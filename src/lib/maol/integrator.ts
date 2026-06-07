import { Chapter, Section } from "../types";

export function markdownToSections(chapter: Chapter, content: string): Section[] {
  const parts = content
    .split(/\n(?=##\s+)/u)
    .map((part) => part.trim())
    .filter(Boolean);

  const sections = parts.length > 0 ? parts : [content.trim()];

  return sections.map((section, index) => {
    const title = section.match(/^##\s+(.+)$/mu)?.[1] ?? (index === 0 ? chapter.title : `小节 ${index + 1}`);
    return {
      id: crypto.randomUUID(),
      chapterId: chapter.id,
      title,
      purpose: index === 0 ? chapter.purpose ?? chapter.description : "支撑本章学习目标。",
      content: section,
      status: "ready",
      order: index,
    };
  });
}
