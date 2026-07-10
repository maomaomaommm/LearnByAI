import { canRenderMath } from "./katexValidate";

type Zone = { type: "normal" | "fenced" | "display_math"; lines: string[] };

const SHORT_MATH_IDENTIFIER_STOP_WORDS = new Set([
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "for",
  "go",
  "he",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "no",
  "not",
  "of",
  "on",
  "or",
  "so",
  "the",
  "to",
  "up",
  "us",
  "we",
  "you",
]);

export function sanitizeMathDelimiters(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const zones = splitZones(normalized);

  const repairNormal = (text: string) =>
    splitInlineCodeSpans(text)
      .map((chunk) => (chunk.code ? chunk.content : scanAndRepairSegment(unescapeRenderableDollarMath(chunk.content))))
      .join("");

  if (zones.length === 1 && zones[0]!.type === "normal") {
    return repairNormal(zones[0]!.lines.join("\n"));
  }

  return zones
    .map((zone) =>
      zone.type === "normal"
        ? repairNormal(zone.lines.join("\n"))
        : zone.type === "display_math"
          ? repairDisplayMathZone(zone.lines)
          : zone.lines.join("\n"),
    )
    .join("\n");
}

function repairDisplayMathZone(lines: string[]): string {
  if (lines.length < 2) return lines.join("\n");

  const first = lines[0]!;
  const last = lines[lines.length - 1]!;
  if (first.trim() !== "$$" || last.trim() !== "$$") return lines.join("\n");

  let body = lines.slice(1, -1);
  const firstBody = body.findIndex((line) => line.trim());
  const lastBodyFromEnd = [...body].reverse().findIndex((line) => line.trim());
  const lastBody = lastBodyFromEnd >= 0 ? body.length - 1 - lastBodyFromEnd : -1;

  // Common model error: wrapping display math in both $$...$$ and inner $...$.
  if (firstBody >= 0 && lastBody >= firstBody && body[firstBody]!.trim() === "$" && body[lastBody]!.trim() === "$") {
    body = body.filter((_line, index) => index !== firstBody && index !== lastBody);
  }

  body = body.map(cleanDisplayMathLine).filter((line) => line.trim() !== "$");

  return [first.trim(), ...body, last.trim()].join("\n");
}

function cleanDisplayMathLine(line: string): string {
  // Inside $$...$$, a Markdown dollar is almost always leaked delimiter noise.
  return line.replace(/\\?\$/gu, "").trimEnd();
}

function unescapeRenderableDollarMath(text: string): string {
  return text.replace(/\\\$\s*([^\n$]{1,200}?)\s*\\\$/gu, (match, inner: string) => {
    const candidate = inner.trim();
    if (isRenderableInlineMath(candidate)) {
      return `$${candidate}$`;
    }
    return match;
  });
}

function splitZones(content: string): Zone[] {
  const lines = content.split("\n");
  const zones: Zone[] = [];
  let current: Zone = { type: "normal", lines: [] };
  let inFence = false;
  let fenceChar = "";
  let inDisplayMath = false;

  const flush = () => {
    if (current.lines.length > 0) zones.push(current);
    current = { type: "normal", lines: [] };
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/u);

    if (inFence) {
      current.lines.push(line);
      if (fenceMatch && fenceMatch[2]![0] === fenceChar && fenceMatch[2]!.length >= 3) {
        inFence = false;
        flush();
      }
      continue;
    }

    if (fenceMatch) {
      flush();
      current = { type: "fenced", lines: [line] };
      inFence = true;
      fenceChar = fenceMatch[2]![0]!;
      continue;
    }

    if (inDisplayMath) {
      current.lines.push(line);
      if (trimmed === "$$") {
        inDisplayMath = false;
        flush();
      }
      continue;
    }

    if (trimmed === "$$") {
      flush();
      current = { type: "display_math", lines: [line] };
      inDisplayMath = true;
      continue;
    }

    if (current.type !== "normal") {
      current = { type: "normal", lines: [line] };
    } else {
      current.lines.push(line);
    }
  }

  flush();
  return zones;
}

function scanAndRepairSegment(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i += 1) {
    if (!isUnescapedSingleDollar(text, i)) {
      result += text[i]!;
      continue;
    }

    const closeIdx = findRenderableClosingDollar(text, i + 1);
    if (closeIdx < 0) {
      result += "\\$";
      continue;
    }

    result += `$${text.slice(i + 1, closeIdx).trim()}$`;
    i = closeIdx;
  }
  return result;
}

