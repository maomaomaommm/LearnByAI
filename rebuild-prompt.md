# LearnByAI 重构完整提示词

> 多Agent协作重构指令：字符暗月主题 + 多AI协同编排层(MAOL) + 教材质量保障层(TQH) + 日间/夜间模式切换

---

## 一、项目概述

**LearnByAI** 是一个AI个性化学习材料生成平台。用户输入学习主题、目标、背景、教学风格、每周学习时间后，系统通过多AI协同生成连贯的 Course Bible、课程大纲和教材章节。用户可在阅读器中阅读 Markdown + LaTeX 渲染的章节内容，并通过右侧AI问答边栏随时提问。

### 当前核心功能

1. **课程创建流程**：用户输入学习主题、目标、背景、教学风格、每周学习时间，系统生成 Course Bible 和课程大纲
2. **章节生成**：自动生成第一章，后续章节按需生成
3. **阅读器**：支持 Markdown + LaTeX 数学公式渲染（react-markdown + rehype-katex + remark-math + remark-gfm）
4. **锚定式AI问答**：在阅读器右侧边栏，用户可选中文字或双击段落发起AI提问
5. **数据存储**：课程和标注数据存储在浏览器 localStorage
6. **AI后端**：OpenAI-compatible API

---

## 二、技术栈约束

| 层级 | 技术选型 |
|------|----------|
| 框架 | Next.js 15 App Router |
| 语言 | TypeScript |
| UI框架 | React 19 |
| 组件库 | shadcn/ui |
| 样式 | Tailwind CSS（替换当前 plain CSS） |
| 图标 | lucide-react |
| Markdown渲染 | react-markdown + rehype-katex + remark-math + remark-gfm |
| 校验 | Zod |
| AI SDK | OpenAI-compatible API（支持多模型后端） |
| 主题系统 | CSS 自定义属性 + Tailwind dark 变体 + 手动/自动切换 |

---

## 三、主题系统设计（日间/夜间双模式）

### 3.1 设计原则

- **系统偏好优先**：首次访问自动检测 `prefers-color-scheme`，默认跟随系统
- **手动切换持久化**：用户可手动切换主题，选择保存在 localStorage
- **无缝切换**：切换时无闪烁、无页面刷新，使用 CSS 变量瞬时切换
- **全组件覆盖**：所有UI组件、Markdown渲染、代码块、数学公式、图表均适配双主题
- **阅读器护眼**：夜间模式降低蓝光，日间模式保持高对比度可读性

### 3.2 配色方案

#### 夜间模式（Night / Dark）—— 字符暗月

| 用途 | 色值 | 说明 |
|------|------|------|
| 页面背景 | `#0a0a0f` | 深空黑 |
| 卡片/面板背景 | `#12121a` | 暗月灰 |
| 阅读器内容区 | `#14141f` | 略浅暗色，区分背景 |
| 主文字 | `#e8e8f0` | 月白 |
| 次要文字 | `#8b8b9e` | 星灰 |
| 主品牌色 | `#4a90d9` | 暗月蓝 |
| 高亮/交互 | `#7c6fae` | 暗月紫 |
| 成功/进度 | `#5fb3b3` | 暗月青 |
| 警告/需复核 | `#d4a017` | 暗月金 |
| 错误/失败 | `#c45c5c` | 暗月红 |
| 边框 | `rgba(74, 144, 217, 0.15)` | 暗月蓝半透明 |
| 代码块背景 | `#0d0d14` | 比页面略深 |
| 代码文字 | `#a8d8ea` | 暗月青白 |
| 公式渲染背景 | 透明 | 跟随内容区 |
| 悬浮 glow | `0 0 12px rgba(74, 144, 217, 0.3)` | 暗月蓝微光 |
| 毛玻璃 | `backdrop-blur: 12px` + `bg-opacity-80` | 半透明模糊 |

#### 日间模式（Day / Light）

| 用途 | 色值 | 说明 |
|------|------|------|
| 页面背景 | `#f8f9fc` | 极浅灰蓝 |
| 卡片/面板背景 | `#ffffff` | 纯白 |
| 阅读器内容区 | `#fefefe` | 微暖白 |
| 主文字 | `#1a1a2e` | 深墨蓝 |
| 次要文字 | `#5a5a6e` | 中灰蓝 |
| 主品牌色 | `#2563eb` | 明亮蓝 |
| 高亮/交互 | `#7c3aed` | 明亮紫 |
| 成功/进度 | `#059669` | 明亮青绿 |
| 警告/需复核 | `#d97706` | 明亮琥珀 |
| 错误/失败 | `#dc2626` | 明亮红 |
| 边框 | `rgba(37, 99, 235, 0.12)` | 明亮蓝半透明 |
| 代码块背景 | `#f1f5f9` | 浅灰蓝 |
| 代码文字 | `#0f172a` | 深蓝黑 |
| 公式渲染背景 | 透明 | 跟随内容区 |
| 悬浮 shadow | `0 4px 12px rgba(0, 0, 0, 0.08)` | 柔和阴影 |
| 毛玻璃 | `backdrop-blur: 12px` + `bg-white/80` | 半透明模糊 |

