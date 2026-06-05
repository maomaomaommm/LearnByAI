# Antigravity 工作记忆区 (Memory Document)

这是 Antigravity AI 助手在此项目的专属上下文记忆文档。它用于记录当前的工作状态、项目目标和关键规范，以便我在整个开发周期中保持连贯性。

## 1. 项目概览 (Project Overview)
- **项目名称**: LearnByAI
- **本地路径**: `d:\LearnByAI`
- **GitHub 仓库**: [maomaomaommm/LearnByAI](https://github.com/maomaomaommm/LearnByAI)
- **技术栈**: Next.js 15, React, npm (从 package-lock.json 推断)
- **当前运行状态**: 本地开发服务器运行中，访问地址 -> http://localhost:3000

## 2. 当前任务与目标 (Current Goals)
- [x] 克隆 GitHub 仓库到本地
- [x] 安装项目依赖 (`npm install`)
- [x] 启动本地开发服务器 (`npm run dev`)
- [ ] 等待分配下一步具体的开发或修改任务

## 3. 约定与规范 (Rules & Guidelines)
- 保持文档与代码同步。
- 遵循现有的代码风格和 Next.js 15 最佳实践。
- 完成重大节点后在此文档中记录状态。

## 4. 项目深度解析 (Project Architecture & Analysis)

基于对代码库的初步分析，本项目的核心机制与架构如下：
- **核心定位**: 一个基于大模型（Gemini 3.1 Pro）的个性化教材生成器与交互式阅读器（MVP阶段）。
- **主要文件结构与功能**:
  - `src/app/page.tsx`: 首页，负责接收用户的学习目标与基础，并触发生成课程大纲。
  - `src/app/courses/`: 动态课程页。这里实现了 README 中提到的“三栏稳定阅读界面”，左侧大纲，中间教材正文，右侧划线问答讨论区。
  - `src/components/MarkdownContent.tsx`: 富文本渲染组件，专门负责将大模型生成的 Markdown + LaTeX 公式转换为漂亮的页面视图（基于 `react-markdown` 和 `rehype-katex`）。
  - `src/lib/ai.ts`: 负责与 `@google/generative-ai` 交互的核心逻辑，代码中锁定了使用 `gemini-3.1-pro-preview`。
  - `src/lib/mock.ts`: 在用户未配置 `AI_API_KEY` 时的本地替身（Mock）数据，让项目在无网络/无 Key 时也能体验主流程。
  - `src/lib/storage.ts`: 本地持久化逻辑，用于保存用户的课程记录和历史对话，防止刷新丢失。
- **技术特点**: 这是一个使用 Next.js App Router 的 AI 应用，大量依赖 `zod` 做数据结构校验，整体状态闭环做得很轻量且自洽。

## 5. 工作日志 (Work Log)
- **2026-06-05**: 初始拉取项目、安装依赖并成功启动。创建本记忆文档。
- **2026-06-05**: 扫描了 `src` 目录下的核心文件，将项目架构分析结果补充到记忆文档中。
- **2026-06-05**: 运行 `git pull` 将本地代码同步到远端最新版本（更新了 README, page.tsx, globals.css 并新增了 docs/DEVELOPMENT.md）。
