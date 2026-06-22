# Tutor / Revise 解耦与补完 —— 执行 TODO

> 目标：把"阅读导师问答"与"局部微调改写"两套功能**彻底解耦成两条独立纵切**，并各自补完。
> 方法：沿用既有打法——**一阶段一自检**，自检失败就地回滚修到绿再进下一阶段。
> 状态图例：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成自检通过

---

## 1. 背景与现状不完善点

**Tutor（问答）** — prompt 已较完整（`src/lib/prompts/annotationTutor.ts` 带 goal/profile/章节上下文/术语表），但：
- 只能锚定选区提问，**无全章/泛问**；空状态写死"选中文字后发起问答"。
- context 未接入新的 `styles` / `learningMode`。
- **无回答中断/重答**，历史只在左栏列选中原文、**无摘要/时间/删除**。
- 流式输出**已实现**（SSE + `askTutorStreaming`），本计划只需"重构中不丢失 + 补停止/重答"。

**Revise（微调，现 `repair`）** — 锚点→预览→精确唯一回插管线良好，但：
- prompt 锁死"只修错、不许改写"（`src/lib/prompts/contentRepair.ts`），表达不了"更详细/换讲法/加例子"。
- 入口是两个写死按钮，**无自由输入框**（但后端 `userMessage` 本就是任意文本）。
- 复用 **TUTOR agent**（`client.ts` `proposeContentRepair`），语义错位、审计里冒充 TUTOR。
- **无配额、无撤销/历史、应用后不真正重检**（只降级 + 写句提示，TQH 不重跑）。

**耦合点**：两功能共用同一右侧抽屉（`tutorOpen`）+ 同一套选区 state（`selectedText/active/selectedSectionId`）。后端早已解耦（`/api/annotations` vs `/api/repairs`），**本次解耦主要是前端 + Revise 后端重构**。

---

## 2. 目标架构

```
                 选区 / 段落 / 小节   ← 唯一共享的"定位原语"
                   ╱                ╲
        问导师纵切                      改写纵切
        ─────────                      ─────────
  UI    <TutorPanel> / useTutor        <RevisePanel> / useRevise
  API   /api/annotations(+DELETE)      /api/revisions (+/apply, +/[id]/revert)
  Agent TUTOR（只读、解释）            REVISER（新增，改写正文）
  Prompt annotationTutor               revise.fix / revise.rewrite
  配额  ask_tutor                      revise（新增，计在"生成建议"而非"应用"）
  数据  Annotation（线程）             Revision（改写历史，支持撤销）
```

两条线**不共用 state、不共用抽屉、不共用 agent、不共用 prompt**，仅共用"在正文里安全定位一段文字"的原语（抽成通用 `resolveRevisionScopeAnchor`）。

---

## 3. 已确定的决策（用户已拍板）

- **决策①**：整章重生**一起**改成"快照 + 可回退"（与 Revision 历史同一套地基，P4 顺带做）。
- **决策②**：**新增 `REVISER` agent**（仍走用户网页自配模型，**不新增服务器 key**），留 `REVISER_*` 可选覆盖；默认参数按 mode 分档——`rewrite` 参考 AUTHOR（温度高、预算大），`fix` 参考 POLISHER（温度低、保守），dispatch 时显式传参。

---

## 4. 契约补强（评审修正，**先读这一节**）

> 以下九条（C1–C9）是两轮评审发现的硬契约缺口，已并入下面各阶段；这里集中说明设计决定，避免阶段间返工。

- **C1 · 两种恢复语义必须分开（不能共用一份 payload）。**
  - **局部撤销**（selection/paragraph/section）：`Revision` 存 `beforeText/afterText`，revert = **定向精确唯一**把 `afterText→beforeText`，**只动该 span**，不波及其后的其他编辑；revert 后照 apply 一样重检。
  - **整章快照**（`scope:"chapter"`，仅用于整章重生回退）：存 **完整 `beforeChapter: Chapter`**（含 `content/sections/status/review/qualityReport`，见 `src/lib/types.ts:21`），revert = **整章原样还原**（带确认，语义即"丢弃重生版、回到上一版"）。
  - ❌ 不要用"整章快照"去做局部撤销——整章还原会抹掉该 revision 之后的所有编辑。

