import { expectedChapterHeading } from "@/lib/chapterHeadings";
import { Chapter, ChapterDepthWeight, Course } from "@/lib/types";
import { textbookSkill } from "./textbookSkill";

type ChapterDepthGuide = { label: string; chars: string; maxTokens: number; sections: string };

/**
 * 每章篇幅由架构师分配的 depthWeight 决定（自适应篇幅），不再由全局篇幅档位一刀切。
 * `chars` 是写进 prompt 的软目标，`maxTokens` 是兜底硬上限，防止 core 章失控。
 */
const DEPTH_GUIDE: Record<ChapterDepthWeight, ChapterDepthGuide> = {
  light: {
    label: "轻量章（引入 / 过渡 / 收尾）",
    chars: "4,000 到 7,000 个中文字符",
    maxTokens: 12288,
    sections: "3 到 5 个主题小节",
  },
  normal: {
    label: "常规章",
    chars: "8,000 到 12,000 个中文字符",
    maxTokens: 18432,
    sections: "5 到 7 个主题小节",
  },
  core: {
    label: "核心 / 难点章",
    chars: "13,000 到 18,000 个中文字符",
    maxTokens: 24576,
    sections: "6 到 9 个主题小节",
  },
};

export function getChapterDepthGuide(weight: ChapterDepthWeight | undefined): ChapterDepthGuide {
  return DEPTH_GUIDE[weight ?? "normal"];
}

export function buildChapterWriterPrompt(
  course: Course,
  chapter: Chapter,
  options?: {
    chapterIndex?: number;
    chapters?: Omit<Chapter, "content" | "review">[];
  },
) {
  const chapterIndex = options?.chapterIndex ?? course.chapters.findIndex((item) => item.id === chapter.id);
  const chapters = options?.chapters ?? course.chapters;
  const previous = chapterIndex > 0 ? chapters[chapterIndex - 1] : undefined;
  const next = chapterIndex >= 0 ? chapters[chapterIndex + 1] : undefined;
  const chapterNumber = chapterIndex >= 0 ? chapterIndex + 1 : undefined;
  const requiredHeading = expectedChapterHeading(course, chapter);
  const depthGuide = getChapterDepthGuide(chapter.depthWeight);
  const contract = chapter.contract ?? course.courseBible.chapterContracts?.find((item) => item.chapterTitle === chapter.title);

  return `${textbookSkill()}

# Task: Chapter Writing

你正在撰写一章中文研究生教材。请只输出完整 Markdown 正文，不要输出 JSON、审稿过程、解释前缀或代码围栏包裹全文。

当前章节：第 ${chapterNumber ?? "未知"} 章 / 共 ${chapters.length} 章
第一行必须严格等于：
# ${requiredHeading}

篇幅定位：${depthGuide.label}
目标长度（软目标，可按内容难度上下浮动）：${depthGuide.chars}
小节数量：${depthGuide.sections}
篇幅原则：根据本章实际难度与重要性自适应取舍——难点和核心内容充分展开，引入与过渡内容保持精炼；不要为凑字数注水，也不要牺牲讲清楚所需的篇幅。

硬性要求：
- 不得发明、改写或错置章节编号；正文中不要出现与当前章节冲突的“第 N 章”标题。
- 使用传统教材体例：章节导言、自然命名的小节、定义/命题/例题/讨论、章节小结和习题。
- 禁用机械模板标题，例如“知识单元”“为什么需要它”“直觉解释”“检查理解的小题”。
- 至少包含 1 个实践案例、1 组练习题、1 个开放式项目任务；只有当本章契约允许代码实现细节时才写代码，否则用“概念性诊断/手算/表格比较”案例替代代码。
- 公式必须规范：行内公式用 $...$；独立公式、推导、cases、aligned、矩阵必须用 $$...$$ 块公式。
- 如果确实写代码，必须放在 fenced code block 中，并保留语言名；禁止写不确定注释、伪造变量名或“可能/需检查惯例”这类未清理草稿痕迹。
- 代码块务必标注语言（如 python、bash）；纯文本示意图也要用 text 作为语言名的围栏代码块包裹。
- LaTeX 文本命令内若含下划线（如节点名 __end__、变量名 node_name），必须转义为 \\_，例如写成 \\text{\\_\\_end\\_\\_}，否则公式会渲染失败。
- 严禁把中文正文、习题标题、说明文字包进 $$...$$；$$ 只能包裹纯数学表达式。
- 如果本章 requiredTopics 包含联网检索发现的近期论文或方法，必须用完整小节展开其动机、原理、证据状态及与经典方法的对比，不能只在一句话里点名带过。
- 对预印本、已录用论文和正式发表版本作准确区分；不得把章节契约未提供来源线索的“最新成果”自行补写成确定事实。
- 不要在本章提前展开 forbiddenEarlyTopics 中列出的后续概念；只允许用一句话铺垫。禁止给出后续章节才讲的参数化公式、代码结构、数据结构、变量读取代码、具体输入文件名或调参步骤。
- 严格避免未清理草稿痕迹：不要写“FSH?”、“可能是”、“待确认”、“需检查惯例”、“这里可以补充”等不确定占位表达。
- 开头要自然承接上一章，结尾要自然为下一章铺垫，但不要把这些写成机械标题。

课程信息：
主题：${course.topic}
学习目标：${course.goal}
学习者基础：${course.background}
讲解偏好：${course.preference}

Course Bible:
${JSON.stringify(course.courseBible, null, 2)}

当前章节：
标题：${chapter.title}
本章任务：${chapter.purpose ?? chapter.description}
与上一章关系：${chapter.connectionFromPrevious ?? "这是课程起点。"}
为下一章铺垫：${chapter.setupForNext ?? "自然引出后续章节。"}
预计学习时间：阅读 ${chapter.time.readingMinutes} 分钟，练习 ${chapter.time.exerciseMinutes} 分钟，实践 ${chapter.time.practiceMinutes} 分钟，拓展阅读 ${chapter.time.extensionMinutes} 分钟。

章节契约：
${JSON.stringify(contract ?? {}, null, 2)}

上一章：
${previous ? `${previous.title}: ${previous.description}${previous.contract?.summaryForNext ? `\n上一章摘要：${previous.contract.summaryForNext}` : ""}` : "无，这是第一章。"}

下一章：
${next ? `${next.title}: ${next.description}` : "无，这是最后一章。"}

请输出完整章节正文。`;
}
