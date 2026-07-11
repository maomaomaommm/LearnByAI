import { canRenderMath } from "./katexValidate";

export function normalizeMath(content: string) {
  return splitMarkdownFences(content.replace(/\r\n/g, "\n"))
    .map((chunk) => (chunk.fenced ? chunk.content : normalizeMathText(chunk.content)))
    .join("\n");
}

function normalizeMathText(content: string) {
  return normalizeBlockquoteMath(content);
}

function normalizeMathTextWithoutBlockquotes(content: string) {
  const repairedArtifacts = mergeBareRelationPrefixIntoDisplay(repairSplitLineSpacingArtifacts(content));
  const normalizedDelimiters = normalizeDisplayEnvironments(repairedArtifacts)
    .replace(/(?<!\\)\\\[/g, () => "\n$$\n")
    .replace(/(?<!\\)\\\]/g, () => "\n$$\n")
    .replace(/(?<!\\)\\\(/g, "$")
    .replace(/(?<!\\)\\\)/g, "$");

  const lines = normalizeDisplayMathDelimiters(normalizedDelimiters).split("\n");
  const repaired: string[] = [];
  let inDisplayMath = false;
  let inSingleDollarBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const nextTrimmed = lines[index + 1]?.trim();

    if (trimmed === "$$") {
      if (inDisplayMath) {
        while (repaired[repaired.length - 1] === "") repaired.pop();
        repaired.push("$$");
        inDisplayMath = false;
      } else if (shouldOpenExplicitDisplayMath(nextNonEmptyTrimmed(lines, index + 1))) {
        repaired.push("$$");
        inDisplayMath = true;
      }
      continue;
    }

    if (inDisplayMath) {
      if (!trimmed && repaired[repaired.length - 1] === "$$") continue;
      repaired.push(cleanMathText(line));
      continue;
    }

    if (inSingleDollarBlock) {
      if (trimmed === "$") {
        repaired.push("$$");
        inSingleDollarBlock = false;
        continue;
      }

      if (!trimmed) {
        repaired.push("$$", "");
        inSingleDollarBlock = false;
        continue;
      }

      if (hasClosingSingleDollar(trimmed)) {
        repaired.push(cleanMathLine(trimmed), "$$");
        inSingleDollarBlock = false;
        continue;
      }

      if (isLikelyMathLine(trimmed)) {
        repaired.push(cleanMathText(line));
        continue;
      }

      repaired.push("$$", line);
      inSingleDollarBlock = false;
      continue;
    }

    if (trimmed === "$") {
      repaired.push("$$");
      inSingleDollarBlock = true;
      continue;
    }

    if (getMathEnvironmentBegin(trimmed)) {
      const environment = collectMathEnvironment(lines, index);
      repaired.push("", "$$", ...environment.lines.map(cleanMathText), "$$", "");
      index = environment.endIndex;
      continue;
    }

    if (isBareDisplayMathLine(trimmed)) {
      repaired.push("", "$$", cleanMathLine(trimmed));
      if (nextTrimmed === "$") {
        repaired.push("$$", "");
        index += 1;
      } else if (hasClosingSingleDollar(trimmed)) {
        repaired.push("$$", "");
      } else {
        inSingleDollarBlock = true;
      }
      continue;
    }

    if (isLikelyMathLine(trimmed)) {
      repaired.push("", "$$", cleanMathText(line));
      while (isLikelyMathContinuation(lines[index + 1]?.trim() ?? "")) {
        index += 1;
        repaired.push(cleanMathText(lines[index]));
      }
      repaired.push("$$", "");
      continue;
    }

    repaired.push(line);
  }

  if (inDisplayMath || inSingleDollarBlock) repaired.push("$$");

  const healedFragments = repairFragmentedDisplayMath(repaired.join("\n").replace(/\n{3,}/g, "\n\n"));
  return escapeTextModeUnderscores(normalizeKatexTags(healedFragments));
}

/**
 * Examples and definitions are often emitted as Markdown blockquotes. A raw
 * LaTex line inside one used to bypass every formula heuristic because the
 * leading `>` made it look like ordinary prose. Normalize the quoted payload
 * first, then put the quote markers back so remark-math can render its
 * $$...$$ blocks inside the callout.
 */
