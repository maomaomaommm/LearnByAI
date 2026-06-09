"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, BookOpen, Target, User, Clock, GraduationCap, Loader2, Route, Zap, FileCheck, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/clientApi";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { saveCourse } from "@/lib/storage";
import { Course, CourseCreateResponse } from "@/lib/types";

export default function CreateCoursePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState("准备生成");

  useEffect(() => {
    if (!loading) return;

    const startedAt = Date.now();
    const stages = [
      { at: 0, label: "分析你的目标与基础" },
      { at: 12, label: "生成 Course Bible" },
      { at: 28, label: "规划章节依赖关系" },
      { at: 45, label: "编写第一章教材" },
      { at: 72, label: "检查章节连续性与公式格式" },
      { at: 88, label: "保存课程并准备跳转" },
    ];

    const timer = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const nextProgress = Math.min(95, Math.round(100 * (1 - Math.exp(-elapsed / 95))));
      setProgress(nextProgress);
      const currentStage = stages
        .slice()
        .reverse()
        .find((stage) => nextProgress >= stage.at);
      if (currentStage) setProgressStage(currentStage.label);
    }, 800);

    return () => window.clearInterval(timer);
  }, [loading]);

  async function createCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setProgress(3);
    setProgressStage("分析你的目标与基础");
    
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const input = {
      topic: String(values.topic),
      goal: String(values.goal),
      background: String(values.background),
      preference: String(values.preference),
      weeklyHours: Number(values.weeklyHours),
    };

    try {
      const response = await apiFetch("/api/courses", {
        method: "POST",
        body: JSON.stringify(input),
      });
      
      if (!response.ok) {
        const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
        throw new Error(data?.error ?? "Course creation failed.");
      }
      const data = (await response.json()) as Course | CourseCreateResponse;
      const course: Course = "course" in data ? data.course : data;
      
      setProgress(100);
      setProgressStage("生成完成，正在打开课程");
      saveCourse(course);
      
      router.push(`/courses/${course.id}`);
    } catch (error) {
      setError(publicSafeErrorMessage(error, "Course creation failed. Please try again."));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl mt-8">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={14} /> 返回首页
        </Link>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="mb-2 font-mono text-2xl font-bold text-foreground">定制你的专属课程</h1>
          <p className="mb-8 text-sm text-muted-foreground">让多个 AI Agent 为你量身打造系统的学习内容</p>

          <AnimatePresence mode="wait">
            {!loading ? (
              <motion.form 
                key="form"
                onSubmit={createCourse} 
                className="space-y-5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <BookOpen size={16} className="text-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">你想学习什么？</h2>
                  </div>
                  <input name="topic" placeholder="例如：量子计算、Rust 语言实战、微观经济学" required className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground" />
                </div>

                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <Target size={16} className="text-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">你的具体目标</h2>
                  </div>
                  <textarea name="goal" placeholder="例如：系统掌握核心概念，能够读懂相关论文，并能用代码独立复现经典算法" required rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground resize-none" />
                </div>

                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <User size={16} className="text-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">你目前的基础</h2>
                  </div>
                  <textarea name="background" placeholder="例如：会 Python 编程，学过大学微积分和线性代数，但没有深入接触过当前领域" required rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground resize-none" />
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="rounded-lg border border-border bg-card p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <GraduationCap size={16} className="text-foreground" />
                      <h2 className="text-sm font-semibold text-foreground">偏好的讲解方式</h2>
                    </div>
                    <select name="preference" defaultValue="直觉结合公式、代码和论文案例" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground">
                      <option>直觉结合公式、代码和论文案例</option>
                      <option>大量具体例子</option>
                      <option>严谨数学推导</option>
                      <option>项目驱动学习</option>
                    </select>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <Clock size={16} className="text-foreground" />
                      <h2 className="text-sm font-semibold text-foreground">每周学习时间</h2>
                    </div>
                    <select name="weeklyHours" defaultValue="6" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground">
                      <option value="3">3 小时</option>
                      <option value="6">6 小时</option>
                      <option value="10">10 小时</option>
                    </select>
                  </div>
                </div>

                <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-6 py-3 text-sm font-medium text-background hover:bg-foreground/90 transition-colors">
                  生成我的课程
                  <ArrowRight size={16} />
                </button>
                {error && <p className="text-destructive text-sm mt-2">{error}</p>}
              </motion.form>
            ) : (
              <motion.div 
                key="generating"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 space-y-6"
              >
                <div className="rounded-lg border border-border bg-card p-6 text-center">
                  <Loader2 size={32} className="mx-auto mb-4 animate-spin text-foreground" />
                  <h2 className="mb-2 text-lg font-mono font-semibold text-foreground">AGENT TEAM COLLABORATING</h2>
                  <p className="text-sm font-mono text-muted-foreground uppercase">{progressStage}</p>
                  <div className="mx-auto mt-6 max-w-xs">
                    <div className="h-1 overflow-hidden rounded-full bg-border">
                      <div className="h-full rounded-full bg-foreground transition-all duration-500" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="mt-2 font-mono text-xs text-muted-foreground">{progress}%</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {["ARCHITECT", "AUTHOR", "POLISHER"].map((agent, i) => (
                    <div key={agent} className="flex flex-col items-center justify-center rounded-lg border border-border bg-background p-4">
                      {i === 0 ? <Route size={20} className="mb-2 text-muted-foreground" /> : i === 1 ? <Zap size={20} className="mb-2 text-muted-foreground" /> : <FileCheck size={20} className="mb-2 text-muted-foreground" />}
                      <span className="font-mono text-[10px] font-medium text-foreground">{agent}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
