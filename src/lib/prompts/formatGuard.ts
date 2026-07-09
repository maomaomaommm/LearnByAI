import { canRenderMath } from "@/lib/katexValidate";
import { normalizeMath } from "@/lib/markdownMath";
import { sanitizeMathDelimiters } from "@/lib/sanitizeMath";

export function preRepairMarkdown(content: string) {
  return escapePipesInTableMath(wrapBareMathParagraphs(repairMarkdownFences(normalizeMath(content))))
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
