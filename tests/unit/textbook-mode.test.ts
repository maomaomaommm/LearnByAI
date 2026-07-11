import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createFailedFigureMarkdownRe,
  createFigureMarkdownRe,
  parseFailedFigureMarker,
  parseFigurePlaceholders,
  renumberChapterFigures,
} from "../../src/lib/figures";
import { normalizeContentMode, normalizeCourse } from "../../src/lib/normalizeCourse";
import { hasImageModelConfig, normalizeModelOverrides } from "../../src/lib/modelOverrides";
import { getUserImageModelConfig } from "../../src/lib/illustration";
import { markdownToTex, toTex } from "../../src/lib/exports";
import { normalizeTextbookMeta, validateTextbookMeta } from "../../src/lib/textbookOutline";
import type { Course, TextbookMeta, TextbookOutlineChapter } from "../../src/lib/types";

// ---- contentMode compatibility -------------------------------------------

test("normalizeContentMode falls back to lecture for legacy/invalid values", () => {
  assert.equal(normalizeContentMode(undefined), "lecture");
  assert.equal(normalizeContentMode("weird"), "lecture");
  assert.equal(normalizeContentMode("textbook"), "textbook");
});

test("normalizeCourse stamps legacy courses as lecture", () => {
  const legacy = {
    id: "c1",
    topic: "t",
    goal: "g",
    background: "b",
    profile: "",
    courseBible: { targetLearner: "", finalOutcomes: [], teachingStyle: "", prerequisites: [], globalNarrative: "", terminology: [], chapterDependencies: [] },
    chapters: [],
    createdAt: new Date().toISOString(),
  } as unknown as Course;
  assert.equal(normalizeCourse(legacy).contentMode, "lecture");
});

// ---- image model config ---------------------------------------------------

test("normalizeModelOverrides keeps a standalone image config", () => {
  const normalized = normalizeModelOverrides({ version: 1, image: { apiKey: "k", baseUrl: "https://x", model: "m" } });
  assert.ok(normalized?.image?.apiKey === "k");
  assert.equal(hasImageModelConfig(normalized), true);
});

test("image mode requires apiKey + baseUrl + model", () => {
  assert.equal(hasImageModelConfig({ version: 1, image: { apiKey: "k" } }), false);
  assert.equal(getUserImageModelConfig({ version: 1, image: { apiKey: "k", baseUrl: "https://x/", model: "m" } })?.baseUrl, "https://x");
  assert.equal(getUserImageModelConfig({ version: 1, image: { apiKey: "k" } }), undefined);
  assert.equal(getUserImageModelConfig(undefined), undefined);
});

// ---- figure placeholder protocol -------------------------------------------

test("parseFigurePlaceholders reads key-value blocks", () => {
  const content = [
    "正文。",
    "",
    ":::learnbyai-figure",
    "caption: 策略迭代循环",
    "prompt: draw the GPI loop",
    "diagramSpec: 评估 -> 改进 -> 收敛",
    "textLabelsAllowed: true",
    ":::",
    "",
    "后文。",
  ].join("\n");
  const blocks = parseFigurePlaceholders(content);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].placeholder.caption, "策略迭代循环");
  assert.equal(blocks[0].placeholder.textLabelsAllowed, true);
  assert.ok(blocks[0].placeholder.diagramSpec?.includes("评估"));
});

test("parseFigurePlaceholders drops blocks missing caption or prompt", () => {
  const content = ":::learnbyai-figure\ncaption: 只有图题\n:::";
  assert.equal(parseFigurePlaceholders(content).length, 0);
});

test("parseFigurePlaceholders reads escaped-newline blocks from model output", () => {
  const content = String.raw`:::learnbyai-figure\ncaption: two-state weather chain\nprompt: draw a simple transition diagram\ndiagramSpec: nodes: sunny, rainy; arrows: sunny->sunny 0.8, sunny->rainy 0.2\ntextLabelsAllowed: true :::`;
  const blocks = parseFigurePlaceholders(content);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].placeholder.caption, "two-state weather chain");
  assert.equal(blocks[0].placeholder.prompt, "draw a simple transition diagram");
  assert.equal(blocks[0].placeholder.textLabelsAllowed, true);
  assert.ok(blocks[0].placeholder.diagramSpec?.includes("sunny->rainy"));
});

// ---- figure markdown regex: dot + legacy dash labels ------------------------

