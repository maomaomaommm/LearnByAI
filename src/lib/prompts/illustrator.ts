import { Course } from "@/lib/types";

/**
 * ILLUSTRATOR planning prompt (beta). A text agent reads the finished chapter
 * and proposes up to N figure spots: a verbatim anchor to insert after, a short
 * Chinese caption, and an image-generation prompt. The image itself is produced
 * by a dedicated image model (see src/lib/illustration.ts) — this prompt only
 * plans WHERE and WHAT.
 */
export function buildIllustrationPlanPrompt(input: {
  course: Course;
  chapterTitle: string;
  chapterNumber: number;
  content: string;
  maxCount: number;
}) {
  return `# Task: 教材章节插图规划

你是一名顶级大学出版社的教材插图编辑。阅读下面这一章的正文，从中挑选最多 ${input.maxCount} 处「配一幅插图能显著帮助理解」的位置，并为每一处写出插图方案。

课程主题：${input.course.topic}
本章：第 ${input.chapterNumber} 章 ${input.chapterTitle}

硬性要求：
- 只选真正值得配图的内容：概念结构、过程/流程、多要素关系、几何/空间直觉。纯文字性内容、公式推导本身不配图。
- 宁缺毋滥：如果全章没有值得配图的位置，返回空数组。
- anchor 必须是从正文中逐字复制的一段连续文字（30 到 80 个字符，保留原有标点与空格，不得改写），插图会插入到包含它的段落之后。anchor 必须在全章唯一出现，且不能取自代码块、公式块、表格或标题行。
- caption 是中文图注，不超过 30 字，说明图的内容（不要带「图 N」编号，编号由系统添加）。
- prompt 用英文撰写，描述一幅扁平矢量教材插图的完整画面：画什么元素、它们的空间布局、箭头/连线关系。图中需要出现的所有文字标签必须在 prompt 里逐一列出，标签用简体中文纯文本；禁止要求图中出现 LaTeX 语法（$、反斜杠命令、_{ } 上下标），数学记号一律改写为纯文本或 Unicode（如 π、γ、s'）。
- 插图内容必须与 anchor 所在段落的知识点强相关，且与本章符号、术语一致。

只输出 JSON（不要输出解释或 Markdown 代码围栏）：
{
  "illustrations": [
    { "anchor": "...", "caption": "...", "prompt": "..." }
  ]
}

本章正文：

${input.content}`;
}
