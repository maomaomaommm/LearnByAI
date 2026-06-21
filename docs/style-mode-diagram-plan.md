# 讲解风格拆分 + 学习方式 + 图默认化 开发计划

> 分支：`main`（建议新开 `feat/style-mode-diagram`）　·　基线：`dd06781`
> 本文档是唯一开发依据，逐项勾选执行，偏离先回文档讨论。

---

## 进度（2026-06-21）

- **阶段 1–11 全部实现完成**：类型 / normalizeCourse / styleGuidance（新建）/ 架构师+作者提示词 / Mermaid 渲染器 / API 校验 / 前端表单+排版 / Admin 透传 / mock+客户端 / 单测+E2E 全部就绪。
- **阶段 12 本地门禁通过**：`test:phase-gate` 全绿（lint + 183 单测 + schema + build + 18 E2E）；MiMo 实跑验证：多选风格（analogy+code）与 project 学习方式已落库并注入提示词，core 章生成正常（~11.9k 正文）且**自动产出 2 张 mermaid 流程图**（图默认化生效）。
- **阶段 13.1–13.3 完成**：`deploy_remote.py` 已在 build 前加增量 `npm install`（解决 mermaid 新依赖在复用 node_modules 时缺失会导致线上构建失败，R1）；已提交 `bdc0f6b` → 推送 main → 部署成功（build 含 mermaid、health 200、原子切换）。线上 `/create` 新表单（讲解风格可多选 + 学习方式）已生效、旧「偏好的讲解方式」已移除、schema 版本一致、旧课程兼容。
- **阶段 13.4 联网检索已验证**：生产 Exa（主）+ StepFun（备）实测 HTTP 200、返回真实近期论文——联网检索主路径**可用**，且不依赖任何 LLM key（关键词提取失败有本地兜底词）。
- **联网检索第三层（Kimi）解耦 + 配置**：把 `searchKimi` 从主 agent 的 `getBaseAIConfig`/用户 overrides 改为独立的 `KIMI_SEARCH_*` 专用配置（与 EXA/STEP 同级的服务器搜索基础设施），并补上 Moonshot 官方 `$web_search` 要求的 `name` 字段；服务器已配 `KIMI_SEARCH_API_KEY/BASE_URL/MODEL`（Moonshot `kimi-k2.6`，已实测两轮 `$web_search` 可用）。7 个内容 agent 仍只走用户在 web 端自配的模型，不受此影响。
- 说明：生产仍是 per-user AI 配置（`aiProviderConfigured:false` 属设计），主 agent 模型由用户在「模型设置」里自填并存到 `profiles.model_config`。

---

## 0. 背景与已确认决策

把旧的单选「讲解方式」拆成两条正交轴，并把 Mermaid 图渲染做成**默认能力**（不是可选模式），同时验证联网功能。

### 已确认的规格
- **① 讲解风格（可多选）**——标题后缀必须带「（可多选）」。枚举 + 标签 + 副标题：
  | 值 | 标签 | 副标题 |
  |---|---|---|
  | `intuition` | 直觉优先 | 先讲清"为什么"，建立直觉再形式化 |
  | `example` | 例子说明 | 例子先行，以例带理 |
  | `rigor` | 严谨推导 | 完整推导，讲究严谨 |
  | `analogy` | 类比通俗 | 用熟悉事物打比方，降低门槛 |
  | `code` | 公式代码 | 公式配可运行代码，理论与实现并行 |
  - **全选 / 不选 → 均衡兜底**；选部分 → "侧重 + 可融合"，对立项给优先级，**不打架**。
- **② 学习方式（单选）**：`standard` 标准教材(默认) / `project` 项目驱动 / `exercise` 习题驱动 / `case` 案例驱动。
- **③ 难度 ④ 章节数 ⑤ 生成模式**：已上线，本次不动。
- **图渲染**：默认开启，作者按「场景→图类型」**自动配图**；不作为风格选项。
- **联网（includeRecentResearch）**：已上线，本次**验证可用**（开关开 → Exa→Step→Kimi 检索 → researchBrief 进规划）。

### 字段策略
- `Course.preference: string` → 改为**可选**（兼容旧课程 + admin 自由文本）；新增 `styles: ExplanationStyle[]`、`learningMode: LearningMode` 作为主控。
- prompt 取 `styles`+`learningMode` 组装引导；`styles` 为空时回退到旧 `preference` 文本（老课程）。

### 图的判定原则（不设数量上下限，按必要性触发——软硬兼施）
> 同篇幅教训：不用硬/软数字。软=何时考虑画（判断），硬=这张图配不配留下（质量闸门）。数量由通过闸门的场景数自然决定。
- **触发（软·判断）**：内容出现流程 / 状态 / 交互时序 / 数据结构 / 数据模型 / 概念关系 / 演进时，考虑配图。
- **必要性闸门（硬·质量bar，非数字）**：每张图必须通过——「是否比纯文字/表格更能说清这段关系？是否承载了文字没完全表达的信息？」**装饰性或重复文字的一律不画；图要为读者省理解成本而存在。**
- **每张图前后必须有文字讲解**；节点文字简洁、避免中文标点。
- **场景→类型**：流程→`flowchart`、交互/协议→`sequenceDiagram`、状态/生命周期→`stateDiagram-v2`、数据结构/类→`classDiagram`、数据模型→`erDiagram`、概念总览→`mindmap`、演进→`timeline`。
- 不写"每章几张/上限几张"这类数字。上线后实测密度，过密/过疏只调闸门措辞。