function normalizeBlockquoteMath(content: string) {
  const lines = content.split("\n");
  const output: string[] = [];
  let normal: string[] = [];
  let index = 0;

  const flushNormal = () => {
    if (normal.length === 0) return;
    output.push(...normalizeMathTextWithoutBlockquotes(normal.join("\n")).split("\n"));
    normal = [];
  };

  while (index < lines.length) {
    if (!/^\s*>\s?/u.test(lines[index] ?? "")) {
      normal.push(lines[index] ?? "");
      index += 1;
      continue;
    }

    flushNormal();
    const quoted: string[] = [];
    while (index < lines.length && /^\s*>\s?/u.test(lines[index] ?? "")) {
      quoted.push((lines[index] ?? "").replace(/^\s*>\s?/u, ""));
      index += 1;
    }

    const normalized = normalizeMathTextWithoutBlockquotes(quoted.join("\n"));
    output.push(...normalized.split("\n").map((line) => line ? `> ${line}` : ">"));
  }

  flushNormal();
  return output.join("\n");
}

function repairSplitLineSpacingArtifacts(content: string) {
  return content.replace(
    /\\{1,2}[ \t]*\n\$\$[ \t]*\n[ \t]*(\d+(?:\.\d+)?(?:pt|em|ex|mm|cm))\][ \t]*\n([\s\S]*?)[ \t]*\n\$\$[ \t]*(?:\n|$)/gu,
    (_match, spacing: string, body: string) => {
      const remainder = body.replace(/^\n+|\n+$/gu, "");
      return `\\\\[${spacing}]\n${remainder ? `${remainder}\n` : ""}`;
    },
  );
}

function mergeBareRelationPrefixIntoDisplay(content: string) {
  const lines = content.split("\n");

  for (let openIndex = 0; openIndex < lines.length; openIndex += 1) {
    if (lines[openIndex]?.trim() !== "$$") continue;

    let closeIndex = openIndex + 1;
    while (closeIndex < lines.length && lines[closeIndex]?.trim() !== "$$") closeIndex += 1;
    if (closeIndex >= lines.length) break;

    let relationIndex = openIndex - 1;
    while (relationIndex >= 0 && !lines[relationIndex]?.trim()) relationIndex -= 1;
    if (relationIndex < 0) {
      openIndex = closeIndex;
      continue;
    }

    const relationLine = lines[relationIndex]!.trim();
    const relationOnly = /^&?\s*\\(?:le|leq|ge|geq|lt|gt|ne|neq|approx|sim)\s*$/u.test(relationLine);
    const relationAtEnd = /\\(?:le|leq|ge|geq|lt|gt|ne|neq|approx|sim)\s*$/u.test(relationLine);
    const prefixLines = relationOnly
      ? findBareRelationLeftHandSide(lines, relationIndex).map((line) => line.trim())
      : relationAtEnd
        ? [relationLine]
        : [];
    if (prefixLines.length === 0 || !isLikelyBareRelationPrefix(prefixLines.join("\n"))) {
      openIndex = closeIndex;
      continue;
    }

    const body = lines.slice(openIndex + 1, closeIndex).map((line) => line.trim());
    const candidate = [...prefixLines, ...body].join("\n").trim();
    if (!canRenderMath(candidate, true)) {
      openIndex = closeIndex;
      continue;
    }

    const startIndex = relationOnly ? previousNonEmptyLineIndex(lines, relationIndex - 1) : relationIndex;
    lines.splice(startIndex, closeIndex - startIndex + 1, "$$", ...prefixLines, ...body, "$$");
    openIndex = startIndex + prefixLines.length + body.length + 1;
  }

  return lines.join("\n");
}

function findBareRelationLeftHandSide(lines: string[], relationIndex: number) {
  const leftIndex = previousNonEmptyLineIndex(lines, relationIndex - 1);
  if (leftIndex < 0) return [];
  return [lines[leftIndex]!, lines[relationIndex]!];
}

function previousNonEmptyLineIndex(lines: string[], startIndex: number) {
  for (let index = startIndex; index >= 0; index -= 1) {
    if (lines[index]?.trim()) return index;
  }
  return -1;
}

function isLikelyBareRelationPrefix(value: string) {
  if (!value || /[$\u4e00-\u9fff]/u.test(value)) return false;
  if (hasPlainTextWords(value)) return false;
  return /[A-Za-z0-9]/u.test(value) && /[_^{}|()[\]\\]/u.test(value);
}

function splitMarkdownFences(content: string) {
  const chunks: { content: string; fenced: boolean }[] = [];
  const lines = content.split("\n");
  let current: string[] = [];
  let fenced = false;
  let fenceMarker = "";

  const flush = () => {
    if (current.length > 0) chunks.push({ content: current.join("\n"), fenced });
    current = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u);

    if (!fenced && fenceMatch) {
      flush();
      fenced = true;
      fenceMarker = fenceMatch[1][0];
      current.push(line);
      continue;
    }

    if (fenced) {
      current.push(line);
      if (fenceMatch?.[1].startsWith(fenceMarker)) {
        flush();
        fenced = false;
        fenceMarker = "";
      }
      continue;
    }

    current.push(line);
  }

  flush();
  return chunks;
}

