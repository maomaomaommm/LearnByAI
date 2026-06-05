export function normalizeMath(content: string) {
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

    if (isBareDisplayMathLine(trimmed)) {
      repaired.push("", "$$", cleanMathLine(trimmed), "$$", "");
      if (nextTrimmed === "$") index += 1;
      continue;
    }

    if (
      /\\begin\{(aligned|align|cases|matrix|pmatrix|bmatrix)\}/.test(trimmed) &&
      !trimmed.includes("$$")
    ) {
      repaired.push("", "$$", cleanMathLine(trimmed), "$$", "");
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

function cleanMathLine(line: string) {
  return line
    .replace(/^\$\s*/u, "")
    .replace(/\s*\$$/u, "")
    .replace(/\\perp!+\\perp/g, "\\perp\\!\\!\\!\\perp")
    .trim();
}

function isBareDisplayMathLine(trimmed: string) {
  if (!trimmed.startsWith("$") || trimmed.startsWith("$$")) return false;
  if (/[\u4e00-\u9fff]/u.test(trimmed)) return false;

  const math = cleanMathLine(trimmed);
  if (!math) return false;

  return /\\|=|[{}_^]|[A-Za-z]\s*\(|\b(mid|sum|prod|frac|tau|beta|gamma|epsilon)\b/.test(math);
}