- **C2 · `Revision.status` 与 `Chapter.status` 是两件事，禁止混用。**
  - `Revision.status ∈ {proposed, applied, reverted, failed}`（改写记录生命周期）。
  - `Chapter.status`（`ready/draft_ready/...`）与 `qualityReport` 由 apply/revert/重检**单独更新**，**不**写进 revision。当前 apply 路由是把章节降 `draft_ready`+清 `qualityReport`（`src/app/api/repairs/apply/route.ts:85`），保持该职责分离。

- **C3 · Revise 配额计在"生成建议"，不计在"应用"。**
  - 最贵的 LLM 调用发生在 `POST /api/revisions`（出 proposal），`/apply` 只是确定性文本回插。**只在 apply 计费会放开无限免费预览**。
  - 决定：`withQuotaConsumption(userId,"revise",…)` 包在 **proposal 路由**、**仅成功生成时计**；`/apply`、`/revert` 不计（确定性、幂等护栏已足）。（备选：拆 `revise_preview`/`revise_apply` 两类——本计划取前者，更简单。）

- **C4 · P1"零行为变化"会撞结构性单测。** `tests/unit/sse.test.ts:58`（"reader page uses authenticated abortable tutor and repair requests"）用**文本断言**要求 `requestRepair(...)`、`apiFetch("/api/repairs")`、`REPAIR_REQUEST_TIMEOUT_MS` 等仍在 reader page 源码内。搬进 hooks/组件后必断。→ P1 必须**同步迁移这些断言**指向新 hook/组件，且自检跑 `test:unit && test:e2e`（不能只跑 e2e）。P3 重命名 `/api/repairs→/api/revisions` 时再更新一次相关断言。

- **C5 · 泛问 / 删除线程的 `Annotation` 契约要先补（含 DB NOT NULL）。** 现 `Annotation.selectedText` 必填、左栏直接展示选区文本（`types.ts:186`、`page.tsx:626`），且 DB 是 `selected_text text not null`（`supabase/schema.sql:47`），`saveServerAnnotation` 直写该字段（`serverStore.ts:343`）——**Supabase 模式下泛问会插入失败**。→ ①`Annotation` 增 `scope:"anchored"|"chapter"`、`selectedText` 改可选、增 `title?/summary?`；②schema `alter table annotations alter column selected_text drop not null`（随 P0 版本升级一起）；③`serverStore.ts:343` 改写 `selected_text: nextAnnotation.selectedText ?? null`；④`serverStore` 增 `deleteServerAnnotation`（本地 Map + Supabase 删除并 cascade `annotation_messages`）；⑤UI 历史列表对空 `selectedText` 用 `title/summary` 兜底。

- **C6 · schema 改动是"多文件齐步走"清单，不止一处。** 见 P0：`schema.sql` 建表/RLS/读策略/索引/禁写、`learnbyai_schema_version()` 升版本，外加**版本号在 6 处代码/脚本 + 1 处文档各自独立硬编码**（P0 实测全量清单，每次升版都要同步）：
  - `supabase/schema.sql`（`learnbyai_schema_version()` 函数体）
  - `src/lib/betaContract.ts`（`LEARNBYAI_SCHEMA_VERSION` 运行时常量，app 上报用）
  - `scripts/verify-supabase-schema.mjs:7`（+ `tables` + requiredSnippets 读策略&索引 + forbiddenSnippets 三条禁写）
  - `scripts/supabase-smoke.mjs:11`（+ `applicationTables`）
  - `scripts/beta-health.mjs:4`（严格 beta gate 独立版本，漏了会卡 beta-gate）
  - `tests/unit/supabase-smoke.test.mjs`（断言 schema + smoke 都含该版本号）
  - `docs/DEVELOPMENT.md`（文档说明，非阻塞但应同步）

- **C7 · 新增 `revise` 配额动作有一串"TS 抓不到"的硬编码。** `UsageEvent.action` 联合（`types.ts:176`，根类型）一改，`Record<UsageEvent["action"],…>` 处会被 TS 抓；但以下都**不会被 TS 抓**，需手动逐个补（见 P3 checklist）：`adminSettings.ts:97` 的 `[…] as const` 动作数组、`settings-form.tsx:50` 的 `quotas` 字面量 + 表单输入框、`USAGE_ACTION_LABEL`、`/api/usage` 的 `usageActions` Set（`usage/route.ts:6`）、`adminData.ts:14` 的 `USAGE_ACTIONS` 数组、`quotaConfig.ts` 的 `DEFAULTS`/`LIMIT_ENV`、`.env.example` 的 `QUOTA_REVISE`。

