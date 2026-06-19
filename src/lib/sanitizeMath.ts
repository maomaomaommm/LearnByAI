type Zone = { type: "normal" | "fenced" | "display_math"; lines: string[] };

export function sanitizeMathDelimiters(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const zones = splitZones(normalized);

  if (zones.length === 1 && zones[0]!.type === "normal") {
    const repaired = scanAndRepairSegment(zones[0]!.lines.join("\n"));
    return repaired;
  }

  return zones
    .map((zone) =>
      zone.type === "normal"
        ? scanAndRepairSegment(zone.lines.join("\n"))
        : zone.lines.join("\n"),
    )
    .join("\n");
}

function splitZones(content: string): Zone[] {
  const lines = content.split("\n");
  const zones: Zone[] = [];
  let current: Zone = { type: "normal", lines: [] };
  let inFence = false;
  let fenceMarker = "";
  let inDisplayMath = false;

  const flush = () => {
    if (current.lines.length > 0) zones.push(current);
    current = { type: "normal", lines: [] };
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/u);

    // Inside a fence: accumulate until closing fence
    if (inFence) {
      current.lines.push(line);
      if (fenceMatch && fenceMatch[2]!.startsWith(fenceMarker)) {
        // Closing fence — must have same marker and at least as many chars
        const marker = fenceMatch[2]!;
        if (marker[0] === fenceMarker && marker.length >= 3) {
          inFence = false;
          flush();
        }
      }
      continue;
    }

    // Start of a new fence
    if (fenceMatch) {
      flush();
      current = { type: "fenced", lines: [line] };
      inFence = true;
      fenceMarker = fenceMatch[2]![0]!;
      continue;
    }

    // Inside display math: accumulate content lines (including the closing $$)
    if (inDisplayMath) {
      current.lines.push(line);
      if (trimmed === "$$") {
        inDisplayMath = false;
        flush();
      }
      continue;
    }

    // Opening display math
    if (trimmed === "$$") {
      flush();
      current = { type: "display_math", lines: [line] };
      inDisplayMath = true;
      continue;
    }

    // Normal text line
    if (current.type !== "normal") {
      current = { type: "normal", lines: [line] };
    } else {
      current.lines.push(line);
    }
  }

  flush();
  return zones;
}

function scanAndRepairSegment(text: string): string {
  const dollars = findAllUnescapedDollars(text);
  if (dollars.length === 0) return text;

  const escapePositions = new Set<number>();

  // Phase 1: handle odd count — escape last unpaired $
  let pairCount = dollars.length;
  if (dollars.length % 2 !== 0) {
    escapePositions.add(dollars[dollars.length - 1]!);
    pairCount = dollars.length - 1;
  }

  // Phase 2: check each $...$ pair
  for (let i = 0; i < pairCount; i += 2) {
    const openIdx = dollars[i]!;
    const closeIdx = dollars[i + 1]!;
    if (openIdx + 1 >= closeIdx) {
      // Empty pair like "$$" — skip (not our problem, empty inline math is valid)
      continue;
    }
    const enclosed = text.slice(openIdx + 1, closeIdx);
    if (isSuspiciousInlineMath(enclosed)) {
      escapePositions.add(openIdx);
      escapePositions.add(closeIdx);
    }
  }

  if (escapePositions.size === 0) return text;

  // Phase 3: build result character by character
  let result = "";
  for (let i = 0; i < text.length; i++) {
    if (escapePositions.has(i)) {
      result += "\\$";
    } else {
      result += text[i]!;
    }
  }
  return result;
}

function findAllUnescapedDollars(text: string): number[] {
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "$" && (i === 0 || text[i - 1] !== "\\")) {
      positions.push(i);
    }
  }
  return positions;
}

function isSuspiciousInlineMath(enclosed: string): boolean {
  // Rule 1: Chinese punctuation inside $...$ is never valid inline math
  if (/[。，；：？！、]/u.test(enclosed)) return true;

  // Rule 2: newlines are not valid in inline math
  if (enclosed.includes("\n")) return true;

  // Rule 3: inline math spans over 200 characters are almost certainly not math
  if (enclosed.length > 200) return true;

  // Rule 4: no math tokens at all — pure natural language
  // Check for backslash, operators, digits, or Latin letters
  if (!/[\\=^_{}+*\/<>\-\[\]()]|\d|[a-zA-Z]/.test(enclosed)) return true;

  return false;
}
