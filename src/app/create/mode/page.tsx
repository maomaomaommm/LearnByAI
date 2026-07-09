"use client";

import Link from "next/link";
import { ArrowLeft, BookOpen, GraduationCap, Timer, Zap } from "lucide-react";

export default function CreateModePage() {
  return (
    <div className="min-h-screen bg-background px-4 py-16">
      <div className="mx-auto max-w-4xl">
        <Link href="/courses" className="mb-8 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> 返回课程
        </Link>
        <div className="mb-8">
          <h1 className="font-mono text-2xl font-bold text-foreground">选择课程模式</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            先确定内容形态，再填写主题和目标。两种模式都会按你的插图设置自动选择代码渲染图或模型生图。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Link
            href="/create?mode=lecture"
            className="group rounded-lg border border-border bg-card p-6 transition-colors hover:border-foreground/40"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="inline-flex size-10 items-center justify-center rounded-md border border-border bg-background">
                  <Zap size={18} />
                </span>
                <div>
                  <h2 className="font-mono text-lg font-semibold text-foreground">讲义模式</h2>
                  <p className="text-xs text-muted-foreground">快速生成，适合先建立知识地图</p>
                </div>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2"><Timer size={15} className="mt-0.5 shrink-0" /> 生成更快，适合入门、复习和快速了解领域。</li>
              <li className="flex gap-2"><BookOpen size={15} className="mt-0.5 shrink-0" /> 保留当前 LearnByAI 的课程体验。</li>
              <li className="flex gap-2"><GraduationCap size={15} className="mt-0.5 shrink-0" /> 内容更像讲义和学习路线。</li>
            </ul>
          </Link>

          <Link
            href="/create?mode=textbook"
            className="group rounded-lg border border-border bg-card p-6 transition-colors hover:border-foreground/40"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="inline-flex size-10 items-center justify-center rounded-md border border-border bg-background">
                  <BookOpen size={18} />
                </span>
                <div>
                  <h2 className="font-mono text-lg font-semibold text-foreground">教材模式</h2>
                  <p className="text-xs text-muted-foreground">先出大纲，再生成系统教材</p>
                </div>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2"><Timer size={15} className="mt-0.5 shrink-0" /> 生成更慢、消耗更多，内容更完整。</li>
              <li className="flex gap-2"><BookOpen size={15} className="mt-0.5 shrink-0" /> 固定引言和总结，包含全书大纲与小节结构。</li>
              <li className="flex gap-2"><GraduationCap size={15} className="mt-0.5 shrink-0" /> 面向长期系统研读和 TeX/PDF 教材导出。</li>
            </ul>
          </Link>
        </div>
      </div>
    </div>
  );
}
