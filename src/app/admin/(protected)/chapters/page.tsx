import Link from "next/link";
import { listAdminChapters } from "@/lib/adminData";
import { AdminActionButton, CHAPTER_STATUS_LABEL, QUALITY_STATUS_LABEL, StatusPill } from "../../parts";
import { formatDate } from "../../format";

export const dynamic = "force-dynamic";

export default async function AdminChaptersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; userId?: string }> }) {
  const params = await searchParams;
  const chapters = await listAdminChapters({ query: params.q, status: params.status, userId: params.userId });

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Chapters</p>
        <h1 className="mt-2 text-3xl font-semibold">章节管理</h1>
      </div>

      <form className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
        <input name="q" defaultValue={params.q ?? ""} placeholder="搜索章节或课程" className="min-w-72 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" />
        <select name="status" defaultValue={params.status ?? ""} className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground">
          <option value="">全部状态</option>
          <option value="pending">待生成</option>
          <option value="queued">队列中</option>
          <option value="generating">生成中</option>
          <option value="draft_ready">待质检</option>
          <option value="quality_failed">质检未通过</option>
          <option value="ready">质检通过</option>
          <option value="failed">生成失败</option>
        </select>
        <button className="rounded-md bg-foreground px-4 py-2 text-sm text-background">筛选</button>
        <Link href="/admin/chapters" className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">清空</Link>
      </form>

      <div className="grid gap-4">
        {chapters.map((chapter) => (
          <div key={chapter.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Link href={`/admin/courses/${chapter.courseId}`} className="text-xs text-muted-foreground hover:text-foreground">{chapter.courseTopic}</Link>
                <h2 className="mt-1 text-lg font-semibold">{chapter.title}</h2>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{chapter.description}</p>
                <p className="mt-2 text-xs text-muted-foreground">{chapter.userEmail ?? chapter.userId ?? "未知用户"} · {formatDate(chapter.updatedAt)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill tone={chapter.status === "failed" || chapter.status === "quality_failed" ? "bad" : chapter.status === "ready" ? "good" : "muted"}>{CHAPTER_STATUS_LABEL[chapter.status ?? "pending"]}</StatusPill>
                {chapter.qualityStatus && <StatusPill tone={chapter.qualityStatus === "failed" ? "bad" : "good"}>{QUALITY_STATUS_LABEL[chapter.qualityStatus]} {chapter.qualityScore ?? 0}/100</StatusPill>}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <AdminActionButton action="review_chapter" payload={{ courseId: chapter.courseId, chapterId: chapter.id }} label="重新质检" confirmText={`确认重新质检「${chapter.title}」？`} />
              <AdminActionButton action="regenerate_chapter" payload={{ courseId: chapter.courseId, chapterId: chapter.id }} label="重新生成" confirmText={`确认重新生成「${chapter.title}」？`} variant="danger" />
              <AdminActionButton action="repair_chapter_status" payload={{ courseId: chapter.courseId, chapterId: chapter.id, status: chapter.chapter.content ? "draft_ready" : "pending" }} label="修复状态" />
              <AdminActionButton action="delete_chapter" payload={{ courseId: chapter.courseId, chapterId: chapter.id }} label="删除章节" confirmText={`危险操作：确认删除「${chapter.title}」？`} variant="danger" />
            </div>
          </div>
        ))}
        {!chapters.length && <p className="rounded-lg border border-border bg-card px-4 py-12 text-center text-muted-foreground">没有找到章节。</p>}
      </div>
    </div>
  );
}
