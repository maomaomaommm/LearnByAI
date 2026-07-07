export type CourseResearchInput = {
  topic: string;
  goal: string;
  background: string;
};

export function buildCourseResearchPrompt(input: CourseResearchInput, currentDate = new Date()) {
  const date = currentDate.toISOString().slice(0, 10);
  return `你是论文检索词生成器。今天是 ${date}。请把中文课程需求转换成适合 arXiv 的简短英文检索词。

课程主题：${input.topic}
学习目标：${input.goal}
学习者基础：${input.background}

只输出合法 JSON：{"query":"5 到 10 个英文关键词"}
要求：
- query 必须包含领域主体和用户最关心的方法方向。
- 不要写年份、布尔运算符、解释或标点。
- 不要输出 Markdown。`;
}
