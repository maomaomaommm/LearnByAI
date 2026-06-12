import Link from "next/link";
import { getAdminOverview } from "@/lib/adminData";
import { JOB_STATUS_LABEL, StatusPill } from "../parts";
import { formatDate } from "../format";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const overview = await getAdminOverview();
  const cards = [
    { label: "用户总数", value: overview.stats.userCount },
    { label: "封禁用户", value: overview.stats.bannedUserCount },
    { label: "课程总数", value: overview.stats.courseCount },
    { label: "活跃任务", value: overview.stats.activeJobCount },
    { label: "失败任务", value: overview.stats.failedJobCount },
    { label: "质检未通过", value: overview.stats.qualityFailedChapters },
    { label: "章节完成度", value: `${overview.stats.readyChapters}/${overview.stats.totalChapters}` },
    { label: "导出记录", value: overview.stats.exportCount },
  ];

  return (
    <div className="space-y-8">
      <section>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Dashboard</p>
        <h1 className="mt-2 text-3xl font-semibold">后台总览</h1>
        <p className="mt-2 text-sm text-muted-foreground">查看真实用户、课程、生成任务、质检、用量和导出状态。</p>
      </section>

      <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className="mt-3 font-mono text-2xl font-semibold">{card.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel title="最近任务" href="/admin/jobs">
          {overview.recentJobs.length ? overview.recentJobs.map((job) => (
            <div key={job.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium">{job.chapterTitle ?? job.courseTopic ?? job.type}</p>
                <p className="mt-1 text-xs text-muted-foreground">{job.userEmail ?? job.userId ?? "未知用户"} · {formatDate(job.updatedAt)}</p>
              </div>
              <StatusPill tone={job.status === "failed" ? "bad" : job.status === "succeeded" ? "good" : "info"}>
                {JOB_STATUS_LABEL[job.status] ?? job.status}
              </StatusPill>
            </div>
          )) : <EmptyLine text="暂无任务" />}
        </Panel>

        <Panel title="最近课程" href="/admin/courses">
          {overview.recentCourses.length ? overview.recentCourses.map((course) => (
            <Link key={course.id} href={`/admin/courses/${course.id}`} className="block px-4 py-3 transition-colors hover:bg-muted/50">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{course.topic}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{course.userEmail ?? course.userId ?? "未知用户"} · {formatDate(course.updatedAt ?? course.createdAt)}</p>
                </div>
                <StatusPill tone={course.qualityFailedCount > 0 ? "bad" : course.activeJobCount > 0 ? "info" : "good"}>
                  {course.activeJobCount > 0 ? "有任务" : course.qualityFailedCount > 0 ? "需处理" : "正常"}
                </StatusPill>
              </div>
            </Link>
          )) : <EmptyLine text="暂无课程" />}
        </Panel>

        <Panel title="低分质检" href="/admin/quality">
          {overview.lowQualityReports.length ? overview.lowQualityReports.map((report) => (
            <div key={report.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{report.chapterTitle ?? report.courseTopic ?? report.targetType}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{report.userEmail ?? report.userId ?? "未知用户"} · {formatDate(report.createdAt)}</p>
                </div>
                <StatusPill tone={report.status === "failed" ? "bad" : "warn"}>{report.score} 分</StatusPill>
              </div>
            </div>
          )) : <EmptyLine text="暂无低分质检" />}
        </Panel>

        <Panel title="快速入口" href="/admin/settings">
          <div className="grid gap-2 p-4 sm:grid-cols-2">
            <QuickLink href="/admin/courses/new" label="创建课程" />
            <QuickLink href="/admin/jobs?status=running" label="运行中任务" />
            <QuickLink href="/admin/quality?status=failed" label="质检未通过" />
            <QuickLink href="/admin/audit" label="操作日志" />
          </div>
        </Panel>
      </section>
    </div>
  );
}

function Panel({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-medium">{title}</h2>
        <Link href={href} className="text-sm text-muted-foreground hover:text-foreground">查看全部</Link>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground">{label}</Link>;
}

function EmptyLine({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{text}</p>;
}
