import { MarkdownSection, parseMarkdownSections } from "../markdownSections";
import { Chapter, Course, QualityIssue } from "../types";

export type RepairIssue = QualityIssue & {
  id: string;
};

export type RepairTargetKind =
  | "chapter_title"
  | "section_contract"
  | "formula_reference"
  | "notation_style"
  | "heading_rename"
  | "format"
  | "local_revision"
  | "unresolved";

export type RepairTarget = {
  id: string;
  kind: RepairTargetKind;
  heading?: string;
  headingLine?: string;
  excerpt: string;
  issues: RepairIssue[];
  repairable: boolean;
  reason?: string;
};

export type RepairPatch = {
  targetHeading?: string;
  before?: string;
  after?: string;
  issueIds?: string[];
  confidence?: "low" | "medium" | "high" | number;
};

export type PatchResult = {
  patch: RepairPatch;
  status: "applied" | "rejected";
  message: string;
  targetId?: string;
  issueIds: string[];
};

export type PatchApplyResult = {
  content: string;
  applied: PatchResult[];
  rejected: PatchResult[];
};

export type DeterministicRepairResult = {
  content: string;
  changes: string[];
};

const MAX_TARGETS = 6;
const MAX_TARGET_EXCERPT_CHARS = 2_400;

export function createRepairIssues(issues: QualityIssue[]) {
  return issues.map((issue, index) => ({
    ...issue,
    id: `issue-${index + 1}`,
  }));
}

export function buildRepairTargets(chapter: Chapter, content: string, issues: QualityIssue[]) {
  const repairIssues = createRepairIssues(issues);
  const sections = parseMarkdownSections(content);
  const targets = repairIssues.flatMap((issue) => buildRepairTargetsForIssue(chapter, content, sections, issue));
  return mergeRepairTargets(targets).slice(0, MAX_TARGETS);
}

