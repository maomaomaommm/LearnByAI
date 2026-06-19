import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDeterministicRepairs,
  applyRepairPatches,
  buildRepairTargets,
  filterTargetsByValidationFailures,
  normalizeRepairPatchPayload,
  validateTargetedContent,
} from "../../src/lib/maol/targetedRepair";
import { Chapter, QualityIssue } from "../../src/lib/types";

function chapter(): Chapter {
  return {
    id: "chapter-2",
    title: "第二章：CLM核心概念与物理过程",
    description: "Explain CLM concepts.",
    purpose: "建立 CLM 物理过程框架。",
    contract: {
      chapterTitle: "第二章：CLM核心概念与物理过程",
      requiredTopics: ["能量平衡", "水分循环", "碳氮循环"],
      bridgeFromPrevious: "承接第一章",
      bridgeToNext: "准备后续参数化章节",
      forbiddenEarlyTopics: ["Richards equation", "Monin-Obukhov", "Jarvis"],
      requiredExamples: [],
      requiredFormulas: [],
    },
    time: {
      readingMinutes: 20,
      exerciseMinutes: 10,
      practiceMinutes: 10,
      extensionMinutes: 5,
    },
  };
}

function issue(patch: Partial<QualityIssue>): QualityIssue {
  return {
    check: "reviewer.continuity",
    severity: "warning",
    message: "Issue",
    source: "REVIEWER",
    ...patch,
  };
}

const currentSecondChapterLikeContent = [
  "# 第二章 CLM核心概念与物理过程",
  "",
  "## 1. 地表能量交换",
  "",
  "### 1.1 为什么需要能量平衡",
  "地表能量平衡可写成一个概念关系。方程（1）说明能量如何分配。",
  "",
  "## 3. 湍流与冠层",
  "",
  "### 3.1 湍流阻抗",
  "这里提前展开 Monin-Obukhov 相似理论和 Jarvis 冠层阻抗方案。",
  "",
  "## 4. 土壤水分",
  "",
  "### 4.3 土壤水运动",
  "这里提前展开 Richards equation、finite difference、Dunne/Horton runoff。",
  "",
  "## 7. 小结",
  "",
  "第 7 节再次提到土壤热扩散离散化，并写成 CO$_2$。",
].join("\n");

test("targeted repair maps reviewer issues to concrete chapter scopes", () => {
  const targets = buildRepairTargets(chapter(), currentSecondChapterLikeContent, [
    issue({
      message: "4.3 prematurely expands Richards equation, finite difference, Dunne/Horton runoff.",
    }),
    issue({
      message: "3.1 and 7 mention Monin-Obukhov, Jarvis, soil heat diffusion discretization.",
    }),
    issue({
      check: "reviewer.math",
      message: "Uses 方程（1） but there is no numbered equation.",
    }),
    issue({
      check: "reviewer.structure",
      message: "Chapter title does not match the contract.",
    }),
  ]);

  assert.ok(targets.some((target) => target.headingLine === "### 4.3 土壤水运动"));
  assert.ok(targets.some((target) => target.headingLine === "### 3.1 湍流阻抗"));
  assert.ok(targets.some((target) => target.headingLine === "### 1.1 为什么需要能量平衡"));
  assert.ok(targets.some((target) => target.kind === "chapter_title"));
  assert.ok(targets.every((target) => target.repairable));
});