- **C8 · Revision 生命周期：proposal 就持久化，apply 接 `revisionId`。** 否则未应用的 proposal 不进历史、`/revert` 也没有稳定 id。→ `POST /api/revisions` 成功生成时即 `saveServerRevision(status:"proposed")` 并返回带 `id` 的 revision；`/apply` 接收 `revisionId`，做精确回插后把**同一条**更新为 `applied`（+`appliedAt`）；`/revert` 按 `revisionId` 操作。历史列表默认只显示 `applied/reverted`；同一锚点再次 proposal 时**作废上一条未应用的 proposed**（避免孤儿堆积，可选 TTL GC）。

- **C9 · 整章快照落服务端入口，不写客户端。** 客户端 `regenerateCurrentChapter` 只是 UI 乐观清空，服务端 `getServerCourse` 取权威数据（项目约定浏览器不提交权威 course snapshot）。真正清空发生在 `/api/chapters/[id]/generate` 的 `updateServerChapter`（`generate/route.ts:95`，条件 `hasChapterBody && retry`）与 admin 的 `enqueueAdminChapterGeneration`（`admin/actions:71`）。→ 抽 `snapshotChapterBeforeRegen(course, chapterId, request)`（清空前 `saveServerRevision({scope:"chapter", beforeChapter})`），在**这两个服务端 seam**各调一次，**不**依赖客户端。

---

## 5. Agent 枚举触点清单（"6→7"，about 页文案"7→8"）

> `AgentName` 改动后，所有 `Record<AgentName, …>` 会被 TS **强制**要求补全 REVISER —— 编译器即清单。

- [ ] `src/lib/types.ts` — `AgentName` union 增加 `"REVISER"`
- [ ] `src/lib/modelOverrides.ts` — `MODEL_AGENT_NAMES` 增加 `"REVISER"`
- [ ] `src/components/ModelSettings.tsx` — `AGENT_LABELS` / `AGENT_DESCRIPTIONS` / `AGENT_BADGES` 各补 REVISER（TS 强制）
- [ ] `src/app/admin/settings-form.tsx` — 本地 `AGENT_LABEL` 补 REVISER（TS 强制）
- [ ] `src/lib/config.ts` — `getAgentConfig` 按前缀通用，**无需改代码**；`.env.example` 增加 `REVISER_*` 文档块
- [ ] `src/app/about/page.tsx`（**流程说明**）— "7 个专业 AI Agent" → "8 个"；Agent System 列表新增 REVISER 条目
  - 备注：该页现有 `GATHERER` 在代码 `AgentName` 中不存在（历史文案不一致），见 §9 可选清理

---

## 6. 分阶段任务（最小可执行单元）

### P0 · 地基（类型 + 存储 + 通用定位原语 + schema 多文件齐步）✅ 完成 2026-06-21
> 自检通过：`test:schema` ✅ · `test:unit` ✅ **194‑0**（`revision-scope-anchor` 7 条 + `revision-store` 4 条）· `tsc --noEmit` ✅。
> **store 单测已补齐**：根因是 serverStore 顶部 `import "server-only"` 在 `tsx --test` 下无法解析。解决：装 `server-only` devDep + `test:unit` 加 `--conditions=react-server`（让该标记解析为空模块；生产仍走 Next 别名，全量 194 条无回归）+ `localStorePath` 支持 `LEARNBYAI_LOCAL_STORE_PATH` 覆盖（测试隔离到临时目录）。`tests/unit/revision-store.test.ts` 实测 revision 往返/改状态/按章隔离 + annotation 增删 + 泛问空 selectedText。
> 该测试还逼出并修复一个真 bug：`deleteServerAnnotation` 删除后用默认 `persistLocalStore()` 会从磁盘 merge 回刚删的项，已改 `{ mergeDisk:false }`（与 `clearLocalCourseData` 一致）；并在删前补 `hydrateLocalStore()`。
- [x] `src/lib/types.ts`：新增 `RevisionMode("fix"|"rewrite")`、`RevisionScope("selection"|"paragraph"|"section"|"chapter")`、`Revision`：
  - 公共：`id/userId/courseId/chapterId/sectionId?/mode/scope/intent/status("proposed"|"applied"|"reverted"|"failed")/createdAt/appliedAt?/revertedAt?`
  - 局部 scope：`beforeText/afterText`（**C1**）
  - 整章 scope：`beforeChapter:Chapter`（`afterChapter?` 可选）（**C1**）
