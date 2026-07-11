import { canRenderMath } from "@/lib/katexValidate";
import { normalizeMath } from "@/lib/markdownMath";
import { sanitizeMathDelimiters } from "@/lib/sanitizeMath";

export function preRepairMarkdown(content: string) {
  const repairedImageSyntax = normalizeEscapedMarkdownImageSyntax(content);
  const normalized = normalizeLooseOrderedLists(
    replaceLegacyImageLinksWithFigurePlaceholders(
      escapePipesInTableMath(
        wrapBareMathParagraphs(
          repairMarkdownFences(
            normalizeMath(
              normalizeTextbookCallouts(repairedImageSyntax),
            ),
          ),
        ),
      ),
    ),
  );
  return normalized
    .replace(/(^|\n)\$\s*\n([\s\S]*?)\n\$\s*(?=\n|$)/gu, (_match, prefix = "", body = "") => {
      return `${prefix}$$\n${body.trim()}\n$$`;
    })
    .replace(/[ \t]+\n/g, "\n")
    // Collapse blank-line runs left behind by removed empty fences so the
    // result is stable under a second pass (the renderer runs this again).
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A model occasionally escapes the brackets in an image token, for example
 * `!\[图示\](images/example.png)`. The math normalizer correctly treats `\[`
 * as a display-math delimiter, so this must run before any LaTeX processing.
 */
function normalizeEscapedMarkdownImageSyntax(content: string) {
  return transformOutsideFences(content, (text) =>
    text
      .replace(/!\\\[([^\]\r\n]*)\\\]\\\(([^)\r\n]+)\\\)/gu, "![$1]($2)")
      .replace(/!\\\[([^\]\r\n]*)\\\]\(([^)\r\n]+)\)/gu, "![$1]($2)")
      .replace(/!\[([^\]\r\n]*)\]\\\(([^)\r\n]+)\\\)/gu, "![$1]($2)"),
  );
}

/**
 * Imported reference documents may contain local image paths such as
 * `images/dp-backup.png`. They cannot be resolved by the web reader or copied
 * into TeX, so convert them to the standard figure protocol. Fresh chapters
 * render the placeholder in the normal figure pipeline; older chapters can be
 * healed with the same pipeline instead of leaking a literal Markdown token.
 */
function replaceLegacyImageLinksWithFigurePlaceholders(content: string) {
  return transformOutsideFences(content, (text) =>
    text.replace(/!\[([^\]\r\n]*)\]\(([^)\r\n]+)\)/gu, (whole, alt: string, url: string) => {
      const source = url.trim();
      if (source.startsWith("/api/illustrations/")) return whole;

      const caption = normalizeLegacyFigureCaption(alt);
      if (!caption) return "";
      return [
        ":::learnbyai-figure",
        `caption: ${caption}`,
        `prompt: 为教材绘制“${caption}”的简洁示意图，突出正文所述的关键对象、关系或流程。`,
        `diagramSpec: ${caption}`,
        "textLabelsAllowed: true",
        ":::",
      ].join("\n");
    }),
  );
}

function normalizeLegacyFigureCaption(alt: string) {
  return alt
    .replace(/^\s*图\s*\d+(?:[.\-]\d+)?\s*[：:、.]?\s*/u, "")
    .replace(/[*_`[\]]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Writers often emit a loose Markdown list as a series of `1.` blocks
 * separated by blank explanatory paragraphs. CommonMark treats those as many
 * independent one-item lists, so both the reader and TeX export show repeated
 * “1.”. Canonicalize them to one ordered list with indented continuations.
 */
function normalizeLooseOrderedLists(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let index = 0;
  let fenceMarker = "";
  let inDisplayMath = false;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = line.match(/^\s*(`{3,}|~{3,})/u);
    if (fence) {
      if (!fenceMarker) fenceMarker = fence[1]![0]!;
      else if (fence[1]![0] === fenceMarker) fenceMarker = "";
      output.push(line);
      index += 1;
      continue;
    }
    if (fenceMarker) {
      output.push(line);
      index += 1;
      continue;
    }
    if (line.trim() === "$$") {
      inDisplayMath = !inDisplayMath;
      output.push(line);
      index += 1;
      continue;
    }
    if (inDisplayMath || !/^\s*\d+[.)]\s+/u.test(line)) {
      output.push(line);
      index += 1;
      continue;
    }

    const parsed = collectLooseOrderedList(lines, index);
    if (!parsed) {
      output.push(line);
      index += 1;
      continue;
    }

    parsed.items.forEach((item, itemIndex) => {
      const clean = trimBlankEdges(item);
      const first = clean.shift() ?? "";
      output.push(`${itemIndex + 1}. ${first}`);
      for (const continuation of clean) {
        output.push(continuation ? `   ${removeOneListIndent(continuation)}` : "");
      }
      if (itemIndex < parsed.items.length - 1 && clean.length > 0) output.push("");
    });
    index = parsed.nextIndex;
  }

  return output.join("\n");
}