---

## 阶段 1 · 类型（真源头）
`src/lib/types.ts`
- [ ] 1.1 新增 `export type ExplanationStyle = "intuition" | "example" | "rigor" | "analogy" | "code";`
- [ ] 1.2 新增 `export type LearningMode = "standard" | "project" | "exercise" | "case";`
- [ ] 1.3 `Course`：`preference: string` → `preference?: string`；新增 `styles: ExplanationStyle[]`、`learningMode: LearningMode`。

**判据**：`npx tsc --noEmit` 列出全部下游触点作为 checklist。

## 阶段 2 · 向后兼容读取层
`src/lib/normalizeCourse.ts`
- [ ] 2.1 `normalizeCourse`：缺 `styles` → `[]`；缺 `learningMode` → `"standard"`；保留 `preference` 原值。
- [ ] 2.2 单测覆盖（见 10.x）。

**判据**：旧 payload（只有 `preference`）归一后 `styles=[]`、`learningMode="standard"`，不报错。

## 阶段 3 · 风格/模式引导构造器（共用）
`src/lib/prompts/styleGuidance.ts`（新建）
- [ ] 3.1 `buildStyleGuidance(styles, learningMode, legacyPreference?)` 返回引导文本：
  - styles 为空或全选 → 「讲解风格：均衡，兼顾直觉、例子、推导与类比，以讲清概念为最高目标。」
  - 选部分 → 「在讲清概念的前提下，**侧重**：{标签…}（可自然融合，不必互斥）。有张力时优先服务理解（如严谨 vs 类比：先类比建立直觉，再给严谨推导，不要各写一段互相冲突）。」
  - styles 为空但有 legacyPreference → 用旧文本（老课程兼容）。
- [ ] 3.2 `LEARNING_MODE_GUIDE: Record<LearningMode, string>`：
  - standard：系统讲授，按概念体系铺开。
  - project：围绕一个贯穿项目组织内容，各章服务于把项目做出来。
  - exercise：问题先行、习题加重，靠练习推进理解。
  - case：用真实案例带出原理，案例作为组织主线。
- [ ] 3.3 `STYLE_LABEL: Record<ExplanationStyle, string>`（供 prompt/admin 复用）。

## 阶段 4 · 架构师提示词
`src/lib/prompts/coursePlanner.ts`
- [ ] 4.1 `CoursePlannerInput`：`preference` → 可选 + 新增 `styles`、`learningMode`。
- [ ] 4.2 8 处 `${input.preference}` 替换为 `buildStyleGuidance(...)` + `LEARNING_MODE_GUIDE[learningMode]`（约第 63、112、133、201、271、374、410 行 + chapterContract 段）。
- [ ] 4.3 学习方式影响**课程结构**：project → 章节围绕项目里程碑；exercise → 每章留问题主线；case → 章节绑案例。写进规划硬性要求。

**判据**：skeleton prompt 含风格引导 + 学习方式结构指令，无裸 `preference`。

## 阶段 5 · 作者提示词（风格融合 + 图判定）
`src/lib/prompts/chapterWriter.ts`
- [ ] 5.1 `buildChapterWriterPrompt` 用 `buildStyleGuidance` 替换 `讲解偏好：${course.preference}`（第 133 行），并注入 `learningMode` 侧重。
- [ ] 5.2 **图判定段落**（替换/扩展现有 mermaid 行）：写入「场景→类型」对照 + **必要性闸门**（装饰/重复文字不画、图要省读者理解成本）+ 每图必配讲解 + 节点简洁。**不写数量数字**（不设每章张数/上限）。
- [ ] 5.3 确认作者 prompt 不再出现裸 `preference`。

**判据**：runtime 验证——不同 styles 组合 prompt 文本不同；全选/不选→均衡文案；含「场景→类型」+ 数量上限措辞。

## 阶段 6 · Mermaid 渲染器（已本地加，需定稿）
`src/components/MarkdownContent.tsx`（已改，未提交）
- [ ] 6.1 复核 `MermaidDiagram` 组件：动态 import、`securityLevel: "loose"`、失败回退源码、加载占位。
- [ ] 6.2 复核 `pre` override 的 `language-mermaid` 拦截。
- [ ] 6.3 主题适配（dark）、SVG 自适应宽度、长图横向滚动。

