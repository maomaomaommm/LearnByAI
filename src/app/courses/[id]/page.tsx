"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getCourse } from "@/lib/storage";
import { Course } from "@/lib/types";

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const [course, setCourse] = useState<Course>();

  useEffect(() => setCourse(getCourse(id)), [id]);

  if (!course) {
    return <main className="shell page">正在读取课程…</main>;
  }

  return (
    <>
      <header className="shell nav">
        <Link href="/" className="brand">
          Learn<span>By</span>AI
        </Link>
        <Link href="/" className="button secondary">
          新建课程
        </Link>
      </header>
      <main className="shell page">
        <div className="eyebrow">Your personal syllabus</div>
        <h1 className="page-title">{course.topic}</h1>
        <p className="muted">{course.goal}</p>
        <div className="profile">
          <strong>为你设计的学习策略</strong>
          <p>{course.profile}</p>
        </div>
        <h2>课程目录</h2>
        <div className="chapter-list">
          {course.chapters.map((chapter, index) => (
            <Link
              className="chapter-row"
              href={`/courses/${course.id}/chapters/${chapter.id}`}
              key={chapter.id}
            >
              <div className="chapter-number">{String(index + 1).padStart(2, "0")}</div>
              <div>
                <h3>{chapter.title}</h3>
                <p>{chapter.description}</p>
              </div>
              <span className="muted">{chapter.minutes} 分钟 →</span>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
