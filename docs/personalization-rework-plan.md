# 个性化重构开发计划（Personalization Axes Rework）

> 分支：`feat/personalization-axes`　·　基线 commit：`ff1a57f`
> 本文档是**唯一开发依据**。开发严格按阶段顺序、逐条勾选执行；任何偏离先回到本文档讨论后再改。

---

## 0. 背景与目标

当前「每周学习时间 / 章节篇幅 / 生成模式」三个控件职责重叠，都在调字数（token），且章节篇幅是**全局一刀切**，难章被砍短、引入被迫凑长。本次把它们重构成**三条互不重叠的轴**：

| 轴 | 谁决定 | 控制什么 | 实现 |
| --- | --- | --- | --- |
| 规模轴 | 用户 | 课程有多少章 | `chapterCount`（离散档） |
| 深度轴 | 架构师（每章） | 每章写多深/多长 | `chapter.depthWeight` 自适应篇幅 |
| 工作流轴 | 用户 | 内容何时出现 | `generationProfile`（快速/深度，纯工作流） |

外加一个独立的内容维度：**难度基调** `difficulty`（入门/进阶/研究前沿），以及**联网时效开关** `includeRecentResearch`。

### 已确认的决策
1. 章节数量：**离散档 + 自定义**。
2. `depthWeight`：**枚举 `core | normal | light`**（不用数值）。
3. 联网开关：**本批一起做**。
4. `weeklyHours`：**删除**。
5. 生成模式：**砍成 2 档** `fast | deep`，与篇幅彻底解耦。
6. 图二（主题/目标/基础）与「讲解方式」下拉：**本版不动**。
7. 旧课程向后兼容：**强制必做**（线上已有数据带旧字段）。

### 不在本次范围
- 不改 DB schema（课程/章节以 `payload jsonb` 整块存储，无独立列）→ **不需要 migration、不 bump `learnbyai_schema_version()`**。
- 不加新 npm 依赖（部署脚本复用 node_modules，不跑 `npm install`）。

### 约定的取值（可在实现前微调，定稿后写死）
- 章节数量离散档 → 目标章数：精简 `5`、标准 `8`、详尽 `14`、自定义 `3–20`。
- 难度基调枚举：`intro`（入门科普）/ `intermediate`（进阶系统）/ `research`（研究前沿）。
- `depthWeight` → 目标中文字符区间（软目标，非硬截断）：
  - `light`：约 4,000–7,000
  - `normal`：约 8,000–12,000
  - `core`：约 13,000–18,000
  - 兜底硬上限 `maxTokens` ≈ 24576（防失控）。

---

## 阶段 1 · 类型（真源头）

文件：`src/lib/types.ts`

- [x] 1.1 `Course` 删除 `weeklyHours`。
- [x] 1.2 `Course` 删除 `chapterLength`，新增 `chapterCount: number`。
- [x] 1.3 `Course` 新增 `difficulty`（新增 `CourseDifficulty` 类型）。
- [x] 1.4 `Course` 新增 `includeRecentResearch?: boolean`。
- [x] 1.5 `GenerationProfile` 由 `"fast" | "standard" | "deep"` 改为 `"fast" | "deep"`。
- [x] 1.6 `Chapter` 新增 `depthWeight?`（新增 `ChapterDepthWeight` 类型）。
- [x] 1.7 删除 `ChapterLength` 类型。

**完成判据**：`npx tsc --noEmit` 报出所有受影响文件（作为后续阶段的 checklist）。✅ 通过：21 个报错全为预期下游引用。
> tsc 新发现两个 admin 触点（阶段 8 补充）：`src/app/admin/parts.tsx`、`src/app/api/admin/actions/route.ts`（均 import `ChapterLength`）。

---

## 阶段 2 · 向后兼容读取层（强制）

目标：旧课程 payload 缺新字段、带旧字段时不报错。

