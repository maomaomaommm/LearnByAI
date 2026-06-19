export type CourseResearchInput = {
  topic: string;
  goal: string;
  background: string;
};

export function buildCourseResearchPrompt(input: CourseResearchInput, currentDate = new Date()) {
  const date = currentDate.toISOString().slice(0, 10);
  return `当前日期是 ${date}。请根据以下课程信息，转写出适合联网搜索的英文关键词。

课程主题：${input.topic}
学习目标：${input.goal}
学习者背景：${input.background}

只输出合法 JSON：{"query":"5 到 10 个英文关键词"}
要求：
- query 应反映领域前沿、而非用户背景的方面。
- 不要写解释、思考过程或注释。
- 不要带 Markdown。`;
}
