import { normalizeMath } from "@/lib/markdownMath";

export function preRepairMarkdown(content: string) {
  return normalizeMath(content)
    .replace(/(^|\n)\$\s*\n([\s\S]*?)\n\$\s*(?=\n|$)/gu, (_match, prefix = "", body = "") => {
      return `${prefix}$$\n${body.trim()}\n$$`;
    })
    .replace(/```(\w+)?\s*\n([\s\S]*?)$/u, (_match, language = "", body = "") => {
      return `\`\`\`${language}\n${body}\n\`\`\``;
    })
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function postRepairMarkdown(content: string) {
  return preRepairMarkdown(stripOuterFence(content));
}

export function buildFormatGuardPrompt(content: string) {
  const repaired = preRepairMarkdown(content);

  return `# Task: Markdown and LaTeX Format Guard

你是一名教材排版质检员。你的唯一任务是修复下面教材正文中的 Markdown、LaTeX、代码块和标题格式问题。

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

- 禁止出现单行 "$ Y = ..."、"$Y = ..."、孤立 "$"、"\\[...\\]"、"\\(...\\)"。
- 多行推导、cases、aligned、矩阵必须放在块级公式中。
- 条件独立必须写成 \\perp\\!\\!\\!\\perp，禁止 \\perp!!!\\perp。
- 代码必须放在 fenced code block 中，并尽量保留语言名。
- 不要把中文正文放进 $$...$$。
- 不要生成“以下是修复后的内容”之类的前后缀。

待修复正文：

${repaired}`;
}

function stripOuterFence(content: string) {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match?.[1] ?? trimmed;
}
