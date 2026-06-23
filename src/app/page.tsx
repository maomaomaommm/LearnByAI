"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  Bot,
  Route,
  MessageSquare,
  Users,
  FileCheck,
  Zap,
  ChevronRight,
} from "lucide-react";
import AsciiCanvas from "@/components/AsciiCanvas";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <HeroSection />

      {/* Core Capabilities */}
      <CapabilitiesSection />

      {/* Process Flow */}
      <ProcessSection />

      {/* CTA Section */}
      <CTASection />
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative flex min-h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Left Panel - Content */}
      <div className="relative z-10 flex w-full flex-col justify-center bg-background px-6 py-24 md:w-[45%] md:px-12 lg:px-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="mb-4 flex items-center gap-2">
            <Sparkles size={16} className="text-yellow-500" />
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              AI 个性化学习材料生成平台
            </span>
          </div>

          <h1 className="mb-6 font-heading text-4xl font-bold leading-tight tracking-tight text-foreground md:text-5xl lg:text-6xl">
            LearnByAI
          </h1>

          <p className="mb-8 max-w-md text-sm leading-relaxed text-muted-foreground">
            多个 AI Agent 协同工作，为你量身打造完整的学习课程。
            从课程设计到教材编写，从质量审查到 AI 答疑，
            每一个学习环节都有专业 AI 保驾护航。
          </p>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/create"
              className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90 transition-opacity"
            >
              创建课程
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/courses"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              查看课程
            </Link>
          </div>

          {/* Stats */}
          <div className="mt-12 grid grid-cols-3 gap-6 border-t border-border pt-6">
            {[
              { value: "7", label: "AI Agent" },
              { value: "∞", label: "学习主题" },
              { value: "100%", label: "个性化" },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="font-mono text-2xl font-bold text-foreground">
                  {stat.value}
                </div>
                <div className="font-mono text-xs text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Right Panel - ASCII Visualization */}
      <div className="relative hidden w-[55%] bg-[#0A0A0A] md:block">
        {/* forceDark guarantees the canvas stays high-contrast black/grey even in light mode */}
        <AsciiCanvas forceDark={true} />
        {/* Overlay gradient for smooth transition from left panel */}
        <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-background to-transparent" />
      </div>
    </section>
  );
}

