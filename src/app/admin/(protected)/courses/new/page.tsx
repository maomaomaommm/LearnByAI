import Link from "next/link";
import { listAdminUsers } from "@/lib/adminData";
import { AdminJsonForm } from "../../../parts";
import { AdminField, AdminPageHeader, ADMIN_INPUT_CLASS } from "../../../admin-ui";

export const dynamic = "force-dynamic";

export default async function AdminNewCoursePage() {
  const users = await listAdminUsers({ limit: 1000 });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AdminPageHeader title="创建课程" description="管理员可为指定用户创建课程，并自动排队规划大纲。" />

      <div className="rounded-lg border border-border bg-card p-6">
        <AdminJsonForm action="create_course" successPath="/admin/courses">
          <AdminField label="归属用户">
            <select name="userId" required className={ADMIN_INPUT_CLASS}>
              <option value="">选择用户</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}
            </select>
          </AdminField>
          <AdminField label="课程主题"><input name="topic" required className={ADMIN_INPUT_CLASS} /></AdminField>
          <AdminField label="学习目标"><textarea name="goal" required rows={3} className={ADMIN_INPUT_CLASS} /></AdminField>
          <AdminField label="学习背景"><textarea name="background" rows={2} className={ADMIN_INPUT_CLASS} /></AdminField>
          <AdminField label="学习偏好"><textarea name="preference" rows={2} className={ADMIN_INPUT_CLASS} /></AdminField>
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminField label="章节数量"><input name="chapterCount" type="number" min={3} max={20} defaultValue={8} className={ADMIN_INPUT_CLASS} /></AdminField>
            <AdminField label="难度基调">
              <select name="difficulty" defaultValue="intermediate" className={ADMIN_INPUT_CLASS}>
                <option value="intro">入门科普</option>
                <option value="intermediate">进阶系统</option>
                <option value="research">研究前沿</option>
              </select>
            </AdminField>
          </div>
        </AdminJsonForm>
      </div>

      <Link href="/admin/courses" className="inline-block text-sm text-muted-foreground hover:text-foreground">返回课程列表</Link>
    </div>
  );
}
