import { expectedChapterHeading } from "@/lib/chapterHeadings";
import { Chapter, ChapterDepthWeight, Course } from "@/lib/types";
import { textbookSkill } from "./textbookSkill";
import { buildTeachingGuidance } from "./styleGuidance";

type ChapterDepthGuide = {
  label: string;
  /** 正文内容清单：写什么（分层的主控杠杆）。 */
  scope: string[];
  /** 讲解深度标准：用“讲透到什么程度”引导，配合内容清单驱动篇幅。 */
  depthNote: string;
  /** 软参考区间：仅指正文讲解文字（不含代码/块公式/练习/拓展）。讲透为先，不是硬指标。 */
  proseBand: string;
  /** 安全网：留足余量，永不用来卡正常篇幅（否则会截断正文）。 */
  maxTokens: number;
  sections: string;
};

/**
 * 每章篇幅由架构师分配的 depthWeight 决定（自适应篇幅）。
 * 主控是 `scope`（写什么）+ `depthNote`（讲多透）；`proseBand` 是只针对“正文讲解文字”的软参考
 * （实测：纯措辞难把模型的 core 文字推过 ~12-14k，故 band 取贴近其自然产出的合理区间，避免来回较劲）。
 * 代码/块公式/练习/拓展都不计入 proseBand，且代码必须配文字讲解、不得凑数（见 prompt 要求）。
 * `maxTokens` 只是防失控安全网。
 */
