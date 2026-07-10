import Link from "next/link";
import { listAdminChapters } from "@/lib/adminData";
import { AdminActionButton, CHAPTER_STATUS_LABEL, QUALITY_STATUS_LABEL, RowMenu, StatusPill } from "../../parts";
import { AdminFilterBar, AdminPageHeader, ADMIN_INPUT_CLASS } from "../../admin-ui";
import { formatDate } from "../../format";

export const dynamic = "force-dynamic";

export default async function AdminChaptersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; userId?: string }> }) {
  const params = await searchParams;
  const chapters = await listAdminChapters({ query: params.q, status: params.status, userId: params.userId });

  return (
    <div className="space-y-6">
      <AdminPageHeader title="章节管理" description="按状态与质检结果浏览全部章节。" />

      <AdminFilterBar clearHref="/admin/chapters">
        <input name="q" defaultValue={params.q ?? ""} placeholder="搜索章节或课程" className={ADMIN_INPUT_CLASS + " min-w-72 flex-1"} />
        <select name="status" defaultValue={params.status ?? ""} className={ADMIN_INPUT_CLASS + " w-auto"}>
          <option value="">全部状态</option>
          <option value="pending">待生成</option>
          <option value="queued">队列中</option>
          <option value="generating">生成中</option>
          <option value="draft_ready">待质检</option>
          <option value="quality_failed">质检未通过</option>
          <option value="ready">质检通过</option>
          <option value="failed">生成失败</option>
        </select>
      </AdminFilterBar>

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
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link href={`/admin/courses/${chapter.courseId}`} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">在课程中编辑</Link>
              <AdminActionButton action="review_chapter" payload={{ courseId: chapter.courseId, chapterId: chapter.id }} label="重新质检" confirmText={`确认重新质检「${chapter.title}」？`} />
              <AdminActionButton action="repair_chapter_status" payload={{ courseId: chapter.courseId, chapterId: chapter.id, status: chapter.hasBody ? "draft_ready" : "pending" }} label="修复状态" />
              <RowMenu>
                <AdminActionButton action="regenerate_chapter" payload={{ courseId: chapter.courseId, chapterId: chapter.id }} label="重新生成" confirmText={`确认重新生成「${chapter.title}」？`} variant="danger" />
                <AdminActionButton action="delete_chapter" payload={{ courseId: chapter.courseId, chapterId: chapter.id }} label="删除章节" confirmText={`危险操作：确认删除「${chapter.title}」？`} variant="danger" />
              </RowMenu>
            </div>
          </div>
        ))}
        {!chapters.length && <p className="rounded-lg border border-border bg-card px-4 py-12 text-center text-muted-foreground">没有找到章节。</p>}
      </div>
    </div>
  );
}