function collectLooseOrderedList(lines: string[], startIndex: number) {
  const items: string[][] = [];
  let current: string[] | undefined;
  let index = startIndex;
  let nonListLines = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (/^#{1,6}\s+/u.test(line) || /^\s*:::\s*learnbyai-figure/u.test(line)) break;
    const marker = line.match(/^\s*\d+[.)]\s+([\s\S]*)$/u);
    if (marker) {
      if (current) items.push(current);
      current = [marker[1] ?? ""];
      nonListLines = 0;
      index += 1;
      continue;
    }
    if (!current) break;
    current.push(line);
    if (line.trim()) nonListLines += 1;
    // A normal paragraph after a one-item list should not absorb a whole
    // chapter while we look for another marker.
    if (items.length === 0 && nonListLines > 24) break;
    index += 1;
  }
  if (current) items.push(current);
  return items.length >= 2 ? { items, nextIndex: index } : undefined;
}

function trimBlankEdges(lines: string[]) {
  const output = [...lines];
  while (output[0]?.trim() === "") output.shift();
  while (output.at(-1)?.trim() === "") output.pop();
  return output;
}

function removeOneListIndent(value: string) {
  return value.replace(/^(?: {3}|\t)/u, "");
}

function transformOutsideFences(content: string, transform: (text: string) => string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  const normal: string[] = [];
  let fenceMarker = "";

  const flushNormal = () => {
    if (normal.length) output.push(transform(normal.join("\n")));
    normal.length = 0;
  };

  for (const line of lines) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/u);
    if (!fenceMarker && fence) {
      flushNormal();
      fenceMarker = fence[1]![0]!;
      output.push(line);
      continue;
    }
    if (fenceMarker) {
      output.push(line);
      if (fence?.[1]?.[0] === fenceMarker) fenceMarker = "";
      continue;
    }
    normal.push(line);
  }
  flushNormal();
  return output.join("\n");
}

/**
 * In a Markdown table, `|` is the column separator — but a `|` inside inline math
 * ($...$) is a LaTeX operator (conditional probability `\pi(a|s)`, `p(s',r|s,a)`).
 * Markdown splits the formula across cells and breaks the `$...$`, so the math
 * renders as raw source and spills into the next column. Rewrite those pipes to
 * `\mid ` (renders as the same vertical bar, but contains no literal `|` to break
 * the row). Only touches `|` inside `$...$` on table rows — never absolute-value
 * bars in display math or ordinary prose.
 */
function escapePipesInTableMath(content: string) {
  return content
    .split("\n")
    .map((line) => {
      if (!/^\s*\|.*\|/u.test(line)) return line; // not a table row
      return line.replace(/\$(?!\$)([^$\n]+?)\$/gu, (whole, inner: string) =>
        inner.includes("|") ? `$${inner.replace(/(?<!\\)\|/gu, "\\mid ")}$` : whole,
      );
    })
    .join("\n");
}

export function postRepairMarkdown(content: string) {
  return sanitizeMathDelimiters(preRepairMarkdown(stripOuterFence(content)));
}

/**
 * Heal whole paragraphs of naked LaTeX that the line-level heuristics in
 * markdownMath can't see. Long model outputs sometimes emit an entire display
 * formula with NO delimiters at all, split across lines, e.g.
 *
 *   (P r)(\text{晴})
 *   =
 *   0.8\times 1+0.2\times (-1)
 *   =0.6.
 *
 * The first line starts with "(" — no strong-command prefix — so per-line
 * wrapping misses it and the whole block renders as broken plain text (the
 * dominant "formula looks broken" failure in real long chapters). Instead of
 * growing regex lists forever, this pass works at paragraph granularity with
 * KaTeX itself as the judge: a paragraph outside any fence/$$ that contains a
 * LaTeX command, has no prose (no CJK outside \text{}, no English sentences),
 * no $ delimiters — and that KaTeX can render as a whole — is a bare display
 * formula and gets wrapped in $$.
 */
