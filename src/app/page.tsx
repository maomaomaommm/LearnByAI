"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { saveCourse } from "@/lib/storage";
import { Course } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function createCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
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
      saveCourse(course);
      router.push(`/courses/${course.id}`);
    } catch {
      setError("Gemini 3.1 Pro 暂时无法生成课程，请稍后重试。");
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
          {error && <p style={{ color: "#a33", marginTop: 12 }}>{error}</p>}
        </form>
      </main>
    </>
  );
}
