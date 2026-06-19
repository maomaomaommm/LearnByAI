"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, ChevronRight, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiFetch } from "@/lib/clientApi";
import { Course } from "@/lib/types";

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseToDelete, setCourseToDelete] = useState<Course>();
  const [deletingId, setDeletingId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");

    apiFetch("/api/courses")
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data) => {
        if (cancelled) return;
        if (data?.courses) {
          setCourses(data.courses);
        } else {
          setLoadError("读取课程失败，请先登录后重试。");
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("读取课程失败，请稍后重试。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function confirmDeleteCourse() {
    if (!courseToDelete) return;
    const target = courseToDelete;
    setDeletingId(target.id);
    setDeleteError("");

    try {
      const response = await apiFetch(`/api/courses/${target.id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "删除课程失败。");
      }

      // Refresh from backend to ensure sync with admin/other sessions.
      const listResponse = await apiFetch("/api/courses");
      if (listResponse.ok) {
        const data = (await listResponse.json()) as { courses?: Course[] };
        setCourses(data.courses ?? []);
      } else {
        setCourses((current) => current.filter((course) => course.id !== target.id));
      }
      setCourseToDelete(undefined);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除课程失败。");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="font-mono text-2xl font-bold text-foreground">我的课程</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              这里会展示你创建的学习课程，方便继续阅读、查看生成进度和管理章节内容。
            </p>
          </div>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm text-background"
          >
            <Plus size={16} /> 创建课程
          </Link>
        </div>

        {loading ? (
          <div className="rounded-lg border border-dashed border-border py-20 text-center">
            <BookOpen size={32} className="mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">正在读取课程...</p>
          </div>
        ) : loadError ? (
          <div className="rounded-lg border border-dashed border-border py-20 text-center">
            <BookOpen size={32} className="mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{loadError}</p>
          </div>
        ) : courses.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-20 text-center">
            <BookOpen size={32} className="mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">还没有课程。</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {courses.map((course) => (
              <div
                key={course.id}
                className="group relative rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/40"
              >
                <Link href={`/courses/${course.id}`} className="block pr-10">
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <h2 className="font-mono text-lg font-semibold text-foreground">{course.topic}</h2>
                    <ChevronRight size={18} className="mt-1 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{course.goal}</p>
                  <p className="mt-4 text-xs text-muted-foreground">
                    {course.chapters.length} 章 · {new Date(course.createdAt).toLocaleString()}
                  </p>
                </Link>
                <button
                  type="button"
                  aria-label={`删除课程：${course.topic}`}
                  disabled={deletingId === course.id}
                  onClick={() => {
                    setDeleteError("");
                    setCourseToDelete(course);
                  }}
                  className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground opacity-100 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={Boolean(courseToDelete)} onOpenChange={(open) => !open && setCourseToDelete(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这门课程？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{courseToDelete?.topic}」以及它的章节、批注、生成任务和导出记录。这个操作不能撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(deletingId)}
              onClick={(event) => {
                event.preventDefault();
                void confirmDeleteCourse();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deletingId ? "删除中..." : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