- [x] `src/lib/types.ts`：`Annotation` 增 `scope?:"anchored"|"chapter"`（缺省即 anchored）、`selectedText?` 改可选、增 `title?/summary?`（**C5**）
- [x] 抽通用定位：新建 `src/lib/markdownSections.ts`（把 `targetedRepair.ts` 私有的 `parseMarkdownSections` 提出来共享），并基于它实现 `resolveRevisionScopeAnchor(content, scope, selectedText)`；`targetedRepair.ts` 改为复用它（**C/评审第8条**）
- [x] `src/lib/serverStore.ts`：新增 `listServerRevisions(chapterId,req)` / `saveServerRevision(rev,req)` / `getServerRevision(id,req)` / `updateServerRevision(id,patch,req)`（apply/revert 改状态用，**C8**）；新增 `deleteServerAnnotation(id,req)`（本地 Map + Supabase cascade）；`saveServerAnnotation` 改写 `selected_text: nextAnnotation.selectedText ?? null`（`:343`，**C5**）；LocalStore/snapshot/merge(`chooseRevision`)/clearLocalCourseData 一并接入
- [x] `supabase/schema.sql`（**C6**）：
  - `create table if not exists revisions (...)` + `alter table revisions enable row level security`
  - `create policy "users can read own revisions"`，**不建** insert/update/delete 客户端策略
  - 索引 `revisions_user_chapter_created_idx`；`annotation_messages` 对 `annotations` 的 `on delete cascade` 确认存在
  - `annotations` 表补 `scope/title/summary` 可空列；**`alter table annotations alter column selected_text drop not null`（C5）**
  - 升 `learnbyai_schema_version()` → `learnbyai-beta-2026-06-21-01`
- [x] `scripts/verify-supabase-schema.mjs`（**C6**）：改 `expectedSchemaVersion`；`tables` 加 `revisions`；`requiredSnippets` 加读策略+索引；`forbiddenSnippets` 加 revisions 的 insert/update/delete 三条
- [x] `scripts/supabase-smoke.mjs`（**C6**）：改 `expectedSchemaVersion`（:11）；`applicationTables` 加 `revisions`（:18）
- [x] `scripts/beta-health.mjs`（**C6**）：改 `expectedSchemaVersion`（:4）
- [x] **额外发现的版本号位置**（C6 全量清单，原计划漏列）：`src/lib/betaContract.ts`、`tests/unit/supabase-smoke.test.mjs`、`docs/DEVELOPMENT.md` 一并同步
- [x] **store 读写单测**：`tests/unit/revision-store.test.ts`（revision 往返/改状态/按章隔离 + annotation 增删 + 泛问空 selectedText）；为此装 `server-only` devDep、`test:unit` 加 `--conditions=react-server`、`localStorePath` 支持 `LEARNBYAI_LOCAL_STORE_PATH` 覆盖
- [x] `scripts/verify-supabase-schema.mjs` 精确断言新列迁移：三条 `alter table annotations add column if not exists {scope,title,summary} text` + `alter table annotations alter column selected_text drop not null`（不再用会被其他表误命中的松散 `summary text`）
- [x] **自检通过**：`test:schema` ✅ + `test:unit` ✅ 194‑0 + `tsc --noEmit` ✅

### P1 · 纯解耦（零行为变化 + 迁移结构性单测）✅
- [ ] 新建 `src/lib/hooks/useTutor.ts`：迁移 `ask / active / annotations / answering / askTutorStreaming` 全部逻辑
- [ ] 新建 `src/lib/hooks/useRevise.ts`：迁移 `repair / repairing / repairError / requestRepair / applyRepair` 全部逻辑
- [ ] 新建 `src/components/reader/TutorPanel.tsx`：纯问答抽屉
- [ ] 新建 `src/components/reader/RevisePanel.tsx`：改写抽屉（从 tutor 抽屉**搬出** REPAIR 按钮 + 预览块）
- [ ] `chapters/[chapterId]/page.tsx`：仅保留"选区原语 + 两面板开关"；选中文字弹**二选一浮条**（问导师 / 改写此处）；两面板**互斥**
- [ ] `tests/unit/sse.test.ts`（**C4**）：把"reader page uses authenticated abortable tutor and repair requests"里的 `requestRepair`/`apiFetch("/api/repairs")`/`REPAIR_REQUEST_TIMEOUT_MS` 等断言**迁移指向**新 hook/组件文件（按文件读取断言）
- [ ] **自检**：`npm run test:unit && npm run test:e2e` —— 硬指标：①流式逐 token 不回退 ②问答多轮 ③"最小修复"行为与现状逐项一致