export function applyDeterministicRepairs(content: string, issues: QualityIssue[]): DeterministicRepairResult {
  let next = content;
  const changes: string[] = [];
  const issueText = issues.map(issueTextForMatching).join("\n");
  const hasIssue = (pattern: RegExp) => pattern.test(issueText);
  const replaceWhenRelevant = (issuePattern: RegExp, pattern: string | RegExp, replacement: string, change: string) => {
    if (!hasIssue(issuePattern)) return;
    const replaced = next.replace(pattern, replacement);
    if (replaced === next) return;
    next = replaced;
    changes.push(change);
  };

  const repairedMath = repairNestedInlineMathInDisplayBlocks(next);
  if (repairedMath !== next) {
    next = repairedMath;
    changes.push("Removed nested inline dollar delimiters from display math blocks.");
  }

  if (/CO\$_2\$|co\$_2\$/iu.test(issueText) && /CO\$_2\$/u.test(next)) {
    next = next.replaceAll("CO$_2$", "$CO_2$");
    changes.push("Normalized CO2 LaTeX notation.");
  }

  const titleLine = next.split(/\r?\n/u)[0]?.trim();
  if (/章节标题|标题|chapter title|title/u.test(issueText) && /^#\s+第[一二三四五六七八九十百千万两\d]+章\s+/u.test(titleLine ?? "")) {
    const repaired = next.replace(/^(#\s+第[一二三四五六七八九十百千万两\d]+章)\s+/u, "$1：");
    if (repaired !== next) {
      next = repaired;
      changes.push("Normalized chapter title colon style.");
    }
  }

  replaceWhenRelevant(
    /FIRE|净辐射变量|变量命名|输出变量/u,
    /`FIRE`（净辐射）等变量/gu,
    "`FSA`/`FIRA` 等辐射相关变量（需按具体输出表确认净短波、净长波与总净辐射口径）",
    "Clarified CLM radiation variable naming.",
  );
  replaceWhenRelevant(
    /FIRE|净辐射变量|变量命名|输出变量/u,
    /`FIRE`（净辐射）/gu,
    "`FSA`/`FIRA` 等辐射相关变量（需按具体输出表确认净短波、净长波与总净辐射口径）",
    "Clarified CLM radiation variable naming.",
  );
  replaceWhenRelevant(
    /感热通量.*公式|公式.*本节开头|内部引用|引用错误/u,
    "感热通量 $H$ 的公式已在本节开头给出。",
    "感热通量 $H$ 的基本定义已在第一节的能量平衡框架中给出。",
    "Corrected local formula reference.",
  );
  replaceWhenRelevant(
    /净辐射|长波|发射率|黑体|FIRA|FIRE|符号/u,
    /因此净辐射 \$R_n = \\text\{FSA\} - \\text\{FIRA\}\$（或根据具体符号约定组合）。/gu,
    "因此应先查明输出表中长波变量的正方向，再将短波吸收量与净长波项按同一符号约定合成 $R_n$。",
    "Clarified CLM net-radiation sign convention.",
  );
  replaceWhenRelevant(
    /净辐射|长波|发射率|黑体|公式/u,
    /R_n = \(1-\\alpha\) S_\{\\mathrm\{in\}\} \+ L_\{\\mathrm\{in\}\} - \\varepsilon \\sigma T_s\^4/gu,
    "R_n = (1-\\alpha) S_{\\mathrm{in}} + \\varepsilon L_{\\mathrm{in}} - \\varepsilon \\sigma T_s^4",
    "Made longwave absorption assumption explicit in net-radiation formula.",
  );
  replaceWhenRelevant(
    /Monin|Jarvis|后续章节|提前|参数化框架|模型/u,
    /在CLM中，\$r_a\$ 通过Monin-Obukhov理论计算（第四章详述），但这里我们先理解其物理含量：/gu,
    "在CLM中，$r_a$ 会由近地层湍流参数化方案估计，具体形式留到后续章节；这里我们先理解其物理含量：",
    "Removed premature Monin-Obukhov detail.",
  );
  replaceWhenRelevant(
    /Monin|Jarvis|后续章节|提前|参数化框架|模型/u,
    /，\$r_s\$ 由气孔导度模型（如Jarvis模型）计算，\$r_a\$ 由Monin-Obukhov理论提供/gu,
    "，$r_s$ 和 $r_a$ 分别由表面阻力与近地层湍流交换相关方案估计",
    "Removed premature resistance model names.",
  );
  replaceWhenRelevant(
    /地形指数|Horton|Dunne|径流参数化|提前/u,
    /(^|[。；;]\s*)CLM中径流参数化方案通常在次网格尺度上处理（如结合地形指数），但物理基础可概括为：/gmu,
    "$1CLM中径流参数化方案通常会把格点内地形和土壤湿度差异折算为有效产流能力，但物理基础可概括为：",
    "Removed premature runoff parameterization name.",
  );
  replaceWhenRelevant(
    /Horton|Dunne|提前|后续|径流参数化/u,
    "- **地表径流**：当降水强度超过土壤入渗能力（Horton径流）或土壤饱和后（Dunne径流）产生。",
    "- **地表径流**：当降水强度超过土壤入渗能力，或土壤接近饱和后，多余水分会在地表汇集并形成径流。",
    "Generalized premature runoff mechanism labels.",
  );
  replaceWhenRelevant(
    /参数化方案|参数化章节|模型参数化|气孔导度|表面阻力|水分限制因子|具体计算形式/u,
    /后续参数化章节将给出的/gu,
    "后续章节将给出的",
    "Generalized premature parameterization chapter wording.",
  );
  replaceWhenRelevant(
    /参数化方案|参数化章节|模型参数化|气孔导度|表面阻力|水分限制因子|具体计算形式/u,
    /参数化方案/gu,
    "后续建模方案",
    "Generalized premature parameterization wording.",
  );
  replaceWhenRelevant(
    /参数化方案|参数化章节|模型参数化|气孔导度|表面阻力|水分限制因子|具体计算形式/u,
    /模型参数化设计/gu,
    "模型可计算表达设计",
    "Generalized model parameterization wording.",
  );
  replaceWhenRelevant(
    /参数化方案|参数化章节|模型参数化|气孔导度|表面阻力|水分限制因子|具体计算形式/u,
    /CLM正是通过参数化这些属性来实现模拟。/gu,
    "CLM正是通过把这些属性写成可计算表达来实现模拟。",
    "Generalized parameterization implementation sentence.",
  );
  replaceWhenRelevant(
    /参数化方案|参数化章节|模型参数化|气孔导度|表面阻力|水分限制因子|具体计算形式/u,
    /这里暴露了未引入土壤水分参数化时手算的局限性，但也正说明模型参数化的必要性。/gu,
    "这里暴露了未显式约束土壤含水状态时手算的局限性，也说明真实模型需要更精细的土壤-大气交换表达。",
    "Generalized soil-moisture limitation discussion.",
  );
  replaceWhenRelevant(
    /参数化方案|参数化章节|模型参数化|气孔导度|表面阻力|水分限制因子|具体计算形式/u,
    /如何将上述物理规律通过参数化方案转化为可计算的数学表达式？不同次网格过程如何被有效表示？这些正是第四章将要回答的。另外，从本章的实践案例已经看到，简化公式在高表面阻力时失效，这提示我们需要更精细的土壤-植被-大气连续体模型——这正是CLM参数化方案的设计动机。/gu,
    "如何将上述物理规律转化为可计算的数学表达式？不同次网格过程如何被有效表示？这些正是第四章将要回答的。另外，从本章的实践案例已经看到，简化公式在高表面阻力时失效，这提示我们需要更精细的土壤-植被-大气连续体模型。",
    "Generalized chapter bridge to later parameterization details.",
  );
  replaceWhenRelevant(
    /Penman-Monteith|PM公式|CLM计算潜热|经典PM|阻抗框架/u,
    /Penman-Monteith方程是CLM计算潜热通量的核心公式之一，但要注意CLM将其嵌入到更完整的冠层-土壤-大气耦合框架中，\$r_s\$ 由后续章节将给出的气孔导度经验或半经验表达计算，\$r_a\$ 由后续章节将给出的边界层阻力方案提供。本章不展开这些参数化细节，只要求理解公式中包含的物理竞争关系。/gu,
    "Penman-Monteith方程在本章作为概念工具，用来说明潜热通量同时受可利用能量、大气干燥度和交换阻力控制。CLM实际会把冠层、土壤和近地层交换拆成更细的分量，具体计算方法留到后续章节；本章只要求理解公式中包含的物理竞争关系。",
    "Clarified Penman-Monteith as a conceptual bridge rather than direct CLM formula.",
  );
  replaceWhenRelevant(
    /列表层级|无序列表|站点B|潜热通量|Markdown导出/u,
    /\n- (\$\\lambda E = 2\.5\\times10\^6 \\times 1\.15 \\times \(0\.036-0\.008\) \/ \(120\.38\+400\) = 2\.5\\times10\^6 \\times 1\.15 \\times 0\.028 \/ 520\.38\$。)/gu,
    "\n   - $1",
    "Indented the site B latent-heat calculation under the numbered step.",
  );
  replaceWhenRelevant(
    /土壤热通量|夜间|冬季|白天|夏季|正值|负值|能量闭合/u,
    /夜间或冬季，\$G\$ 通常为正值；白天或夏季则为负值/gu,
    "在本文采用“正值表示热量从地表进入深层土壤”的约定下，白天或暖季地表受热时 $G$ 通常偏正；夜间或冷季土壤向地表释放热量时 $G$ 可转为负值",
    "Corrected soil heat flux sign convention.",
  );
  replaceWhenRelevant(
    /汽化潜热|融化|冻结|冻土|熔化潜热/u,
    /汽化潜热在融化时释放/gu,
    "冰水相变的熔化潜热在融化时被吸收、在冻结时被释放",
    "Corrected frozen soil latent heat wording.",
  );
  replaceWhenRelevant(
    /汽化潜热|融化|冻结|冻土|熔化潜热/u,
    /融化本身消耗大量能量，导致净辐射中的相当一部分被冻结潜热/gu,
    "融化本身会吸收大量熔化潜热，导致净辐射中的相当一部分用于冰水相变",
    "Clarified snow and frozen-soil phase-change energy.",
  );

  return { content: next, changes };
}

export function normalizeRepairPatchPayload(payload: unknown): RepairPatch[] {
  const value = payload as { patches?: unknown } | RepairPatch[] | undefined;
  const rawPatches = Array.isArray(value) ? value : Array.isArray(value?.patches) ? value.patches : [];
  return rawPatches
    .map((item) => {
      const patch = item as RepairPatch;
      return {
        targetHeading: typeof patch.targetHeading === "string" ? patch.targetHeading.trim() : undefined,
        before: typeof patch.before === "string" ? patch.before.trim() : undefined,
        after: typeof patch.after === "string" ? patch.after.trim() : undefined,
        issueIds: Array.isArray(patch.issueIds)
          ? patch.issueIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())
          : [],
        confidence: patch.confidence,
      };
    })
    .filter((patch) => patch.before || patch.after || patch.issueIds?.length);
}

export function applyRepairPatches(content: string, targets: RepairTarget[], patches: RepairPatch[]): PatchApplyResult {
  let current = content;
  const applied: PatchResult[] = [];
  const rejected: PatchResult[] = [];

  for (const patch of patches) {
    const issueIds = patch.issueIds ?? [];
    const target = findPatchTarget(current, targets, patch);
    if (!target) {
      rejected.push({
        patch,
        status: "rejected",
        message: "Patch target could not be matched to a repairable issue target.",
        issueIds,
      });
      continue;
    }

    const validation = validatePatchShape(patch, target);
    if (validation) {
      rejected.push({
        patch,
        status: "rejected",
        message: validation,
        targetId: target.id,
        issueIds,
      });
      continue;
    }

    const range = findTargetRange(current, target);
    if (!range) {
      rejected.push({
        patch,
        status: "rejected",
        message: "Target heading no longer exists in the current candidate content.",
        targetId: target.id,
        issueIds,
      });
      continue;
    }

    const before = patch.before!.trim();
    const after = patch.after!.trim();
    const targetText = current.slice(range.start, range.end);
    const firstMatch = targetText.indexOf(before);
    const secondMatch = firstMatch >= 0 ? targetText.indexOf(before, firstMatch + before.length) : -1;
    if (firstMatch < 0) {
      rejected.push({
        patch,
        status: "rejected",
        message: "Patch before text was not found exactly inside the target scope.",
        targetId: target.id,
        issueIds,
      });
      continue;
    }
    if (secondMatch >= 0) {
      rejected.push({
        patch,
        status: "rejected",
        message: "Patch before text matched multiple times inside the target scope.",
        targetId: target.id,
        issueIds,
      });
      continue;
    }

    const nextTargetText = `${targetText.slice(0, firstMatch)}${after}${targetText.slice(firstMatch + before.length)}`;
    const scopedValidation = validatePatchedTarget(targetText, nextTargetText, target);
    if (scopedValidation) {
      rejected.push({
        patch,
        status: "rejected",
        message: scopedValidation,
        targetId: target.id,
        issueIds,
      });
      continue;
    }

    current = `${current.slice(0, range.start)}${nextTargetText}${current.slice(range.end)}`;
    applied.push({
      patch,
      status: "applied",
      message: "Patch applied.",
      targetId: target.id,
      issueIds,
    });
  }

  const chapterValidation = validateCandidateContent(content, current);
  if (chapterValidation) {
    return {
      content,
      applied: [],
      rejected: [
        ...rejected,
        ...applied.map((result) => ({
          ...result,
          status: "rejected" as const,
          message: chapterValidation,
        })),
      ],
    };
  }

  return { content: current, applied, rejected };
}

export function validateTargetedContent(content: string, targets: RepairTarget[]) {
  const failures: string[] = [];
  for (const target of targets.filter((item) => item.repairable)) {
    const text = findTargetRange(content, target);
    const scoped = text ? content.slice(text.start, text.end) : content;
    const issueText = target.issues.map(issueTextForMatching).join("\n");

    if (/方程[（(]\s*1\s*[）)]/u.test(issueText) && /方程[（(]\s*1\s*[）)]/u.test(scoped)) {
      failures.push(`${target.id}: formula reference still uses 方程（1）.`);
    }
    if (/CO\$_2\$|co\$_2\$/iu.test(issueText) && /CO\$_2\$/u.test(scoped)) {
      failures.push(`${target.id}: CO2 notation is still mixed Markdown/LaTeX.`);
    }
    if (/(公式块|Markdown\/LaTeX|\$\$|行内公式|block math|inline)/iu.test(issueText) && hasNestedInlineMathInDisplayBlock(scoped)) {
      failures.push(`${target.id}: display math block still contains nested inline math delimiters.`);
    }
    if (/Richards|Dunne|Horton|finite difference|有限差分|理查兹/iu.test(issueText) && /Richards|Dunne|Horton|finite difference|有限差分|理查兹/iu.test(scoped)) {
      failures.push(`${target.id}: forbidden early hydrology detail is still present.`);
    }
    if (/Monin|Jarvis|土壤热扩散|soil heat diffusion|离散化/iu.test(issueText) && /Monin|Jarvis|土壤热扩散|soil heat diffusion|离散化/iu.test(scoped)) {
      failures.push(`${target.id}: advanced parameterization/discretization detail is still present.`);
    }
    if (/FIRE|净辐射变量|输出变量/iu.test(issueText) && /`FIRE`（净辐射）/u.test(scoped)) {
      failures.push(`${target.id}: CLM radiation variable naming is still over-specific.`);
    }
    if (/感热通量.*公式|本节开头|引用错误/iu.test(issueText) && /感热通量 \$H\$ 的公式已在本节开头给出/u.test(scoped)) {
      failures.push(`${target.id}: local formula reference still points to the wrong section.`);
    }
    if (/地形指数|Horton|Dunne|径流参数化|提前/iu.test(issueText) && /地形指数|Horton径流|Dunne径流/u.test(scoped)) {
      failures.push(`${target.id}: premature runoff parameterization detail is still present.`);
    }
  }
  return failures;
}

export function filterTargetsByValidationFailures(targets: RepairTarget[], failures: string[]) {
  if (!failures.length) return [];
  const failedTargetIds = new Set(failures.map((failure) => failure.split(":")[0]).filter(Boolean));
  return targets.filter((target) => failedTargetIds.has(target.id));
}

export function buildTargetedPatchRepairPrompt(course: Course, chapter: Chapter, targets: RepairTarget[]) {
  return `# Task: Targeted Chapter Repair Patches

You are repairing a Chinese textbook chapter. The workflow will apply your output with exact-match patches, so you must output JSON only.

Return this JSON shape:
{
  "patches": [
    {
      "targetHeading": "the exact target heading line, or __CHAPTER_TITLE__",
      "issueIds": ["issue-1"],
      "before": "exact text copied from the target excerpt",
      "after": "replacement Markdown text",
      "confidence": "high"
    }
  ]
}

Hard rules:
- Output JSON only. No Markdown fences, prose, comments, or explanations.
- Each patch must fix only the listed issueIds.
- before must be copied exactly from the target excerpt.
- after must preserve the same heading level unless the issue is a heading/title issue.
- Do not rewrite unrelated paragraphs.
- Do not add conversational openings such as 您好, 抱歉, 以下是.
- If an issue cannot be fixed with a precise patch, omit it.

Course topic: ${course.topic}
Chapter title: ${chapter.title}
Chapter task: ${chapter.purpose ?? chapter.description}
Chapter contract:
${JSON.stringify(chapter.contract ?? {}, null, 2)}

Repair targets:
${targets.map(formatTargetForPrompt).join("\n\n")}`;
}

function buildRepairTargetsForIssue(
  chapter: Chapter,
  content: string,
  sections: MarkdownSection[],
  issue: RepairIssue,
): RepairTarget[] {
  const text = issueTextForMatching(issue);
  const titleLine = content.split(/\r?\n/u).find((line) => line.trim().startsWith("# "))?.trim();

  if (/章节标题|章标题|chapter title|title|标题.*不匹配|doesn'?t match/iu.test(text)) {
    return [{
      id: `target-${issue.id}`,
      kind: "chapter_title",
      heading: "__CHAPTER_TITLE__",
      headingLine: "__CHAPTER_TITLE__",
      excerpt: titleLine ?? `# ${chapter.title}`,
      issues: [issue],
      repairable: true,
    }];
  }

  const kind = classifyIssue(text);
  const matchedSections = findIssueSections(sections, text, kind);
  if (!matchedSections.length) {
    return [{
      id: `target-${issue.id}`,
      kind: "unresolved",
      excerpt: "",
      issues: [issue],
      repairable: false,
      reason: "No precise section or text anchor could be inferred from the issue.",
    }];
  }

  return matchedSections.map((section, index) => ({
    id: `target-${issue.id}${matchedSections.length > 1 ? `-${index + 1}` : ""}`,
    kind,
    heading: section.heading,
    headingLine: section.headingLine,
    excerpt: trimTargetExcerpt(section.text),
    issues: [issue],
    repairable: true,
  }));
}

function mergeRepairTargets(targets: RepairTarget[]) {
  const merged = new Map<string, RepairTarget>();
  for (const target of targets) {
    const key = target.repairable ? `${target.kind}:${target.headingLine ?? target.heading ?? target.id}` : target.id;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, target);
      continue;
    }
    existing.issues.push(...target.issues);
  }
  return [...merged.values()];
}

