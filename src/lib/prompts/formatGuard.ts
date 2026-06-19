import { normalizeMath } from "@/lib/markdownMath";
import { sanitizeMathDelimiters } from "@/lib/sanitizeMath";

export function preRepairMarkdown(content: string) {
  return repairMarkdownFences(normalizeMath(content))
    .replace(/(^|\n)\$\s*\n([\s\S]*?)\n\$\s*(?=\n|$)/gu, (_match, prefix = "", body = "") => {
      return `${prefix}$$\n${body.trim()}\n$$`;
    })
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function postRepairMarkdown(content: string) {
  return sanitizeMathDelimiters(preRepairMarkdown(stripOuterFence(content)));
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
