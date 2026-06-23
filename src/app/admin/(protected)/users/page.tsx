import Link from "next/link";
import { listAdminUsers } from "@/lib/adminData";
import { AdminActionButton, AdminJsonForm, RowMenu, StatusPill } from "../../parts";
import { AdminField, AdminFilterBar, AdminPageHeader, AdminTable, ADMIN_INPUT_CLASS } from "../../admin-ui";
import { formatDate } from "../../format";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const params = await searchParams;
  const users = await listAdminUsers({ query: params.q, status: params.status });

  return (
    <div className="space-y-6">
      <AdminPageHeader title="用户管理" description="查看、创建、封禁与删除用户。" />

      <details className="rounded-lg border border-border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">+ 创建用户</summary>
        <div className="border-t border-border p-4">
          <AdminJsonForm action="create_user">
            <div className="grid gap-4 sm:grid-cols-2">
              <AdminField label="邮箱"><input name="email" type="email" required placeholder="user@example.com" className={ADMIN_INPUT_CLASS} /></AdminField>
              <AdminField label="初始密码"><input name="password" required minLength={6} placeholder="至少 6 位" className={ADMIN_INPUT_CLASS} /></AdminField>
            </div>
          </AdminJsonForm>
        </div>
      </details>

      <AdminFilterBar clearHref="/admin/users">
        <input name="q" defaultValue={params.q ?? ""} placeholder="搜索邮箱或用户 ID" className={ADMIN_INPUT_CLASS + " min-w-72 flex-1"} />
        <select name="status" defaultValue={params.status ?? ""} className={ADMIN_INPUT_CLASS + " w-auto"}>
          <option value="">全部用户</option>
          <option value="normal">正常用户</option>
          <option value="banned">已封禁</option>
        </select>
      </AdminFilterBar>

      <AdminTable head={["用户", "状态", "课程/任务", "用量", "最近活动", "操作"]} isEmpty={!users.length} empty="暂无用户。">
        {users.map((user) => (
          <tr key={user.id} className="align-top hover:bg-muted/30">
            <td className="px-4 py-3">
              <Link href={`/admin/users/${user.id}`} className="font-medium hover:underline">{user.email}</Link>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{user.id}</p>
              <p className="mt-1 text-xs text-muted-foreground">注册：{formatDate(user.createdAt)}</p>
            </td>
            <td className="px-4 py-3">
              <StatusPill tone={user.isBanned ? "bad" : "good"}>{user.isBanned ? "已封禁" : "正常"}</StatusPill>
            </td>
            <td className="px-4 py-3 text-muted-foreground">
              <Link href={`/admin/courses?userId=${user.id}`} className="hover:text-foreground">{user.courseCount} 门课程</Link>
              <p className="mt-1">{user.activeJobCount}/{user.jobCount} 活跃任务</p>
            </td>
            <td className="px-4 py-3 text-muted-foreground">{user.usageCount} 次</td>
            <td className="px-4 py-3 text-muted-foreground">{formatDate(user.lastActivityAt)}</td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {user.isBanned ? (
                  <AdminActionButton action="unban_user" payload={{ userId: user.id }} label="解封" confirmText={`确认解封用户 ${user.email}？`} />
                ) : (
                  <AdminActionButton action="ban_user" payload={{ userId: user.id }} label="封禁" confirmText={`确认封禁用户 ${user.email}？`} variant="danger" />
                )}
                <RowMenu>
                  <ResetPasswordButton userId={user.id} email={user.email} />
                  {user.activeJobCount > 0 && (
                    <AdminActionButton action="cancel_active_jobs" payload={{ userId: user.id }} label="取消任务" confirmText={`确认取消 ${user.email} 的全部活跃任务？`} variant="danger" />
                  )}
                  <AdminActionButton action="delete_user" payload={{ userId: user.id }} label="删除用户" confirmText={`危险操作：确认硬删除用户 ${user.email}？该用户课程、章节、任务、批注、导出和用量记录都会被级联删除。`} variant="danger" />
                </RowMenu>
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}

function ResetPasswordButton({ userId, email }: { userId: string; email: string }) {
  return (
    <AdminActionButton
      action="reset_user_password"
      payload={{ userId, password: "LearnByAI@123456" }}
      label="重设密码"
      confirmText={`确认将 ${email} 的密码重设为 LearnByAI@123456？`}
      variant="danger"
    />
  );
}