test("patch application only changes exact text inside the target section", () => {
  const targets = buildRepairTargets(chapter(), currentSecondChapterLikeContent, [
    issue({
      message: "4.3 prematurely expands Richards equation, finite difference, Dunne/Horton runoff.",
    }),
  ]);

  const result = applyRepairPatches(currentSecondChapterLikeContent, targets, [
    {
      targetHeading: "### 4.3 土壤水运动",
      issueIds: ["issue-1"],
      before: "这里提前展开 Richards equation、finite difference、Dunne/Horton runoff。",
      after: "这里仅说明土壤水分作为储水库与蒸散、入渗和径流相连，不提前展开后续章节的数值求解方法。",
      confidence: "high",
    },
  ]);

  assert.equal(result.applied.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.match(result.content, /不提前展开后续章节的数值求解方法/u);
  assert.match(result.content, /Monin-Obukhov/u);
});

test("patch application rejects non-exact and cross-section replacements", () => {
  const targets = buildRepairTargets(chapter(), currentSecondChapterLikeContent, [
    issue({
      message: "4.3 prematurely expands Richards equation.",
    }),
  ]);

  const result = applyRepairPatches(currentSecondChapterLikeContent, targets, [
    {
      targetHeading: "### 4.3 土壤水运动",
      issueIds: ["issue-1"],
      before: "这里提前展开 Monin-Obukhov 相似理论和 Jarvis 冠层阻抗方案。",
      after: "这里只保留概念性描述。",
      confidence: "high",
    },
  ]);

  assert.equal(result.applied.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].message, /not found exactly/u);
  assert.equal(result.content, currentSecondChapterLikeContent);
});

test("patch application rejects conversational model output and keeps original content", () => {
  const targets = buildRepairTargets(chapter(), currentSecondChapterLikeContent, [
    issue({
      message: "Uses 方程（1） but there is no numbered equation.",
    }),
  ]);

  const result = applyRepairPatches(currentSecondChapterLikeContent, targets, [
    {
      targetHeading: "### 1.1 为什么需要能量平衡",
      issueIds: ["issue-1"],
      before: "地表能量平衡可写成一个概念关系。方程（1）说明能量如何分配。",
      after: "您好，下面是修复后的内容。",
      confidence: "high",
    },
  ]);

  assert.equal(result.applied.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.content, currentSecondChapterLikeContent);
});

test("targeted validation catches unresolved issue-specific forbidden terms", () => {
  const targets = buildRepairTargets(chapter(), currentSecondChapterLikeContent, [
    issue({
      message: "4.3 prematurely expands Richards equation, finite difference, Dunne/Horton runoff.",
    }),
  ]);

  const failures = validateTargetedContent(currentSecondChapterLikeContent, targets);
  assert.ok(failures.some((failure) => failure.includes("forbidden early hydrology detail")));
});

test("patch payload normalization accepts provider object shape and strips invalid values", () => {
  const patches = normalizeRepairPatchPayload({
    patches: [
      {
        targetHeading: " ### 4.3 土壤水运动 ",
        before: " before ",
        after: " after ",
        issueIds: [" issue-1 ", "", 4],
        confidence: "high",
      },
      {
        targetHeading: "ignored empty",
      },
    ],
  });

  assert.deepEqual(patches, [
    {
      targetHeading: "### 4.3 土壤水运动",
      before: "before",
      after: "after",
      issueIds: ["issue-1"],
      confidence: "high",
    },
  ]);
});

test("deterministic repair removes nested inline math delimiters from display formulas", () => {
  const content = [
    "# 第二章 CLM核心概念与物理过程",
    "",
    "## 例 2.2",
    "$$",
    "$L^\\uparrow = \\epsilon \\sigma T_s^4$。",
    "$$",
    "",
    "$$",
    "$\\lambda E = R_n - H - G$",
    "$$",
  ].join("\n");

  const result = applyDeterministicRepairs(content, [
    issue({
      check: "reviewer.math",
      message: "公式块写成了 $$ 内部再包一层行内公式符号，例如 $L^\\uparrow$ 和 $\\lambda E$。",
    }),
  ]);

  assert.ok(result.changes.some((change) => change.includes("display math")));
  assert.match(result.content, /\$\$\nL\^\\uparrow = \\epsilon \\sigma T_s\^4\n\$\$/u);
  assert.doesNotMatch(result.content, /\$\$[。；;,.，、]/u);
  assert.match(result.content, /\$\$\n\\lambda E = R_n - H - G\n\$\$/u);
  assert.doesNotMatch(result.content, /\$\$\n\$/u);
});