### P2 · Tutor 补完 ✅
- [ ] `src/lib/prompts/annotationTutor.ts`：`selectedText` 可空时走"整章/整节泛问"分支；context 接入 `styles` / `learningMode`
- [ ] `src/app/api/annotations/route.ts`：锚点校验改为"有 sectionId/selectedText 才校验"；新增 `DELETE`（删线程，调 `deleteServerAnnotation`）
- [ ] `TutorPanel`：「当前对话 / 历史」两视图；历史列表给 **问题摘要 + 时间 + 删除 + 续聊**；空 `selectedText` 用 `title/summary` 展示（**C5**）
- [ ] `TutorPanel`：流式「停止」（露出已有 `AbortController`）+「重答」（删最后一条 assistant 重新流）
- [ ] `useTutor`：支持无选区泛问入口
- [ ] **自检**：`test:unit`（泛问 prompt 分支 + DELETE 契约）+ `test:e2e`（历史续聊/删除/流式停止）

### P3 · Revise 后端重构（新 agent + 三动作 + 配额）✅
- [ ] 新增 `REVISER` agent（依赖 §5 全部枚举触点已改完）
- [ ] 新建 `src/lib/prompts/revise.ts`：`buildReviseFixPrompt`（沿用最小修复语义）+ `buildReviseRewritePrompt`（授权定向改写/扩写，硬约束：守 contract、标题层级不动、不外溢后续章节、遵循 styles/learningMode、只动选定范围）
- [ ] `src/lib/maol/client.ts`：`proposeContentRepair` → `proposeRevision`，`agent:"TUTOR"`→`agent:"REVISER"`，按 `mode` 显式传 temp/maxTokens（rewrite=AUTHOR 档 / fix=POLISHER 档）
- [ ] 重命名路由 `src/app/api/repairs` → `src/app/api/revisions`：请求加 `mode/scope/intent`；用 `resolveRevisionScopeAnchor` 处理 paragraph/section 范围；**成功生成时 `saveServerRevision(status:"proposed")` 并返回带 `id` 的 revision（C8）**；同锚点新 proposal 作废上一条未应用的 proposed
- [ ] **配额计在 proposal（C3）**：`UsageEvent.action` 加 `"revise"`（`types.ts:176`）；`quotaConfig.ts` 的 `DEFAULTS`+`LIMIT_ENV` 加 `revise`/`QUOTA_REVISE`；`/api/revisions`（proposal）包 `withQuotaConsumption(userId,"revise",…)` 仅成功计；`/apply`、`/revert` 不计
- [ ] **TS 抓不到的硬编码全清单（C7）**：`adminSettings.ts:97` 的 `as const` 动作数组加 `"revise"`；`settings-form.tsx:50` 的 `quotas` 字面量 + 表单输入框加 `revise`；`USAGE_ACTION_LABEL` 加"局部改写"；`/api/usage` 的 `usageActions` Set（`usage/route.ts:6`）；`adminData.ts:14` 的 `USAGE_ACTIONS` 数组；`.env.example` 加 `QUOTA_REVISE`
- [ ] `RevisePanel`：调用方改 `/api/revisions`（旧 `/api/repairs` 为唯一调用方，直接改）；同步更新 `tests/unit/sse.test.ts` 中相关 URL 断言
- [ ] **自检**：`test:unit`（rewrite 守约束断言 + scope 锚点 + 配额计在 proposal）