function CapabilitiesSection() {
  const capabilities = [
    {
      icon: Users,
      title: "多 AI 协同生成教材",
      description:
        "7 个专业 AI Agent 分工协作：ASSISTANT 清洗输入，ARCHITECT 规划课程并可调用联网检索，AUTHOR 编写内容，POLISHER 润色排版，REVIEWER 审查质量；阅读阶段由 TUTOR 答疑、REVISER 局部改写。",
      features: ["智能分工", "联网检索工具", "自动回退机制", "完整审计日志"],
    },
    {
      icon: Route,
      title: "个性化学习路径",
      description:
        "根据你的学习目标、知识背景和可用时间，AI 为你量身定制最优学习路径，生成专属的 Course Bible 和章节大纲。",
      features: ["自适应难度", "前置知识分析", "时间规划", "动态调整"],
    },
    {
      icon: MessageSquare,
      title: "锚定式 AI 答疑",
      description:
        "阅读教材时选中任意文字或双击段落，即可向 AI 导师提问。AI 会结合上下文给出精准解释，支持多轮对话深入探讨。",
      features: ["选中即问", "上下文感知", "多轮对话", "LaTeX 公式支持"],
    },
  ];

  return (
    <section className="border-t border-border px-6 py-24 md:px-12 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-16 text-center"
        >
          <h2 className="mb-3 font-heading text-2xl font-bold text-foreground md:text-3xl">
            三大核心能力
          </h2>
          <p className="text-sm text-muted-foreground">
            多 Agent 协作，让 AI 为你打造专属学习体验
          </p>
        </motion.div>

        <div className="grid gap-8 md:grid-cols-3">
          {capabilities.map((cap, index) => (
            <motion.div
              key={cap.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="rounded-lg border border-border bg-card p-6"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                <cap.icon size={20} className="text-primary" />
              </div>
              <h3 className="mb-2 text-base font-semibold text-foreground">
                {cap.title}
              </h3>
              <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                {cap.description}
              </p>
              <ul className="space-y-1.5">
                {cap.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <ChevronRight size={12} className="text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProcessSection() {
  const steps = [
    {
      agent: "ASSISTANT",
      icon: Bot,
      title: "输入清洗",
      desc: "验证并规范化用户输入",
    },
    {
      agent: "ARCHITECT",
      icon: Route,
      title: "课程设计",
      desc: "生成 Course Bible 和章节大纲；开启最新进展时调用联网检索",
    },
    {
      agent: "AUTHOR",
      icon: Zap,
      title: "内容编写",
      desc: "编写教材、案例和练习题",
    },
    {
      agent: "POLISHER",
      icon: Sparkles,
      title: "排版润色",
      desc: "格式化 Markdown 和 LaTeX",
    },
    {
      agent: "REVIEWER",
      icon: FileCheck,
      title: "质量审查",
      desc: "检查质量并评分",
    },
  ];
  const readingAgents = [
    {
      agent: "TUTOR",
      icon: MessageSquare,
      title: "锚定问答",
      desc: "围绕选中正文或整章进行解释、例子和追问",
    },
    {
      agent: "REVISER",
      icon: Sparkles,
      title: "局部改写",
      desc: "对选定正文生成可审查修改建议，支持应用、历史和撤销",
    },
  ];

  return (
    <section className="border-t border-border px-6 py-24 md:px-12 lg:px-16">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-16 text-center"
        >
          <h2 className="mb-3 font-heading text-2xl font-bold text-foreground md:text-3xl">
            课程生成流程
          </h2>
          <p className="text-sm text-muted-foreground">
            5 个生成阶段，阅读阶段另由 TUTOR / REVISER 接力
          </p>
        </motion.div>

        <div className="relative">
          {/* Connecting line */}
          <div className="absolute left-6 top-0 hidden h-full w-px bg-border md:block" />

          <div className="space-y-6">
            {steps.map((step, index) => (
              <motion.div
                key={step.agent}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.08 }}
                className="relative flex items-start gap-4 md:gap-6"
              >
                <div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-background shadow-sm">
                  <step.icon size={18} className="text-primary" />
                </div>
                <div className="flex-1 rounded-lg border border-border bg-card p-4">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-medium text-primary">
                      {step.agent}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      阶段 {index + 1}
                    </span>
                  </div>
                  <h3 className="mb-1 text-sm font-semibold text-foreground">
                    {step.title}
                  </h3>
                  <p className="text-xs text-muted-foreground">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {readingAgents.map((agent) => (
              <motion.div
                key={agent.agent}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.35 }}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <agent.icon size={16} className="text-primary" />
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-medium text-primary">
                      {agent.agent}
                    </span>
                    <span className="text-xs text-muted-foreground">阅读阶段</span>
                  </div>
                  <h3 className="mb-1 text-sm font-semibold text-foreground">
                    {agent.title}
                  </h3>
                  <p className="text-xs text-muted-foreground">{agent.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="border-t border-border px-6 py-24 md:px-12 lg:px-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="mx-auto max-w-2xl text-center"
      >
        <h2 className="mb-4 font-heading text-2xl font-bold text-foreground md:text-3xl">
          开始你的个性化学习之旅
        </h2>
        <p className="mb-8 text-sm text-muted-foreground">
          输入你想学习的主题，让多个 AI Agent 为你打造专属课程
        </p>
        <Link
          href="/create"
          className="inline-flex items-center gap-2 rounded-md bg-foreground px-6 py-3 text-sm font-medium text-background hover:opacity-90 transition-opacity"
        >
          立即创建课程
          <ArrowRight size={16} />
        </Link>
      </motion.div>
    </section>
  );
}
