import { Course, RevisionMode, RevisionScope } from "../types";
import { textbookSkill } from "./textbookSkill";
import { buildTeachingGuidance } from "./styleGuidance";

export type RevisePromptInput = {
  course: Course;
  chapterId: string;
  sectionId?: string;
  mode: RevisionMode;
  scope: RevisionScope;
  /** The resolved anchor — a verbatim slice of the chapter/section content. */
  selectedText: string;
  /** The user's intent: a preset code's expanded text or free-form instruction. */
  userMessage: string;
};

const JSON_SHAPE = `请只输出 JSON，不要输出 Markdown 代码块。JSON 必须符合：
{
  "issueType": "formula_rendering" | "markdown_format" | "conceptual_error" | "wording" | "rewrite" | "other",
  "diagnosis": "一句到三句话说明你做了什么改动以及原因",
  "beforeText": "必须逐字等于下面给出的原文",
  "afterText": "改写/修复后的文本",
  "confidence": "low" | "medium" | "high"
}`;

export function buildRevisePrompt(input: RevisePromptInput) {
  return input.mode === "rewrite" ? buildReviseRewritePrompt(input) : buildReviseFixPrompt(input);
}

export function buildReviseFixPrompt(input: RevisePromptInput) {
  const { chapter, section } = locate(input);

  return `${textbookSkill()}

# Task: Local Textbook Repair（最小修复）

你是 LearnByAI 的教材修复助手。用户指出教材中的某一小段内容可能有问题。
你的任务不是重写整章，而是给出一个最小、可审查的局部修复建议。

课程主题：${input.course.topic}
课程目标：${input.course.goal}
学习者画像：${input.course.profile}
当前章节：${chapter?.title ?? "未知章节"}
章节说明：${chapter?.description ?? "未提供"}
当前小节：${section?.title ?? "未指定"}

用户指出的问题：
${input.userMessage}

需要检查/修复的原文：
${input.selectedText}

${JSON_SHAPE}

修复要求：
- beforeText 必须完全等于上面的原文，不要改写。
- afterText 必须保留原意，只修复格式、公式、表述或明显错误。
- 如果是公式渲染问题，使用 Markdown/LaTeX：行内 $...$，块级 $$...$$。
- 复杂公式、cases、矩阵和多行推导必须用独立块级公式，前后留空行。
- 不要把正文放在 $$...$$ 同一行。
- 不要扩大修改范围，不要生成整段新教材。
- 如果无法确定，confidence 设为 low，并给出最保守的 afterText。`;
}

export function buildReviseRewritePrompt(input: RevisePromptInput) {
  const { chapter, section } = locate(input);
  const teaching = buildTeachingGuidance(input.course.styles, input.course.learningMode, input.course.preference);

  return `${textbookSkill()}

# Task: Local Textbook Rewrite（按要求改写）

你是 LearnByAI 的教材改写助手。用户对教材中**已选定的一段内容**提出了改写诉求。
你的任务是**只针对这一段**做有方向的改写（可以扩写、补例子、换讲法、增删图示），
而不是重写整章，也不要触碰选区以外的内容。

课程主题：${input.course.topic}
课程目标：${input.course.goal}
学习者画像：${input.course.profile}
当前章节：${chapter?.title ?? "未知章节"}
章节说明：${chapter?.description ?? "未提供"}
当前小节：${section?.title ?? "未指定"}
改写范围：${SCOPE_LABEL[input.scope]}

讲解风格与学习方式（改写须与全书保持一致）：
${teaching}

用户的改写诉求：
${input.userMessage}

需要改写的原文（选定范围）：
${input.selectedText}

${JSON_SHAPE}

改写要求：
- beforeText 必须逐字等于上面的原文（选定范围），用于精确回插，不要改动它。
- afterText 是改写后的完整替换文本，只替换选定范围，不要把前后文也写进来。
- 守住本章的教学契约：不得提前引入后续章节才会讲的概念，不得与上下文重复或冲突。
- 保持 Markdown 结构：若原文以标题行（#/##/###）开头，afterText 必须保留同级标题且不改其层级。
- 公式用 Markdown/LaTeX（行内 $...$、块级 $$...$$，块级前后留空行，正文不与 $$ 同行）。
- 若需要配图，用 \`\`\`mermaid 围栏（平台会渲染）。务必使用合法 Mermaid 语法：
  - 首行声明类型（flowchart TD / sequenceDiagram / stateDiagram-v2 等）。
  - 连线/箭头只能用 ASCII：flowchart 用 \`-->\`（带标签 \`A -->|说明| B\`）、sequenceDiagram 用 \`->>\`。严禁使用 Unicode 箭头（→、⟶、⇒、⇨ 等），否则整张图无法渲染。
  - 节点文字保持简短，避免中文括号、引号、分号等特殊字符（必要时用 \`A["标签"]\`）。图前后要有文字讲解。
- issueType 用 "rewrite"；confidence 反映你对改写质量的把握。
- 不要输出任何客套话（如"您好""以下是"），只输出 JSON。`;
}

const SCOPE_LABEL: Record<RevisionScope, string> = {
  selection: "用户选中的片段",
  paragraph: "选区所在的整个段落",
  section: "选区所在的整个小节",
  chapter: "整章（谨慎，通常应由整章重生处理）",
};

function locate(input: RevisePromptInput) {
  const chapter = input.course.chapters.find((item) => item.id === input.chapterId);
  const section = input.sectionId
    ? chapter?.sections?.find((item) => item.id === input.sectionId)
    : undefined;
  return { chapter, section };
}
