import { Course } from "./types";

export function createMockCourse(input: {
  topic: string;
  goal: string;
  background: string;
  preference: string;
  weeklyHours: number;
}): Course {
  const id = crypto.randomUUID();
  return {
    id,
    ...input,
    profile: `你已经具备「${input.background}」相关基础。课程将以${input.preference}为主要讲解方式，每周按照 ${input.weeklyHours} 小时的节奏推进。`,
    createdAt: new Date().toISOString(),
    chapters: [
      {
        id: crypto.randomUUID(),
        title: `${input.topic}：建立全局地图`,
        description: "先理解核心问题、关键概念与整个领域的知识结构。",
        minutes: 45,
      },
      {
        id: crypto.randomUUID(),
        title: "必要的前置知识",
        description: "补齐后续深入学习所需要的概念与工具。",
        minutes: 60,
      },
      {
        id: crypto.randomUUID(),
        title: "核心原理与直觉",
        description: "从直觉、公式和具体案例三个角度理解核心机制。",
        minutes: 90,
      },
      {
        id: crypto.randomUUID(),
        title: "动手实现",
        description: "通过一个小型项目连接理论与实际应用。",
        minutes: 120,
      },
      {
        id: crypto.randomUUID(),
        title: "进阶主题与下一步",
        description: "识别领域边界，建立继续学习与研究的路线。",
        minutes: 60,
      },
    ],
  };
}

export function createMockChapter(topic: string, title: string, goal: string) {
  return `# ${title}

> **本章目标**：为你建立一张关于「${topic}」的清晰地图，并连接到你的目标：${goal}

## 为什么先建立全局地图？

学习一个新领域时，最大的困难通常不是缺少资料，而是不知道每条信息在整体中的位置。我们先把领域看作一个由**问题、方法和评价标准**组成的系统。

一个可靠的学习框架可以写成：

$$
\\text{有效学习} = \\text{清晰目标} \\times \\text{及时反馈} \\times \\text{刻意练习}
$$

其中任何一项接近零，整体效果都会显著下降。这也是为什么本课程不会一次性把所有内容堆给你，而是按章节逐步展开。

## 三个核心问题

1. **它试图解决什么问题？** 先理解问题，才能判断一种方法为什么存在。
2. **它如何解决这个问题？** 这里包含直觉、机制、公式与实现。
3. **如何判断它做得好不好？** 没有评价标准，就无法比较不同方法。

## 一个具体例子

假设你正在学习生成式 AI。与其直接记住 Transformer 的所有细节，不如先明确：

- 问题：如何让模型理解并生成序列？
- 方法：根据上下文预测有意义的后续内容。
- 评价：生成结果是否准确、有用、可靠且符合约束？

有了这张地图，之后遇到注意力机制、嵌入和微调时，你会知道它们分别解决哪个子问题。

## 小结

本章建立了学习新领域的统一视角。下一步，我们会识别你真正需要的前置知识，并跳过已经掌握的部分。

## 练习

用三句话分别描述「${topic}」要解决的问题、常见方法和评价标准。`;
}

export function createMockAnswer(selectedText: string, question: string) {
  return `你选中的内容是：“${selectedText.slice(0, 100)}${selectedText.length > 100 ? "…" : ""}”

针对“${question}”，可以把它理解为：这段内容是在给后续知识建立一个稳定的坐标系。你不需要立即记住所有细节，先确认它解决了什么问题，以及它与前后内容如何连接。

一个实用的判断方法是：尝试用自己的话复述，并举出一个反例。如果复述困难，说明这里值得继续拆解。`;
}
