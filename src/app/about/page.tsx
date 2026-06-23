"use client";

import Link from "next/link";
import {
  BookOpen,
  Github,
  Bot,
  Shield,
  Zap,
  Code2,
} from "lucide-react";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background pt-16">
      <div className="mx-auto max-w-3xl px-4 py-12">
        {/* Header */}
        <div className="mb-12 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <BookOpen size={32} className="text-primary" />
          </div>
          <h1 className="mb-2 font-mono text-3xl font-bold text-foreground">
            LearnByAI
          </h1>
          <p className="text-sm text-muted-foreground">
            AI 个性化学习材料生成平台
          </p>
        </div>

        {/* Description */}
        <div className="mb-12 rounded-lg border border-border bg-card p-6">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            关于项目
          </h2>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            LearnByAI 是一个多 AI Agent 协作的个性化学习平台。用户输入学习主题、
            目标、背景和偏好后，系统会自动调度多个专业 AI Agent 协同完成课程设计、
            教材编写、质量审查等全流程工作。
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            平台采用模型无关的 MAOL（Multi-Agent Orchestration Layer）架构，
            支持通过环境变量自由切换底层 AI 模型，并具备完整的质量保障体系 TQH
            （Textbook Quality Harness），确保每章教材都经过严格的结构、格式、
            连贯性和事实性检查。
          </p>
        </div>

        {/* Tech Stack */}
        <div className="mb-12 rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <Code2 size={16} className="text-primary" />
            <h2 className="text-sm font-semibold text-foreground">技术架构</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                title: "前端",
                items: [
                  "React 19 + TypeScript",
                  "Tailwind CSS + shadcn/ui",
                  "Framer Motion 动画",
                  "Zustand 状态管理",
                ],
              },
              {
                title: "后端",
                items: [
                  "Next.js App Router API",
                  "自定义模型接入",
                ],
              },
              {
                title: "MAOL 多 Agent 编排",
                items: [
                  "7 个专业 AI Agent",
                  "串行/并行/条件执行",
                  "自动回退机制",
                  "完整审计日志",
                ],
              },
              {
                title: "TQH 质量保障",
                items: [
                  "StructureValidator",
                  "FormatValidator",
                  "ContinuityValidator",
                  "FactLiteValidator",
                ],
              },
            ].map((section) => (
              <div key={section.title}>
                <h3 className="mb-2 text-xs font-semibold text-foreground">
                  {section.title}
                </h3>
                <ul className="space-y-1">
                  {section.items.map((item) => (
                    <li
                      key={item}
                      className="text-xs text-muted-foreground"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Agent System */}
        <div className="mb-12 rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <Bot size={16} className="text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              AI Agent 系统
            </h2>
          </div>

          <div className="space-y-3">
            {[
              {
                name: "ASSISTANT",
                desc: "轻量级任务、格式转换、状态同步、日志记录和结果聚合",
              },
              {
                name: "ARCHITECT",
                desc: "生成 Course Bible、课程大纲、章节依赖和教学路径；开启“纳入最新进展”时调用联网检索工具",
              },
              {
                name: "AUTHOR",
                desc: "生成教材正文、案例、公式推导、代码示例、练习题",
              },
              {
                name: "POLISHER",
                desc: "Markdown 清洗、LaTeX 规范化、排版润色和语言优化",
              },
              {
                name: "REVIEWER",
                desc: "事实核查、逻辑检查、一致性检查、质量评分和错误标记",
              },
              {
                name: "TUTOR",
                desc: "阅读器右侧问答、引导式教学、解释和学习诊断",
              },
              {
                name: "REVISER",
                desc: "阅读时按用户要求对选定正文做局部改写与修复，支持历史与撤销",
              },
            ].map((agent) => (
              <div
                key={agent.name}
                className="flex items-start gap-3 rounded-md bg-background p-3"
              >
                <span className="shrink-0 rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {agent.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {agent.desc}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Features */}
        <div className="mb-12 grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: Zap,
              title: "Mock Mode",
              desc: "无需 API Key 即可体验完整功能，使用模拟数据演示全部流程",
            },
            {
              icon: Shield,
              title: "质量保障",
              desc: "每章教材经过 4 维度质量检查，确保内容结构完整、格式规范",
            },
            {
              icon: Bot,
              title: "锚定式答疑",
              desc: "选中教材内容即可向 AI 导师提问，支持多轮对话深入探讨",
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="rounded-lg border border-border bg-card p-4 text-center"
            >
              <feature.icon
                size={20}
                className="mx-auto mb-2 text-primary"
              />
              <h3 className="mb-1 text-xs font-semibold text-foreground">
                {feature.title}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {feature.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Links */}
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <BookOpen size={12} />
            首页
          </Link>
          <span className="text-muted-foreground/30">|</span>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              alert("开源链接即将发布");
            }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Github size={12} />
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
