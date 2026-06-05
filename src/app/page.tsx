"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { saveCourse } from "@/lib/storage";
import { Course } from "@/lib/types";

export default function Home() {
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
      const response = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(await response.text());
      const course: Course = await response.json();
      setProgress(100);
      setProgressStage("生成完成，正在打开课程");
      saveCourse(course);
      router.push(`/courses/${course.id}`);
    } catch {
      setError("AI 模型暂时无法生成课程，请稍后重试。");
      setLoading(false);
    }
  }

  return (
    <>
      <header className="shell nav">
        <Link href="/" className="brand">
          Learn<span>By</span>AI
        </Link>
        <span className="muted">一本会根据你重写自己的教材</span>
      </header>
      <main className="shell hero">
        <section>
          <div className="eyebrow">Personal textbook system</div>
          <h1>
            生成一门
            <br />
            <em>真正连贯</em>的个人课程
          </h1>
          <p className="hero-copy">
            系统会先生成 Course Bible，再自动编写第一章教材。每一章都知道自己承接什么、引出什么，右侧讨论也支持公式、代码和 Markdown。
          </p>
        </section>

        <form className={`card form-card ${loading ? "loading" : ""}`} onSubmit={createCourse}>
          <h2>创建你的第一门课程</h2>
          <p>会同时生成课程总纲和第一章，可能需要 1–3 分钟。</p>
          <div className="field">
            <label htmlFor="topic">你想学习什么？</label>
            <input id="topic" name="topic" defaultValue="因果推断" required />
          </div>
          <div className="field">
            <label htmlFor="goal">你的具体目标</label>
            <textarea
              id="goal"
              name="goal"
              defaultValue="系统掌握因果推断，能够读懂相关论文，并尝试做方法改进"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="background">你目前的基础</label>
            <textarea
              id="background"
              name="background"
              defaultValue="会 Python，学过概率统计和基础机器学习，但没有系统学过因果推断"
              required
            />
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="preference">偏好的讲解方式</label>
              <select id="preference" name="preference" defaultValue="直觉结合公式、代码和论文案例">
                <option>直觉结合公式、代码和论文案例</option>
                <option>大量具体例子</option>
                <option>严谨数学推导</option>
                <option>项目驱动学习</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="weeklyHours">每周学习时间</label>
              <select id="weeklyHours" name="weeklyHours" defaultValue="6">
                <option value="3">3 小时</option>
                <option value="6">6 小时</option>
                <option value="10">10 小时</option>
              </select>
            </div>
          </div>
          <button className="button" type="submit">
            {loading ? "正在生成课程总纲与第一章…" : "生成我的课程"}
          </button>
          {loading && (
            <div className="progress-card" aria-live="polite">
              <div className="progress-top">
                <strong>{progressStage}</strong>
                <span>{progress}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <p>正在调用 AI 模型。第一章会一起生成并经过格式检查，所以这一步可能需要几分钟。</p>
            </div>
          )}
          {error && <p style={{ color: "#a33", marginTop: 12 }}>{error}</p>}
        </form>
      </main>
    </>
  );
}