- [x] 2.1 新增 `src/lib/normalizeCourse.ts`，`normalizeCourse()` 补默认值：缺 `chapterCount` → 章数或 8；缺 `difficulty` → `intermediate`；非 `deep` 的 profile（含旧 `standard`）→ `fast`；缺 `includeRecentResearch` → `false`。
- [x] 2.2 `normalizeChapter`：缺 `depthWeight` → `normal`。
- [x] 2.3 在所有服务端 payload→Course 读取边界接入：`serverStore.ts`（getServerCourse/listServerCourses/deleteServerCourseByAdmin）+ `adminData.ts`（×3）。前端经 API 拿到的已是归一数据。

**完成判据**：✅ 通过。tsc 无新增报错（仍 21，全下游）；runtime 用旧结构课程验证：`standard→fast`、`chapterCount` 回退章数、`difficulty→intermediate`、`depthWeight→normal`、`includeRecentResearch→false`。

---

## 阶段 3 · 架构师提示词（章节数 + 难度 + 每章权重 + 联网）

文件：`src/lib/prompts/coursePlanner.ts`

- [x] 3.1 `CoursePlannerInput`：删 `weeklyHours`、`chapterLength`；加 `chapterCount`、`difficulty`。
- [x] 3.2 写死的章数改为 `chapterCountRule(input.chapterCount)`（skeleton + compact + 3 个 monolithic builder）。
- [x] 3.3 「每周学习时间 / 默认章节篇幅」全部替换为「难度基调 / 目标章节数」。
- [x] 3.4 skeleton JSON 每章新增 `depth` 字段 + `DEPTH_RULE`（core/normal/light，禁止均摊）。
- [x] 3.5 compact 兜底同步输出 `depth`。
- [x] 3.6 新增 `DIFFICULTY_GUIDE` + `difficultyLabel/difficultyGuide`，注入规划口吻。
- [x] 3.7 `mergeCoursePlanningStages` 把 `depth → depthWeight`（默认 normal）；`stripGeneratedChapterFields` 保留 `depthWeight`。
- [x] 3.8（新增）`assertCourseSkeleton` 章数硬限 6–8 → 放宽 3–20，适配新档位。

**完成判据**：✅ `coursePlanner.ts` 零编译错误；runtime 验证 skeleton prompt 含 `严格生成 N 章`、depth 规则、难度文案，无旧字段残留。端到端「章数==chapterCount」「每章合法 depthWeight」待阶段 5 接线后回归。

---

## 阶段 4 · 作者提示词（自适应篇幅，去耦 profile）

文件：`src/lib/prompts/chapterWriter.ts`

- [x] 4.1 删除 `FAST_AUTHOR_MAX_TOKENS`、`STANDARD_AUTHOR_MAX_TOKENS`。
- [x] 4.2 删除 `getEffectiveChapterLengthGuide`（及 profile 卡 token 逻辑）。
- [x] 4.3 新增 `DEPTH_GUIDE` + `getChapterDepthGuide(weight)`，按 `chapter.depthWeight` 映射（light 4–7k / normal 8–12k / core 13–18k）。
- [x] 4.4 prompt 写成软目标「可按内容难度上下浮动」+ 篇幅原则话术；`maxTokens` 保留为兜底硬上限。
- [x] 4.5 删 `generationProfileGuide`、`getCourseGenerationProfile`；writer 不再引用 generationProfile。
- [x] 4.6 `buildChapterWriterPrompt` 用 `chapter.depthWeight` 取 guide；client.ts 三个调用点 `getEffectiveChapterLengthGuide(course)` → `getChapterDepthGuide(chapter.depthWeight)`。

**完成判据**：✅ chapterWriter 零编译错误；runtime 验证三档 depthWeight 篇幅区间各不相同、缺失回退 normal；prompt 不再出现 `生成模式`。

---

## 阶段 5 · 生成流程 / 客户端接线

- [x] 5.1 `CourseInput` 删 `weeklyHours/chapterLength`，加 `chapterCount/difficulty/includeRecentResearch`。
- [x] 5.2 `plannerInput = {...input, research...}` 透传，规划三阶段编译通过。
- [x] 5.3 `buildChapterWriterPrompt(course, chapter)` 已读 `chapter.depthWeight`（阶段 4 完成）。
- [x] 5.4 `researchLatestCourseKnowledge` gate 在 `input.includeRecentResearch`；关闭走「未开启联网检索」事件、`researchBrief` 空。
- [x] 5.5 `shouldUseAsyncDraftReview` = `(profile ?? "fast") !== "deep"`，无 `standard`。
- [x] 5.6 全库 `generationProfile` 仅 类型透传 + 工作流开关，零篇幅耦合（grep 确认）。