function findIssueSections(sections: MarkdownSection[], text: string, kind: RepairTargetKind) {
  const byKeywords = findSectionsByIssueKeywords(sections, text);
  const shouldPreferKeywords = kind === "formula_reference" || kind === "notation_style";
  if (shouldPreferKeywords && byKeywords.length) return byKeywords;

  const referenced = findReferencedSections(sections, text);
  const merged = uniqueSections([...referenced, ...byKeywords]);
  return merged.length ? merged : [];
}

function findReferencedSections(sections: MarkdownSection[], text: string) {
  const matches: MarkdownSection[] = [];
  const numericRefs = [...text.matchAll(/(?:第\s*)?(\d+(?:\.\d+)*)(?:\s*[章节小节])?/gu)]
    .map((match) => match[1])
    .filter((value) => value && value.length <= 5);
  for (const ref of numericRefs) {
    const section = sections.find((item) => item.headingLine.includes(ref) || item.heading.startsWith(ref));
    if (section) matches.push(section);
  }

  const chineseRefs = [...text.matchAll(/第\s*([一二三四五六七八九十]+)\s*(?:节|小节|章)/gu)].map((match) => chineseNumber(match[1]));
  for (const ref of chineseRefs) {
    if (!ref) continue;
    const section = sections.find((item) => item.headingLine.includes(`第${ref}`) || item.headingLine.includes(`${ref}.`));
    if (section) matches.push(section);
  }

  return uniqueSections(matches);
}

