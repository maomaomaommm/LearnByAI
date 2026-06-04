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
        <span className="muted">一本真正适合你的教材</span>
      </header>
      <main className="shell hero">
        <section>
          <div className="eyebrow">Personal learning, rewritten</div>
          <h1>
            一本会学习
            <br />
            <em>如何教你</em>的教材
          </h1>
          <p className="hero-copy">
            告诉我们你想掌握什么。我们会根据你的基础与目标设计课程、编写教材，并让每个疑问都留在它产生的位置。
          </p>
        </section>

        <form className={`card form-card ${loading ? "loading" : ""}`} onSubmit={createCourse}>
          <h2>创建你的第一门课程</h2>
          <p>大约需要一分钟，第一章随后生成。</p>
          <div className="field">
            <label htmlFor="topic">你想学习什么？</label>
            <input id="topic" name="topic" defaultValue="生成式 AI" required />
          </div>
          <div className="field">
            <label htmlFor="goal">你的具体目标</label>
            <textarea
              id="goal"
              name="goal"
              defaultValue="理解 Transformer，并能够阅读生成式 AI 相关论文"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="background">你目前的基础</label>
            <textarea
              id="background"
              name="background"
              defaultValue="会 Python，学过基础机器学习，但不熟悉深度学习"
              required
            />
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="preference">偏好的讲解方式</label>
              <select id="preference" name="preference" defaultValue="直觉结合代码和公式">
                <option>直觉结合代码和公式</option>
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
            {loading ? "正在设计课程…" : "生成我的课程"}
          </button>
          {error && <p style={{ color: "#a33", marginTop: 12 }}>{error}</p>}
        </form>
      </main>
    </>
  );
}