### P4 · Revise 闭环（历史 / 撤销 / 重检 / 整章快照）✅
- [ ] `src/app/api/revisions/apply/route.ts`：接收 `revisionId`，做精确回插后把**同一条 proposed → `applied`（+appliedAt，C8）**；随后**同步跑 TQH 确定性校验**（structure/format/latex，`src/lib/quality/`）：过则 `Chapter.status: draft_ready→ready`，否则保持 + 写报告——**章节状态与 revision 状态分别更新（C2）**
- [ ] 新建 `src/app/api/revisions/[id]/revert/route.ts`（按 `revisionId`）：
  - 局部 scope：精确唯一 `afterText→beforeText` 回插 + 重检（**C1**），revision.status→`reverted`
  - 整章 scope：整章还原 `beforeChapter`（带确认），revision.status→`reverted`
- [ ] `RevisePanel`：拉"本段改写历史"（仅 applied/reverted），逐条**撤销** + 顶部重检状态
- [ ] **决策① + C9（快照落服务端）**：抽 `snapshotChapterBeforeRegen(course, chapterId, request)`（清空前 `saveServerRevision({scope:"chapter", beforeChapter})`），在 `generate/route.ts:95`（`hasChapterBody && retry` 清空前）与 admin `enqueueAdminChapterGeneration`（`admin/actions:71`）**两个服务端 seam**各调一次；客户端 `regenerateCurrentChapter` 不承担快照
- [ ] **自检**：`test:unit`（局部 revert 不波及其他编辑 + 整章 revert 还原 + revision/chapter 状态分离）+ `test:e2e`（改写→重检→撤销 全链路）

### P5 · RevisePanel 完整交互 + 全量回归 ✅
- [ ] `RevisePanel`：范围切换（选区/段落/小节）→ 模式（修错/按要求改写）→ 预设意图芯片（更详细/更简洁/多举例/换讲法/加个图）+ 自由输入 → 预览 diff（带 confidence）→ 应用 → 重检状态 + 撤销
- [ ] 文案/空状态/错误态打磨；二选一浮条交互细节
- [ ] **自检**：`npm run test:phase-gate` 全绿 + 真模型 MiMo 抽检（改写→重检→撤销 一次走通）

---

## 7. 每阶段自检门汇总

| 阶段 | 自检命令 / 验收 |
|---|---|
| P0 | `test:unit` + `test:schema` |
| P1 | **`test:unit && test:e2e`**（结构性单测已迁移 / 流式不回退 / 行为一致）|
| P2 | `test:unit` + `test:e2e`（历史/删除/流式停止） |
| P3 | `test:unit`（rewrite 守约束 / scope 锚点 / 配额计在 proposal） |
| P4 | `test:unit`（局部 revert 不波及 / 整章还原 / 状态分离） + `test:e2e`（改写→重检→撤销） |
| P5 | `test:phase-gate` 全绿 + 真模型 MiMo 抽检 |

---

## 8. 风险与回滚

- **`/api/repairs` 重命名**：当前唯一调用方是 chapter page，beta 小用户，直接改；若担心在途请求可临时留 `repairs` 薄别名一版后删。
- **schema 改动**：必须三处齐步（schema.sql + verify-schema + supabase-smoke）并 bump 版本，否则 `test:schema` / smoke 失败（见 §4 C6）。
- **流式回退风险**：P1 搬 SSE 进 hook 最易弄丢，已列为 P1 硬验收项。
- **配额绕过风险**：proposal 必须计费（C3），否则放开最贵 LLM 调用。
- **撤销语义风险**：局部 revert 用定向回插、整章 revert 用整章还原，禁止互换（C1）。
- **REVISER 仍用用户模型**：不新增服务器 key，符合"内容 agent 一律用用户自配模型"原则。
- **回滚策略**：每阶段独立提交，自检失败 `git` 回退该阶段再修。

---

## 9. 开放 / 可选清理（不阻塞主线）

- [ ] `about/page.tsx` 的 `GATHERER` 在代码中不存在（历史文案）：本次顺手决定——保留为概念描述，还是删除以与代码一致？（默认：仅新增 REVISER + 改计数，GATHERER 留待确认）
- [ ] 是否需要"课程级"历史（跨章查看 annotations / revisions）？默认按章，留作后续。

---

## 10. 进度记录

