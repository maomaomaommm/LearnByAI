import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminCourse } from "@/lib/adminData";
import { AdminActionButton, AdminJsonForm, CHAPTER_STATUS_LABEL, DEPTH_LABEL, JOB_STATUS_LABEL, QUALITY_STATUS_LABEL, StatusPill } from "../../../parts";
import { formatDate } from "../../../format";

export const dynamic = "force-dynamic";

export default async function AdminCourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const course = await getAdminCourse(id);
  if (!course) notFound();

  const jobsByChapter = new Map(course.jobs.filter((job) => job.chapterId).map((job) => [job.chapterId!, job]));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <Link href="/admin/courses" className="text-sm text-muted-foreground hover:text-foreground">返回课程列表</Link>
          <h1 className="mt-3 text-3xl font-semibold">{course.topic}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{course.goal}</p>
          <p className="mt-2 text-xs text-muted-foreground">用户：{course.userEmail ?? course.userId ?? "未知用户"} · 创建于 {formatDate(course.createdAt)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          <p>章节：{course.readyCount}/{course.chapterCount} 完成</p>
          <p className="mt-1">活跃任务：{course.activeJobCount}</p>
          <p className="mt-1">质检未通过：{course.qualityFailedCount}</p>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-4 font-medium">编辑课程基础信息</h2>
        <AdminJsonForm action="update_course">
          <input type="hidden" name="courseId" value={course.id} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="课程主题"><input name="topic" defaultValue={course.topic} required className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" /></Field>
            <Field label="章节数量"><input name="chapterCount" type="number" min={3} max={20} defaultValue={course.targetChapterCount ?? 8} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" /></Field>
          </div>
          <Field label="学习目标"><textarea name="goal" defaultValue={course.goal} rows={2} required className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" /></Field>
          <Field label="学习背景"><textarea name="background" defaultValue={course.background ?? ""} rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" /></Field>
          <Field label="学习偏好"><textarea name="preference" defaultValue={course.preference ?? ""} rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" /></Field>
          <Field label="难度基调">
            <select name="difficulty" defaultValue={course.difficulty ?? "intermediate"} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground">
              <option value="intro">入门科普</option>
              <option value="intermediate">进阶系统</option>
              <option value="research">研究前沿</option>
            </select>
          </Field>
        </AdminJsonForm>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-medium">章节列表</h2>
          <div className="flex gap-2">
            {course.activeJobCount > 0 && <AdminActionButton action="cancel_active_jobs" payload={{ courseId: course.id }} label="取消本课程任务" confirmText="确认取消本课程全部活跃任务？" variant="danger" />}
            <AdminActionButton action="delete_course" payload={{ courseId: course.id }} label="删除课程" confirmText={`危险操作：确认删除课程「${course.topic}」？`} variant="danger" />
          </div>
        </div>
        <div className="divide-y divide-border">
          {course.course.chapters.map((chapter, index) => {
            const job = jobsByChapter.get(chapter.id);
            const hasBody = Boolean(chapter.content || chapter.sections?.length);
            const qualityStatus = chapter.qualityReport?.status;
            return (
              <div key={chapter.id} className="grid gap-4 px-4 py-4 lg:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{String(index + 1).padStart(2, "0")}. {chapter.title}</p>
                    <StatusPill tone={chapter.status === "quality_failed" || chapter.status === "failed" ? "bad" : chapter.status === "ready" ? "good" : "muted"}>
                      {CHAPTER_STATUS_LABEL[chapter.status ?? "pending"] ?? chapter.status ?? "待生成"}
                    </StatusPill>
                    {qualityStatus && (
                      <StatusPill tone={qualityStatus === "failed" ? "bad" : "good"}>
                        {QUALITY_STATUS_LABEL[qualityStatus] ?? qualityStatus} {chapter.qualityReport?.score ?? 0}/100
                      </StatusPill>
                    )}
                    <StatusPill>{DEPTH_LABEL[chapter.depthWeight ?? "normal"]}</StatusPill>
                    {job && <StatusPill tone={job.status === "failed" ? "bad" : job.status === "succeeded" ? "good" : "info"}>任务：{JOB_STATUS_LABEL[job.status] ?? job.status}</StatusPill>}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{chapter.description}</p>
                  {job?.error && <p className="mt-2 text-xs text-destructive">错误：{job.error}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">正文：{hasBody ? "已有正文" : "暂无正文"} · 章节 ID：{chapter.id}</p>
                </div>
                <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                  {hasBody && <AdminActionButton action="review_chapter" payload={{ courseId: course.id, chapterId: chapter.id }} label="重新质检" confirmText={`确认重新质检「${chapter.title}」？`} />}
                  <AdminActionButton action="regenerate_chapter" payload={{ courseId: course.id, chapterId: chapter.id }} label="重新生成" confirmText={`确认重新生成「${chapter.title}」？这会清空当前章节正文和质检报告。`} variant="danger" />
                  <AdminActionButton action="repair_chapter_status" payload={{ courseId: course.id, chapterId: chapter.id, status: hasBody ? "draft_ready" : "pending" }} label="修复状态" confirmText={`确认修复「${chapter.title}」的状态？`} />
                  <AdminActionButton action="delete_chapter" payload={{ courseId: course.id, chapterId: chapter.id }} label="删除章节" confirmText={`危险操作：确认删除章节「${chapter.title}」？`} variant="danger" />
                  {job && ["pending", "queued", "running", "retrying"].includes(job.status) && <AdminActionButton action="cancel_job" payload={{ jobId: job.id }} label="取消任务" confirmText={`确认取消任务 ${job.id}？`} variant="danger" />}
                </div>
              </div>
            );
          })}
          {!course.course.chapters.length && <p className="px-4 py-12 text-center text-muted-foreground">课程还没有章节。</p>}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3"><h2 className="font-medium">最近任务日志</h2></div>
        <div className="divide-y divide-border">
          {course.jobs.slice(0, 20).map((job) => (
            <div key={job.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={job.status === "failed" ? "bad" : job.status === "succeeded" ? "good" : "info"}>{JOB_STATUS_LABEL[job.status] ?? job.status}</StatusPill>
                <p className="text-sm">{job.chapterTitle ?? job.courseTopic ?? job.type}</p>
                <p className="text-xs text-muted-foreground">{formatDate(job.updatedAt)}</p>
              </div>
              {job.events.slice(-3).map((event) => <p key={event.id} className="mt-1 text-xs text-muted-foreground">{event.agent} · {JOB_STATUS_LABEL[event.status] ?? event.status} · {event.message}</p>)}
            </div>
          ))}
          {!course.jobs.length && <p className="px-4 py-8 text-center text-muted-foreground">暂无任务日志。</p>}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm text-muted-foreground">{label}</span>{children}</label>;
}
