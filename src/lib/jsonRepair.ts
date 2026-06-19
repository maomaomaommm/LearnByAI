export function extractJsonObjectText(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const source = fenced?.[1] ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return source;
  return source.slice(start, end + 1);
}

export function repairInvalidJsonEscapes(text: string) {
  const source = extractJsonObjectText(text);
  let repaired = "";
  let inString = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (!inString) {
      if (char === "\"") inString = true;
      repaired += char;
      continue;
    }

    if (char === "\"") {
      inString = false;
      repaired += char;
      continue;
    }

    if (char !== "\\") {
      repaired += char;
      continue;
    }

    const next = source[index + 1] ?? "";
    const afterNext = source[index + 2] ?? "";
    if (!next) {
      repaired += "\\\\";
      continue;
    }

    if (next === "u") {
      const hex = source.slice(index + 2, index + 6);
      if (/^[0-9a-fA-F]{4}$/u.test(hex)) {
        repaired += `\\u${hex}`;
        index += 5;
      } else {
        repaired += "\\\\";
      }
      continue;
    }

    if (next === "\"" || next === "\\" || next === "/") {
      repaired += `\\${next}`;
      index += 1;
      continue;
    }

    if (/[bfnrt]/u.test(next) && !/[A-Za-z]/u.test(afterNext)) {
      repaired += `\\${next}`;
      index += 1;
      continue;
    }

    repaired += "\\\\";
  }

  return repaired;
}