test("createFigureMarkdownRe matches both 图 N.M and legacy 图 N-M", () => {
  const dot = "![图 2.1　贝尔曼备份图](/api/illustrations/a/b/c.png)\n\n*图 2.1　贝尔曼备份图*";
  const dash = "![图 2-1　贝尔曼备份图](/api/illustrations/a/b/c.png)\n\n*图 2-1　贝尔曼备份图*";
  assert.ok(createFigureMarkdownRe().test(dot));
  assert.ok(createFigureMarkdownRe().test(dash));
});

test("renumberChapterFigures renumbers by document order and migrates dash labels", () => {
  const content = [
    "段落一。",
    "![图 3-2　旧图乙](/api/illustrations/a/b/two.png)",
    "",
    "*图 3-2　旧图乙*",
    "",
    "段落二。",
    "![图 3.9　新图丙](/api/illustrations/a/b/three.png)",
    "",
    "*图 3.9　新图丙*",
  ].join("\n");
  const renumbered = renumberChapterFigures(content, 3);
  assert.ok(renumbered.includes("![图 3.1　旧图乙]"), renumbered);
  assert.ok(renumbered.includes("*图 3.1　旧图乙*"), renumbered);
  assert.ok(renumbered.includes("![图 3.2　新图丙]"), renumbered);
  assert.ok(!renumbered.includes("图 3-2"), renumbered);
  assert.ok(!renumbered.includes("图 3.9"), renumbered);
});

// ---- failed-figure marker ---------------------------------------------------

test("failed-figure marker roundtrips caption/prompt for retry", () => {
  const marker = [
    "> 图示暂未生成（代码渲染）：策略迭代循环。provider timeout",
    '<!--learnbyai-figure-failed {"caption":"策略迭代循环","prompt":"draw the GPI loop","diagramSpec":"评估 -> 改进","mode":"code"}-->',
  ].join("\n");
  const re = createFailedFigureMarkdownRe();
  const match = re.exec(`前文。\n\n${marker}\n\n后文。`);
  assert.ok(match, "marker should match");
  const placeholder = parseFailedFigureMarker(match![1] ?? "");
  assert.equal(placeholder?.caption, "策略迭代循环");
  assert.equal(placeholder?.prompt, "draw the GPI loop");
});

// ---- markdown → TeX ---------------------------------------------------------

test("markdownToTex drops the duplicate 第 N 章 heading", async () => {
  const tex = await markdownToTex("# 第 3 章 动态规划\n\n正文段落。");
  assert.ok(!tex.includes("第 3 章"), tex);
  assert.ok(tex.includes("正文段落。"), tex);
});

test("markdownToTex strips writer numbering from section headings (TeX counters own numbers)", async () => {
  const tex = await markdownToTex("## 3.2 策略迭代\n\n### 3.2.1 收敛性");
  assert.ok(tex.includes("\\section{策略迭代}"), tex);
  assert.ok(tex.includes("\\subsubsection{收敛性}"), tex);
});

test("markdownToTex preserves math delimiters inside headings", async () => {
  const tex = await markdownToTex("## 6.4 动作价值估计：为什么需要估计 $q_\\pi(s,a)$");
  assert.ok(tex.includes("\\section{动作价值估计：为什么需要估计 $q_\\pi(s,a)$}"), tex);
  assert.ok(!tex.includes("\\$q\\_\\pi"), tex);
});

test("markdownToTex converts pipe tables to booktabs longtable and keeps cell math", async () => {
  const md = [
    "| 类型 | 表达式 |",
    "| --- | --- |",
    "| 期望 | $\\pi(a \\mid s)$ |",
    "| 极值_情形 | 100% |",
  ].join("\n");
  const tex = await markdownToTex(md);
  assert.match(tex, /\\begin\{longtable\}\{@\{\}L\{0\.\d{4}\}L\{0\.\d{4}\}@\{\}\}/u);
  assert.ok(tex.includes("\\setlength{\\LTleft}{0pt}") && tex.includes("\\rowcolor{LearnByAITableHeader}"), tex);
  assert.ok(tex.includes("\\toprule") && tex.includes("\\bottomrule"), tex);
  assert.ok(tex.includes("$\\pi(a \\mid s)$"), tex); // math cell untouched
  assert.ok(tex.includes("极值\\_情形") && tex.includes("100\\%"), tex); // text cells escaped
});