### 3.3 CSS 变量系统

在 `src/app/globals.css` 中定义 CSS 自定义属性，通过 `html` 标签的 `data-theme` 属性切换：

```css
:root {
  /* 日间模式默认值 */
  --bg-primary: #f8f9fc;
  --bg-secondary: #ffffff;
  --bg-reader: #fefefe;
  --text-primary: #1a1a2e;
  --text-secondary: #5a5a6e;
  --brand-primary: #2563eb;
  --brand-highlight: #7c3aed;
  --success: #059669;
  --warning: #d97706;
  --error: #dc2626;
  --border-color: rgba(37, 99, 235, 0.12);
  --code-bg: #f1f5f9;
  --code-text: #0f172a;
  --glow-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  --glass-bg: rgba(255, 255, 255, 0.8);
}

[data-theme="dark"] {
  --bg-primary: #0a0a0f;
  --bg-secondary: #12121a;
  --bg-reader: #14141f;
  --text-primary: #e8e8f0;
  --text-secondary: #8b8b9e;
  --brand-primary: #4a90d9;
  --brand-highlight: #7c6fae;
  --success: #5fb3b3;
  --warning: #d4a017;
  --error: #c45c5c;
  --border-color: rgba(74, 144, 217, 0.15);
  --code-bg: #0d0d14;
  --code-text: #a8d8ea;
  --glow-shadow: 0 0 12px rgba(74, 144, 217, 0.3);
  --glass-bg: rgba(18, 18, 26, 0.8);
}
```

### 3.4 主题切换机制

#### 自动检测

```typescript
// src/lib/theme.ts
function getInitialTheme(): "light" | "dark" {
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
```

#### 手动切换组件

- 位置：全局导航栏右侧，紧邻用户头像/设置入口
- 样式：日月图标切换按钮，悬浮时带品牌色微光
- 行为：点击切换 → 更新 `html[data-theme]` → 保存 localStorage → 触发 `theme-change` 自定义事件
- 动画：图标旋转 180° + 颜色渐变过渡 300ms

#### 系统偏好监听

```typescript
// 监听系统主题变化
const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
mediaQuery.addEventListener("change", (e) => {
  if (!localStorage.getItem("theme")) {
    setTheme(e.matches ? "dark" : "light");
  }
});
```

### 3.5 各页面主题适配要点

| 页面 | 夜间模式 | 日间模式 |
|------|----------|----------|
| **首页英雄区** | 暗月蓝渐变背景 + 粒子动画 | 明亮蓝渐变 + 柔和几何图案 |
| **课程创建表单** | 暗色卡片 + 暗月蓝边框 glow | 白色卡片 + 明亮蓝边框 + 柔和阴影 |
| **进度条** | 暗月蓝渐变 + 微光脉冲 | 明亮蓝渐变 + 平滑动画 |
| **课程总览页** | 暗色面板 + 暗月青/暗月金/暗月红状态徽章 | 白色面板 + 明亮绿/琥珀/红状态徽章 |
| **阅读器内容区** | `#14141f` 背景 + 月白文字 + 暗月青代码高亮 | `#fefefe` 背景 + 深墨蓝文字 + 明亮青绿代码高亮 |
| **AI问答边栏** | 用户消息暗月蓝边框 + AI消息暗色背景 | 用户消息明亮蓝边框 + AI消息浅灰背景 |
| **Markdown公式** | KaTeX 自动适配（文字色跟随 `--text-primary`） | KaTeX 自动适配 |
| **代码块** | 暗月主题语法高亮（暗背景+高饱和语法色） | 明亮主题语法高亮（浅背景+标准语法色） |
| **导航栏** | 毛玻璃暗色 + 暗月蓝下划线指示 | 毛玻璃白色 + 明亮蓝下划线指示 |

### 3.6 代码块语法高亮双主题

使用 `react-markdown` + `rehype-highlight` 或 `react-syntax-highlighter`，配置两套主题：

- **夜间**：自定义暗色主题（类似 One Dark / Dracula 暗色变体），背景 `#0d0d14`，关键字暗月蓝/暗月紫/暗月青
- **日间**：标准明亮主题（类似 GitHub Light），背景 `#f1f5f9`

切换逻辑：通过 `data-theme` 属性选择对应 CSS 类名。

---

## 四、页面结构

### 4.1 全局布局

```
┌─────────────────────────────────────────────┐
│  导航栏 (固定顶部, 毛玻璃, 主题切换按钮)        │
├─────────────────────────────────────────────┤
│                                             │
│              页面内容区域                      │
│                                             │
├─────────────────────────────────────────────┤
│  页脚 (暗色/亮色适配)                         │
└─────────────────────────────────────────────┘
```

### 4.2 首页（Landing）

- **英雄区**：全屏高度，暗月蓝/明亮蓝渐变背景（跟随主题），动态粒子/几何图案，产品 Slogan + CTA按钮
- **功能展示**：三列卡片展示核心功能（AI协同、个性化学习、锚定问答）
- **主题演示**：一个小型交互区域，展示日间/夜间切换效果（吸引用户注意主题功能）
- **底部CTA**：引导进入课程创建

