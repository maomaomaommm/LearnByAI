export type CoursePlannerInput = {
  topic: string;
  goal: string;
  background: string;
  preference: string;
  weeklyHours: number;
};

export function buildCoursePlannerPrompt(input: CoursePlannerInput) {
  return `你是一位课程架构师。请根据学习者信息设计一门连贯的中文课程。

学习主题：${input.topic}
具体目标：${input.goal}
当前基础：${input.background}
讲解偏好：${input.preference}
每周学习时间：${input.weeklyHours} 小时

只输出合法 JSON，不要输出 Markdown、代码围栏、解释或前后缀。

JSON 必须符合：
{
  "profile": "为什么采用这条学习路线",
  "courseBible": {
    "targetLearner": "目标学习者画像",
    "finalOutcomes": ["最终能力"],
    "teachingStyle": "全书统一写作风格",
    "prerequisites": ["前置知识"],
    "globalNarrative": "章节如何递进",
    "terminology": [
      {"term":"术语","definition":"定义","introducedIn":"首次出现的章节名"}
    ],
    "chapterDependencies": [
      {"chapterTitle":"章节名","dependsOn":["依赖章节"],"introduces":["新概念"],"preparesFor":["后续章节"]}
    ]
  },
  "chapters": [
    {
      "title": "章节名",
      "description": "内容概述",
      "purpose": "教学任务",
      "connectionFromPrevious": "与上一章的具体联系",
      "setupForNext": "如何为下一章铺垫",
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
- 章节必须有明确依赖和学习递进。
- 不要写成互不相关的主题列表。
- 时间估计必须拆分，单章总学习时间通常为 6 到 9 小时。
- 所有 JSON 字符串必须正确转义，禁止尾随逗号。`;
}
