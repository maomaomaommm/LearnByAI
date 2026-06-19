import Link from "next/link";
import { listAdminQualityReports } from "@/lib/adminData";
import { AdminActionButton, QUALITY_STATUS_LABEL, StatusPill } from "../../parts";
import { formatDate } from "../../format";

export const dynamic = "force-dynamic";

export default async function AdminQualityPage({ searchParams }: { searchParams: Promise<{ status?: string; courseId?: string; all?: string }> }) {
  const params = await searchParams;
  const showAll = params.all === "1";
  const reports = await listAdminQualityReports({ status: params.status, courseId: params.courseId, latest: !showAll });

  const filteredCourse = params.courseId ? reports.find((r) => r.courseId === params.courseId) : null;
  const filteredCourseName = filteredCourse?.courseTopic ?? params.courseId;

  function buildFilterUrl(overrides: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    const status = overrides.status ?? params.status;
    const courseId = overrides.courseId ?? params.courseId;
    const all = overrides.all ?? params.all;
    if (status) sp.set("status", status);
    if (courseId) sp.set("courseId", courseId);
    if (all) sp.set("all", all);
    const qs = sp.toString();
    return `/admin/quality${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Quality</p>
        <h1 className="mt-2 text-3xl font-semibold">质检管理</h1>
      </div>

      {params.courseId && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
          <span>筛选课程：{filteredCourseName}</span>
          <Link href={buildFilterUrl({ courseId: undefined })} className="ml-auto rounded px-2 py-0.5 text-xs hover:bg-blue-100">✕ 清除</Link>
        </div>
      )}

      <form className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
        <select name="status" defaultValue={params.status ?? ""} className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground">
          <option value="">全部质检</option>
          <option value="passed">通过</option>
          <option value="warning">提醒</option>
          <option value="failed">未通过</option>
        </select>
        {params.courseId && <input type="hidden" name="courseId" value={params.courseId} />}
        <input type="hidden" name="all" value={showAll ? "1" : ""} />
        <button className="rounded-md bg-foreground px-4 py-2 text-sm text-background">筛选</button>
        <Link href="/admin/quality" className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">清空</Link>
      </form>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">当前显示：{showAll ? "全部历史报告" : "每个章节/目标的最新报告"}</p>
        <Link
          href={buildFilterUrl({ all: showAll ? undefined : "1" })}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >{showAll ? "只看最新" : "显示全部历史"}</Link>
      </div>

      <div className="grid gap-4">
        {reports.map((report) => (
          <div key={report.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                {report.courseId ? (
                  <Link href={buildFilterUrl({ courseId: report.courseId })} className="text-xs text-muted-foreground hover:text-foreground hover:underline">{report.courseTopic ?? report.courseId}</Link>
                ) : null}
                <h2 className="mt-1 text-lg font-semibold">{report.chapterTitle ?? report.courseTopic ?? report.targetType}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{report.issueCount} 个问题 · {report.userEmail ?? report.userId ?? "未知用户"} · {formatDate(report.createdAt)}</p>
              </div>
              <StatusPill tone={report.status === "failed" ? "bad" : report.score < 80 ? "warn" : "good"}>{QUALITY_STATUS_LABEL[report.status] ?? report.status} {report.score}/100</StatusPill>
            </div>
            {report.report.issues?.length ? (
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {report.report.issues.slice(0, 4).map((issue, index) => <li key={`${issue.check}-${index}`}>[{issue.severity}] {issue.message}</li>)}
              </ul>
            ) : null}
            {report.courseId && report.chapterId && (
              <div className="mt-4 flex flex-wrap gap-2">
                <AdminActionButton action="review_chapter" payload={{ courseId: report.courseId, chapterId: report.chapterId }} label="重新质检" />
                <AdminActionButton action="regenerate_chapter" payload={{ courseId: report.courseId, chapterId: report.chapterId }} label="重新生成" confirmText="确认重新生成该章节？" variant="danger" />
              </div>
            )}
          </div>
        ))}
        {!reports.length && <p className="rounded-lg border border-border bg-card px-4 py-12 text-center text-muted-foreground">暂无质检报告。</p>}
      </div>
    </div>
  );
}