**完成判据**：✅ client/generationRunner 编译通过；联网 gate 分支正确。端到端「关闭不检索 / deep 打包 vs fast 拆分」待阶段 11 mock e2e 回归。

---

## 阶段 6 · API 层

文件：`src/app/api/courses/route.ts`

- [x] 6.1 `CourseInput` 删 `weeklyHours`、`chapterLength`→`chapterCount?`；`normalizeChapterCount` clamp 3–20、默认 8。
- [x] 6.2 `normalizeDifficulty` 白名单（`intro|research` 否则 `intermediate`）。
- [x] 6.3 `includeRecentResearch: input.includeRecentResearch === true`（默认 false）。
- [x] 6.4 `normalizeGenerationProfile` 只认 `deep`，其余（含旧 `standard`）→ `fast`。
- [x] 6.5 `createPendingCourse` 显式写入新字段（不再 `...input`，避免旧前端泄漏 legacy 字段）。

**完成判据**：✅ route.ts 零错误；runtime 验证三个归一函数对缺失/非法/越界输入均安全。

---

## 阶段 7 · 前端创建表单

文件：`src/app/create/page.tsx`

- [x] 7.1 删除「每周学习时间」select 及 payload `weeklyHours`。
- [x] 7.2 「章节篇幅」radio → 「章节数量」：精简(5)/标准(8)/详尽(14) + 自定义数字(3–20)；含「篇幅自适应」说明。
- [x] 7.3 新增「难度基调」下拉（入门科普/进阶系统/研究前沿）。
- [x] 7.4 「生成模式」三卡→两卡（快速「草稿先出，质检在后台」/深度「整章质检通过后再显示」）。
- [x] 7.5 新增「纳入最新进展」checkbox（`includeRecentResearch`）。
- [x] 7.6 payload 改为 `chapterCount`（自定义优先于档位）+`difficulty`+`generationProfile`+`includeRecentResearch === "on"`。

**完成判据**：✅ create 页 tsc + eslint 零错误；payload 含新字段、无 `weeklyHours/chapterLength`。

---

## 阶段 8 · 展示 / Admin

- [x] 8.1 `adminData.ts`：summary 字段 `weeklyHours/chapterLength` → `difficulty/targetChapterCount`（避开与「章数统计 chapterCount」命名冲突）；`createAdminCourse/updateAdminCourse` 入参与写入改 `chapterCount/difficulty`。
- [x] 8.2 `courses/new/page.tsx`：`weeklyHours/chapterLength` 字段 → `chapterCount`(数字 3–20) + `difficulty`(下拉)。
- [x] 8.3 `courses/[id]/page.tsx`：编辑表单同上；每章 StatusPill 由 `LENGTH_LABEL[course.chapterLength]` → `DEPTH_LABEL[chapter.depthWeight]`。
- [x] 8.4 `api/admin/actions/route.ts`：union + `readCourseInput` 改 `chapterCount`(clamp)/`difficulty`(白名单)；`parts.tsx` `LENGTH_LABEL`→`DIFFICULTY_LABEL`+新增 `DEPTH_LABEL`。

**完成判据**：✅ admin 全链路零编译错误（tsc 10→3，仅剩 mock）。

---

## 阶段 9 · Mock

文件：`src/lib/mock.ts`

- [x] 9.1 `createMockCourse` 入参 → `chapterCount/difficulty/generationProfile?/includeRecentResearch?`。
- [x] 9.2 两章 mock 分别标 `depthWeight: "core"` / `"light"`（演示自适应）。
- [x] 9.3 ✅ **全量 `tsc --noEmit` 零错误**，生产源码全部编译通过。

---

## 阶段 10 · 测试

