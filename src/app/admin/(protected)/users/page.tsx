import Link from "next/link";
import { listAdminUsers } from "@/lib/adminData";
import { AdminActionButton, StatusPill } from "../../parts";
import { formatDate } from "../../format";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const params = await searchParams;
  const users = await listAdminUsers({ query: params.q, status: params.status });

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Users</p>
        <h1 className="mt-2 text-3xl font-semibold">用户管理</h1>
      </div>

      <form className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
        <input name="q" defaultValue={params.q ?? ""} placeholder="搜索邮箱或用户 ID" className="min-w-72 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground" />
        <select name="status" defaultValue={params.status ?? ""} className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground">
          <option value="">全部用户</option>
          <option value="normal">正常用户</option>
          <option value="banned">已封禁</option>
        </select>
        <button className="rounded-md bg-foreground px-4 py-2 text-sm text-background">筛选</button>
        <Link href="/admin/users" className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">清空</Link>
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">用户</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">课程/任务</th>
              <th className="px-4 py-3 font-medium">用量</th>
              <th className="px-4 py-3 font-medium">最近活动</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
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
                  <div className="flex flex-wrap gap-2">
                    {user.isBanned ? (
                      <AdminActionButton action="unban_user" payload={{ userId: user.id }} label="解封" confirmText={`确认解封用户 ${user.email}？`} />
                    ) : (
                      <AdminActionButton action="ban_user" payload={{ userId: user.id }} label="封禁" confirmText={`确认封禁用户 ${user.email}？`} variant="danger" />
                    )}
                    <ResetPasswordButton userId={user.id} email={user.email} />
                    {user.activeJobCount > 0 && (
                      <AdminActionButton action="cancel_active_jobs" payload={{ userId: user.id }} label="取消任务" confirmText={`确认取消 ${user.email} 的全部活跃任务？`} variant="danger" />
                    )}
                    <AdminActionButton action="delete_user" payload={{ userId: user.id }} label="删除用户" confirmText={`危险操作：确认硬删除用户 ${user.email}？该用户课程、章节、任务、批注、导出和用量记录都会被级联删除。`} variant="danger" />
                  </div>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">暂无用户。</td></tr>
            )}
          </tbody>
        </table>
      </div>
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
