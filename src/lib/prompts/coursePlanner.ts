export type CoursePlannerInput = {
  topic: string;
  goal: string;
  background: string;
  preference: string;
  weeklyHours: number;
  chapterLength?: "short" | "medium" | "long";
};

export function buildCoursePlannerPrompt(input: CoursePlannerInput) {
  return `你是一名中文教材课程架构师。请根据学习者信息设计一门前后贯通、适合生成完整教材的课程。

学习主题：${input.topic}
具体目标：${input.goal}
当前基础：${input.background}
讲解偏好：${input.preference}
每周学习时间：${input.weeklyHours} 小时
默认章节篇幅：${input.chapterLength ?? "medium"}

核心设计要求：请为每一章生成“章节契约”，用于后续并发撰写章节时保持前后贯通。

只输出合法 JSON。不要输出 Markdown、代码围栏、解释文字或前后缀。
输出必须满足：
- 第一个字符必须是 {，最后一个字符必须是 }。
- 不要输出注释、尾随逗号、Markdown 标记或代码围栏。
- JSON 字符串内部不要直接换行；需要分句时使用中文逗号、分号或句号。
- 字符串内部尽量不要使用英文双引号；如必须使用，必须写成转义形式 \\"。
- 数组元素之间必须使用英文逗号分隔，最后一个元素后不能有逗号。
- 章节标题、术语、例题要求可以用中文标点，但整个结果必须能被 JSON.parse 直接解析。
- 为保证 JSON 稳定，每个字符串控制在 120 个中文字符以内，每个数组最多 6 项。

JSON 必须符合下面结构：
{
  "profile": "为什么采用这条学习路线",
  "courseBible": {
    "targetLearner": "目标学习者画像",
    "finalOutcomes": ["最终能做到什么"],
    "teachingStyle": "全书统一写作风格",
    "prerequisites": ["前置知识"],
    "globalNarrative": "全书章节如何递进",
    "terminology": [
      {"term":"术语","definition":"定义","introducedIn":"首次出现的章节标题"}
    ],
    "chapterDependencies": [
      {"chapterTitle":"章节标题","dependsOn":["依赖章节"],"introduces":["新概念"],"preparesFor":["后续章节"]}
    ],
    "chapterContracts": [
      {
        "chapterTitle": "章节标题",
        "requiredTopics": ["本章必须覆盖的知识点"],
        "bridgeFromPrevious": "本章开头如何承接上一章；第一章说明课程起点",
        "bridgeToNext": "本章结尾如何为下一章铺垫",
        "forbiddenEarlyTopics": ["本章不应提前展开的后续概念"],
        "requiredExamples": ["本章必须包含的例题/代码/实践案例"],
        "requiredFormulas": ["本章必须规范展示的公式或推导"],
        "summaryForNext": "供下一章引用的 2-4 句摘要"
      }
    ]
  },
  "chapters": [
    {
      "title": "章节标题",
      "description": "内容概述",
      "purpose": "教学任务",
      "connectionFromPrevious": "与上一章的具体关系",
      "setupForNext": "如何为下一章铺垫",
      "contract": {
        "chapterTitle": "章节标题",
        "requiredTopics": ["本章必须覆盖的知识点"],
        "bridgeFromPrevious": "本章开头如何承接上一章",
        "bridgeToNext": "本章结尾如何为下一章铺垫",
        "forbiddenEarlyTopics": ["不要提前展开的后续概念"],
        "requiredExamples": ["必须包含的例题/代码/实践案例"],
        "requiredFormulas": ["必须规范展示的公式或推导"],
        "summaryForNext": "供下一章引用的 2-4 句摘要"
      },
      "time": {
        "readingMinutes": 150,
        "exerciseMinutes": 90,
        "practiceMinutes": 120,
        "extensionMinutes": 60
      }
    }
  ]
}

要求：
- 生成 6 到 10 章。
- 默认生成 8 章；只有学习主题确实需要时才扩展到 9 到 10 章。
- 每章必须有明确依赖、承接关系和向后铺垫，避免互不相关的主题列表。
- chapterContracts 必须与 chapters 一一对应；chapters[i].contract.chapterTitle 必须等于 chapters[i].title。
- terminology 的 introducedIn 必须指向实际章节标题。
- 时间估计必须拆分，单章总学习时间通常为 6 到 9 小时。
- 所有 JSON 字符串必须正确转义，禁止尾随逗号。

内容时效性与覆盖面（重要）：
- 识别该领域在 2023 年至模型知识截止时间（约 2025 年 4 月）出现的关键进展。
- 章节必须覆盖“经典方法”和“近期方法”两层，不能只列经典方法。
- 如果该领域发展较快（如大模型、AI 安全、Agent、扩散模型、RAG），至少安排 2 章专门讨论 2023 年以后提出或显著演进的方法。
- 在 requiredTopics 中，近期方法应明确标注提出时间或代表性论文，便于后续章节作者识别。
- 不要因为“旧方法更经典”就忽略新方法；也不要只堆砌新方法而丢失基础。
- terminology 中应包含该领域的核心近期术语，如新方法的缩写、提出者或代表性论文。
- 不得声称覆盖模型知识截止时间之后的进展，也不得虚构论文、方法或发布日期。`;
}

