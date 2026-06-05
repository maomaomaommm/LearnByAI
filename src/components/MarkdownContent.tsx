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
  const normalizedDelimiters = content
    .replace(/\r\n/g, "\n")
    .replace(/\\\[/g, "\n$$\n")
    .replace(/\\\]/g, "\n$$\n")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");

  const lines = normalizedDelimiters.split("\n");
  const repaired: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const nextTrimmed = lines[index + 1]?.trim();

    if (trimmed === "$") {
      repaired.push("$$");
      continue;
    }

    if (trimmed.startsWith("$ ") && !trimmed.startsWith("$$")) {
      const math = trimmed.slice(1).trim().replace(/\$$/, "").trim();
      repaired.push("", "$$", math, "$$", "");
      if (nextTrimmed === "$") index += 1;
      continue;
    }

    if (
      /\\begin\{(aligned|align|cases|matrix|pmatrix|bmatrix)\}/.test(trimmed) &&
      !trimmed.includes("$$")
    ) {
      repaired.push("", "$$", trimmed.replace(/^\$/, "").replace(/\$$/, "").trim(), "$$", "");
      continue;
    }

    repaired.push(line);
  }

  return repaired
    .join("\n")
    .replace(/\$\$\s*/g, "\n$$\n")
    .replace(/\s*\$\$/g, "\n$$\n")
    .replace(/\n{3,}/g, "\n\n");
}
