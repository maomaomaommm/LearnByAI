import Link from "next/link";
import { listAdminCourses } from "@/lib/adminData";
import { AdminActionButton, RowMenu, StatusPill } from "../../parts";
import { AdminFilterBar, AdminPageHeader, AdminTable, ADMIN_INPUT_CLASS } from "../../admin-ui";
import { formatDate } from "../../format";

export const dynamic = "force-dynamic";

export default async function AdminCoursesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; userId?: string }> }) {
  const params = await searchParams;
  const courses = await listAdminCourses({ query: params.q, status: params.status, userId: params.userId });

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="课程管理"
        description="全部课程的章节进度与质检状态。"
        action={<Link href="/admin/courses/new" className="rounded-md bg-foreground px-4 py-2 text-sm text-background">创建课程</Link>}
      />

      <AdminFilterBar clearHref="/admin/courses">
        <input name="q" defaultValue={params.q ?? ""} placeholder="搜索课程、目标或用户邮箱" className={ADMIN_INPUT_CLASS + " min-w-72 flex-1"} />
        {params.userId && <input type="hidden" name="userId" value={params.userId} />}
        <select name="status" defaultValue={params.status ?? ""} className={ADMIN_INPUT_CLASS + " w-auto"}>
          <option value="">全部状态</option>
          <option value="active">有活跃任务</option>
          <option value="quality_failed">质检未通过</option>
          <option value="ready">全部完成</option>
        </select>
      </AdminFilterBar>

      <AdminTable head={["课程", "用户", "章节", "状态", "更新时间", "操作"]} isEmpty={!courses.length} empty="没有找到课程。">
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
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/admin/courses/${course.id}`} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">查看 / 编辑</Link>
                <RowMenu>
                  {course.activeJobCount > 0 && <AdminActionButton action="cancel_active_jobs" payload={{ courseId: course.id }} label="取消任务" confirmText={`确认取消课程「${course.topic}」的全部活跃任务？`} variant="danger" />}
                  <AdminActionButton action="delete_course" payload={{ courseId: course.id }} label="删除课程" confirmText={`危险操作：确认删除课程「${course.topic}」及其章节、任务和导出记录？`} variant="danger" />
                </RowMenu>
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
