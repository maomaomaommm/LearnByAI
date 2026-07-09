"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { apiFetch, subscribeToSse } from "@/lib/clientApi";
import type { Course, GenerationJob, TextbookMeta, TextbookOutlineChapter, TextbookOutlineSection } from "@/lib/types";

type OutlineStatus = NonNullable<TextbookMeta["outlineStatus"]>;

const STATUS_LABEL: Record<OutlineStatus, string> = {
  none: "未开始",
  planning: "正在生成大纲",
  ready: "等待确认",
  confirmed: "已确认",
  failed: "大纲失败",
};

export default function TextbookOutlinePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<Course>();
  const [meta, setMeta] = useState<TextbookMeta>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    apiFetch(`/api/courses/${id}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Course not found"))))
      .then((data: { course?: Course }) => {
        if (cancelled) return;
        if (data.course) {
          setCourse(data.course);
          setMeta(data.course.textbookMeta);
        }
      })
      .catch(() => {
        if (!cancelled) setError("读取教材大纲失败，请稍后重试。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const subscription = subscribeToSse(`/api/courses/${id}/events`, {
      onMessage(messageEvent) {
        if (cancelled) return;
        const data = messageEvent.data as { course?: Course; jobs?: GenerationJob[] } | undefined;
        if (data?.course) {
          setCourse(data.course);
          if (data.course.textbookMeta) setMeta(data.course.textbookMeta);
        }
      },
    });
    return () => {
      cancelled = true;
      subscription.close();
    };
  }, [id]);

  const chapters = useMemo(() => meta?.outline?.chapters ?? [], [meta?.outline?.chapters]);
  const canEditOutline = Boolean(meta?.outline && chapters.length > 0);
  const middleChapterCount = useMemo(() => chapters.filter((chapter) => !chapter.fixedRole).length, [chapters]);

  async function saveOutline(nextMeta = meta) {
    if (!nextMeta) return undefined;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch(`/api/courses/${id}/textbook-outline`, {
        method: "PUT",
        body: JSON.stringify({ textbookMeta: nextMeta }),
      });
      const data = (await response.json().catch(() => ({}))) as { course?: Course; textbookMeta?: TextbookMeta; error?: string };
      if (!response.ok) throw new Error(data.error ?? "保存大纲失败。");
      if (data.course) setCourse(data.course);
      if (data.textbookMeta) setMeta(data.textbookMeta);
      setMessage("大纲已保存。");
      return data.textbookMeta;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存大纲失败。");
      return undefined;
    } finally {
      setSaving(false);
    }
  }

  async function confirmOutline() {
    if (!meta) return;
    setConfirming(true);
    setError("");
    setMessage("");
    const saved = await saveOutline(meta);
    if (!saved) {
      setConfirming(false);
      return;
    }

    try {
      const response = await apiFetch(`/api/courses/${id}/confirm-textbook-outline`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const data = (await response.json().catch(() => ({}))) as { course?: Course; error?: string };
      if (!response.ok) throw new Error(data.error ?? "确认大纲失败。");
      if (data.course) setCourse(data.course);
      router.push(`/courses/${id}`);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "确认大纲失败。");
    } finally {
      setConfirming(false);
    }
  }

  function patchMeta(patch: Partial<TextbookMeta>) {
    setMeta((current) => current ? { ...current, ...patch } : current);
  }

  function patchChapter(chapterId: string, patch: Partial<TextbookOutlineChapter>) {
    updateChapters((items) => items.map((chapter) => chapter.id === chapterId ? { ...chapter, ...patch } : chapter));
  }

  function patchSection(chapterId: string, sectionId: string, patch: Partial<TextbookOutlineSection>) {
    updateChapters((items) =>
      items.map((chapter) =>
        chapter.id === chapterId
          ? {
              ...chapter,
              sections: chapter.sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section),
            }
          : chapter,
      ),
    );
  }

  function addChapter() {
    updateChapters((items) => {
      const insertAt = Math.max(1, items.length - 1);
      const chapter: TextbookOutlineChapter = {
        id: crypto.randomUUID(),
        title: "新章节",
        description: "说明本章要解决的问题和承上启下的位置。",
        order: insertAt,
        sections: [createSection(0)],
      };
      return renumberChapters([...items.slice(0, insertAt), chapter, ...items.slice(insertAt)]);
    });
  }

  function removeChapter(chapterId: string) {
    updateChapters((items) => renumberChapters(items.filter((chapter) => chapter.id !== chapterId || chapter.fixedRole)));
  }

  function moveChapter(chapterId: string, direction: -1 | 1) {
    updateChapters((items) => {
      const index = items.findIndex((chapter) => chapter.id === chapterId);
      if (index <= 0 || index >= items.length - 1) return items;
      const target = index + direction;
      if (target <= 0 || target >= items.length - 1) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return renumberChapters(next);
    });
  }

  function addSection(chapterId: string) {
    updateChapters((items) =>
      items.map((chapter) =>
        chapter.id === chapterId
          ? { ...chapter, sections: renumberSections([...chapter.sections, createSection(chapter.sections.length)]) }
          : chapter,
      ),
    );
  }

  function removeSection(chapterId: string, sectionId: string) {
    updateChapters((items) =>
      items.map((chapter) =>
        chapter.id === chapterId
          ? { ...chapter, sections: renumberSections(chapter.sections.filter((section) => section.id !== sectionId)) }
          : chapter,
      ),
    );
  }

  function moveSection(chapterId: string, sectionId: string, direction: -1 | 1) {
    updateChapters((items) =>
      items.map((chapter) => {
        if (chapter.id !== chapterId) return chapter;
        const index = chapter.sections.findIndex((section) => section.id === sectionId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= chapter.sections.length) return chapter;
        const sections = [...chapter.sections];
        [sections[index], sections[target]] = [sections[target]!, sections[index]!];
        return { ...chapter, sections: renumberSections(sections) };
      }),
    );
  }

  function updateChapters(updater: (chapters: TextbookOutlineChapter[]) => TextbookOutlineChapter[]) {
    setMeta((current) => {
      if (!current?.outline) return current;
      return {
        ...current,
        outlineStatus: current.outlineStatus === "confirmed" ? "ready" : current.outlineStatus,
        outline: {
          ...current.outline,
          chapters: updater(current.outline.chapters),
        },
      };
    });
  }

  if (loading) {
    return <Shell><CenteredState icon={<Loader2 className="animate-spin" size={28} />} title="正在读取教材大纲" /></Shell>;
  }

  if (error && !course) {
    return <Shell><CenteredState icon={<BookOpen size={28} />} title={error} /></Shell>;
  }

  if (!course || course.contentMode !== "textbook") {
    return <Shell><CenteredState icon={<BookOpen size={28} />} title="这门课程不是教材模式。" /></Shell>;
  }

  const outlineStatus = meta?.outlineStatus ?? "planning";

  return (
    <Shell>
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <Link href={`/courses/${id}`} className="mb-5 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft size={14} /> 返回课程
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold text-foreground">教材大纲确认</h1>
            <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              {STATUS_LABEL[outlineStatus]}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            教材模式会先固定全书结构，再并行生成章节正文。首章引言和末章总结与展望会锁定，只允许编辑标题与说明。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => void saveOutline()}
            disabled={!canEditOutline || saving || confirming}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} 保存
          </button>
          <button
            type="button"
            onClick={() => void confirmOutline()}
            disabled={!canEditOutline || saving || confirming}
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
          >
            {confirming ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} 确认并生成
          </button>
        </div>
      </div>

      {error && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {message && <p className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}

      {!canEditOutline ? (
        <CenteredState
          icon={<Loader2 className={outlineStatus === "failed" ? "" : "animate-spin"} size={28} />}
          title={outlineStatus === "failed" ? "大纲生成失败" : "正在生成教材大纲"}
          description={outlineStatus === "failed" ? "可以回到课程页重试规划任务。" : "规划完成后这里会自动出现全书章节和小节结构。"}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="h-fit rounded-lg border border-border bg-card p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">目录预览</p>
            <div className="space-y-2">
              {chapters.map((chapter, index) => (
                <a key={chapter.id} href={`#chapter-${chapter.id}`} className="block rounded-md px-2 py-2 text-sm hover:bg-muted">
                  <span className="mr-2 font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}.</span>
                  <span className="text-foreground">{chapter.title || "未命名章节"}</span>
                  {!chapter.fixedRole && <span className="ml-2 text-xs text-muted-foreground">{chapter.sections.length} 小节</span>}
                </a>
              ))}
            </div>
          </aside>

          <main className="space-y-5">
            <section className="rounded-lg border border-border bg-card p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">正式书名</span>
                  <input
                    value={meta?.title ?? ""}
                    onChange={(event) => patchMeta({ title: event.target.value })}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">副标题</span>
                  <input
                    value={meta?.subtitle ?? ""}
                    onChange={(event) => patchMeta({ subtitle: event.target.value })}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
                  />
                </label>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                插图会根据模型设置自动选择：未配置生图 API 时使用代码渲染图；配置后使用模型生图。
              </p>
            </section>

            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">中间章节：{middleChapterCount} 章</p>
              <button
                type="button"
                onClick={addChapter}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <Plus size={15} /> 添加章节
              </button>
            </div>

            {chapters.map((chapter, index) => (
              <section id={`chapter-${chapter.id}`} key={chapter.id} className="rounded-lg border border-border bg-card p-5">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="mt-2 inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background font-mono text-xs text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-3">
                      <input
                        value={chapter.title}
                        onChange={(event) => patchChapter(chapter.id, { title: event.target.value })}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-base font-semibold outline-none focus:border-foreground/40"
                      />
                      <textarea
                        value={chapter.description}
                        onChange={(event) => patchChapter(chapter.id, { description: event.target.value })}
                        rows={2}
                        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:border-foreground/40"
                      />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {chapter.fixedRole && (
                      <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                        固定章节
                      </span>
                    )}
                    {!chapter.fixedRole && (
                      <>
                        <IconButton label="上移" onClick={() => moveChapter(chapter.id, -1)} disabled={index <= 1}>
                          <ChevronUp size={15} />
                        </IconButton>
                        <IconButton label="下移" onClick={() => moveChapter(chapter.id, 1)} disabled={index >= chapters.length - 2}>
                          <ChevronDown size={15} />
                        </IconButton>
                        <IconButton label="删除章节" onClick={() => removeChapter(chapter.id)}>
                          <Trash2 size={15} />
                        </IconButton>
                      </>
                    )}
                  </div>
                </div>

                {!chapter.fixedRole && (
                  <div className="space-y-3">
                    {chapter.sections.map((section) => (
                      <div key={section.id} className="rounded-md border border-border bg-background p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <GripVertical size={14} className="text-muted-foreground" />
                          <span className="font-mono text-xs text-muted-foreground">{index + 1}.{section.order + 1}</span>
                          <input
                            value={section.title}
                            onChange={(event) => patchSection(chapter.id, section.id, { title: event.target.value })}
                            className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm outline-none focus:border-foreground/40"
                          />
                          <IconButton label="上移小节" onClick={() => moveSection(chapter.id, section.id, -1)} disabled={section.order === 0}>
                            <ChevronUp size={14} />
                          </IconButton>
                          <IconButton label="下移小节" onClick={() => moveSection(chapter.id, section.id, 1)} disabled={section.order >= chapter.sections.length - 1}>
                            <ChevronDown size={14} />
                          </IconButton>
                          <IconButton label="删除小节" onClick={() => removeSection(chapter.id, section.id)} disabled={chapter.sections.length <= 1}>
                            <Trash2 size={14} />
                          </IconButton>
                        </div>
                        <textarea
                          value={section.description}
                          onChange={(event) => patchSection(chapter.id, section.id, { description: event.target.value })}
                          rows={2}
                          className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm leading-relaxed outline-none focus:border-foreground/40"
                        />
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addSection(chapter.id)}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <Plus size={15} /> 添加小节
                    </button>
                  </div>
                )}
              </section>
            ))}
          </main>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-6xl">{children}</div>
    </div>
  );
}

function CenteredState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border py-20 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
        {icon}
      </div>
      <p className="font-medium text-foreground">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>}
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function createSection(order: number): TextbookOutlineSection {
  return {
    id: crypto.randomUUID(),
    title: "新小节",
    description: "说明本小节要讲清楚的概念、例子或推导。",
    order,
  };
}

function renumberChapters(chapters: TextbookOutlineChapter[]) {
  return chapters.map((chapter, order) => ({ ...chapter, order }));
}

function renumberSections(sections: TextbookOutlineSection[]) {
  return sections.map((section, order) => ({ ...section, order }));
}