**判据**：含 ```mermaid 的章节渲染成图；语法错回退源码不白屏。

## 阶段 7 · API 层
`src/app/api/courses/route.ts`
- [ ] 7.1 `CourseInput`：`preference` 可选 + 新增 `styles?`、`learningMode?`。
- [ ] 7.2 校验：`styles` 过滤为合法枚举数组（去重、丢非法）；`learningMode` 白名单（非法→`standard`）。
- [ ] 7.3 `createPendingCourse` 写入 `styles`、`learningMode`；`courseBible.teachingStyle` 由 `buildStyleGuidance` 摘要或保留 preference。

**判据**：合法/非法/缺字段三类入参不 500。

## 阶段 8 · 前端表单 + 排版
`src/app/create/page.tsx`
- [ ] 8.1 删除原「偏好的讲解方式」单选 `<select>`（第 153-159 行区）。
- [ ] 8.2 新增「**讲解风格（可多选）**」：5 个 chip/checkbox（标签+副标题，见 0 节），多选状态，**全占整行**（`md:col-span-2`），排版与「章节数量」卡一致。
- [ ] 8.3 新增「**学习方式**」单选下拉（4 项，默认 standard），半宽卡。
- [ ] 8.4 提交 payload（第 68 行）：`styles: string[]`（收集选中 chip）、`learningMode`；移除 `preference`。
- [ ] 8.5 布局复核：保证 ①风格(整行多选) ②学习方式(半宽) 与 ③难度/④章节/⑤模式/联网开关 在网格里对齐、不挤。

**判据**：表单提交 JSON 含 `styles[]`+`learningMode`，不含 `preference`；多选交互正常；移动端不错位。

## 阶段 9 · Admin / 展示
- [ ] 9.1 `src/lib/adminData.ts`：summary `preference?` 保留只读展示；`createAdminCourse`/`updateAdminCourse` 入参加 `styles?`/`learningMode?`（admin 可继续用 preference 自由文本，二者择一映射）。
- [ ] 9.2 `admin/(protected)/courses/new` + `[id]`：保留 preference 文本框即可（admin 走兼容路径），或加只读展示 styles/mode。
- [ ] 9.3 `api/admin/actions/route.ts`：`readCourseInput` 增 `styles?`/`learningMode?` 透传。

**判据**：admin 建/改/详情不报错。

## 阶段 10 · Mock + 客户端
- [ ] 10.1 `src/lib/maol/client.ts` `CourseInput`（第 34 行）：`preference` 可选 + `styles`/`learningMode`。
- [ ] 10.2 `src/lib/mock.ts`：入参更新；`profile`/`teachingStyle` 文案改用 styles 摘要或兜底。

## 阶段 11 · 测试
- [ ] 11.1 单测 `buildStyleGuidance`：全选/不选→均衡；部分→侧重+融合措辞；legacy 回退。
- [ ] 11.2 单测 `normalize-course`：旧 payload → `styles=[]`/`learningMode="standard"`。
- [ ] 11.3 单测 `prompt-architecture`：风格/学习方式注入架构师&作者 prompt；图「场景→类型」+ 数量上限措辞在 prompt 内。
- [ ] 11.4 E2E：16 处 `preference: "..."` → `styles: [...], learningMode: "standard"`（`auth-isolation`/`auth-flow`/`ai-smoke`）。
- [ ] 11.5 `npm run test:unit` 全绿。

## 阶段 12 · 本地门禁
- [ ] 12.1 `npm run lint` / `test:unit` / `test:schema` / `build` / `test:e2e` 全绿（或 `test:phase-gate`）。
- [ ] 12.2 本地 `npm run dev` 用 MiMo 实测：多选风格生效、学习方式改变结构、含图章节渲染正常。

## 阶段 13 · 部署 + 联网验证
- [ ] 13.1 **关键**：Mermaid 是新依赖，但 `deploy_remote.py` **复用 node_modules、不跑 npm install** → 改部署脚本：在 build 前加 `npm install`（或检测 package-lock 变化时安装），否则线上缺 mermaid 构建/运行失败。
- [ ] 13.2 提交 `package.json`+`package-lock.json`+渲染器+提示词，合并 main，`deploy_remote.py` 部署。
- [ ] 13.3 部署后验证：`/create` 新表单（讲解风格可多选 + 学习方式）、含图章节渲染、旧课程可开。
- [ ] 13.4 **联网功能验证**：线上建一门 `includeRecentResearch=true` 的课，确认任务事件出现「正在联网检索」且 researchBrief 进规划（服务器已配 EXA/STEP key）。

---

## 风险
- **R1 部署依赖**（最高）：不加 `npm install` 线上必挂 → 13.1 必做且先验证。
- **R2 旧课程兼容**：阶段 2 先于其它读取改动；preference 保留兜底。
- **R3 图过多/过少**：靠 5.2 的数量克制 + 场景判定；上线后抽查几章观感再微调。
- **R4 E2E 漏改**：16 处 preference 散落多 spec，11.4 逐个清。
- **R5 多选 UI**：注意移动端排版（8.5）。

## 待开工前确认（默认见 0 节）
- 学习方式 4 项 / 讲解风格 5 标签 是否定稿？
- 图数量上限（每章约 4）是否合适？