function normalizeDisplayEnvironments(content: string) {
  return content
    .replace(/\\begin\{equation\*?\}/gu, () => "\n$$\n")
    .replace(/\\end\{equation\*?\}/gu, () => "\n$$\n")
    .replace(/\\begin\{displaymath\}/gu, () => "\n$$\n")
    .replace(/\\end\{displaymath\}/gu, () => "\n$$\n")
    .replace(/\\begin\{align\*?\}/gu, "\\begin{aligned}")
    .replace(/\\end\{align\*?\}/gu, "\\end{aligned}")
    .replace(/\\begin\{gather\*?\}/gu, "\\begin{gathered}")
    .replace(/\\end\{gather\*?\}/gu, "\\end{gathered}")
    .replace(/\\begin\{alignat\*?\}/gu, "\\begin{alignedat}")
    .replace(/\\end\{alignat\*?\}/gu, "\\end{alignedat}");
}

function normalizeDisplayMathDelimiters(content: string) {
  const output: string[] = [];

  for (const line of content.split("\n")) {
    if (!line.includes("$$")) {
      output.push(line);
      continue;
    }

    if (line.trim() === "$$") {
      output.push("$$");
      continue;
    }

    const parts = line.split("$$");
    for (let index = 0; index < parts.length; index += 1) {
      const isBeforeDelimiter = index < parts.length - 1;
      const part =
        index === 0
          ? parts[index].trimEnd()
          : isBeforeDelimiter
            ? parts[index].trim()
            : parts[index].trimStart();

      if (part) output.push(part);
      if (isBeforeDelimiter) output.push("$$");
    }
  }

  return output.join("\n");
}

/**
 * Long model outputs occasionally close a display fence before a fraction,
 * root, or trailing numeric result is complete:
 *
 * $$ \sqrt{\frac{... $$  }{4} } \approx 0.381.
 *
 * This is neither a syntax typo nor a renderer issue: it is a Markdown fence
 * fracture. Join only mathematically-shaped continuation lines back into the
 * preceding display block, stopping as soon as prose resumes.
 */
function repairFragmentedDisplayMath(content: string) {
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== "$$") continue;

    let closeIndex = index + 1;
    while (closeIndex < lines.length && lines[closeIndex]?.trim() !== "$$") closeIndex += 1;
    if (closeIndex >= lines.length) break;

    const body = lines.slice(index + 1, closeIndex);
    let braceDepth = mathBraceDepth(body.join("\n"));
    let expectsContinuation = endsWithMathContinuation(body.join("\n"));
    if (braceDepth <= 0 && !expectsContinuation) {
      index = closeIndex;
      continue;
    }

    let cursor = closeIndex + 1;
    const continuation: string[] = [];
    while (cursor < lines.length) {
      const candidate = lines[cursor] ?? "";
      const trimmed = candidate.trim();
      if (!trimmed) {
        cursor += 1;
        continue;
      }
      if (trimmed === "$$") break;
      if (!isDetachedDisplayMathContinuation(trimmed, braceDepth, expectsContinuation)) break;

      continuation.push(cleanMathText(candidate));
      braceDepth += mathBraceDepth(candidate);
      expectsContinuation = endsWithMathContinuation([...body, ...continuation].join("\n"));
      cursor += 1;
    }

    if (continuation.length === 0) {
      index = closeIndex;
      continue;
    }

    lines.splice(index, cursor - index, "$$", ...body, ...continuation, "$$");
    index += body.length + continuation.length + 1;
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function mathBraceDepth(value: string) {
  let depth = 0;
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
  }
  return depth;
}

function endsWithMathContinuation(value: string) {
  const last = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";
  return /(?:=|\\(?:approx|sim|le|leq|ge|geq|to|mapsto|Rightarrow|Leftarrow)|[+\-*/])\s*$/u.test(last);
}

function isDetachedDisplayMathContinuation(value: string, braceDepth: number, expectsContinuation: boolean) {
  if (hasProseCjk(value)) return false;
  if (/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|:::|\|.*\|)$/u.test(value)) return false;
  if (value.includes("![") || value.includes("](") || value.includes("<!--")) return false;

  const fragmentLike =
    /^[})\]]/u.test(value) ||
    /^[=+*/]/u.test(value) ||
    /^\\(?:approx|sim|le|leq|ge|geq|ne|neq|times|cdot|div|qquad|quad)\b/u.test(value) ||
    /^[+-]?\d+(?:\.\d+)?[.,]?$/u.test(value) ||
    /^(?:\d+(?:\.\d+)?|[()\-+*/]).*[=+*/^()\\{}]/u.test(value) ||
    isLikelyMathLine(value);

  return fragmentLike && (braceDepth > 0 || expectsContinuation || /^[=+*/\\]/u.test(value));
}