### 4.3 课程创建页

- **表单区域**：暗色/亮色卡片布局，输入框带品牌色聚焦 glow
- **进度指示**：生成过程中的暗月蓝/明亮蓝渐变进度条，带脉冲动画
- **代理状态面板**（可选高级视图）：显示当前哪个MAOL代理正在工作（搜集者→架构师→写作者...）
- **主题适配**：所有表单元素、下拉框、滑块均适配双主题

### 4.4 课程总览页

- **左侧**：课程信息面板（Course Bible摘要、学习目标、前置知识）
- **右侧**：章节列表
  - 每章显示：标题、描述、预计学习时间、状态徽章
  - 状态颜色：pending(灰)、gathering(暗月蓝/明亮蓝闪烁)、writing(暗月紫/明亮紫)、polishing(暗月青/明亮青闪烁)、reviewing(暗月金/琥珀)、ready(暗月青/明亮绿)、failed(暗月红/明亮红)、needs-review(暗月黄/琥珀)
  - 质量评分：hover 显示各代理参与记录和质量元数据
- **主题适配**：面板背景、文字、徽章颜色全部跟随主题变量

### 4.5 阅读器页（三栏布局）

```
┌──────────┬──────────────────────┬──────────┐
│          │                      │          │
│  章节导航  │    教材内容阅读区      │ AI问答边栏 │
│ (可折叠)  │   (Markdown+LaTeX)    │          │
│          │                      │          │
│ 暗色/亮色 │     暗色/亮色背景      │ 暗色/亮色  │
│ 树形结构  │    月白/深墨蓝文字     │ 气泡对话   │
│          │                      │          │
└──────────┴──────────────────────┴──────────┘
```

- **左栏**：章节导航树，当前章节高亮（暗月蓝/明亮蓝），可折叠
- **中栏**：
  - 内容区背景跟随 `--bg-reader`
  - Markdown 渲染：标题、段落、列表、表格、代码块、公式全部适配主题
  - 代码块：双主题语法高亮
  - 公式：KaTeX 渲染，文字色跟随 CSS 变量
  - 选中文字：暗月蓝/明亮蓝半透明高亮背景，触发AI问答
- **右栏**：
  - AI问答边栏，对话气泡
  - 用户消息：暗月蓝/明亮蓝左边框 + 对应背景色
  - AI消息：暗色/浅色背景
  - 输入框：底部固定，聚焦时品牌色 glow

### 4.6 全局导航栏

- **固定顶部**，高度 64px
- **毛玻璃效果**：`backdrop-blur: 12px` + `--glass-bg`
- **左侧**：Logo + 产品名
- **中间**：导航链接（首页、我的课程、关于）
- **右侧**：
  - 主题切换按钮（日月图标，圆形，悬浮 glow）
  - 设置入口（齿轮图标）
- **当前页面指示**：底部 2px 品牌色下划线

---

## 五、Multi-Agent Orchestration Layer (MAOL)

### 5.1 架构概述

MAOL 是一个可配置的、模型无关的多智能体协作框架。每个"代号"是一个角色定义，运行时通过环境变量配置映射到具体的模型API。

```
┌─────────────────────────────────────────────────────────────┐
│                    用户界面 (双主题适配)                        │
│  首页 → 创建页 → 总览页 → 阅读器 → AI问答边栏                  │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│              Multi-Agent Orchestration Layer                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Job Dispatcher│  │ State Manager│  │Result Integrator│   │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                              │                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │GATHERER │ │ARCHITECT│ │ AUTHOR  │ │POLISHER │          │
│  │(搜集者)  │ │(架构师)  │ │(写作者)  │ │(美化者)  │          │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                       │
│  │REVIEWER │ │  TUTOR  │ │ASSISTANT│                       │
│  │(审查者)  │ │(导师)   │ │(助手)   │                       │
│  └─────────┘ └─────────┘ └─────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Agent Registry（代理注册表）

7个核心代理代号及默认推荐配置：

| 代号 | 角色名 | 核心职责 | 推荐模型 | 能力标签 |
|------|--------|----------|----------|----------|
| **GATHERER** | 搜集者 | 文献检索、资料收集、术语定义、前置知识梳理、实时信息获取 | Gemini, Grok | search, research, real-time, knowledge-base |
| **ARCHITECT** | 架构师 | 课程大纲设计、Course Bible生成、章节依赖规划、学习路径设计、教学策略制定 | GPT-4, Claude | planning, structure, design, reasoning |
| **AUTHOR** | 写作者 | 核心教材章节内容生成、知识单元撰写、直觉解释、公式推导、案例编写 | GPT-4, Claude | writing, long-context, reasoning, technical |
| **POLISHER** | 美化者 | LaTeX格式化、Markdown清洗、排版美化、语言润色、公式规范化、代码块格式化 | Kimi, Claude | formatting, chinese, latex, language |
| **REVIEWER** | 审查者 | 事实核查、逻辑审查、一致性检查、错误标记、质量评分、常识性错误拦截 | DeepSeek, Claude | reasoning, review, fact-check, critique |
| **TUTOR** | 导师 | AI问答边栏、答疑、解释、引导式教学、苏格拉底式提问、学习诊断 | Claude, GPT-4 | conversation, teaching, empathy, guidance |
| **ASSISTANT** | 助手 | 数据转换、格式转换、元数据管理、状态同步、轻量任务、日志记录、结果聚合 | Mimo, 轻量模型 | utility, transform, sync, orchestration |

代理配置结构（TypeScript）：

```typescript
type AgentConfig = {
  codeName: string;           // 代号
  roleName: string;           // 角色名
  description: string;        // 职责描述
  modelProvider: string;      // 模型提供商标识
  modelName: string;          // 具体模型名称
  apiBaseUrl: string;         // API基础地址
  apiKey: string;             // API密钥（从环境变量读取）
  temperature: number;        // 温度参数
  maxTokens: number;          // 最大token数
  systemPrompt: string;       // 系统提示词（角色定义）
  capabilities: string[];     // 能力标签
  fallbackAgent?: string;     // 失败时的备用代理代号
  timeoutMs: number;          // 超时时间
  retryAttempts: number;      // 重试次数
};
```

### 5.3 环境变量配置模板

在 `.env.example` 中提供完整配置：

```env
# ============================================
# MAOL - Multi-Agent Orchestration Layer
# 每个代理可独立配置模型、API、参数
# 修改后重启服务即可生效，无需改代码
# ============================================

