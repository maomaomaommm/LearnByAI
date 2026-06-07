"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, ChevronRight, Plus } from "lucide-react";
import { apiFetch } from "@/lib/clientApi";
import { getCourses, saveCourse } from "@/lib/storage";
import { Course } from "@/lib/types";

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);

  useEffect(() => {
    setCourses(getCourses());
    apiFetch("/api/courses")
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data) => {
        if (data?.courses) {
          data.courses.forEach((course: Course) => saveCourse(course));
          setCourses(data.courses);
        }
      })
      .catch(() => setCourses(getCourses()));
  }, []);

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="font-mono text-2xl font-bold text-foreground">我的课程</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              登录 Supabase 后这里会读取云端课程；本地开发时使用浏览器草稿。
            </p>
          </div>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm text-background"
          >
            <Plus size={16} /> 创建课程
          </Link>
        </div>

        {courses.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-20 text-center">
            <BookOpen size={32} className="mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">还没有课程。</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {courses.map((course) => (
              <Link
                key={course.id}
                href={`/courses/${course.id}`}
                className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/40"
              >
                <div className="mb-2 flex items-start justify-between gap-4">
                  <h2 className="font-mono text-lg font-semibold text-foreground">{course.topic}</h2>
                  <ChevronRight size={18} className="text-muted-foreground" />
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">{course.goal}</p>
                <p className="mt-4 text-xs text-muted-foreground">
                  {course.chapters.length} 章 · {new Date(course.createdAt).toLocaleString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
