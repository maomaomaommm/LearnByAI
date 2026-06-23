import Link from "next/link";
import { getAdminOverview } from "@/lib/adminData";
import { JOB_STATUS_LABEL, StatusPill } from "../parts";
import { formatDate } from "../format";
import { OverviewCharts } from "./overview-charts";

export const dynamic = "force-dynamic";

const TONE = {
  bad: "border-destructive/30 bg-destructive/10",
  warn: "border-amber-500/30 bg-amber-500/10",
  info: "border-blue-500/30 bg-blue-500/10",
} as const;

const TONE_TEXT = {
  bad: "text-destructive",
  warn: "text-amber-600 dark:text-amber-300",
  info: "text-blue-600 dark:text-blue-300",
} as const;

export default async function AdminOverviewPage() {
  const overview = await getAdminOverview();
  const { stats } = overview;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-semibold">后台总览</h1>
        <p className="mt-2 text-sm text-muted-foreground">先看需要处理的事，再看趋势与明细。</p>
      </section>

      <section className="space-y-3">
        <p className="text-sm text-muted-foreground">待处理</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <AttentionCard label="失败任务" value={stats.failedJobCount} tone="bad" hint="查看失败任务" href="/admin/jobs?status=failed" />
          <AttentionCard label="质检未通过" value={stats.qualityFailedChapters} tone="warn" hint="处理质检" href="/admin/quality?status=failed" />
          <AttentionCard label="活跃任务" value={stats.activeJobCount} tone="info" hint="查看运行中" href="/admin/jobs?status=running" />
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <StatInline label="用户" value={stats.userCount} href="/admin/users" />
        <Divider />
        <StatInline label="课程" value={stats.courseCount} href="/admin/courses" />
        <Divider />
        <StatInline label="章节完成" value={`${stats.readyChapters}/${stats.totalChapters}`} href="/admin/chapters" />
        <Divider />
        <StatInline label="导出" value={stats.exportCount} href="/admin/exports" />
        {stats.bannedUserCount > 0 && (
          <>
            <Divider />
            <StatInline label="封禁用户" value={stats.bannedUserCount} href="/admin/users?status=banned" />
          </>
        )}
      </section>

      <OverviewCharts series={overview.series} />

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

function AttentionCard({ label, value, tone, hint, href }: { label: string; value: number; tone: keyof typeof TONE; hint: string; href: string }) {
  const active = value > 0;
  return (
    <Link
      href={href}
      className={`rounded-lg border p-4 transition-colors hover:bg-muted/40 ${active ? TONE[tone] : "border-border bg-card"}`}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-2 font-mono text-3xl font-semibold ${active ? TONE_TEXT[tone] : "text-foreground"}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{active ? `${hint} →` : "暂无"}</p>
    </Link>
  );
}

function StatInline({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <Link href={href} className="transition-colors hover:text-foreground">
      {label} <span className="font-mono font-medium text-foreground">{value}</span>
    </Link>
  );
}

function Divider() {
  return <span className="text-border">·</span>;
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