# --- GATHERER 搜集者 ---
GATHERER_API_BASE_URL=https://api.yzccc.cloud/v1
GATHERER_API_KEY=your_gatherer_key
GATHERER_MODEL=gemini-3.1-pro-preview
GATHERER_TEMPERATURE=0.3
GATHERER_MAX_TOKENS=8192

# --- ARCHITECT 架构师 ---
ARCHITECT_API_BASE_URL=https://api.openai.com/v1
ARCHITECT_API_KEY=your_architect_key
ARCHITECT_MODEL=gpt-4o
ARCHITECT_TEMPERATURE=0.4
ARCHITECT_MAX_TOKENS=16384

# --- AUTHOR 写作者 ---
AUTHOR_API_BASE_URL=https://api.openai.com/v1
AUTHOR_API_KEY=your_author_key
AUTHOR_MODEL=gpt-4o
AUTHOR_TEMPERATURE=0.45
AUTHOR_MAX_TOKENS=24576

# --- POLISHER 美化者 ---
POLISHER_API_BASE_URL=https://api.moonshot.cn/v1
POLISHER_API_KEY=your_polisher_key
POLISHER_MODEL=kimi-latest
POLISHER_TEMPERATURE=0.3
POLISHER_MAX_TOKENS=16384

# --- REVIEWER 审查者 ---
REVIEWER_API_BASE_URL=https://api.deepseek.com/v1
REVIEWER_API_KEY=your_reviewer_key
REVIEWER_MODEL=deepseek-reasoner
REVIEWER_TEMPERATURE=0.2
REVIEWER_MAX_TOKENS=16384

# --- TUTOR 导师 ---
TUTOR_API_BASE_URL=https://api.anthropic.com/v1
TUTOR_API_KEY=your_tutor_key
TUTOR_MODEL=claude-3-7-sonnet-20250219
TUTOR_TEMPERATURE=0.5
TUTOR_MAX_TOKENS=8192

# --- ASSISTANT 助手 ---
ASSISTANT_API_BASE_URL=https://api.yzccc.cloud/v1
ASSISTANT_API_KEY=your_assistant_key
ASSISTANT_MODEL=gemini-2.0-flash
ASSISTANT_TEMPERATURE=0.2
ASSISTANT_MAX_TOKENS=4096
```

### 5.4 Job Dispatcher（任务分发器）

三种执行模式：

**串行模式 (Sequential)**：任务按顺序执行，前一个输出作为后一个输入
```
ARCHITECT 生成大纲 → AUTHOR 按大纲写章节 → POLISHER 美化 → REVIEWER 审查
```

**并行模式 (Parallel)**：多个代理同时执行不同子任务，结果合并
```
GATHERER 同时搜集多个章节的前置资料
```

**条件分支模式 (Conditional)**：根据中间结果决定下一步
```
REVIEWER 评分 < 80 → 返回 AUTHOR 重写
REVIEWER 评分 >= 80 → 进入 POLISHER
```

任务定义结构：

```typescript
type Job = {
  jobId: string;
  jobType: "course-creation" | "chapter-generation" | "chapter-polish" | "qa-session" | "fact-check";
  executionMode: "sequential" | "parallel" | "conditional";
  steps: JobStep[];
  sharedContext: JobContext;
  timeoutMs: number;
};

type JobStep = {
  stepId: string;
  agentCodeName: string;
  taskDescription: string;
  inputTemplate: string;
  outputSchema?: ZodSchema;
  condition?: {
    field: string;
    operator: "gt" | "lt" | "eq" | "contains";
    value: any;
    trueNext?: string;
    falseNext?: string;
  };
  retryPolicy: {
    maxAttempts: number;
    backoffMultiplier: number;
  };
};
```

### 5.5 State Manager（状态管理器）

维护所有代理共享的上下文：

```typescript
type SharedContext = {
  courseBible: CourseBible;
  terminology: Map<string, TermDefinition>;
  chapterStates: Map<string, ChapterState>;
  generationHistory: GenerationLog[];
  qualityReports: QualityReport[];
};

