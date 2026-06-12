import Link from "next/link";
import { ACTIVE_ADMIN_JOB_STATUSES, listAdminJobs } from "@/lib/adminData";
import { AdminActionButton, JOB_STATUS_LABEL, StatusPill } from "../../parts";
import { formatDate } from "../../format";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string; q?: string }> }) {
  const params = await searchParams;
  const jobs = await listAdminJobs({ status: params.status, type: params.type, query: params.q });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Generation Jobs</p>
          <h1 className="mt-2 text-3xl font-semibold">任务管理</h1>
        </div>
        <AdminActionButton action="cancel_active_jobs" label="取消全部活跃任务" confirmText="确认取消系统内全部活跃生成任务？" variant="danger" />
      </div>

      <form className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
        <input name="q" defaultValue={params.q ?? ""} placeholder="搜索任务、课程、章节、错误" className="min-w-72 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" />
        <select name="status" defaultValue={params.status ?? ""} className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground">
          <option value="">全部状态</option>
          <option value="pending">待处理</option>
          <option value="queued">队列中</option>
          <option value="running">运行中</option>
          <option value="retrying">重试中</option>
          <option value="succeeded">已完成</option>
          <option value="failed">失败</option>
        </select>
        <select name="type" defaultValue={params.type ?? ""} className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground">
          <option value="">全部类型</option>
          <option value="course">课程规划</option>
          <option value="chapter">章节生成</option>
          <option value="annotation">批注问答</option>
          <option value="export">导出</option>
        </select>
        <button className="rounded-md bg-foreground px-4 py-2 text-sm text-background">筛选</button>
        <Link href="/admin/jobs" className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">清空</Link>
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">任务</th>
              <th className="px-4 py-3 font-medium">用户</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">锁</th>
              <th className="px-4 py-3 font-medium">更新时间</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {jobs.map((job) => {
              const active = ACTIVE_ADMIN_JOB_STATUSES.includes(job.status);
              return (
                <tr key={job.id} className="align-top hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-medium">{job.chapterTitle ?? job.courseTopic ?? job.type}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{job.type}{job.mode ? ` · ${job.mode}` : ""} · {job.id}</p>
                    {job.courseId && <Link href={`/admin/courses/${job.courseId}`} className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground">查看课程</Link>}
                    {job.error && <p className="mt-1 text-xs text-destructive">{job.error}</p>}
                    {job.events.slice(-2).map((event) => <p key={event.id} className="mt-1 text-xs text-muted-foreground">{event.agent} · {JOB_STATUS_LABEL[event.status] ?? event.status} · {event.message}</p>)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{job.userEmail ?? job.userId ?? "未知用户"}</td>
                  <td className="px-4 py-3">
                    <StatusPill tone={job.status === "failed" ? "bad" : job.status === "succeeded" ? "good" : "info"}>{JOB_STATUS_LABEL[job.status] ?? job.status}</StatusPill>
                    <p className="mt-2 text-xs text-muted-foreground">尝试 {job.attempts ?? 0} 次</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{job.lockedBy ? <>{job.lockedBy}<br />到 {formatDate(job.lockedUntil)}</> : "未锁定"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(job.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {active ? (
                        <AdminActionButton action="cancel_job" payload={{ jobId: job.id }} label="取消任务" confirmText={`确认取消任务 ${job.id}？`} variant="danger" />
                      ) : (
                        <AdminActionButton action="delete_job" payload={{ jobId: job.id }} label="删除任务" confirmText={`确认删除任务 ${job.id}？`} variant="danger" />
                      )}
                      {job.status === "failed" && <AdminActionButton action="retry_job" payload={{ jobId: job.id }} label="重试" confirmText={`确认重试任务 ${job.id}？`} />}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!jobs.length && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">没有找到任务。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