function wrapBareMathParagraphs(content: string) {
  const lines = content.split("\n");
  const out: string[] = [];
  let inFence = false;
  let inMath = false;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (/^(```|~~~)/u.test(trimmed)) {
      inFence = !inFence;
      out.push(line);
      index += 1;
      continue;
    }
    if (inFence || inMath || !trimmed) {
      if (trimmed === "$$") inMath = !inMath;
      out.push(line);
      index += 1;
      continue;
    }
    if (trimmed === "$$") {
      inMath = true;
      out.push(line);
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = (lines[index] ?? "").trim();
      if (!current || current === "$$" || /^(```|~~~)/u.test(current)) break;
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    out.push(...(tryWrapBareMathParagraph(paragraph) ?? paragraph));
  }

  return out.join("\n");
}

function tryWrapBareMathParagraph(paragraph: string[]): string[] | undefined {
  const trimmedLines = paragraph.map((line) => line.trim());
  // Never touch structured Markdown (headings, lists, quotes, tables, figure
  // blocks). A leading "|" only means "table row" when the line also ends with
  // one — |G_t| \leq ... is an absolute value, not a table.
  if (trimmedLines.some((line) => /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|:::)/u.test(line) || (line.startsWith("|") && line.endsWith("|")))) {
    return undefined;
  }
  const joined = trimmedLines.join("\n");
  if (joined.length < 4) return undefined;
  if (/(?<!\\)\$/u.test(joined)) return undefined; // already delimited somewhere
  if (joined.includes("![") || joined.includes("](") || joined.includes("<!--")) return undefined;
  if (!/\\[A-Za-z]+/u.test(joined)) return undefined; // needs a real LaTeX command
  if (hasProseCjkOutsideTextCommands(joined)) return undefined;
  if (hasPlainProseWords(joined)) return undefined;
  if (!canRenderMath(joined, true)) return undefined; // KaTeX has the final say
  return ["$$", ...trimmedLines, "$$"];
}

function hasProseCjkOutsideTextCommands(value: string) {
  const stripped = value.replace(
    /\\(?:text|textbf|textit|textrm|textsf|texttt|mathrm|mathbf|mathsf|mathtt|operatorname)\s*\{[^{}]*\}/gu,
    "",
  );
  return /[一-鿿]/u.test(stripped);
}

function hasPlainProseWords(value: string) {
  const stripped = value
    .replace(/\\(?:text|textbf|textit|textrm|textsf|texttt|mathrm|mathbf|operatorname)\s*\{[^{}]*\}/gu, "")
    .replace(/\\[A-Za-z]+/gu, "");
  return (stripped.match(/[A-Za-z]{3,}/gu) ?? []).length >= 3;
}

export function buildFormatGuardPrompt(content: string) {
  const repaired = preRepairMarkdown(content);

  return `# Task: Markdown and LaTeX Format Guard

你是一名中文教材排版质检员。你的唯一任务是修复下面教材正文中的 Markdown、LaTeX、代码块和标题格式问题。

硬性要求：
- 只修格式，不扩写、不删减知识点、不改变论证顺序。
- 不输出解释，不输出 JSON，不输出审查报告，只输出修复后的完整 Markdown 正文。
- 保留中文正文含义。
- 保留原有章节标题和小节标题，但可以修正明显错误的 Markdown 标题层级。
- 行内公式必须是 $...$。
- 块级公式必须是：

$$
公式
$$

- 禁止出现单行 "$ Y = ..."、"$Y = ..."、孤立 "$"、\\[...\\]、\\(...\\)。
- 多行推导、cases、aligned、矩阵必须放在块级公式中。
- 条件独立必须写成 \\perp\\!\\!\\!\\perp，禁止 \\perp!!!\\perp。
- 代码必须放在 fenced code block 中，并尽量保留语言名。
- 删除空代码块和多余的连续 fence，例如正文末尾的单独 \`\`\` 或 \`\`\`\n\`\`\`。
- 不要把中文正文放进 $$...$$。
- 若发现 $$ 或 $ 包裹的是中文正文 / 习题标题 / 说明文字，删除这对美元符号，把它还原成普通文本。
- \\text、\\mathrm、\\operatorname 等文本命令的花括号内如含下划线，必须转义为 \\_（如 \\text{\\_\\_end\\_\\_}），禁止出现裸下划线。
- 不要生成“以下是修复后的内容”之类的前后缀。

待修复正文：

${repaired}`;
}