function findRenderableClosingDollar(text: string, start: number): number {
  for (let i = start; i < text.length; i += 1) {
    if (!isUnescapedSingleDollar(text, i)) continue;
    if (isRenderableInlineMath(text.slice(start, i))) return i;
  }
  return -1;
}

function isUnescapedSingleDollar(text: string, index: number) {
  return text[index] === "$" && text[index - 1] !== "\\" && text[index - 1] !== "$" && text[index + 1] !== "$";
}

function isRenderableInlineMath(enclosed: string): boolean {
  const candidate = enclosed.trim();
  if (!candidate) return false;
  if (candidate.includes("\n")) return false;
  if (candidate.length > 200) return false;
  if (hasUnescapedSingleDollar(candidate)) return false;
  if (/[，。；：？！、]/u.test(candidate)) return false;

  const withoutTextCommands = stripLatexTextCommandBodies(candidate);
  if (/[\u4e00-\u9fff]/u.test(withoutTextCommands)) return false;
  if (!looksLikeInlineMath(candidate)) return false;

  return canRenderMath(candidate, false);
}

function looksLikeInlineMath(value: string): boolean {
  const compact = value.trim();
  const withoutTextCommands = stripLatexTextCommandBodies(compact);
  const withoutCommands = withoutTextCommands.replace(/\\[a-zA-Z]+/gu, "");

  if (/\\[a-zA-Z]+/u.test(compact)) return true;
  if (/[_^{}=<>+\-*\/|()\[\]]/u.test(compact)) return true;
  if (/^[A-Za-z](?:\s*,\s*[A-Za-z])+$/u.test(compact)) return true;
  if (isNumericMathLiteral(compact)) return true;
  if (isNumericMathSequence(compact)) return true;
  if (isShortMathIdentifier(compact)) return true;

  // Plain words and currency/unit tokens such as USD are text, not math.
  if (/^[A-Za-z]{2,}$/u.test(withoutCommands)) return false;
  if ((withoutCommands.match(/[A-Za-z]{2,}/gu) ?? []).length >= 1) return false;
  if (/\d/u.test(compact) && /[A-Za-z]/u.test(compact)) return true;
  if (/^[A-Za-z](?:['’])?$/u.test(compact)) return true;
  if (/^[A-Za-z]\d+$/u.test(compact)) return true;
  return false;
}

function isNumericMathLiteral(value: string) {
  return /^[+-]?(?:(?:\d+(?:\.\d+)?)|(?:\.\d+))(?:e[+-]?\d+)?(?:\\%|%)?$/iu.test(value);
}

function isNumericMathSequence(value: string) {
  return /^[+-]?(?:(?:\d+(?:\.\d+)?)|(?:\.\d+))(?:e[+-]?\d+)?(?:\s*[,;]\s*[+-]?(?:(?:\d+(?:\.\d+)?)|(?:\.\d+))(?:e[+-]?\d+)?)+$/iu.test(value);
}

function isShortMathIdentifier(value: string) {
  if (!/^[A-Za-z]{2,3}$/u.test(value)) return false;
  if (/^[A-Z]{2,3}$/u.test(value)) return false;
  return !SHORT_MATH_IDENTIFIER_STOP_WORDS.has(value.toLowerCase());
}

function hasUnescapedSingleDollar(text: string) {
  for (let i = 0; i < text.length; i += 1) {
    if (isUnescapedSingleDollar(text, i)) return true;
  }
  return false;
}

function stripLatexTextCommandBodies(value: string) {
  return value.replace(
    /\\(?:text|textbf|textit|textrm|textsf|texttt|mathrm|mathbf|mathsf|mathtt|operatorname)\s*\{[^{}]*\}/gu,
    "",
  );
}

function splitInlineCodeSpans(text: string): { content: string; code: boolean }[] {
  const chunks: { content: string; code: boolean }[] = [];
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf("`", index);
    if (start < 0) {
      chunks.push({ content: text.slice(index), code: false });
      break;
    }

    let ticks = 1;
    while (text[start + ticks] === "`") ticks += 1;
    const marker = "`".repeat(ticks);
    const end = text.indexOf(marker, start + ticks);
    if (end < 0) {
      chunks.push({ content: text.slice(index), code: false });
      break;
    }

    if (start > index) chunks.push({ content: text.slice(index, start), code: false });
    chunks.push({ content: text.slice(start, end + ticks), code: true });
    index = end + ticks;
  }

  return chunks;
}
