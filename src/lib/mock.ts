import { buildStyleGuidance, STYLE_LABEL } from "./prompts/styleGuidance";
import { Course, CourseDifficulty, ExplanationStyle, GenerationProfile, LearningMode } from "./types";

export function createMockCourse(input: {
  topic: string;
  goal: string;
  background: string;
  preference?: string;
  styles: ExplanationStyle[];
  learningMode: LearningMode;
  chapterCount: number;
  difficulty: CourseDifficulty;
  generationProfile?: GenerationProfile;
  includeRecentResearch?: boolean;
}): Course {
  const firstChapterId = crypto.randomUUID();
  const styleSummary = input.styles.length
    ? input.styles.map((style) => STYLE_LABEL[style]).join("、")
    : input.preference?.trim() || "均衡讲解";
  return {
    id: crypto.randomUUID(),
    ...input,
    profile: `课程将面向具备「${input.background}」基础的学习者，采用「${styleSummary}」的方式推进，目标是：${input.goal}。`,
    createdAt: new Date().toISOString(),
    courseBible: {
      targetLearner: input.background,
      finalOutcomes: [input.goal, "能够解释核心概念并完成一个小型实践项目"],
      teachingStyle: buildStyleGuidance(input.styles, input.preference),
      prerequisites: ["基础数学", "基本编程能力", "阅读技术文档的能力"],
      globalNarrative: `从问题意识出发，逐步建立 ${input.topic} 的概念、方法、实践与论文阅读能力。`,
      terminology: [
        {
          term: "核心问题",
          definition: "该领域反复试图解决的中心困难。",
          introducedIn: "第一章",
        },
      ],
      chapterDependencies: [
        {
          chapterTitle: `${input.topic}：建立问题地图`,
          dependsOn: [],
          introduces: ["问题地图", "评价标准"],
          preparesFor: ["前置知识补齐"],
        },
      ],
    },
    chapters: createMockChapterPlan(input, firstChapterId),
  };
}

/**
 * Mock chapter plan honoring the requested chapter count (min 3 so textbook
 * outline validation — intro + ≥1 middle + conclusion — passes in mock mode).
 * Every chapter carries a contract with requiredTopics: textbook mode derives
 * section outlines from them.
 */
function createMockChapterPlan(
  input: { topic: string; goal: string; chapterCount: number },
  firstChapterId: string,
): Course["chapters"] {
  const count = Math.min(Math.max(input.chapterCount || 5, 3), 12);
  const middleThemes = ["必要前置知识", "核心原理", "经典方法", "进阶方法", "工程实践", "案例分析", "评估与调优", "近期进展", "开放问题", "综合项目"];

  return Array.from({ length: count }, (_, index) => {
    const isFirst = index === 0;
    const isLast = index === count - 1;
    const title = isFirst
      ? "引言"
      : isLast
        ? "总结与展望"
        : `${middleThemes[(index - 1) % middleThemes.length]}`;
    const requiredTopics = isFirst
      ? ["背景与意义", "研究近况", "全书阅读路线"]
      : isLast
        ? ["全书回顾", "前沿展望", "后续学习建议"]
        : [`${title}：核心概念`, `${title}：关键方法`, `${title}：典型例子`, `${title}：常见误区`];
    return {
      id: isFirst ? firstChapterId : crypto.randomUUID(),
      title,
      description: isFirst
        ? `先明确「${input.topic}」解决什么问题、为什么重要，以及后续章节如何展开。`
        : isLast
          ? "回顾全书主线，给出未来方向与学习建议。"
          : `围绕「${title}」系统展开讲解，服务于目标：${input.goal}。`,
      purpose: isFirst ? "建立全局方向，避免后续学习变成术语堆砌。" : isLast ? "完成全书收束。" : `讲透「${title}」。`,
      connectionFromPrevious: isFirst ? "这是课程起点。" : "承接上一章的核心概念。",
      setupForNext: isLast ? "这是全书收束。" : "为下一章准备必要概念。",
      depthWeight: isFirst || isLast ? ("light" as const) : ("normal" as const),
      contract: {
        chapterTitle: title,
        requiredTopics,
        bridgeFromPrevious: isFirst ? "这是全书起点。" : "从上一章自然过渡。",
        bridgeToNext: isLast ? "这是全书收束。" : "为下一章留下明确问题。",
        forbiddenEarlyTopics: [],
        requiredExamples: isFirst || isLast ? [] : ["至少包含一个服务本章核心概念的例子。"],
        requiredFormulas: [],
        summaryForNext: isLast ? "全书收束。" : "本章概念将被下一章直接引用。",
      },
      time: {
        readingMinutes: 50,
        exerciseMinutes: 30,
        practiceMinutes: 45,
        extensionMinutes: 45,
      },
      status: isFirst ? ("ready" as const) : ("pending" as const),
      ...(isFirst
        ? {
            review: "Mock 内容已通过结构检查。",
            content: createMockChapter(input.topic, "引言", input.goal),
          }
        : {}),
    };
  });
}

export function createMockChapter(topic: string, title: string, goal: string) {
  return `# ${title}

> **本章目标**：建立关于「${topic}」的学习地图，并连接到你的目标：${goal}

## 1. 本章在课程中的位置

本章不是为了讲完所有细节，而是为了回答三个问题：

- 这个领域真正想解决什么问题？
- 后续章节为什么要按照这个顺序学习？
- 学完后你应该如何判断自己是否真的理解了？

## 2. 直觉解释

学习一个新领域时，最大的困难通常不是资料不足，而是不知道每条信息在整体中的位置。我们可以把有效学习写成：

$$
\\text{有效学习} = \\text{清晰目标} \\times \\text{及时反馈} \\times \\text{刻意练习}
$$

如果其中任何一项接近零，学习效果都会明显下降。

## 3. 正式学习任务

本章要求你用自己的话写出：

1. 「${topic}」要解决的中心问题。
2. 至少两类常见方法。
3. 判断方法好坏的评价标准。

## 4. 练习与实践

- 阅读练习：找一篇相关综述，摘录其中的 5 个核心术语。
- 写作练习：用 200 字解释这个领域为什么值得学习。
- 实践任务：整理一个“我已经会 / 我还不会”的知识清单。

## 5. 下一章预告

下一章会补齐理解核心方法所需的前置知识。`;
}

export function createMockAnswer(selectedText: string, question: string) {
  return `你选中的内容是：

> ${selectedText.slice(0, 160)}${selectedText.length > 160 ? "..." : ""}

针对「${question}」，可以这样理解：

这段内容的作用是给后续学习建立坐标系。你暂时不需要记住所有细节，先确认它解决了什么问题，以及它为什么会出现在这里。

如果要进一步检查理解，可以试着回答：

1. 这段话中的核心概念是什么？
2. 它和上一段有什么关系？
3. 如果删掉这段，后续哪部分会变难？`;
}
