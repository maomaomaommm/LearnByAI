import { Chapter, Course, QualityIssue } from "@/lib/types";

export function buildChapterRepairPrompt(course: Course, chapter: Chapter, content: string, issues: QualityIssue[]) {
  return `# Task: Targeted Chapter Repair

你是一名中文教材返修编辑。请根据下面的质检问题修复章节正文。

硬性要求：
- 只输出修复后的完整 Markdown 正文。
- 不输出解释、JSON、审稿报告或前后缀。
- 不重写整章，不改变章节主线，只修复列出的问题。
- 第一行必须保持为当前章节标题，不要改错章节编号。
- 修复 Markdown 代码块、公式块、章节标题、连续性和明显浅薄段落。
- 独立公式必须使用 $$...$$；代码必须使用 fenced code block。

课程主题：${course.topic}
章节标题：${chapter.title}
章节任务：${chapter.purpose ?? chapter.description}
章节契约：
${JSON.stringify(chapter.contract ?? {}, null, 2)}

需要修复的问题：
${issues.map((issue, index) => `${index + 1}. [${issue.severity}] ${issue.check}: ${issue.message}${issue.suggestion ? ` 修复建议：${issue.suggestion}` : ""}`).join("\n")}

待修复正文：

${content}`;
}