function nextNonEmptyTrimmed(lines: string[], startIndex: number) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function shouldOpenExplicitDisplayMath(trimmed: string) {
  if (!trimmed || trimmed === "$" || trimmed === "$$") return false;
  if (/^(```|~~~|#{1,6}\s|[-*+]\s|\d+\.\s|>)/u.test(trimmed)) return false;
  if (isMarkdownTableLine(trimmed)) return false;
  if (/[\u4e00-\u9fff]/u.test(trimmed) && !/^\\(?:begin|text|mathrm|operatorname)\b/u.test(trimmed)) {
    return false;
  }
  if (hasPlainTextWords(trimmed) && !/^\\/.test(trimmed)) return false;
  return true;
}

function cleanMathLine(line: string) {
  return line
    .replace(/^\$\s*/u, "")
    .replace(/\s*\$$/u, "")
    .replace(/\\perp!+\\perp/g, "\\perp\\!\\!\\!\\perp")
    .trim();
}

function cleanMathText(line: string) {
  return line
    .replace(/\\perp!+\\perp/g, "\\perp\\!\\!\\!\\perp")
    .trim();
}

function getMathEnvironmentBegin(trimmed: string) {
  return trimmed.match(
    /\\begin\{(aligned|alignedat|cases|array|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|split|gathered)\}/u,
  )?.[1];
}

function collectMathEnvironment(lines: string[], startIndex: number) {
  const linesInEnvironment: string[] = [];
  const environment = getMathEnvironmentBegin(lines[startIndex].trim());
  let depth = 0;
  let endIndex = startIndex;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    linesInEnvironment.push(line);
    endIndex = index;

    if (environment) {
      const beginMatches = trimmed.match(new RegExp(`\\\\begin\\{${environment}\\}`, "gu")) ?? [];
      const endMatches = trimmed.match(new RegExp(`\\\\end\\{${environment}\\}`, "gu")) ?? [];
      depth += beginMatches.length - endMatches.length;
      if (index > startIndex && depth <= 0) break;
    }

    if (!environment && index > startIndex && !isLikelyMathContinuation(lines[index + 1]?.trim() ?? "")) {
      break;
    }
  }

  return {
    endIndex,
    lines: linesInEnvironment,
  };
}

function hasProseCjk(value: string) {
  // CJK inside LaTeX text commands (\text{\u4e2d\u6587}, \operatorname{...}) is legitimate
  // formula content \u2014 strip those before deciding whether a line is prose, so a
  // bare display formula like "\max ... \text{\u5176\u4e2d } a_i^* = ..." is still treated
  // as math and gets wrapped in $$ instead of leaking as literal LaTeX.
  const stripped = value.replace(
    /\\(?:text|textbf|textit|textrm|textsf|texttt|mathrm|mathbf|mathsf|mathtt|operatorname)\s*\{[^{}]*\}/gu,
    "",
  );
  return /[\u4e00-\u9fff]/u.test(stripped);
}

function isBareDisplayMathLine(trimmed: string) {
  if (!trimmed.startsWith("$") || trimmed.startsWith("$$")) return false;
  if (hasProseCjk(trimmed)) return false;
  const closingDollarIndex = findUnescapedDollar(trimmed, 1);
  if (closingDollarIndex >= 0 && trimmed.slice(closingDollarIndex + 1).trim()) return false;

  const math = cleanMathLine(trimmed);
  if (!math) return false;

  return /\\|=|[{}_^]|[A-Za-z]\s*\(|\b(mid|sum|prod|frac|tau|beta|gamma|epsilon)\b/.test(math);
}

function hasClosingSingleDollar(trimmed: string) {
  return /^\$[\s\S]*[^\\]\$\s*$/u.test(trimmed);
}

function isLikelyMathContinuation(trimmed: string) {
  if (!trimmed || trimmed === "$" || trimmed === "$$") return false;
  if (hasProseCjk(trimmed)) return false;
  if (hasPlainTextWords(trimmed) && !/^\\/.test(trimmed) && !hasStrongMathSyntax(trimmed)) return false;
  return (
    isLikelyMathLine(trimmed) ||
    /^[&=+\-*/\\|]/u.test(trimmed) ||
    /(?:&?=|<=|>=|\\leq|\\geq|\\approx|\\sim|\\in)\s*/u.test(trimmed) ||
    /\\\\\s*$/u.test(trimmed)
  );
}

function isLikelyMathLine(trimmed: string) {
  if (!trimmed || hasProseCjk(trimmed)) return false;
  if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>)/u.test(trimmed)) return false;
  if (isMarkdownTableLine(trimmed)) return false;
  if (/^(import|from|def|class|return|const|let|var|if|for|while)\b/u.test(trimmed)) return false;
  if (trimmed.includes("$") && !trimmed.startsWith("$")) return false;
  if (hasPlainTextWords(trimmed) && !/^\\/.test(trimmed) && !hasStrongMathSyntax(trimmed)) return false;

  return (
    /\\(begin|end)\{(aligned|alignedat|cases|array|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|split|gathered)\}/u.test(
      trimmed,
    ) ||
    /\\(operatorname|mathrm|mathbf|mathcal|mathbb|frac|dfrac|tfrac|sum|prod|int|lim|log|ln|exp|times|cdot|div|pm|mp|Pr|P|E|Var|Cov|hat|bar|tilde|sqrt|theta|lambda|alpha|beta|gamma|delta|epsilon|varepsilon|sigma|mu|tau|phi|psi|omega|pi|rho|eta|kappa|ldots|cdots|mapsto|to|Rightarrow|Leftarrow|leftrightarrow|infty)(?=[^A-Za-z]|$)/u.test(
      trimmed,
    ) ||
    /[A-Za-z0-9)}\]]\s*[_^]\s*\{?[\w\\]/u.test(trimmed) ||
    /\\[()[\]{}]/u.test(trimmed)
  );
}

function hasStrongMathSyntax(trimmed: string) {
  return (
    /\\(operatorname|mathrm|mathbf|mathcal|mathbb|frac|dfrac|tfrac|sum|prod|int|lim|log|ln|exp|times|cdot|div|pm|mp|Pr|P|E|Var|Cov|hat|bar|tilde|sqrt|vec|sin|cos|tan|left|right|le|leq|ge|geq|ne|neq|approx|sim|theta|lambda|alpha|beta|gamma|delta|epsilon|varepsilon|sigma|mu|tau|phi|psi|omega|pi|rho|eta|kappa|ldots|cdots|mapsto|to|Rightarrow|Leftarrow|leftrightarrow|infty)(?=[^A-Za-z]|$)/u.test(
      trimmed,
    ) ||
    (/[=<>]/u.test(trimmed) && /[A-Za-z0-9)}\]]\s*[_^]\s*\{?[\w\\]/u.test(trimmed))
  );
}

function isMarkdownTableLine(trimmed: string) {
  if (!trimmed.startsWith("|")) return false;
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(trimmed)) return true;
  if (/^\|[^|\n]+\|$/u.test(trimmed) && /[_^{}\\A-Za-z0-9]/u.test(trimmed) && canRenderMath(trimmed, true)) {
    return false;
  }
  if (hasStrongMathSyntax(trimmed)) return false;
  return (trimmed.match(/\|/gu) ?? []).length >= 2;
}

function hasPlainTextWords(trimmed: string) {
  const withoutLatexText = trimmed
    .replace(/\\(?:text|operatorname|mathrm|mathbf|mathcal|mathbb)\{[^}]*\}/gu, "")
    .replace(/\\[A-Za-z]+/gu, "");
  return (withoutLatexText.match(/[A-Za-z]{3,}/gu) ?? []).length >= 2;
}

function findUnescapedDollar(value: string, startIndex: number) {
  for (let index = startIndex; index < value.length; index += 1) {
    if (value[index] === "$" && value[index - 1] !== "\\") return index;
  }
  return -1;
}

function normalizeKatexTags(content: string) {
  return content.replace(/\$\$\n([\s\S]*?)\n\$\$/gu, (match: string, body: string) => {
    const tags = body.match(/\\tag\{[^{}]+\}/gu) ?? [];
    if (tags.length <= 1) return match;
    return `$$\n${body.replace(/\\tag\{([^{}]+)\}/gu, "\\qquad \\text{($1)}")}\n$$`;
  });
}

function escapeTextModeUnderscores(content: string) {
  // KaTeX throws on literal "_" inside text-mode commands such as \text{__end__}.
  return content.replace(
    /(\\(?:text|textbf|textit|textrm|textsf|texttt|mathrm|mathbf|mathsf|mathtt|operatorname)\s*)\{([^{}]*)\}/gu,
    (_match: string, command: string, inner: string) => {
      const safe = inner.replace(/\\?_/g, "\\_");
      return command + "{" + safe + "}";
    },
  );
}
