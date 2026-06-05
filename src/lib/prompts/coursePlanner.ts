import { textbookSkill } from "./textbookSkill";

export type CoursePlannerInput = {
  topic: string;
  goal: string;
  background: string;
  preference: string;
  weeklyHours: number;
};

export function buildCoursePlannerPrompt(input: CoursePlannerInput) {
  return `${textbookSkill()}

# Task: Course Planning

你是一位课程架构师和教材总主编。请为学习者设计一门连贯课程，并生成 Course Bible。

用户想学习：${input.topic}
具体目标：${input.goal}
当前基础：${input.background}
讲解偏好：${input.preference}
每周学习时间：${input.weeklyHours} 小时

请只输出 JSON，不要 Markdown。必须符合以下结构：

{
  "profile": "学习策略说明，说明为什么这样安排",
  "courseBible": {
    "targetLearner": "目标学习者画像",
    "finalOutcomes": ["最终应达到的能力"],
    "teachingStyle": "整本教材统一写作风格",
    "prerequisites": ["需要补齐或默认掌握的前置知识"],
    "globalNarrative": "整门课的主线叙事，说明章节如何递进",
    "terminology": [
      {"term":"术语","definition":"定义","introducedIn":"章节名"}
    ],
    "chapterDependencies": [
      {"chapterTitle":"章节名","dependsOn":["依赖"],"introduces":["本章引入"],"preparesFor":["为后续铺垫"]}
    ]
  },
  "chapters": [
    {
      "title": "章节名",
      "description": "一句话说明",
      "purpose": "本章在整门课中的教学任务",
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

生成 6 到 10 章。章节之间必须有明确依赖，不要想到什么说什么。时间估计必须拆分，不允许只给一个总数。每章正文会明显变长，单章总学习时间通常应为 6 到 9 小时，除非该章只是过渡章节。`;
}