type ChapterState = {
  chapterId: string;
  status: "pending" | "gathering" | "writing" | "polishing" | "reviewing" | "ready" | "failed" | "needs-review";
  assignedAgents: string[];
  contentVersions: ContentVersion[];
  currentQuality: ChapterQuality;
};
```

关键规则：
- Course Bible 和术语表是**全局只读约束**
- 每个代理只能读写其职责范围内的状态字段
- 所有代理操作记录审计日志

### 5.6 Result Integrator（结果整合器）

- **内容合并**：AUTHOR 原始内容 + POLISHER 格式化修改 → 最终内容
- **冲突检测**：REVIEWER 标记错误 → 自动触发修正循环
- **版本管理**：保留每个代理原始输出，支持回溯对比
- **元数据附加**：生成溯源信息（哪些代理参与、各代理贡献度）

### 5.7 统一调用接口

```typescript
// src/lib/maol/client.ts

// 生成课程（多代理协作）
async function generateCourse(input: CourseInput): Promise<Course>

// 生成单章（多代理协作）
async function generateChapter(course: Course, chapterIndex: number): Promise<Chapter>

// AI问答（TUTOR代理）
async function askTutor(context: TutorContext, question: string): Promise<string>

// 事实核查（REVIEWER代理）
async function factCheck(content: string, domain: string): Promise<FactCheckResult>
```

内部自动处理：代理选择 → 提示词组装 → API调用 → 结果解析 → 质量检查 → 状态更新

---

## 六、Textbook Quality Harness (TQH)

### 6.1 架构定位

TQH 嵌入在 MAOL 的每个代理输出之后，作为强制检查关卡。确保无论接入任何AI模型，最终教材都满足：

- 结构完整（知识单元、公式、案例、练习齐全）
- 逻辑连贯（章节衔接、术语一致、叙事统一）
- 格式规范（LaTeX正确、Markdown标准、排版美观）
- 事实可靠（无常识错误、数学公式语法正确、代码可运行）

### 6.2 代理专属质量关卡

| 代理 | 输出后检查 | 检查者 |
|------|-----------|--------|
| GATHERER | 资料完整性、来源可信度、术语准确性 | ASSISTANT（轻量） |
| ARCHITECT | 大纲逻辑性、依赖合理性、时间分配 | REVIEWER |
| AUTHOR | 结构完整性、知识单元质量、连续性、字数 | REVIEWER + Auto-QA |
| POLISHER | 格式正确性、LaTeX语法、排版一致性 | ASSISTANT（轻量） |
| REVIEWER | 审查报告自洽性 | ASSISTANT（轻量） |
| TUTOR | 回答相关性、安全性、不偏离教材 | ASSISTANT（轻量） |

### 6.3 自动质量检查管道（Auto-QA Pipeline）

纯代码检查，不依赖AI模型：

**结构检查器 (StructureValidator)**
- 章节知识单元数量 >= 4
- 每个知识单元包含：直觉解释、正式定义、公式/推导、例子、常见误区
- 包含代码/实践案例、练习题、开放式项目任务
- 字数 8,000-12,000 中文字符

**格式检查器 (FormatValidator)**
- LaTeX 公式格式：块级公式前后空行、无 \[ \] 混用
- Markdown 结构：标题层级正确、列表格式正确
- 代码块：带语言标识、语法基本正确

**连续性检查器 (ContinuityValidator)**
- 与上一章 connectionFromPrevious 存在且合理
- 为下一章 setupForNext 存在且合理
- 术语使用与 Course Bible 一致

**事实轻量检查器 (FactLiteValidator)**
- 数学公式静态语法校验（括号匹配、常见错误模式）
- 代码示例基本结构检查
- 明显常识错误模式匹配

### 6.4 质量评分与自修正循环

```typescript
type ChapterQuality = {
  structureScore: number;      // 0-100
  continuityScore: number;     // 0-100
  formatScore: number;          // 0-100
  factCheckFlags: string[];    // 标记项
  overallScore: number;         // 加权总分
  reviewStatus: "passed" | "needs-review" | "failed";
  agentTrace: AgentTrace[];     // 各代理参与记录
  correctionRounds: number;   // 自修正轮数
};
```

自修正循环：
```
AUTHOR生成 → Auto-QA检查 → 发现问题 → 构造修正提示词 → AUTHOR重写 → 再次检查
```
- 最多2轮自修正
- 仍不通过则标记 "needs-review" 或 "failed"
- 修正提示词自动注入：具体错误描述 + Course Bible 约束 + 术语定义

### 6.5 Course Bible 守卫 (BibleGuardian)

- **术语一致性**：所有术语必须在 Course Bible terminology 中有定义，或标注"新引入"
- **教学风格一致性**：所有章节使用 Course Bible 定义的 teachingStyle
- **叙事一致性**：所有章节服务于 Course Bible 的 globalNarrative
- **前置依赖检查**：生成前自动检查 dependsOn 章节是否已 ready

---

## 七、提示词模板引擎

在 `src/lib/prompts/` 下为每个代理定义专属模板：

| 文件 | 代理 | 用途 |
|------|------|------|
| `agents/gatherer.ts` | GATHERER | 文献检索、资料搜集提示词 |
| `agents/architect.ts` | ARCHITECT | 课程架构、大纲设计提示词 |
| `agents/author.ts` | AUTHOR | 章节写作、知识单元生成提示词 |
| `agents/polisher.ts` | POLISHER | 格式化、LaTeX清洗、排版提示词 |
| `agents/reviewer.ts` | REVIEWER | 审查、评分、错误标记提示词 |
| `agents/tutor.ts` | TUTOR | 问答、答疑、引导式教学提示词 |

每个模板包含：
- 角色定义（系统提示词）
- 输出格式规范
- 质量约束
- 负向约束
- 动态变量插槽（Course Bible、章节上下文等）

---

## 八、核心工作流定义

### 工作流A：课程创建（Course Creation）

```
用户输入 → ASSISTANT(预处理/格式化输入)
    ↓