function findSectionsByIssueKeywords(sections: MarkdownSection[], text: string) {
  const anchors = [
    "方程（1）",
    "方程(1)",
    "CO$_2$",
    "Richards",
    "Dunne",
    "Horton",
    "finite difference",
    "有限差分",
    "理查兹",
    "Monin",
    "Jarvis",
    "土壤热扩散",
    "soil heat diffusion",
    "离散化",
    "FIRE",
    "净辐射",
    "感热通量",
    "本节开头",
    "地形指数",
    "气孔导度",
    "径流参数化",
    "汽化潜热",
    "熔化潜热",
    "冻土",
    "土壤热通量",
  ];
  const matches: MarkdownSection[] = [];
  for (const anchor of anchors) {
    if (!text.toLowerCase().includes(anchor.toLowerCase())) continue;
    const candidates = sections.filter((item) => item.text.toLowerCase().includes(anchor.toLowerCase()));
    matches.push(...leafSections(candidates));
  }
  return uniqueSections(matches);
}

function leafSections(sections: MarkdownSection[]) {
  return sections.filter((section) => !sections.some((candidate) => candidate !== section && candidate.startLine > section.startLine && candidate.endLine <= section.endLine));
}

function uniqueSections(sections: MarkdownSection[]) {
  const seen = new Set<string>();
  const result: MarkdownSection[] = [];
  for (const section of sections) {
    const key = section.headingLine;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(section);
  }
  return result;
}