test("targeted validation can isolate failed targets while preserving other applied patches", () => {
  const targets = buildRepairTargets(chapter(), currentSecondChapterLikeContent, [
    issue({
      message: "3.1 and 7 mention Monin-Obukhov, Jarvis, soil heat diffusion discretization.",
    }),
  ]);
  const result = applyRepairPatches(currentSecondChapterLikeContent, targets, [
    {
      targetHeading: "### 3.1 湍流阻抗",
      issueIds: ["issue-1"],
      before: "这里提前展开 Monin-Obukhov 相似理论和 Jarvis 冠层阻抗方案。",
      after: "这里仅说明湍流交换会受风速、植被高度和大气稳定度影响，具体阻力公式留到第四章。",
      confidence: "high",
    },
    {
      targetHeading: "## 7. 小结",
      issueIds: ["issue-1"],
      before: "第 7 节再次提到土壤热扩散离散化，并写成 CO$_2$。",
      after: "第 7 节仍然提到土壤热扩散离散化，并写成 CO$_2$。",
      confidence: "high",
    },
  ]);
  const appliedIssueIds = new Set(result.applied.flatMap((item) => item.issueIds));
  const appliedTargets = targets.filter((target) => target.issues.some((targetIssue) => appliedIssueIds.has(targetIssue.id)));
  const failures = validateTargetedContent(result.content, appliedTargets);
  const failedTargets = filterTargetsByValidationFailures(appliedTargets, failures);

  assert.equal(result.applied.length, 2);
  assert.match(result.content, /具体阻力公式留到第四章/u);
  assert.ok(failures.length >= 1);
  assert.ok(failedTargets.some((target) => target.headingLine === "## 7. 小结"));
  assert.ok(!failedTargets.some((target) => target.headingLine === "### 3.1 湍流阻抗"));
});