export function buildCoursePlannerJsonRepairPrompt(input: CoursePlannerInput, invalidText: string, parseError: string) {
  return `你是一名严谨的 JSON 修复器。下面是课程规划模型输出的坏 JSON，它的内容方向基本可用，但语法无法被 JSON.parse 解析。

你的任务：不要逐字修补坏 JSON，而是根据原始课程需求和坏 JSON 的意图，重新生成一个更短、更稳定、合法、可直接 JSON.parse 的 JSON 对象。

原始课程需求：
- 学习主题：${input.topic}
- 具体目标：${input.goal}
- 当前基础：${input.background}
- 讲解偏好：${input.preference}
- 每周学习时间：${input.weeklyHours} 小时
- 默认章节篇幅：${input.chapterLength ?? "medium"}

解析错误：
${parseError}

坏 JSON 原文：
${invalidText}

修复规则：
- 只输出 JSON 对象，不要输出 Markdown、代码围栏、说明文字或前后缀。
- 第一个字符必须是 {，最后一个字符必须是 }。
- 保留 profile、courseBible、chapters 三个顶层字段。
- courseBible 必须包含 targetLearner、finalOutcomes、teachingStyle、prerequisites、globalNarrative、terminology、chapterDependencies、chapterContracts。
- chapters 必须是 6 到 8 章；每章必须包含 title、description、purpose、connectionFromPrevious、setupForNext、contract、time。
- chapters[i].contract.chapterTitle 必须等于 chapters[i].title。
- 所有字符串必须闭合；字符串内部不要直接换行；英文双引号必须转义为 \\"。
- 数组元素之间必须有英文逗号；禁止尾随逗号。
- 不要把公式、Markdown 列表或代码块放进 JSON 字符串。
- 每个字符串最多 80 个中文字符；每个数组最多 5 项；不要保留坏 JSON 里的长段落。
- 输出尽量紧凑，不要为了排版添加多余换行。

请现在输出修复后的完整 JSON。`;
}

export function buildCoursePlannerCompactPrompt(input: CoursePlannerInput, reason: string) {
  return `你是一名中文教材课程架构师。前一次课程规划 JSON 仍无法解析，因此现在必须改用紧凑模式重新规划。

失败原因：
${reason}

课程需求：
- 学习主题：${input.topic}
- 具体目标：${input.goal}
- 当前基础：${input.background}
- 讲解偏好：${input.preference}
- 每周学习时间：${input.weeklyHours} 小时
- 默认章节篇幅：${input.chapterLength ?? "medium"}

只输出一个合法 JSON 对象，必须能被 JSON.parse 直接解析。不要输出 Markdown、代码围栏、说明文字或前后缀。

硬性规则：
- 第一个字符是 {，最后一个字符是 }。
- 生成 6 到 8 章。
- 每个字符串最多 70 个中文字符。
- 每个数组最多 5 项。
- 字符串内部不要直接换行，不要使用未转义的英文双引号。
- 禁止尾随逗号。

JSON 结构必须完全使用：
{
  "profile": "学习路线说明",
  "courseBible": {
    "targetLearner": "目标学习者",
    "finalOutcomes": ["能力1"],
    "teachingStyle": "写作风格",
    "prerequisites": ["前置知识1"],
    "globalNarrative": "全书递进逻辑",
    "terminology": [
      {"term":"术语","definition":"定义","introducedIn":"章节标题"}
    ],
    "chapterDependencies": [
      {"chapterTitle":"章节标题","dependsOn":["前置章节"],"introduces":["新概念"],"preparesFor":["后续章节"]}
    ],
    "chapterContracts": [
      {
        "chapterTitle": "章节标题",
        "requiredTopics": ["主题1"],
        "bridgeFromPrevious": "承接方式",
        "bridgeToNext": "铺垫方式",
        "forbiddenEarlyTopics": ["暂不展开的主题"],
        "requiredExamples": ["例题或实践"],
        "requiredFormulas": ["公式或推导"],
        "summaryForNext": "给下一章引用的摘要"
      }
    ]
  },
  "chapters": [
    {
      "title": "章节标题",
      "description": "内容概述",
      "purpose": "教学任务",
      "connectionFromPrevious": "与上一章关系",
      "setupForNext": "为下一章铺垫",
      "contract": {
        "chapterTitle": "章节标题",
        "requiredTopics": ["主题1"],
        "bridgeFromPrevious": "承接方式",
        "bridgeToNext": "铺垫方式",
        "forbiddenEarlyTopics": ["暂不展开的主题"],
        "requiredExamples": ["例题或实践"],
        "requiredFormulas": ["公式或推导"],
        "summaryForNext": "给下一章引用的摘要"
      },
      "time": {
        "readingMinutes": 150,
        "exerciseMinutes": 90,
        "practiceMinutes": 120,
        "extensionMinutes": 60
      }
    }
  ]
}

现在输出紧凑合法 JSON。`;
}