function classifyIssue(text: string): RepairTargetKind {
  if (/方程[（(]\s*1\s*[）)]|equation/iu.test(text)) return "formula_reference";
  if (/CO\$_2\$|co\$_2\$|latex|notation/iu.test(text)) return "notation_style";
  if (/标题|heading/iu.test(text)) return "heading_rename";
  if (/format|markdown|代码块|公式块|格式/iu.test(text)) return "format";
  if (/contract|continuity|提前|后续|forbidden|Richards|Dunne|Horton|Monin|Jarvis|有限差分|离散|地形指数|径流参数化/iu.test(text)) return "section_contract";
  return "local_revision";
}

function findPatchTarget(content: string, targets: RepairTarget[], patch: RepairPatch) {
  const issueIds = new Set(patch.issueIds ?? []);
  const targetHeading = patch.targetHeading?.trim();
  const candidates = targets.filter((target) => target.repairable);

  if (targetHeading) {
    const byHeading = candidates.find((target) => target.headingLine === targetHeading || target.heading === targetHeading);
    if (byHeading) return byHeading;
  }

  if (issueIds.size) {
    const byIssue = candidates.find((target) => target.issues.some((issue) => issueIds.has(issue.id)));
    if (byIssue) return byIssue;
  }

  if (patch.before) {
    return candidates.find((target) => {
      const range = findTargetRange(content, target);
      return range ? content.slice(range.start, range.end).includes(patch.before!) : false;
    });
  }

  return undefined;
}

