import { Chapter, Course } from "./types";

const CHINESE_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

export function expectedChapterHeading(course: Course, chapter: Chapter) {
  const index = course.chapters.findIndex((item) => item.id === chapter.id);
  const title = stripChapterOrdinal(chapter.title);
  if (index < 0) return title;
  return `${chapterOrdinalLabel(index)} ${title}`.trim();
}

export function chapterOrdinalLabel(index: number) {
  return `第${toChineseNumber(index + 1)}章`;
}

export function normalizeChapterMarkdownHeading(course: Course, chapter: Chapter, content: string) {
  const heading = `# ${expectedChapterHeading(course, chapter)}`;
  const trimmedStart = content.trimStart();
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";

  if (/^#\s+.+(?:\r?\n|$)/u.test(trimmedStart)) {
    return trimmedStart.replace(/^#\s+.+?(\r?\n|$)/u, (_match, end: string) => `${heading}${end}`);
  }

  return `${heading}${lineEnding}${lineEnding}${trimmedStart}`;
}

function stripChapterOrdinal(title: string) {
  const trimmed = title.trim();
  const stripped = trimmed
    .replace(
      /^(?:第\s*[零〇一二三四五六七八九十百千万两\d]+\s*章|chapter\s*\d+|ch\.?\s*\d+|\d+[.．、])\s*[:：\-—–、.]?\s*/iu,
      "",
    )
    .trim();
  return stripped || trimmed;
}

function toChineseNumber(value: number) {
  if (!Number.isInteger(value) || value <= 0 || value > 99) return String(value);
  if (value < 10) return CHINESE_DIGITS[value];
  if (value === 10) return "十";
  if (value < 20) return `十${CHINESE_DIGITS[value % 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${CHINESE_DIGITS[tens]}十${ones ? CHINESE_DIGITS[ones] : ""}`;
}
