"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getCourse } from "@/lib/storage";
import { formatMinutes, totalMinutes } from "@/lib/time";
import { Course } from "@/lib/types";
import { MarkdownContent } from "@/components/MarkdownContent";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Target, Lightbulb, GraduationCap, ArrowLeft, FileText, ChevronRight, Clock } from "lucide-react";

export default function CourseOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const [course, setCourse] = useState<Course>();

  useEffect(() => setCourse(getCourse(id)), [id]);

  if (!course) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        正在读取课程...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={14} /> 返回首页创建课程
          </Link>
          <ThemeToggle />
        </div>

        {/* Course Header */}
        <div className="mb-8 rounded-lg border border-border bg-card p-6 md:p-8">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="font-mono text-2xl font-bold text-foreground md:text-3xl">{course.topic}</h1>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              课程就绪
            </span>
          </div>
          <p className="mb-6 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {course.goal}
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 rounded-md bg-background px-2.5 py-1.5 border border-border">
              <Target size={14} className="text-foreground" /> 目标导向
            </span>
            <span className="flex items-center gap-1 rounded-md bg-background px-2.5 py-1.5 border border-border">
              <GraduationCap size={14} className="text-foreground" /> {course.profile.slice(0, 30)}...
            </span>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          {/* Left: Course Bible */}
          <div className="space-y-6">
            <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">Course Bible</h2>
            
            <BibleSection icon={FileText} title="课程叙事" content={course.courseBible.globalNarrative} />
            
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <Target size={16} className="text-foreground" />
                <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">最终能力</h3>
              </div>
              <ul className="space-y-2">
                {course.courseBible.finalOutcomes.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <ChevronRight size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <Lightbulb size={16} className="text-foreground" />
                <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">前置知识</h3>
              </div>
              <ul className="space-y-2">
                {course.courseBible.prerequisites.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <ChevronRight size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Right: Chapters */}
          <div>
            <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">章节列表</h2>
            <div className="space-y-4">
              {course.chapters.map((chapter, index) => (
                <Link
                  key={chapter.id}
                  href={`/courses/${course.id}/chapters/${chapter.id}`}
                  className="group block rounded-lg border border-border bg-card p-5 transition-all hover:-translate-y-1 hover:border-foreground/30 hover:shadow-md"
                >
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <h3 className="font-mono text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                      <span className="mr-2 text-muted-foreground">{String(index + 1).padStart(2, '0')}.</span>
                      {chapter.title}
                    </h3>
                    <span className="shrink-0 rounded-full bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground border border-border">
                      {chapter.status === "ready" ? "可阅读" : "待生成"}
                    </span>
                  </div>
                  <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">
                    {chapter.description}
                  </p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatMinutes(totalMinutes(chapter.time))}
                      </span>
                    </div>
                    <span className="flex items-center gap-1 font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      开始阅读 <ChevronRight size={14} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { ElementType } from "react";
function BibleSection({ icon: Icon, title, content }: { icon: ElementType; title: string; content: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={16} className="text-foreground" />
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">{title}</h3>
      </div>
      <div className="text-sm leading-relaxed text-muted-foreground">
        <MarkdownContent content={content} />
      </div>
    </div>
  );
}