function findTargetRange(content: string, target: RepairTarget) {
  if (target.kind === "chapter_title") {
    const firstLineEnd = content.indexOf("\n");
    return { start: 0, end: firstLineEnd >= 0 ? firstLineEnd : content.length };
  }
  if (!target.headingLine) return undefined;

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const startLine = lines.findIndex((line) => line.trim() === target.headingLine);
  if (startLine < 0) return undefined;
  const level = target.headingLine.match(/^(#{1,6})\s/u)?.[1].length ?? 6;
  let endLine = lines.length;
  for (let index = startLine + 1; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+\S/u.exec(lines[index]);
    if (match && match[1].length <= level) {
      endLine = index;
      break;
    }
  }

  const start = lines.slice(0, startLine).join("\n").length + (startLine > 0 ? 1 : 0);
  const end = lines.slice(0, endLine).join("\n").length;
  return { start, end };
}

function validatePatchShape(patch: RepairPatch, target: RepairTarget) {
  if (!patch.issueIds?.length) return "Patch must include at least one issueId.";
  const targetIssueIds = new Set(target.issues.map((issue) => issue.id));
  if (!patch.issueIds.some((id) => targetIssueIds.has(id))) return "Patch issueIds do not belong to the target.";
  if (!patch.before?.trim()) return "Patch before text is empty.";
  if (!patch.after?.trim()) return "Patch after text is empty.";
  if (patch.before.trim() === patch.after.trim()) return "Patch does not change the target text.";
  if (/^(您好|你好|抱歉|对不起|以下是|下面是|当然|好的)[，,。\s]/u.test(patch.after.trim())) {
    return "Patch after text is conversational.";
  }
  if (/^```[\s\S]*```$/u.test(patch.after.trim())) return "Patch after text wraps the whole result in a code fence.";
  if (patch.before.trim().length >= 400 && patch.after.trim().length < patch.before.trim().length * 0.35) {
    return "Patch shortens the target text too aggressively.";
  }
  return undefined;
}

function validatePatchedTarget(originalTarget: string, patchedTarget: string, target: RepairTarget) {
  if (!patchedTarget.trim()) return "Patched target became empty.";
  if (target.kind !== "chapter_title" && target.kind !== "heading_rename" && target.headingLine && !patchedTarget.includes(target.headingLine)) {
    return "Patched target lost its heading line.";
  }
  const originalHeadings = markdownHeadings(originalTarget);
  const patchedHeadings = markdownHeadings(patchedTarget);
  const missingHeading = originalHeadings.find((heading) => target.kind !== "heading_rename" && !patchedHeadings.includes(heading));
  if (missingHeading) return `Patched target lost heading: ${missingHeading}`;
  return undefined;
}

function validateCandidateContent(original: string, candidate: string) {
  if (!candidate.trim()) return "Candidate content became empty.";
  if (/^(您好|你好|抱歉|对不起|以下是|下面是|当然|好的)[，,。\s]/u.test(candidate.trim())) {
    return "Candidate content starts with conversational text.";
  }
  if (/^```[\s\S]*```$/u.test(candidate.trim())) return "Candidate content is wrapped in a whole-document code fence.";
  if (original.trim().length >= 1_000 && candidate.trim().length < original.trim().length * 0.7) {
    return "Candidate content shortened the chapter too aggressively.";
  }
  return undefined;
}

function markdownHeadings(content: string) {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+\S/u.test(line));
}

function issueTextForMatching(issue: QualityIssue) {
  return `${issue.check} ${issue.message} ${issue.suggestion ?? ""}`;
}

function hasNestedInlineMathInDisplayBlock(content: string) {
  return /\$\$\s*\r?\n\s*\$[^\r\n$][^\r\n]*?\$[.;,，。；、]?\s*\r?\n\s*\$\$/u.test(content);
}

function repairNestedInlineMathInDisplayBlocks(content: string) {
  return content.replace(/\$\$\s*\r?\n\s*\$([^\r\n$][^\r\n]*?)\$[.;,，。；、]?\s*\r?\n\s*\$\$/gu, (block, formula: string) => {
    const normalizedFormula = formula.trim();
    if (!normalizedFormula) return block;
    return `$$\n${normalizedFormula}\n$$`;
  });
}

function trimTargetExcerpt(text: string) {
  if (text.length <= MAX_TARGET_EXCERPT_CHARS) return text;
  return `${text.slice(0, MAX_TARGET_EXCERPT_CHARS)}\n\n[excerpt truncated]`;
}

function formatTargetForPrompt(target: RepairTarget, index: number) {
  const issues = target.issues
    .map((issue) => `- ${issue.id}: [${issue.severity}] ${issue.check}: ${issue.message}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ""}`)
    .join("\n");

  return `## Target ${index + 1}
targetHeading: ${target.headingLine ?? target.heading ?? "__UNRESOLVED__"}
kind: ${target.kind}
repairable: ${target.repairable}
issues:
${issues}

target excerpt:
${target.excerpt || target.reason || "(no precise excerpt)"}`;
}

function chineseNumber(value: string) {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (digits[value.slice(1)] ?? 0);
  if (value.endsWith("十")) return (digits[value.slice(0, 1)] ?? 0) * 10;
  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (digits[tens] ?? 1) * 10 + (digits[ones] ?? 0);
  }
  return digits[value];
}