GATHERER(并行搜集：主题资料、术语定义、前置知识、最新进展)
    ↓
ASSISTANT(聚合搜集结果，构建术语表草稿)
    ↓
ARCHITECT(基于术语表设计 Course Bible + 大纲 + 章节依赖)
    ↓
REVIEWER(审查大纲逻辑性、依赖合理性)
    ↓ [评分>=80]
AUTHOR(基于 Course Bible 生成第一章内容)
    ↓
POLISHER(格式化：LaTeX、Markdown、排版)
    ↓
Auto-QA Pipeline(结构/格式/连续性检查)
    ↓
REVIEWER(深度审查：事实、逻辑、一致性)
    ↓ [评分>=80]
最终内容 → 存储 + 返回用户
    ↓ [评分<80]
AUTHOR(自修正重写，注入审查意见)
```

### 工作流B：章节生成（Chapter Generation）

```
用户请求第N章 → ASSISTANT(检查前置依赖：第N-1章是否ready)
    ↓ [依赖满足]
GATHERER(搜集本章专项资料)
    ↓
AUTHOR(基于 Course Bible + 上下文生成内容)
    ↓
POLISHER(格式化)
    ↓
Auto-QA Pipeline(自动检查)
    ↓
REVIEWER(深度审查)
    ↓ [通过]
存储 + 标记ready
```

### 工作流C：AI问答（Q&A Session）

```
用户选中文字/提问 → ASSISTANT(构建上下文：选中内容、课程信息、对话历史)
    ↓
TUTOR(基于上下文生成回答)
    ↓
ASSISTANT(轻量检查：相关性、安全性、格式)
    ↓