const DEPTH_GUIDE: Record<ChapterDepthWeight, ChapterDepthGuide> = {
  light: {
    label: "轻量章（引入 / 过渡 / 收尾）",
    scope: [
      "建立直觉与动机：讲清这个主题为什么出现、要解决什么问题",
      "给出 1 个最小示例帮助建立感觉",
      "只点到核心概念；完整推导、证明与复杂情形留到后续核心章，本章不展开",
    ],
    depthNote:
      "目标是建立直觉与动机、点到为止：把“是什么、为什么重要”讲清即可，不展开完整推导或证明，深入留到后续核心章。读者读完应当有感觉、有兴趣，不必掌握全部细节。",
    proseBand: "正文讲解文字大致 4,000 到 6,000 字",
    maxTokens: 12288,
    sections: "3 到 4 个主题小节",
  },
  normal: {
    label: "常规章",
    scope: [
      "系统讲清本章主线方法或概念",
      "对关键结论给出推导的关键步骤（讲清思路即可，不必穷尽每一步）",
      "给出 1 个完整的 worked example，从问题走到结论",
      "给出必要的定义 / 命题 / 讨论，说明适用范围与前提",
    ],
    depthNote:
      "把主线方法讲清楚：每个关键概念给出定义、直觉和一个完整例子，关键结论交代推导思路。读者读完应能照着做出来、并讲得出大致原因。",
    proseBand: "正文讲解文字大致 7,000 到 10,000 字",
    maxTokens: 18432,
    sections: "5 到 7 个主题小节",
  },
  core: {
    label: "核心 / 难点章",
    scope: [
      "完整、严谨地推导每个关键结论，给出分步骤的推导过程或证明思路，不跳步",
      "给出至少 3 个完整的 worked example，覆盖不同情形、难度递进，每个都从问题走到结论并解释关键判断",
      "对关键方法给出分步骤的操作流程，并用文字逐步解释每一步的作用与动机",
      "讨论边界条件、常见误区、失败模式，以及复杂度 / 性能 / 取舍",
      "用一个对比小节或表格，系统比较本章涉及的不同方案或参数选择的适用场景",
      "把本章最难的点拆成多个小节逐层讲透，不能停在结论层面",
    ],
    depthNote:
      "这是全书讲解最充分、最厚的一类章，目标是把难点彻底讲透。对每个关键概念与结论：先讲清它要解决的问题与设计动机，再给出完整、不跳步的推导或论证，逐步解释每一步为什么成立；主动预判读者在难点处会冒出的疑问，并在正文里正面解答；对最难的点用多个角度（直觉、形式化、类比、反例）反复打磨。判断标准是：读者读完每一节都觉得“这下真懂了，而且知道为什么、知道换个做法为什么不行”，而不是“记住了结论”。宁可把一个点讲到通透，也不要为了覆盖面而每个点浅尝辄止。",
    proseBand: "正文讲解文字大致 12,000 到 16,000 字",
    maxTokens: 32000,
    sections: "8 到 11 个主题小节",
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
本章正文必须覆盖以下内容要点：
${depthGuide.scope.map((item) => `- ${item}`).join("\n")}
小节数量：${depthGuide.sections}
讲解深度标准（用“讲透到什么程度”来决定篇幅——篇幅应当是讲深讲透的自然结果）：${depthGuide.depthNote}
篇幅软参考（仅指正文讲解文字，不含代码、块公式、练习、拓展；这是合理区间不是硬指标，讲透为先，不要为凑数注水或删减）：${depthGuide.proseBand}

硬性要求：
- 不得发明、改写或错置章节编号；正文中不要出现与当前章节冲突的“第 N 章”标题。
- 章节结构固定为：正文主题小节（按上面的内容要点展开）→「## 本章小结」→「## 练习」→「## 拓展阅读」。
- 「## 练习」给 3 到 5 道由浅入深的练习题，其中包含 1 个开放式项目任务；「## 拓展阅读」给 2 到 4 条延伸方向或资源（若确无可靠来源可省略该节）。
- 上面的正文篇幅护栏只针对正文主题小节，不包含「## 练习」与「## 拓展阅读」；这两块是固定附加块，不随本章篇幅定位缩放。
- 禁用机械模板标题，例如“知识单元”“为什么需要它”“直觉解释”“检查理解的小题”。
- 正文中至少包含 1 个贯穿讲解的实践案例；只有当本章契约允许代码实现细节时才写代码，否则用“概念性诊断/手算/表格比较”案例替代代码。
- 代码与块公式是讲解的佐证、不是主体：每段代码或伪代码前后都必须有文字说明它在做什么、为什么这么写、关键步骤的作用；衡量“讲透”看的是文字讲解，不得用代码或公式堆砌来充篇幅、替代讲解。
- 公式必须规范：行内公式用 $...$；独立公式、推导、cases、aligned、矩阵必须用 $$...$$ 块公式。
- 如果确实写代码，必须放在 fenced code block 中，并保留语言名；禁止写不确定注释、伪造变量名或“可能/需检查惯例”这类未清理草稿痕迹。
- 代码块务必标注语言（如 python、bash）；纯文本示意图也要用 text 作为语言名的围栏代码块包裹。
- 图示是默认能力（Mermaid，按需自动配图，平台会把 \`\`\`mermaid 围栏渲染成图）。判定与画法：
  - 触发（何时考虑画）：当正文出现流程、状态/生命周期、交互时序、数据结构/类、数据模型/实体关系、概念关系或时间演进时，考虑配一张图。
  - 场景→类型：流程→flowchart TD；交互/协议/调用时序→sequenceDiagram；状态/生命周期→stateDiagram-v2；数据结构/类关系→classDiagram；数据模型/实体关系→erDiagram；概念总览→mindmap；时间演进→timeline。
  - 必要性闸门（每张图落笔前都要过）：这张图是否比纯文字或表格更能说清这段关系、是否承载了文字没完全表达的信息？只起装饰、复述文字、或可有可无的图一律不画——图必须为读者省下理解成本才配留下。
  - 不设每章张数与上限：画几张由通过闸门的场景数自然决定；该画则画，没有合适场景就一张都不画，绝不为凑图而画。
  - 每张图前后都必须有文字讲解，图只是佐证不是主体；节点文字保持简短，避免中文括号、引号、分号等特殊字符（必要时用英文别名加中文标签 A["标签"]），确保能被 Mermaid 正确解析。
  - 图内标签只能用纯文本：禁止任何 LaTeX 与数学记号（$...$、下标 _{}、上标 ^{}、\\ 命令），它们在图里会原样显示；要表达 S_t、π_ref 之类，写成朴素文本（如 S(t)、pi_ref 或中文说明）。
  - 连线/箭头只能用 Mermaid 的 ASCII 语法：flowchart 用 \`-->\`（带标签写 \`A -->|说明| B\`）、sequenceDiagram 用 \`->>\`、stateDiagram 用 \`-->\`。严禁使用 Unicode 箭头（→、⟶、⇒、⇨ 等），否则整张图会因语法错误无法渲染。
- LaTeX 文本命令内若含下划线（如节点名 __end__、变量名 node_name），必须转义为 \\_，例如写成 \\text{\\_\\_end\\_\\_}，否则公式会渲染失败。
- 严禁把中文正文、习题标题、说明文字包进 $$...$$；$$ 只能包裹纯数学表达式。
- 如果本章 requiredTopics 包含联网检索发现的近期论文或方法，必须用完整小节展开其动机、原理、证据状态及与经典方法的对比，不能只在一句话里点名带过。
- 对预印本、已录用论文和正式发表版本作准确区分；不得把章节契约未提供来源线索的“最新成果”自行补写成确定事实。
- 不要在本章提前展开 forbiddenEarlyTopics 中列出的后续概念；只允许用一句话铺垫。禁止给出后续章节才讲的参数化公式、代码结构、数据结构、变量读取代码、具体输入文件名或调参步骤。
- 严格避免未清理草稿痕迹：不要写“FSH?”、“可能是”、“待确认”、“需检查惯例”、“这里可以补充”等不确定占位表达。
- 符号一致性（重要）：全书统一使用 Course Bible 的 notation 记号表——同一个量只用同一种写法并逐字沿用，禁止在本章另立记号（如状态价值全书统一写 $v_\\pi(s)$，不得改写成 $V(s)$ 或 $V^\\pi(s)$；动作价值、最优值、随机变量大小写同理）。若 notation 为空，则本章自选一套并全章保持一致。
- 术语一致性（重要）：概念的中文译名逐字沿用 Course Bible 的 terminology 与 writingConventions，同一概念全书只用一个词（如统一「马尔可夫」不写「马尔科夫」，「Bellman」与「贝尔曼」按约定二选一），不得中途换词。
- 结构一致性：小节标题一律遵循 writingConventions 规定的编号方案（如统一「N.M」）；固定结尾块标题必须逐字为「## 本章小结」「## 练习」「## 拓展阅读」，不得写成「习题」「小结」「第 N 节」等变体，也不要额外添加「章节导言」之类标题。
- 不重复引入：terminology 中 introducedIn 指向本章之前章节的术语，直接使用，不要当作首次出现重新括注定义；只有本章首次引入的术语才展开解释。
- 若本章是全书收尾「总结与展望」章：以回顾主线、串联各章、指出前沿与后续学习方向为主，不展开新的概念或推导。
- 开头要自然承接上一章，结尾要自然为下一章铺垫，但不要把这些写成机械标题。

课程信息：
主题：${course.topic}
学习目标：${course.goal}
学习者基础：${course.background}
${buildTeachingGuidance(course.styles, course.learningMode, course.preference)}

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
