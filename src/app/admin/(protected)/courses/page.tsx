import Link from "next/link";
import { listAdminCourses } from "@/lib/adminData";
import { AdminActionButton, StatusPill } from "../../parts";
import { formatDate } from "../../format";

export const dynamic = "force-dynamic";

export default async function AdminCoursesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; userId?: string }> }) {
  const params = await searchParams;
  const courses = await listAdminCourses({ query: params.q, status: params.status, userId: params.userId });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Courses</p>
          <h1 className="mt-2 text-3xl font-semibold">课程管理</h1>
        </div>
        <Link href="/admin/courses/new" className="rounded-md bg-foreground px-4 py-2 text-sm text-background">创建课程</Link>
      </div>

      <form className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
        <input name="q" defaultValue={params.q ?? ""} placeholder="搜索课程、目标或用户邮箱" className="min-w-72 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" />
        {params.userId && <input type="hidden" name="userId" value={params.userId} />}
        <select name="status" defaultValue={params.status ?? ""} className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground">
          <option value="">全部状态</option>
          <option value="active">有活跃任务</option>
          <option value="quality_failed">质检未通过</option>
          <option value="ready">全部完成</option>
        </select>
        <button className="rounded-md bg-foreground px-4 py-2 text-sm text-background">筛选</button>
        <Link href="/admin/courses" className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">清空</Link>
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">课程</th>
              <th className="px-4 py-3 font-medium">用户</th>
              <th className="px-4 py-3 font-medium">章节</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">更新时间</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {courses.map((course) => (
              <tr key={course.id} className="align-top hover:bg-muted/30">
                <td className="px-4 py-3">
                  <Link href={`/admin/courses/${course.id}`} className="font-medium hover:underline">{course.topic}</Link>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{course.goal}</p>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{course.userEmail ?? course.userId ?? "未知用户"}</td>
                <td className="px-4 py-3 text-muted-foreground">{course.readyCount}/{course.chapterCount} 完成</td>
                <td className="px-4 py-3">
                  <StatusPill tone={course.activeJobCount > 0 ? "info" : course.qualityFailedCount > 0 ? "bad" : "good"}>
                    {course.activeJobCount > 0 ? "有活跃任务" : course.qualityFailedCount > 0 ? "质检未通过" : "正常"}
                  </StatusPill>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(course.updatedAt ?? course.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {course.activeJobCount > 0 && <AdminActionButton action="cancel_active_jobs" payload={{ courseId: course.id }} label="取消任务" confirmText={`确认取消课程「${course.topic}」的全部活跃任务？`} variant="danger" />}
                    <AdminActionButton action="delete_course" payload={{ courseId: course.id }} label="删除课程" confirmText={`危险操作：确认删除课程「${course.topic}」及其章节、任务和导出记录？`} variant="danger" />
                  </div>
                </td>
              </tr>
            ))}
            {!courses.length && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">没有找到课程。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