- [x] 10.1 `prompt-architecture.test.ts` 重写：depth 驱动篇幅断言、章数/难度/depth 注入断言、`生成模式` 不进 writer。
- [x] 10.2 `model-overrides-worker.test.ts` 无需改（`generationProfile ?? "fast"` 子串仍在 runner 源码中，断言仍通过）。
- [x] 10.3 `chapter-headings.test.ts` + `prompt-architecture.test.ts` 夹具 `weeklyHours/chapterLength` → `chapterCount/difficulty`。
- [x] 10.4 E2E 16 处 `weeklyHours: 3` → `chapterCount: 5, difficulty: "intermediate"`（全 API POST，无表单选择器依赖）。
- [x] 10.5 新增 `normalize-course.test.ts`（旧/新 payload 归一）；`prompt-architecture` 覆盖 章数注入/难度注入/depth 驱动 writer。

**完成判据**：✅ `npm run test:unit` = **174 pass / 0 fail**。

---

## 阶段 11 · 本地门禁

- [x] 11.1 `npm run lint` ✅ 0 errors（3 个 pre-existing warning，非本次文件）。
- [x] 11.2 `npm run test:unit` ✅ 174 pass / 0 fail。
- [x] 11.3 `npm run test:schema` ✅ —— 修复 pre-existing 缺陷：verify 脚本 `claim_generation_job` 仍写 4 参，实际 schema.sql 已 5 参，对齐后通过（base `ff1a57f` 即红，与个性化无关）。
- [x] 11.4 `npm run build` ✅。
- [x] 11.5 `npm run test:e2e` ✅ **18 passed / 1 skipped**（skip = opt-in ai-smoke）。
- [x] 11.6 全绿。

> **Pre-existing e2e 修复说明**：256/292/407/451 断言「单个 chapter job 跑完 AUTHOR+POLISHER+REVIEWER → ready」，属 sync(deep) 语义；自 fast 异步拆分成为默认后，这些测试在 base `ff1a57f` 已失败（`git checkout ff1a57f` 实测复现同样 3 红）。修复：给这些「需章节跑到 ready」的测试课程显式加 `generationProfile: "deep"`，走确定性单任务流水线；opt-in `ai-smoke` 同样加 deep。这同时端到端验证了新 deep 工作流。

---

## 阶段 12 · 灰度验证 + 部署

- [ ] 12.1 本地 `npm run dev` 建一门新课，人工验证：
  - 章节数 == 所选档位
  - 难章（core）明显比引入（light）长
  - 快速 vs 深度的显示时机符合预期
  - 联网开关开/关行为正确
  - 3 章并发是否真并行（接上次未验证项）
- [ ] 12.2 提交并 push 分支：`git push origin feat/personalization-axes`。
- [ ] 12.3 合并到 `main`（PR 审阅）。
- [ ] 12.4 切回 main、拉取最新，运行 `python deploy_remote.py` 部署。
- [ ] 12.5 部署后线上验证：健康检查通过（脚本自动）、`/admin` 建课新表单正常、**打开一门旧课程**确认向后兼容无报错。
- [ ] 12.6 线上实建一门新课，确认端到端正常。

---

## 风险与注意事项

- **R1 旧课程兼容**（最高）：阶段 2 必须先于其它读取改动完成；线上有存量课程，缺字段会直接影响详情/续生成。
- **R2 篇幅失控**：去掉硬上限后，`core` 章可能过长 → 阶段 4.4 的兜底 `maxTokens` 必须保留。
- **R3 部署不跑 npm install**：本次确认不加依赖；若中途引入新包，需单独处理服务器 `npm install`。
- **R4 schema 重跑**：部署每次重跑 `schema.sql`（幂等）；本次不改 schema，回滚安全。
- **R5 E2E 漏改**：建课 payload 的旧字段散落多个 spec，阶段 10.4 要逐个清，否则 gate 红。

## 待实现前最终确认的微调项（默认值见阶段 0，可改）
- 离散档目标章数：精简 5 / 标准 8 / 详尽 14？
- `depthWeight` 三档字符区间是否采用阶段 0 数值？
- 难度基调三档的 UI 文案措辞。
