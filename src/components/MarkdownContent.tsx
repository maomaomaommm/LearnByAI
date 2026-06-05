import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export function MarkdownContent({ content }: { content: string }) {
  const normalized = normalizeMath(content);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
    >
      {normalized}
    </ReactMarkdown>
  );
}

function normalizeMath(content: string) {
  return content
    .replace(/\\\[/g, "\n$$\n")
    .replace(/\\\]/g, "\n$$\n")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$")
    .replace(/\$\$\s*/g, "\n$$\n")
    .replace(/\s*\$\$/g, "\n$$\n")
    .replace(/\n{3,}/g, "\n\n");
}