返回用户
```

---

## 九、协作工作流程（开发执行步骤）

请严格按照以下步骤执行：

### 步骤1：设计阶段

派出 **designer agent** (`Agent(subagent_type="plan")`)，输出以下设计文档：

- `design/design.md` — 暗月主题 + 日间模式视觉设计系统（颜色、字体、间距、动画、响应式规则）
- `design/maol-architecture.md` — MAOL 架构设计（代理注册表、任务分发器、状态管理器、结果整合器接口定义）
- `design/tqh-spec.md` — TQH 规范（质量检查管道、评分标准、自修正循环逻辑）
- `design/theme-system.md` — 日间/夜间模式切换系统设计（CSS变量、切换机制、各组件适配规则）

### 步骤2：MAOL + TQH 核心层阶段（最高优先级）

派出 **coder agent** 实现以下核心基础设施：

- `src/lib/maol/` 完整架构：
  - `registry.ts` — Agent Registry（代理注册、配置加载、环境变量解析）
  - `dispatcher.ts` — Job Dispatcher（串行/并行/条件分支执行）
  - `state.ts` — State Manager（共享上下文、章节状态、审计日志）
  - `integrator.ts` — Result Integrator（内容合并、冲突检测、版本管理）
  - `client.ts` — 统一调用接口（generateCourse / generateChapter / askTutor / factCheck）
  - `types.ts` — MAOL 类型定义

- `src/lib/prompts/` 模板引擎：
  - `engine.ts` — 模板组合器、变量插值
  - `agents/gatherer.ts` — GATHERER 提示词模板
  - `agents/architect.ts` — ARCHITECT 提示词模板
  - `agents/author.ts` — AUTHOR 提示词模板
  - `agents/polisher.ts` — POLISHER 提示词模板
  - `agents/reviewer.ts` — REVIEWER 提示词模板
  - `agents/tutor.ts` — TUTOR 提示词模板

- `src/lib/quality/` 自动检查管道：
  - `pipeline.ts` — 质量检查管道编排
  - `structure.ts` — StructureValidator
  - `format.ts` — FormatValidator
  - `continuity.ts` — ContinuityValidator
  - `fact-lite.ts` — FactLiteValidator
  - `types.ts` — 质量评分类型定义

- `src/lib/theme.ts` — 主题系统核心：
  - 系统偏好检测
  - localStorage 持久化
  - `data-theme` 属性管理
  - 主题切换事件系统

- 编写单元测试确保 MAOL、TQH、Theme 核心逻辑正确

### 步骤3：脚手架阶段

派出 **coder agent** 初始化项目基础：

- Next.js 项目初始化（保留现有项目结构）
- 安装 shadcn/ui、Tailwind CSS
- 配置 Tailwind 支持 CSS 变量主题系统（`tailwind.config.ts` 中扩展 colors 使用 `var(--*)`）
- 配置全局暗色/亮色主题 CSS（`src/app/globals.css`）
- 创建共享布局组件：
  - `src/components/layout/Navbar.tsx` — 导航栏（含主题切换按钮）
  - `src/components/layout/Footer.tsx` — 页脚
  - `src/components/layout/ThemeProvider.tsx` — 主题上下文 Provider
  - `src/components/ui/ThemeToggle.tsx` — 主题切换按钮组件
- 创建 `src/app/layout.tsx` 全局布局（包裹 ThemeProvider）
- 提交基线 commit

### 步骤4：页面实现阶段（并行）

派出多个 **coder agent** 并行实现：

**Agent A — 首页 + 课程创建页**
- 首页英雄区（双主题渐变背景、粒子动画、主题演示交互区）
- 课程创建表单（暗色/亮色卡片、品牌色聚焦 glow、进度条）
- 集成 MAOL 课程创建工作流
- 代理状态面板（可选高级视图，显示当前活跃代理）

**Agent B — 课程总览页**
- 左侧课程信息面板（Course Bible 摘要、学习目标）
- 右侧章节列表（状态徽章、质量评分 hover 显示、代理溯源）
- 章节状态颜色适配双主题
- 质量元数据展示

**Agent C — 阅读器页**
- 三栏布局（左导航/中内容/右AI问答）
- Markdown 渲染组件（双主题适配：文字色、代码块高亮、公式颜色）
- 代码块语法高亮双主题（暗色/亮色）
- KaTeX 公式渲染主题适配
- 选中文字触发AI问答（暗月蓝/明亮蓝高亮）
- AI问答边栏（用户消息品牌色边框、AI消息对应主题背景）

**Agent D — API路由重构**
- `src/app/api/courses/route.ts` — 使用 MAOL Client 替代直接 generateText
- `src/app/api/chapters/route.ts` — 使用 MAOL Client + TQH 管道
- `src/app/api/annotations/route.ts` — 使用 MAOL Client TUTOR 工作流
- 保留原有提示词核心教学逻辑，迁移到 Prompt Template Engine

### 步骤5：集成阶段

主 agent 负责：

- 合并所有分支
- 解决冲突
- 确保 MAOL 各层正确串联
- 确保主题系统全局生效（所有页面、组件、Markdown渲染、代码块、公式）
- 确保路由正确连接

### 步骤6：验证阶段

执行以下验证：

- `npm run build` 通过，无编译错误
- `npm run lint` 通过，无 ESLint 错误
- **主题切换验证**：
  - 首页日间/夜间切换无闪烁
  - 所有页面跟随主题变量正确变色
  - 代码块语法高亮随主题切换
  - KaTeX 公式文字色随主题切换
  - localStorage 持久化正确
  - 系统偏好变化自动响应（清除 localStorage 后测试）
- **MAOL 工作流验证**：
  - 工作流A：创建课程 → 观察多代理协作日志 → 检查第一章质量
  - 工作流B：生成后续章节 → 检查依赖验证
  - 工作流C：AI问答 → 检查 TUTOR 回答质量
- **TQH 验证**：
  - 结构检查正确拦截缺失知识单元的章节
  - 格式检查正确标记 LaTeX 错误
  - 自修正循环能修复可修复的问题
- **配置切换验证**：
  - 修改 `.env` 中某个代理的模型 → 重启后正常工作
  - 切换为 mock 模式（无API key）→ 降级到 mock 数据

---

## 十、重要约束

### 10.1 模型无关性

MAOL 架构必须完全模型无关。切换任何代理的 API 配置（模型名称、API地址、密钥）后，**零代码改动**即可工作。所有代理差异通过 `AgentConfig` 抽象屏蔽。

### 10.2 向后兼容

- 现有数据模型 `Course` / `Chapter` / `CourseBible` 不变
- 仅扩展 `Chapter` 类型添加 `quality?: ChapterQuality` 字段
- 现有 localStorage 数据格式兼容（旧数据无 quality 字段时显示默认状态）

### 10.3 存储机制

- 所有数据仍存 localStorage
- `quality` 元数据一并存入 localStorage
- 主题偏好 `theme: "light" | "dark"` 存入 localStorage

### 10.4 降级策略

- 任何代理失败时自动切换到 `fallbackAgent`
- 全部失败时标记章节为 `failed` 并记录原因
- 无 API key 时自动降级到 mock 数据（现有逻辑保留）

### 10.5 审计日志

每个代理的每次调用记录日志：
- 时间戳
- 代理代号
- 输入摘要（前200字符）
- 输出摘要（前200字符）
- 耗时（ms）
- 质量评分（如适用）
- 成功/失败状态

### 10.6 主题系统约束

- 所有 UI 组件必须使用 CSS 变量或 Tailwind dark 变体，**禁止硬编码颜色**
- 不再使用 plain CSS，全部使用 Tailwind + CSS 变量
- 代码块语法高亮必须实现双主题（暗色/亮色）
- KaTeX 公式渲染必须通过 CSS 变量适配文字色
- 主题切换动画过渡时间 300ms，使用 `transition-colors`

### 10.7 环境变量

`.env.example` 中必须提供：
- 所有 7 个代理的完整配置模板
- 主题系统无额外环境变量（纯前端 localStorage）

---

## 十一、文件结构目标

```
D:\LearnByAI
├── .env.example              # 7个代理配置模板
├── design/
│   ├── design.md             # 视觉设计系统
│   ├── maol-architecture.md  # MAOL架构设计
│   ├── tqh-spec.md           # TQH规范
│   └── theme-system.md       # 主题系统设计
├── src/
│   ├── app/
│   │   ├── page.tsx          # 首页
│   │   ├── layout.tsx        # 全局布局（ThemeProvider）
│   │   ├── globals.css       # 主题CSS变量 + Tailwind
│   │   ├── courses/
│   │   │   └── [id]/
│   │   │       └── page.tsx  # 课程总览页
│   │   ├── courses/[id]/chapters/[chapterId]/
│   │   │   └── page.tsx      # 阅读器页
│   │   └── api/
│   │       ├── courses/route.ts      # MAOL集成
│   │       ├── chapters/route.ts     # MAOL+TQH集成
│   │       └── annotations/route.ts  # TUTOR工作流
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Navbar.tsx          # 导航栏（含ThemeToggle）
│   │   │   ├── Footer.tsx
│   │   │   └── ThemeProvider.tsx   # 主题上下文
│   │   ├── ui/
│   │   │   └── ThemeToggle.tsx     # 主题切换按钮
│   │   ├── MarkdownContent.tsx     # Markdown渲染（双主题）
│   │   └── ...
│   ├── lib/
│   │   ├── maol/
│   │   │   ├── types.ts
│   │   │   ├── registry.ts
│   │   │   ├── dispatcher.ts
│   │   │   ├── state.ts
│   │   │   ├── integrator.ts
│   │   │   └── client.ts
│   │   ├── prompts/
│   │   │   ├── engine.ts
│   │   │   └── agents/
│   │   │       ├── gatherer.ts
│   │   │       ├── architect.ts
│   │   │       ├── author.ts
│   │   │       ├── polisher.ts
│   │   │       ├── reviewer.ts
│   │   │       └── tutor.ts
│   │   ├── quality/
│   │   │   ├── types.ts
│   │   │   ├── pipeline.ts
│   │   │   ├── structure.ts
│   │   │   ├── format.ts
│   │   │   ├── continuity.ts
│   │   │   └── fact-lite.ts
│   │   ├── theme.ts              # 主题系统核心
│   │   ├── ai.ts                 # 重构为MAOL适配层
│   │   ├── types.ts              # 扩展ChapterQuality
│   │   ├── storage.ts            # localStorage（扩展theme/quality）
│   │   └── ...
│   └── ...
├── docs/
│   └── DEVELOPMENT.md          # 更新开发文档
├── tailwind.config.ts          # 扩展CSS变量支持
└── ...
```

---

## 十二、验收标准

### 12.1 功能验收

- [ ] 日间/夜间模式切换无闪烁，所有页面正确响应
- [ ] 主题偏好持久化到 localStorage，刷新后保持
- [ ] 系统偏好变化自动响应（未手动设置时）
- [ ] 课程创建流程完整（表单 → MAOL工作流 → 存储 → 跳转）
- [ ] 章节生成触发正确的工作流B
- [ ] AI问答使用 TUTOR 代理工作流C
- [ ] 质量检查管道正确拦截问题内容
- [ ] 自修正循环能修复可修复问题
- [ ] 代理失败时正确降级到 fallback

### 12.2 视觉验收

- [ ] 夜间模式：深空黑背景 + 月白文字 + 暗月蓝品牌色
- [ ] 日间模式：极浅灰蓝背景 + 深墨蓝文字 + 明亮蓝品牌色
- [ ] 代码块：暗色/亮色语法高亮正确切换
- [ ] 公式：KaTeX 文字色跟随主题变量
- [ ] 导航栏：毛玻璃效果 + 主题适配
- [ ] 阅读器：三栏布局 + 选中文字高亮 + AI问答边栏

### 12.3 架构验收

- [ ] 修改任意代理的 `.env` 配置 → 重启后正常工作
- [ ] 新增代理代号 → 只需添加配置 + 模板，无需改核心代码
- [ ] 切换 mock 模式 → 无API key时正常降级
- [ ] 所有代理调用记录审计日志

---

> **项目路径**：`D:\LearnByAI`
> 
> **执行指令**：请使用多agent协作模式（swarm-coding），严格按照上述步骤执行。MAOL+TQH核心层优先于页面实现。主题系统必须与所有页面同时实现，不得作为后续补丁添加。
