import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMath } from "@/lib/markdownMath";

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
