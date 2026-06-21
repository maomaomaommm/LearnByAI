import { ExplanationStyle, LearningMode } from "@/lib/types";

/**
 * 讲解风格 / 学习方式 的引导文本构造器（架构师与作者提示词共用）。
 *
 * 两条正交轴：
 * - 讲解风格 `styles`（可多选）——侧重哪种讲法（直觉 / 例子 / 推导 / 类比 / 公式代码），
 *   可自然融合；空或全选时回退到「均衡」，对立风格不打架。
 * - 学习方式 `learningMode`（单选）——内容如何组织（标准教材 / 项目 / 习题 / 案例）。
 *
 * 老课程只有自由文本 `preference`，无 styles 时用它兜底。
 */

export const STYLE_LABEL: Record<ExplanationStyle, string> = {
  intuition: "直觉优先",
  example: "例子说明",
  rigor: "严谨推导",
  analogy: "类比通俗",
  code: "公式代码",
};

const STYLE_ORDER: ExplanationStyle[] = ["intuition", "example", "rigor", "analogy", "code"];

export const LEARNING_MODE_LABEL: Record<LearningMode, string> = {
  standard: "标准教材",
  project: "项目驱动",
  exercise: "习题驱动",
  case: "案例驱动",
};

export const LEARNING_MODE_GUIDE: Record<LearningMode, string> = {
  standard: "学习方式：标准教材——系统讲授，按概念体系循序铺开，先打地基再逐层深入。",
  project:
    "学习方式：项目驱动——围绕一个贯穿全程的项目组织内容，各章服务于把这个项目逐步做出来；概念在搭建项目的过程中按需引入，章节结构对应项目里程碑。",
  exercise:
    "学习方式：习题驱动——问题先行、习题加重，每章围绕一条问题主线推进，靠提出问题、动手求解、复盘来建立与检验理解。",
  case:
    "学习方式：案例驱动——用真实案例带出原理，案例作为各章的组织主线，从案例现象出发走到背后的方法、结论与适用边界。",
};

/** 学习方式对「课程结构」的硬性约束（架构师规划章节时用）。 */
export const LEARNING_MODE_STRUCTURE_RULE: Record<LearningMode, string> = {
  standard: "按概念体系组织章节，循序渐进地铺开知识，先打基础再逐层深入。",
  project:
    "章节必须围绕一个贯穿全程的项目来组织：先在 profile / globalNarrative 里点明这个贯穿项目，再让每一章对应把项目推进一步（一个里程碑），概念在搭建项目的过程中按需引入。",
  exercise:
    "章节必须围绕问题主线组织：每章对应一类要解决的问题，由浅入深排布，理论与方法都服务于解决这些问题，章节里要预留贯穿的问题/习题线索。",
  case:
    "章节必须以真实案例为组织主线：每章绑定一个代表性案例，从案例现象出发引出本章的原理、方法与适用边界。",
};

const BALANCED_STYLE = "讲解风格：均衡，兼顾直觉、例子、推导与类比，以讲清概念为最高目标。";

/**
 * 构造「讲解风格」引导文本。
 * - 空或全选 → 均衡兜底。
 * - 选部分 → 「侧重 + 可融合」，并给出对立项的融合优先级，避免互相打架。
 * - 空但有 legacyPreference → 用旧自由文本（老课程兼容）。
 */
export function buildStyleGuidance(styles: ExplanationStyle[], legacyPreference?: string): string {
  const list = Array.isArray(styles) ? styles : [];
  const selected = STYLE_ORDER.filter((style) => list.includes(style));

  if (selected.length === 0) {
    const legacy = legacyPreference?.trim();
    if (legacy) {
      return `讲解风格：${legacy}`;
    }
    return BALANCED_STYLE;
  }

  if (selected.length >= STYLE_ORDER.length) {
    return BALANCED_STYLE;
  }

  const labels = selected.map((style) => STYLE_LABEL[style]).join("、");
  return (
    `讲解风格：在讲清概念这一最高目标的前提下，侧重 ${labels}（这些风格可自然融合，不必互斥）。` +
    `当不同风格有张力时一律优先服务理解，不要各写一段互相冲突——` +
    `例如「严谨推导」与「类比通俗」并存时，先用类比建立直觉，再给出严谨推导；` +
    `「直觉优先」与「公式代码」并存时，先讲清动机直觉，再落到公式与可运行代码。`
  );
}

/** 组合「讲解风格 + 学习方式」两行引导，供提示词里替换原 preference 处直接插入。 */
export function buildTeachingGuidance(
  styles: ExplanationStyle[],
  learningMode: LearningMode,
  legacyPreference?: string,
): string {
  const mode = LEARNING_MODE_GUIDE[learningMode] ? learningMode : "standard";
  return `${buildStyleGuidance(styles, legacyPreference)}\n${LEARNING_MODE_GUIDE[mode]}`;
}