test("deterministic repair handles known local reviewer issues without model rewrites", () => {
  const content = [
    "# 第二章 CLM核心概念与物理过程",
    "",
    "第一章的输出文件中，我们看到了 `FSH`（感热通量）、`EFLX_LH_TOT`（潜热通量）、`FIRE`（净辐射）等变量。",
    "",
    "## 第三节 感热与潜热通量",
    "",
    "### 感热通量",
    "",
    "感热通量 $H$ 的公式已在本节开头给出。在CLM中，$r_a$ 通过Monin-Obukhov理论计算（第四章详述），但这里我们先理解其物理含量：$r_a$ 越小，热量交换效率越高。",
    "",
    "### 潜热通量",
    "",
    "Penman-Monteith方程是CLM计算潜热通量的核心公式之一，但要注意CLM将其嵌入到更完整的冠层-土壤-大气耦合框架中，$r_s$ 由气孔导度模型（如Jarvis模型）计算，$r_a$ 由Monin-Obukhov理论提供。本章不展开这些参数化细节。",
    "",
    "### 径流过程",
    "",
    "CLM中径流参数化方案通常在次网格尺度上处理（如结合地形指数），但物理基础可概括为：",
    "",
    "- **地表径流**：当降水强度超过土壤入渗能力（Horton径流）或土壤饱和后（Dunne径流）产生。",
    "",
    "### 冻土过程",
    "",
    "汽化潜热在融化时释放。融化本身消耗大量能量，导致净辐射中的相当一部分被冻结潜热。",
  ].join("\n");

  const result = applyDeterministicRepairs(content, [
    issue({ check: "reviewer.structure", message: "章节标题写作格式与契约中的“第二章：CLM核心概念与物理过程”不一致。" }),
    issue({ check: "reviewer.depth", message: "FIRE 称为净辐射变量，可能与CLM常用输出变量命名不一致。" }),
    issue({ check: "reviewer.structure", message: "感热通量小节写公式已在本节开头给出，属于章节内部引用错误。" }),
    issue({ check: "reviewer.continuity", message: "提前点名 Monin-Obukhov、Jarvis、地形指数和 Horton/Dunne 等后续参数化框架。" }),
    issue({ check: "reviewer.depth", message: "冻土过程段落中写到汽化潜热在融化时释放，物理表述错误。" }),
  ]);

  assert.match(result.content, /^# 第二章：CLM核心概念与物理过程/u);
  assert.doesNotMatch(result.content, /`FIRE`（净辐射）/u);
  assert.doesNotMatch(result.content, /公式已在本节开头给出/u);
  assert.doesNotMatch(result.content, /Monin-Obukhov理论计算/u);
  assert.doesNotMatch(result.content, /Jarvis模型/u);
  assert.doesNotMatch(result.content, /地形指数|Horton径流|Dunne径流/u);
  assert.doesNotMatch(result.content, /汽化潜热在融化时释放/u);
  assert.ok(result.changes.length >= 6);
});

test("deterministic repair generalizes late-chapter parameterization warnings", () => {
  const content = [
    "# 第二章：CLM核心概念与物理过程",
    "",
    "因此净辐射 $R_n = \\text{FSA} - \\text{FIRA}$（或根据具体符号约定组合）。",
    "",
    "$$",
    "R_n = (1-\\alpha) S_{\\mathrm{in}} + L_{\\mathrm{in}} - \\varepsilon \\sigma T_s^4",
    "$$",
    "",
    "Penman-Monteith方程是CLM计算潜热通量的核心公式之一，但要注意CLM将其嵌入到更完整的冠层-土壤-大气耦合框架中，$r_s$ 由后续章节将给出的气孔导度经验或半经验表达计算，$r_a$ 由后续章节将给出的边界层阻力方案提供。本章不展开这些参数化细节，只要求理解公式中包含的物理竞争关系。",
    "",
    "3. 潜热通量：",
    "",
    "- $\\lambda E = 2.5\\times10^6 \\times 1.15 \\times (0.036-0.008) / (120.38+400) = 2.5\\times10^6 \\times 1.15 \\times 0.028 / 520.38$。",
    "",
    "这里暴露了未引入土壤水分参数化时手算的局限性，但也正说明模型参数化的必要性。",
    "CLM正是通过参数化这些属性来实现模拟。",
    "如何将上述物理规律通过参数化方案转化为可计算的数学表达式？不同次网格过程如何被有效表示？这些正是第四章将要回答的。另外，从本章的实践案例已经看到，简化公式在高表面阻力时失效，这提示我们需要更精细的土壤-植被-大气连续体模型——这正是CLM参数化方案的设计动机。",
  ].join("\n");

  const result = applyDeterministicRepairs(content, [
    issue({ check: "reviewer.math", message: "净辐射公式未说明长波发射率和符号约定。" }),
    issue({ check: "reviewer.depth", message: "Penman-Monteith方程被称为CLM计算潜热通量的核心公式之一，容易误以为CLM直接整体套用该公式。" }),
    issue({ check: "reviewer.structure", message: "站点B潜热通量公式使用了未缩进的无序列表。" }),
    issue({ check: "reviewer.continuity", message: "多次使用参数化方案、模型参数化、气孔导度、表面阻力等，接近第四章内容。" }),
  ]);

  assert.match(result.content, /应先查明输出表中长波变量的正方向/u);
  assert.match(result.content, /\\varepsilon L_\{\\mathrm\{in\}\}/u);
  assert.match(result.content, /在本章作为概念工具/u);
  assert.match(result.content, /\n   - \$\\lambda E/u);
  assert.doesNotMatch(result.content, /未引入土壤水分参数化/u);
  assert.doesNotMatch(result.content, /CLM正是通过参数化这些属性/u);
  assert.doesNotMatch(result.content, /参数化方案的设计动机/u);
});