test("markdownToTex converts fenced code to framed textbook listings and lists to itemize/enumerate", async () => {
  const md = [
    "```python",
    "V[s] = max(q)",
    "```",
    "",
    "- 第一点 50%",
    "- 第二点",
    "",
    "1. 甲",
    "2. 乙",
  ].join("\n");
  const tex = await markdownToTex(md);
  assert.ok(tex.includes("\\Needspace{10\\baselineskip}"), tex);
  assert.ok(tex.includes("\\begin{lstlisting}[style=learnbyai,language=Python"), tex);
  assert.ok(tex.includes("\\color{LearnByAICodeMeta}Python"), tex);
  assert.ok(tex.includes("V[s] = max(q)\n\\end{lstlisting}"), tex);
  assert.ok(tex.includes("\\begin{itemize}") && tex.includes("\\item 第一点 50\\%"), tex);
  assert.ok(tex.includes("\\begin{enumerate}") && tex.includes("\\item 甲"), tex);
});

test("markdownToTex keeps exercise and further-reading lists continuous across blank lines", async () => {
  const md = [
    "## 3.8 课后习题",
    "",
    "1. **推导题：** 状态价值与动作价值关系。",
    "",
    "从定义",
    "",
    "$$",
    "v_\\pi(s) = \\mathbb{E}_\\pi[G_t \\mid S_t=s]",
    "$$",
    "",
    "推出动作价值的期望形式。",
    "",
    "1. **建模题：** 判断马尔可夫性。",
    "",
    "说明状态表示是否足够。",
    "",
    "## 3.9 拓展阅读",
    "",
    "1. Sutton 与 Barto，*Reinforcement Learning*。",
    "",
    "1. Ross，*Introduction to Probability Models*。",
  ].join("\n");

  const tex = await markdownToTex(md);
  assert.ok(tex.includes("\\section{课后习题}"), tex);
  assert.ok(tex.includes("\\begin{enumerate}[label=\\arabic*."), tex);
  assert.equal((tex.match(/\\begin\{enumerate\}\[label=\\arabic\*\./gu) ?? []).length, 2, tex);
  assert.equal((tex.match(/\\item /gu) ?? []).length, 4, tex);
  assert.ok(tex.includes("\\textbf{推导题：}"), tex);
  assert.ok(tex.includes("v_\\pi(s) = \\mathbb{E}_\\pi[G_t \\mid S_t=s]"), tex);
});

test("markdownToTex wraps wide tables and tightens typography for four columns", async () => {
  const md = [
    "| 建模选择 | 常见取法 | 适用场景 | 主要风险 |",
    "| --- | --- | --- | --- |",
    "| 状态表示 | 原始观测、手工特征、历史窗口 | 需要预测未来转移和奖励 | 状态信息缺失导致非马尔可夫性 |",
    "| 动作空间 | 离散动作、状态相关动作集合 | 表格方法和小规模控制 | 动作数量过大 |",
  ].join("\n");
  const tex = await markdownToTex(md);
  const widths = [...tex.matchAll(/L\{(0\.\d{4})\}/gu)].map((match) => Number(match[1]));
  assert.equal(widths.length, 4, tex);
  assert.ok(Math.abs(widths.reduce((sum, width) => sum + width, 0) - 1) < 0.001, tex);
  assert.ok(tex.includes("\\footnotesize"), tex);
  assert.ok(tex.includes("\\renewcommand{\\arraystretch}{1.28}"), tex);
  assert.ok(!tex.includes("\\begin{landscape}"), tex);
  assert.ok(!tex.includes("\\textbf{状态表示}"), tex);
  assert.ok(!tex.includes("\\textbf{动作空间}"), tex);
});

test("markdownToTex keeps compact six-column comparison tables in portrait", async () => {
  const md = [
    "| 方法 | 主要目标 | 备份形式 | 是否显式维护策略 | 适用场景 | 主要代价 |",
    "| --- | --- | --- | --- | --- | --- |",
    "| 迭代策略评估 | 计算 $v_\\pi$ | 对动作按 $\\pi(a\\mid s)$ 求期望 | 是，策略固定 | 已有策略、需要评价 | 多轮全状态扫描 |",
    "| 精确策略迭代 | 求最优策略 | 评估后对动作取贪心 | 是 | 小型 MDP | 每轮评估可能昂贵 |",
    "| 值迭代 | 求 $v_*$ 并提取策略 | 直接对动作取最大 | 否 | 小型到中型 MDP | 可能需要许多扫描 |",
  ].join("\n");
  const tex = await markdownToTex(md);
  assert.ok(!tex.includes("\\begin{landscape}"), tex);
  assert.ok(tex.includes("\\begin{longtable}"), tex);
  assert.ok(tex.includes("\\footnotesize"), tex);
  assert.ok(tex.includes("\\setlength{\\tabcolsep}{2.5pt}"), tex);
});

test("markdownToTex reserves landscape pages for dense seven-column algorithm matrices", async () => {
  const md = [
    "| 方法 | 学习对象 | 是否需模型 | 更新目标 | 策略关系 | 主要优点 | 主要风险 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| DP 策略评估 | $v_\\pi$ 或 $q_\\pi$ | 是 | 期望 Bellman 备份 | 给定策略 | 无采样噪声 | 需要完整模型 |",
    "| MC 预测 | $v_\\pi$ 或 $q_\\pi$ | 否 | 完整回报 $G_t$ | 通常同策略 | 目标无偏 | 必须等回合结束 |",
    "| TD(0) 预测 | $v_\\pi$ | 否 | $R_{t+1}+\\gamma v(S_{t+1})$ | 给定策略 | 在线、低方差 | 自举引入偏差 |",
    "| Sarsa | $q_\\pi$ | 否 | $R_{t+1}+\\gamma q(S_{t+1},A_{t+1})$ | 同策略 | 计入探索后果 | 学到探索策略价值 |",
    "| Q-learning | $q_*$ | 否 | $R_{t+1}+\\gamma\\max_{a'}q(S_{t+1},a')$ | 离策略 | 可复用探索数据 | 最大化偏差 |",
  ].join("\n");
  const tex = await markdownToTex(md);
  assert.ok(tex.includes("\\begin{landscape}"), tex);
  assert.ok(tex.includes("\\pagestyle{empty}"), tex);
  assert.ok(tex.includes("\\vspace*{\\fill}"), tex);
  assert.ok(tex.includes("\\small"), tex);
  assert.ok(tex.includes("\\end{landscape}"), tex);
  assert.ok(tex.includes("\\pagestyle{fancy}"), tex);
});

test("markdownToTex drops HTML comments and renders figures via \\includegraphics fallback box", async () => {
  const md = [
    "![图 1.1　交互循环](/api/illustrations/a/b/c.png)",
    "",
    "*图 1.1　交互循环*",
    "",
    "<!--learnbyai-figure-failed {\"caption\":\"x\",\"prompt\":\"y\"}-->",
  ].join("\n");
  const tex = await markdownToTex(md);
  assert.ok(tex.includes("\\begin{figure}[htbp]"), tex);
  assert.ok(tex.includes("\\caption{交互循环}"), tex);
  assert.ok(!tex.includes("learnbyai-figure-failed"), tex);
});

test("markdownToTex protects inline paren math like \\(f(x)\\)", async () => {
  const tex = await markdownToTex("函数 \\(f(x)\\) 的值域为 50%。");
  assert.ok(tex.includes("\\(f(x)\\)"), tex);
  assert.ok(tex.includes("50\\%"), tex);
});

test("markdownToTex converts bare Greek text symbols to math commands", async () => {
  const tex = await markdownToTex("ε-soft 策略包含 π 和 θ。");
  assert.ok(tex.includes("$\\varepsilon$-soft"), tex);
  assert.ok(tex.includes("$\\pi$"), tex);
  assert.ok(tex.includes("$\\theta$"), tex);
});

test("toTex wraps raw TeX in notation metadata before compilation", async () => {
  const course = {
    id: "course-raw-notation",
    contentMode: "textbook",
    topic: "Raw notation",
    goal: "",
    background: "",
    styles: [],
    learningMode: "standard",
    chapterCount: 2,
    difficulty: "beginner",
    profile: "",
    createdAt: "2026-07-11T00:00:00.000Z",
    courseBible: {
      targetLearner: "",
      finalOutcomes: [],
      teachingStyle: "",
      prerequisites: [],
      globalNarrative: "",
      terminology: [],
      notation: [{ symbol: "\\gamma", meaning: "discount factor: 0\\leq\\gamma\\leq1." }],
      chapterDependencies: [],
    },
    textbookMeta: { title: "Raw notation", subtitle: "", language: "zh-CN", outlineStatus: "confirmed" },
    chapters: [],
  } as unknown as Course;

  const tex = await toTex(course);
  assert.ok(tex.includes("discount factor: $0\\leq\\gamma\\leq1$."), tex);
});

test("toTex emits textbook front matter, map page, and chapter-level counters", async () => {
  const now = "2026-07-10T00:00:00.000Z";
  const course = {
    id: "course-1",
    contentMode: "textbook",
    topic: "强化学习",
    goal: "系统掌握强化学习的基本概念与数学原理。",
    background: "数学与编程基础",
    styles: ["rigor"],
    learningMode: "standard",
    chapterCount: 2,
    difficulty: "intermediate",
    profile: "进阶初学者",
    createdAt: now,
    courseBible: {
      targetLearner: "希望系统学习强化学习的读者",
      finalOutcomes: ["理解马尔可夫决策过程", "能够阅读基础论文"],
      teachingStyle: "教材式",
      prerequisites: ["线性代数", "概率论"],
      globalNarrative: "从基础概念到算法。",
      terminology: [{ term: "策略", definition: "状态到动作的映射。", introducedIn: "第 1 章" }],
      notation: [{ symbol: "G_t", meaning: "时刻 \\(t\\) 的回报。" }],
      chapterDependencies: [],
    },
    textbookMeta: {
      title: "强化学习",
      subtitle: "数学基础与算法导论",
      language: "zh-CN",
      outlineStatus: "confirmed",
      textbookMap: {
        id: "map-1",
        courseId: "course-1",
        order: 0,
        label: "教材地图",
        caption: "全书结构地图",
        prompt: "draw a map",
        generationMode: "code",
        status: "ready",
        createdAt: now,
      },
    },
    chapters: [
      {
        id: "ch-1",
        title: "引言",
        description: "背景与学习路线。",
        time: { readingMinutes: 10, exerciseMinutes: 0, practiceMinutes: 0, extensionMinutes: 0 },
        content: "# 第一章 引言\n\n## 1.1 背景\n\n正文。",
      },
      {
        id: "ch-2",
        title: "总结与展望",
        description: "回顾与未来方向。",
        time: { readingMinutes: 10, exerciseMinutes: 0, practiceMinutes: 0, extensionMinutes: 0 },
        content: "# 第二章 总结与展望\n\n正文。",
      },
    ],
  } as unknown as Course;

  const tex = await toTex(course);

  assert.ok(tex.includes("\\documentclass[UTF8,openany,oneside,12pt]{ctexbook}"), tex);
  assert.ok(tex.includes("\\usepackage{listings,upquote}"), tex);
  assert.ok(tex.includes("\\usepackage{pdflscape}"), tex);
  assert.ok(tex.includes("\\lstdefinestyle{learnbyai}"), tex);
  assert.ok(tex.includes("\\newcolumntype{L}[1]"), tex);
  assert.ok(tex.includes("\\chapter*{前言}"), tex);
  assert.ok(tex.includes("\\tableofcontents"), tex);
  assert.ok(tex.includes("\\chapter*{全书结构地图}"), tex);
  assert.ok(tex.includes("不占用正文图编号"), tex);
  assert.ok(tex.includes("\\numberwithin{equation}{chapter}"), tex);
  assert.ok(tex.includes("\\item[$G_t$] 时刻 \\(t\\) 的回报。"), tex);
});

// ---- outline validation -----------------------------------------------------

function outlineChapter(partial: Partial<TextbookOutlineChapter> & { title: string; order: number }): TextbookOutlineChapter {
  return {
    id: `ch-${partial.order}`,
    description: "说明",
    sections: [{ id: `s-${partial.order}`, title: "小节", description: "d", order: 0 }],
    ...partial,
  };
}

function validMeta(): TextbookMeta {
  return normalizeTextbookMeta({
    title: "测试教材",
    language: "zh-CN",
    outlineStatus: "ready",
    outline: {
      chapters: [
        outlineChapter({ title: "引言", order: 0, fixedRole: "introduction", sections: [] }),
        outlineChapter({ title: "主体", order: 1 }),
        outlineChapter({ title: "总结与展望", order: 2, fixedRole: "conclusion", sections: [] }),
      ],
    },
  });
}

test("validateTextbookMeta passes a canonical outline", () => {
  assert.equal(validateTextbookMeta(validMeta()), "");
});

test("validateTextbookMeta rejects missing fixed roles / empty sections", () => {
  const noIntro = validMeta();
  delete noIntro.outline!.chapters[0]!.fixedRole;
  assert.notEqual(validateTextbookMeta(noIntro), "");

  const emptyMiddle = validMeta();
  emptyMiddle.outline!.chapters[1]!.sections = [];
  assert.notEqual(validateTextbookMeta(emptyMiddle), "");

  const tooFew = validMeta();
  tooFew.outline!.chapters = tooFew.outline!.chapters.slice(0, 2);
  assert.notEqual(validateTextbookMeta(tooFew), "");
});
