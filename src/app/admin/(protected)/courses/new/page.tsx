import Link from "next/link";
import { listAdminUsers } from "@/lib/adminData";
import { AdminJsonForm } from "../../../parts";

export const dynamic = "force-dynamic";

export default async function AdminNewCoursePage() {
  const users = await listAdminUsers({ limit: 1000 });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Create Course</p>
        <h1 className="mt-2 text-3xl font-semibold">创建课程</h1>
        <p className="mt-2 text-sm text-muted-foreground">管理员可为指定用户创建课程，并自动排队规划大纲。</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <AdminJsonForm action="create_course" successPath="/admin/courses">
          <Field label="归属用户">
            <select name="userId" required className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground">
              <option value="">选择用户</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}
            </select>
          </Field>
          <Field label="课程主题"><input name="topic" required className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" /></Field>
          <Field label="学习目标"><textarea name="goal" required rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" /></Field>
          <Field label="学习背景"><textarea name="background" rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" /></Field>
          <Field label="学习偏好"><textarea name="preference" rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="每周学习小时"><input name="weeklyHours" type="number" min={1} max={80} defaultValue={5} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" /></Field>
            <Field label="章节篇幅">
              <select name="chapterLength" defaultValue="medium" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground">
                <option value="short">短</option>
                <option value="medium">中</option>
                <option value="long">长</option>
              </select>
            </Field>
          </div>
        </AdminJsonForm>
      </div>

      <Link href="/admin/courses" className="inline-block text-sm text-muted-foreground hover:text-foreground">返回课程列表</Link>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm text-muted-foreground">{label}</span>{children}</label>;
}