- 2026-06-21：方案定稿，两项决策已拍板，文档建立。
- 2026-06-21：按第一轮评审补强契约（C1–C7：快照/状态分离/配额计费点/P1 单测迁移/Annotation 泛问契约/schema 多文件清单/quota 硬编码触点）。
- 2026-06-21：按第二轮评审再补（C8 Revision 生命周期 proposal 即持久化 + apply 接 revisionId；C9 整章快照落服务端两个 seam；C5 补 `selected_text drop not null` + serverStore 写 `?? null`；C6 补 `beta-health.mjs` 版本号；C7 补 `/api/usage` usageActions + `adminData` USAGE_ACTIONS），更新各阶段任务。
- 2026-06-21：**P0 完成并自检通过**（`test:schema` + `test:unit` 190‑0 + `tsc --noEmit`）。新增 `Revision`/`AnnotationScope` 类型、`src/lib/markdownSections.ts`（`resolveRevisionScopeAnchor` + 共享 `parseMarkdownSections`）、serverStore revisions CRUD + `deleteServerAnnotation`、`revisions` 表 + 注解列迁移、schema 版本升至 `learnbyai-beta-2026-06-21-01`（实测共 6 处代码/脚本 + 1 处文档硬编码，已全量同步，C6 清单更新）。
- 2026-06-21：**P0 评审补强**（3 项阻塞）：① 补 store 读写单测（`server-only` devDep + `--conditions=react-server` + `LEARNBYAI_LOCAL_STORE_PATH` 覆盖，`revision-store.test.ts` 4 条），并修复 `deleteServerAnnotation` 删除被 merge 撤销的真 bug（`mergeDisk:false` + 删前 hydrate）；② verify-schema 补断言新 annotation 列；③ 自检升至 `test:unit` **194‑0** + `test:schema` + `tsc`。
- 2026-06-22：**P1–P5 一次性全部完成，`npm run test:phase-gate` 全绿**（lint 0 err · unit **197‑0** · schema · build · e2e **18 passed/1 skipped**）。
  - P1 解耦：抽 `useTutor`/`useRevise`（`src/lib/hooks/`）+ `<TutorPanel>`/`<RevisePanel>`（`src/components/reader/`）；reader page 仅保留选区 + 二选一浮条 + 互斥面板；迁移 `sse.test.ts` 结构性断言。
  - P2 Tutor：泛问（`selectedText` 可空分支）、context 接入 styles/learningMode、历史一等视图（摘要/时间/删除/续聊）、停止/重答、`DELETE /api/annotations`。
  - P3 Revise 后端：新增 `REVISER` agent（8 枚举触点 + about 文案 7→8）、`src/lib/prompts/revise.ts`(fix+rewrite)、`proposeRevision`(按 mode 传 temp/maxTokens)、`/api/repairs`→`/api/revisions`(mode/scope/intent)、`revise` 配额计在 proposal（全部 TS 抓不到的硬编码触点已补）。
  - P4 闭环：proposal 即落 `proposed`、apply 接 `revisionId`→`applied` + 同步 TQH 重检、`/api/revisions/[id]/revert`（局部回插 / 整章快照还原）、`snapshotChapterBeforeRegen` 挂 generate 路由 + admin 重生两个服务端 seam（`src/lib/revisionApply.ts`）。
  - P5：RevisePanel 范围/方式/预设/diff/应用/历史撤销 完整交互。
  - 两条工程教训：① `npm run build` 后直接跑 e2e 会复用 prod `.next` 导致 dev 运行时 "Invalid or unexpected token"（清 `.next` 即恢复，符合 CLAUDE.md 告警）；② `auth-isolation` 的 worker `processed>0` 在全量套件下偶发竞态（隔离 16/16 通过、未触碰其代码），重跑即绿。
  - 顺手更新 CLAUDE.md「Targeted repair」→「Local revision — fix + rewrite」反映新架构。
- 2026-06-22：**评审补强（4 项 + e2e 缺口）**：① `/api/revisions/apply` 收紧状态机，非 `proposed` 一律 409（`applied` 仍幂等）；② `revisionApply.rechecked` 文案按动作（应用/撤销）× 质检结果（通过/未通过）生成，不再固定写"通过重新质检"；③ 落地 C8——同锚点新 proposal 把旧 `proposed` 置 `failed`；④ RevisePanel 预览改为 原文/改写后 对照。新增 `tests/e2e/revise-flow.spec.ts`（propose→apply→revert + 409 状态机 + 历史）。`test:phase-gate` 全绿：**19 passed / 1 skipped**。
