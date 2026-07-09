"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, BookOpen, Target, User, Clock, GraduationCap, Loader2, Route, Zap, FileCheck, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/clientApi";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { isSupabaseAuthEnabled, useUser } from "@/lib/hooks/useUser";
import { Course, CourseCreateResponse } from "@/lib/types";
import type { ContentMode } from "@/lib/types";

const DRAFT_KEY = "learnbyai_create_draft";

type CreateDraft = {
  topic?: string;
  goal?: string;
  background?: string;
  styles?: string[];
  learningMode?: string;
  difficulty?: string;
  chapterCountPreset?: string;
  chapterCountCustom?: string;
  generationProfile?: string;
  includeRecentResearch?: boolean;
};

export default function CreateCoursePage() {
  return (
    <Suspense fallback={<CenteredNote text="正在加载创建页..." />}>
      <CreateCourseContent />
    </Suspense>
  );
}

function CreateCourseContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contentMode: ContentMode = searchParams.get("mode") === "textbook" ? "textbook" : "lecture";
  const loginNext = `/login?next=${encodeURIComponent(`/create?mode=${contentMode}`)}`;
  const user = useUser();
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState<CreateDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState("准备生成");

  useEffect(() => {
    setHydrated(true);
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        setDraft(JSON.parse(raw) as CreateDraft);
        window.localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      /* ignore a malformed draft */
    }
  }, []);

  // Guide signed-out visitors to log in / register first, then bring them back
  // here. In local fallback mode there is no auth system at all — never gate,
  // or local users would be bounced to a login page that cannot work.
  const authEnabled = isSupabaseAuthEnabled();
  useEffect(() => {
    if (authEnabled && user === null) router.replace(loginNext);
  }, [authEnabled, user, router, loginNext]);

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

    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData);
    const styles = formData.getAll("styles").map(String);
    const customCount = Number(values.chapterCountCustom);
    const presetCount = Number(values.chapterCountPreset);
    const chapterCount = Number.isFinite(customCount) && customCount > 0
      ? customCount
      : (Number.isFinite(presetCount) && presetCount > 0 ? presetCount : 8);
    const input = {
      contentMode,
      topic: String(values.topic),
      goal: String(values.goal),
      background: String(values.background),
      styles,
      learningMode: String(values.learningMode || "standard"),
      chapterCount,
      difficulty: String(values.difficulty || "intermediate"),
      generationProfile: String(values.generationProfile || "fast"),
      includeRecentResearch: values.includeRecentResearch === "on",
    };

    try {
      const response = await apiFetch("/api/courses", {
        method: "POST",
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Session expired mid-fill — preserve everything and route through login.
          persistDraft(values, styles);
          setError("登录已过期，正在前往登录，你的填写已保留...");
          setLoading(false);
          router.push(loginNext);
          return;
        }
        const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
        throw new Error(data?.error ?? "Course creation failed.");
      }
      const data = (await response.json()) as Course | CourseCreateResponse;
      const course: Course = "course" in data ? data.course : data;

      setProgress(100);
      setProgressStage(contentMode === "textbook" ? "大纲已创建，正在打开确认页" : "生成完成，正在打开课程");

      router.push(contentMode === "textbook" ? `/courses/${course.id}/outline` : `/courses/${course.id}`);
    } catch (error) {
      setError(publicSafeErrorMessage(error, "Course creation failed. Please try again."));
      setLoading(false);
    }
  }

  if (authEnabled && user === undefined) {
    return <CenteredNote text="检查登录状态…" />;
  }
  if (authEnabled && user === null) {
    return <CenteredNote text="创建课程需要登录，正在前往登录 / 注册…" />;
  }

  const styleOptions: [string, string, string][] = [
    ["intuition", "直觉优先", "先讲清“为什么”，建立直觉再形式化"],
    ["example", "例子说明", "例子先行，以例带理"],
    ["rigor", "严谨推导", "完整推导，讲究严谨"],
    ["analogy", "类比通俗", "用熟悉事物打比方，降低门槛"],
    ["code", "公式代码", "公式配可运行代码，理论与实现并行"],
  ];

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
          <h1 className="mb-2 font-mono text-2xl font-bold text-foreground">
            {contentMode === "textbook" ? "定制你的专属教材" : "定制你的专属课程"}
          </h1>
          <p className="mb-4 text-sm text-muted-foreground">
            {contentMode === "textbook"
              ? "教材模式会先生成全书大纲，确认后再分章生成正文。插图会根据你的生图模型配置自动选择模型生图或默认代码渲染。"
              : "让多个 AI Agent 为你量身打造系统的学习内容"}
          </p>
          <div className="mb-8 inline-flex rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            {contentMode === "textbook" ? "教材模式 · 先确认大纲" : "讲义模式 · 快速生成"}
          </div>

          {draft && !loading && (
            <p className="mb-6 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              已恢复你上次的填写，检查后即可继续生成。
            </p>
          )}

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
                  <input name="topic" defaultValue={draft?.topic} placeholder="例如：量子计算、Rust 语言实战、微观经济学" required className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground" />
                </div>

                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <Target size={16} className="text-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">你的具体目标</h2>
                  </div>
                  <textarea name="goal" defaultValue={draft?.goal} placeholder="例如：系统掌握核心概念，能够读懂相关论文，并能用代码独立复现经典算法" required rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground resize-none" />
                </div>

                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <User size={16} className="text-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">你目前的基础</h2>
                  </div>
                  <textarea name="background" defaultValue={draft?.background} placeholder="例如：会 Python 编程，学过大学微积分和线性代数，但没有深入接触过当前领域" required rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground resize-none" />
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="rounded-lg border border-border bg-card p-5 md:col-span-2">
                    <div className="mb-3 flex items-center gap-2">
                      <GraduationCap size={16} className="text-foreground" />
                      <h2 className="text-sm font-semibold text-foreground">
                        讲解风格 <span className="text-xs font-normal text-muted-foreground">（可多选）</span>
                      </h2>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {styleOptions.map(([value, label, description]) => (
                        <label
                          key={value}
                          className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background p-3 text-sm has-[:checked]:border-foreground"
                        >
                          <input type="checkbox" name="styles" value={value} defaultChecked={draft?.styles?.includes(value) ?? false} className="mt-0.5" />
                          <span>
                            <span className="font-medium text-foreground">{label}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">不选或全选 = 均衡讲解；多选时系统会侧重并自然融合，不会让对立风格互相打架。</p>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <GraduationCap size={16} className="text-foreground" />
                      <h2 className="text-sm font-semibold text-foreground">学习方式</h2>
                    </div>
                    <select name="learningMode" defaultValue={draft?.learningMode ?? "standard"} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground">
                      <option value="standard">标准教材 · 系统讲授（默认）</option>
                      <option value="project">项目驱动 · 围绕贯穿项目</option>
                      <option value="exercise">习题驱动 · 问题与练习推进</option>
                      <option value="case">案例驱动 · 真实案例带原理</option>
                    </select>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <GraduationCap size={16} className="text-foreground" />
                      <h2 className="text-sm font-semibold text-foreground">难度基调</h2>
                    </div>
                    <select name="difficulty" defaultValue={draft?.difficulty ?? "intermediate"} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground">
                      <option value="intro">入门科普 · 多铺垫、少推导</option>
                      <option value="intermediate">进阶系统 · 均衡严谨</option>
                      <option value="research">研究前沿 · 直击最新方法</option>
                    </select>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-5 md:col-span-2">
                    <div className="mb-3 flex items-center gap-2">
                      <BookOpen size={16} className="text-foreground" />
                      <h2 className="text-sm font-semibold text-foreground">章节数量</h2>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {[
                        ["5", "精简", "约 5 章，快速建立框架"],
                        ["8", "标准", "约 8 章，推荐"],
                        ["14", "详尽", "约 14 章，系统深入"],
                      ].map(([value, label, description]) => (
                        <label key={value} className="rounded-md border border-border bg-background p-3 text-sm">
                          <input
                            type="radio"
                            name="chapterCountPreset"
                            value={value}
                            defaultChecked={draft ? draft.chapterCountPreset === value : value === "8"}
                            className="mr-2"
                          />
                          <span className="font-medium text-foreground">{label}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <label htmlFor="chapterCountCustom" className="text-xs text-muted-foreground">自定义章节数（可选，3–20）：</label>
                      <input
                        id="chapterCountCustom"
                        name="chapterCountCustom"
                        type="number"
                        min={3}
                        max={20}
                        defaultValue={draft?.chapterCountCustom}
                        placeholder="留空则用上方档位"
                        className="w-40 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-foreground"
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">每章篇幅由系统按难度自适应分配：难点章更长、引入与过渡更精炼。</p>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-5 md:col-span-2">
                    <div className="mb-3 flex items-center gap-2">
                      <Zap size={16} className="text-foreground" />
                      <h2 className="text-sm font-semibold text-foreground">生成模式</h2>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {[
                        ["fast", "快速", "草稿先出，质检在后台进行"],
                        ["deep", "深度", "整章质检通过后再显示"],
                      ].map(([value, label, description]) => (
                        <label key={value} className="rounded-md border border-border bg-background p-3 text-sm">
                          <input
                            type="radio"
                            name="generationProfile"
                            value={value}
                            defaultChecked={draft ? draft.generationProfile === value : value === "fast"}
                            className="mr-2"
                          />
                          <span className="font-medium text-foreground">{label}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-5 md:col-span-2">
                    <label className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        name="includeRecentResearch"
                        defaultChecked={draft?.includeRecentResearch ?? false}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="flex items-center gap-2 font-semibold text-foreground">
                          <Clock size={16} /> 纳入最新进展
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">开启后先联网检索近期论文与方法再规划（耗时略增）；关闭则直接规划。</span>
                      </span>
                    </label>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!hydrated}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-6 py-3 text-sm font-medium text-background hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
                >
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

function persistDraft(values: Record<string, FormDataEntryValue>, styles: string[]) {
  const draft: CreateDraft = {
    topic: String(values.topic ?? ""),
    goal: String(values.goal ?? ""),
    background: String(values.background ?? ""),
    styles,
    learningMode: String(values.learningMode ?? "standard"),
    difficulty: String(values.difficulty ?? "intermediate"),
    chapterCountPreset: values.chapterCountPreset ? String(values.chapterCountPreset) : undefined,
    chapterCountCustom: values.chapterCountCustom ? String(values.chapterCountCustom) : undefined,
    generationProfile: String(values.generationProfile ?? "fast"),
    includeRecentResearch: values.includeRecentResearch === "on",
  };
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage may be unavailable — non-fatal */
  }
}

function CenteredNote({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
        {text}
      </div>
    </div>
  );
}