function stripOuterFence(content: string) {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match?.[1] ?? trimmed;
}

function repairMarkdownFences(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const repaired: string[] = [];
  let inFence = false;
  let fenceStart = -1;

  for (const line of lines) {
    const isFence = /^\s*(`{3,}|~{3,})/.test(line);
    if (!isFence) {
      repaired.push(line);
      continue;
    }

    if (!inFence) {
      inFence = true;
      fenceStart = repaired.length;
      repaired.push(line);
      continue;
    }

    const body = repaired.slice(fenceStart + 1).join("\n").trim();
    if (!body) {
      repaired.splice(fenceStart, repaired.length - fenceStart);
    } else if (isAccidentallyFencedMathProse(repaired[fenceStart] ?? "", body)) {
      repaired.splice(fenceStart, repaired.length - fenceStart, ...body.split("\n"));
    } else {
      repaired.push(line);
    }
    inFence = false;
    fenceStart = -1;
  }

  if (inFence) {
    const body = repaired.slice(fenceStart + 1).join("\n").trim();
    if (body) repaired.push("```");
    else repaired.splice(fenceStart, repaired.length - fenceStart);
  }

  return repaired.join("\n").replace(/\n```[ \t]*\n```[ \t]*$/u, "").trim();
}

/**
 * Examples and definitions are textbook elements, not quotations. Older
 * writers emitted them as `>` blocks, which made the reader apply the visual
 * language of a social-media callout: border, tinted background and italics.
 * Canonicalize the legacy form to a bold textbook lead-in followed by ordinary
 * prose so web, PDF and TeX all share the same semantics.
 */
function normalizeTextbookCallouts(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!/^\s*>\s?/u.test(lines[index] ?? "")) {
      output.push(lines[index] ?? "");
      index += 1;
      continue;
    }

    const quoted: string[] = [];
    const original: string[] = [];
    while (index < lines.length && /^\s*>\s?/u.test(lines[index] ?? "")) {
      original.push(lines[index] ?? "");
      quoted.push((lines[index] ?? "").replace(/^\s*>\s?/u, ""));
      index += 1;
    }

    const first = quoted.findIndex((line) => line.trim().length > 0);
    const title = first >= 0 ? textbookCalloutTitle(quoted[first] ?? "") : undefined;
    if (!title || first < 0) {
      output.push(...original);
      continue;
    }

    output.push(`**${title}**`);
    const body = quoted.slice(first + 1);
    while (body[0]?.trim() === "") body.shift();
    while (body.at(-1)?.trim() === "") body.pop();
    if (body.length > 0) {
      const normalizedBody: string[] = [];
      for (const line of body) {
        const nestedTitle = textbookCalloutTitle(line);
        if (nestedTitle) {
          while (normalizedBody.at(-1)?.trim() === "") normalizedBody.pop();
          normalizedBody.push("", `**${nestedTitle}**`, "");
        } else {
          normalizedBody.push(line);
        }
      }
      while (normalizedBody.at(-1)?.trim() === "") normalizedBody.pop();
      output.push("", ...normalizedBody, "");
    }
  }

  return output.join("\n");
}

function textbookCalloutTitle(value: string) {
  const title = value
    .trim()
    .replace(/^(?:\*\*|__)([\s\S]*?)(?:\*\*|__)$/u, "$1")
    .trim();
  return /^(?:例|定义)(?=\s|[0-9一二三四五六七八九十]|[：:])/u.test(title) ? title : undefined;
}

function isAccidentallyFencedMathProse(opener: string, body: string) {
  const language = opener.replace(/^\s*(?:`{3,}|~{3,})/u, "").trim().toLowerCase();
  if (language && !["text", "markdown", "md"].includes(language)) return false;
  if (!/[\u4e00-\u9fff]/u.test(body) || !/\$[^$\n]{1,200}\$/u.test(body)) return false;
  if (/^\s*(?:caption|prompt|diagramSpec|textLabelsAllowed)\s*:/imu.test(body)) return false;
  if (/(?:=>|->|<-|[{};]|\b(?:class|const|def|for|function|if|import|return|while)\b)/iu.test(body)) return false;
  return true;
}
