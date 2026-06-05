export const FORBIDDEN_PHRASES = [
  "颠覆",
  "革命性",
  "震撼",
  "雷霆",
  "史诗",
  "打开大门",
  "踏上旅程",
  "解锁",
  "魔法",
  "未来已来",
  "改变世界",
  "无限可能",
  "激动人心",
  "准备好了吗",
  "别担心",
  "我会陪你",
  "相信你一定可以",
  "核心密码",
  "终极指南",
  "一文搞懂",
  "保姆级",
  "天花板",
  "降维打击",
  "王炸",
  "炸裂",
  "灵魂",
  "神级",
];

export function forbiddenPhraseSection() {
  return `禁用表达：
${FORBIDDEN_PHRASES.map((phrase) => `- ${phrase}`).join("\n")}

如果草稿里出现这些表达，必须改写成具体、克制、可验证的教学说明。`;
}
