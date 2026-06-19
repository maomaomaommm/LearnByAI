import { Chapter, Course, QualityIssue } from "@/lib/types";

function formatIssuesForPrompt(issues: QualityIssue[]): string {
  return issues.map((issue, index) => {
    const suggestion = issue.suggestion ? `\n   修复建议：${issue.suggestion}` : "";
    return `${index + 1}. [${issue.severity.toUpperCase()}][${issue.check}] ${issue.message}${suggestion}`;
  }).join("\n");
}

export function buildChapterRepairByAuthorPrompt(
  course: Course,
  chapter: Chapter,
  content: string,
  issues: QualityIssue[]
) {
  return `# Task: Chapter Content Repair (AUTHOR)

你是一位中文教材作者。请根据下方的质检反馈，对章节内容进行**点对点修改**。只输出修复后的完整 Markdown 正文，不要输出 JSON、解释、报告、前后缀或任何元信息。

## 角色与目标

你是教材作者，不是编辑。你需要：
1. 逐条修复质检列出的问题
2. 保持章节主线、教学节奏和原有结构不变
3. 修复后自检每条 issue 是否已解决

## 逐条修复与自检要求

对每一条 issue，你必须在正文中完成对应修改。修改完成后，在脑中自检：
- 该 issue 描述的问题在正文中是否还存在？
- 如果还有残留，继续修改直到解决。
- 不要为没有问题的内容做"额外优化"。

## 硬性约束（不可违反）

- **只修改指出的问题**，不要重写整章、不要改写无关段落、不要润色无关内容。
- **第一行必须是当前章节的正确一级标题**，格式为 
- **删除所有作者过程说明**，例如"我先把这一章的结构搭好""接下来直接写正文""下面开始写"等，这些不属于教材正文。
- **公式格式**：独立公式必须整体使用 $$...$$，行内公式使用 $...$。
- **列表中的公式**：如果公式属于某个编号列表项，必须整体缩进到该列表项内部（4 个空格或 1 个 Tab），否则 Markdown 导出器会中断列表。
- **代码块**：使用 fenced code block（\`\`\`language ... \`\`\`）。
- **章节契约**：必须确保契约中要求的教学点、案例、项目或原则在正文中有明确体现。
- **章节引用**：若 issue 要求把案例/项目与 S-MADRL、SwarmSys 等前文框架对应，必须显式写出对应关系，不能只描述现象。
- **不要添加总结表、自检清单、emoji、"注意"框等额外元素**。
- **不要编造不存在的数据、论文或实现细节**。

## 课程信息

课程主题：${course.topic}
章节标题：${chapter.title}
章节描述：${chapter.purpose ?? chapter.description}
章节契约：
${JSON.stringify(chapter.contract ?? {}, null, 2)}

## 需要修复的问题（共 ${issues.length} 条）

${formatIssuesForPrompt(issues)}

## 待修复正文

${content}`;
}

export function buildChapterChunkRepairByAuthorPrompt(
  course: Course,
  chapter: Chapter,
  chunk: string,
  issues: QualityIssue[],
  chunkIndex: number,
  totalChunks: number,
) {
  return `# Task: Chapter Chunk Repair (AUTHOR)

你正在修复教材章节的一个 Markdown 片段（第 ${chunkIndex}/${totalChunks} 段）。只输出修复后的该片段内容，不要输出 JSON、解释、报告或其他片段的内容。

## 修复要求

1. 保留本片段内的标题级别和章节结构
2. **只修复与当前片段相关的问题**，不要修改无关内容
3. 独立公式必须使用 $$...$$
4. 代码必须保留在 fenced code block 中
5. 确保内容准确、逻辑清晰
6. 如果列表项中包含公式，必须将公式块缩进到列表项内部
7. 删除片段中可能出现的作者过程说明（如"我先写...""接下来..."）

## 课程信息

课程主题：${course.topic}
章节标题：${chapter.title}
片段：${chunkIndex}/${totalChunks}

## 需要修复的问题

${formatIssuesForPrompt(issues)}

## Markdown 片段

${chunk}`;
}
