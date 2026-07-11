import { postRepairMarkdown } from "./prompts/formatGuard";

export function prepareMarkdownForRender(content: string) {
  return stripFailedFigureMarkers(hideUnresolvedFigurePlaceholders(postRepairMarkdown(content)));
}

export function hideUnresolvedFigurePlaceholders(content: string) {
  return unwrapFencedFigurePayloads(normalizeEscapedFigurePlaceholderBlocks(content)).replace(
    /:::learnbyai-figure[^\n]*\n([\s\S]*?)\n:::/gu,
    (_match, body: string) => {
      const caption = readFigureCaption(body) || "插图";
      return `> 图示尚未生成：${caption}。请稍后重试本章生成。`;
    },
  );
}

function stripFailedFigureMarkers(content: string) {
  return content.replace(/\n?<!--learnbyai-figure-failed\s+\{[^\n]*\}-->/gu, "");
}

function normalizeEscapedFigurePlaceholderBlocks(content: string) {
  return content.replace(/:::learnbyai-figure\\n([\s\S]*?)\s*:::/gu, (_match, body: string) => {
    const normalizedBody = body.replace(/\\n/gu, "\n").trim();
    return `:::learnbyai-figure\n${normalizedBody}\n:::`;
  });
}

function unwrapFencedFigurePayloads(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const opener = lines[index] ?? "";
    const match = opener.match(/^\s*(`{3,}|~{3,})[^\n]*$/u);
    if (!match) {
      output.push(opener);
      index += 1;
      continue;
    }

    const marker = match[1]![0]!;
    let end = index + 1;
    while (end < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`, "u").test(lines[end] ?? "")) {
      end += 1;
    }
    if (end >= lines.length) {
      output.push(opener);
      index += 1;
      continue;
    }

    const body = lines.slice(index + 1, end).join("\n").trim();
    if (/^\s*caption\s*:/imu.test(body) && /^\s*prompt\s*:/imu.test(body)) {
      output.push(":::learnbyai-figure", body, ":::");
    } else {
      output.push(...lines.slice(index, end + 1));
    }
    index = end + 1;
  }

  return output.join("\n");
}

function readFigureCaption(body: string) {
  for (const line of body.split(/\r?\n/u)) {
    const match = line.match(/^\s*caption\s*:\s*(.*?)\s*$/iu);
    if (match?.[1]) return match[1].replace(/^["']|["']$/gu, "").trim().slice(0, 80);
  }
  return "";
}
