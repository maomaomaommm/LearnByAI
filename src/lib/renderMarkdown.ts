import { postRepairMarkdown } from "./prompts/formatGuard";

export function prepareMarkdownForRender(content: string) {
  return hideUnresolvedFigurePlaceholders(postRepairMarkdown(content));
}

export function hideUnresolvedFigurePlaceholders(content: string) {
  return normalizeEscapedFigurePlaceholderBlocks(content).replace(
    /:::learnbyai-figure[^\n]*\n([\s\S]*?)\n:::/gu,
    (_match, body: string) => {
      const caption = readFigureCaption(body) || "插图";
      return `> 图示尚未生成：${caption}。请稍后重试本章生成。`;
    },
  );
}

function normalizeEscapedFigurePlaceholderBlocks(content: string) {
  return content.replace(/:::learnbyai-figure\\n([\s\S]*?)\s*:::/gu, (_match, body: string) => {
    const normalizedBody = body.replace(/\\n/gu, "\n").trim();
    return `:::learnbyai-figure\n${normalizedBody}\n:::`;
  });
}

function readFigureCaption(body: string) {
  for (const line of body.split(/\r?\n/u)) {
    const match = line.match(/^\s*caption\s*:\s*(.*?)\s*$/iu);
    if (match?.[1]) return match[1].replace(/^["']|["']$/gu, "").trim().slice(0, 80);
  }
  return "";
}
