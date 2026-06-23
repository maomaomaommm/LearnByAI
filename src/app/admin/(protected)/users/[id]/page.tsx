import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/adminData";
import { JOB_STATUS_LABEL, StatusPill, USAGE_ACTION_LABEL } from "../../../parts";
import { AdminPageHeader } from "../../../admin-ui";
import { formatDate } from "../../../format";

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAdminUser(id);
  if (!user) notFound();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={user.email}
        action={<Link href="/admin/users" className="text-sm text-muted-foreground hover:text-foreground">返回用户列表</Link>}
      />
      <p className="-mt-2 font-mono text-xs text-muted-foreground">{user.id}</p>

      <section className="grid gap-4 md:grid-cols-4">
        <Card label="状态" value={user.isBanned ? "已封禁" : "正常"} />
        <Card label="课程数" value={user.courseCount} />
        <Card label="任务数" value={`${user.activeJobCount}/${user.jobCount}`} />
        <Card label="用量次数" value={user.usageCount} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel title="课程">
          {user.courses.map((course) => (
            <Link key={course.id} href={`/admin/courses/${course.id}`} className="block border-b border-border px-4 py-3 last:border-b-0 hover:bg-muted/40">
              <p className="text-sm font-medium">{course.topic}</p>
              <p className="mt-1 text-xs text-muted-foreground">{course.readyCount}/{course.chapterCount} 完成 · {formatDate(course.updatedAt ?? course.createdAt)}</p>
            </Link>
          ))}
          {!user.courses.length && <Empty text="暂无课程" />}
        </Panel>

        <Panel title="最近任务">
          {user.jobs.slice(0, 12).map((job) => (
            <div key={job.id} className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
              <div>
                <p className="text-sm font-medium">{job.chapterTitle ?? job.courseTopic ?? job.type}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(job.updatedAt)}</p>
              </div>
              <StatusPill tone={job.status === "failed" ? "bad" : job.status === "succeeded" ? "good" : "info"}>
                {JOB_STATUS_LABEL[job.status] ?? job.status}
              </StatusPill>
            </div>
          ))}
          {!user.jobs.length && <Empty text="暂无任务" />}
        </Panel>
      </section>

      <Panel title="最近用量">
        {user.usage.slice(0, 30).map((event) => (
          <div key={event.id} className="flex justify-between border-b border-border px-4 py-3 text-sm last:border-b-0">
            <span>{USAGE_ACTION_LABEL[event.action] ?? event.action}</span>
            <span className="text-muted-foreground">{formatDate(event.createdAt)}</span>
          </div>
        ))}
        {!user.usage.length && <Empty text="暂无用量记录" />}
      </Panel>
    </div>
  );
}

function Card({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-3 font-mono text-2xl font-semibold">{value}</p></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-card"><h2 className="border-b border-border px-4 py-3 font-medium">{title}</h2>{children}</div>;
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{text}</p>;
}
