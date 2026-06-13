type ComparableText = {
  value: string;
  starts: number[];
  ends: number[];
};

export function resolveRepairAnchor(source: string, selected: string) {
  const trimmed = selected.trim();
  if (!trimmed) return undefined;
  const exactMatch = uniqueIndexOf(source, trimmed);
  if (exactMatch !== -1) {
    return expandMarkdownWrapper(source, exactMatch, exactMatch + trimmed.length);
  }

  const sourceComparable = comparableText(source);
  for (const candidate of selectionCandidates(trimmed)) {
    const selectedComparable = comparableText(candidate).value;
    if (selectedComparable.length < 3) continue;

    const match = uniqueIndexOf(sourceComparable.value, selectedComparable);
    if (match !== -1) {
      const start = sourceComparable.starts[match];
      const end = sourceComparable.ends[match + selectedComparable.length - 1];
      return expandMarkdownWrapper(source, start, end);
    }
  }

  return resolveBlockAnchor(source, trimmed);
}

function comparableText(text: string): ComparableText {
  const value: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];

  for (let index = 0; index < text.length;) {
    const point = text.codePointAt(index);
    if (point === undefined) break;
    const raw = String.fromCodePoint(point);
    const end = index + raw.length;

    for (const normalized of raw.normalize("NFKC").toLocaleLowerCase()) {
      if (/[\p{L}\p{N}]/u.test(normalized)) {
        value.push(normalized);
        starts.push(index);
        ends.push(end);
      }
    }
    index = end;
  }

  return { value: value.join(""), starts, ends };
}

function expandMarkdownWrapper(source: string, initialStart: number, initialEnd: number) {
  let start = initialStart;
  let end = initialEnd;

  for (const wrapper of ["**", "__", "~~", "$$", "`", "$"]) {
    if (source.slice(start - wrapper.length, start) === wrapper &&
        source.slice(end, end + wrapper.length) === wrapper) {
      start -= wrapper.length;
      end += wrapper.length;
      break;
    }
  }

  return source.slice(start, end);
}

function selectionCandidates(selected: string) {
  const candidates = [selected];
  const comparable = comparableText(selected).value;
  if (comparable.length % 2 === 0) {
    const half = comparable.length / 2;
    if (comparable.slice(0, half) === comparable.slice(half)) {
      candidates.push(selected.slice(0, Math.ceil(selected.length / 2)));
    }
  }
  return candidates;
}

function uniqueIndexOf(source: string, selected: string) {
  const first = source.indexOf(selected);
  if (first === -1) return -1;
  return source.indexOf(selected, first + 1) === -1 ? first : -1;
}

function resolveBlockAnchor(source: string, selected: string) {
  const selectedComparable = comparableText(selected).value;
  if (selectedComparable.length < 12) return undefined;

  const blocks = source.split(/\n{2,}/u);
  let best: { block: string; score: number } | undefined;
  let secondScore = 0;

  for (const block of blocks) {
    const blockComparable = comparableText(block).value;
    if (!blockComparable) continue;
    const score = diceCoefficient(blockComparable, selectedComparable);
    if (!best || score > best.score) {
      secondScore = best?.score ?? 0;
      best = { block, score };
    } else {
      secondScore = Math.max(secondScore, score);
    }
  }

  if (!best || best.score < 0.62 || best.score - secondScore < 0.08) return undefined;
  return best.block;
}

function diceCoefficient(left: string, right: string) {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;

  const pairs = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const pair = left.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }

  let overlap = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const pair = right.slice(index, index + 2);
    const count = pairs.get(pair) ?? 0;
    if (count > 0) {
      overlap += 1;
      pairs.set(pair, count - 1);
    }
  }

  return (2 * overlap) / (left.length + right.length - 2);
}
