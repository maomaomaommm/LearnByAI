import Link from "next/link";
import { listAdminExports } from "@/lib/adminData";
import { AdminActionButton, JOB_STATUS_LABEL, StatusPill } from "../../parts";
import { formatDate } from "../../format";

export const dynamic = "force-dynamic";

export default async function AdminExportsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  const exports = await listAdminExports({ status: params.status });

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Exports</p>
        <h1 className="mt-2 text-3xl font-semibold">导出管理</h1>
      </div>

      <form className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
        <select name="status" defaultValue={params.status ?? ""} className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground">
          <option value="">全部状态</option>
          <option value="pending">待处理</option>
          <option value="running">运行中</option>
          <option value="succeeded">已完成</option>
          <option value="failed">失败</option>
        </select>
        <button className="rounded-md bg-foreground px-4 py-2 text-sm text-background">筛选</button>
        <Link href="/admin/exports" className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">清空</Link>
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="px-4 py-3 font-medium">导出</th><th className="px-4 py-3 font-medium">课程</th><th className="px-4 py-3 font-medium">用户</th><th className="px-4 py-3 font-medium">状态</th><th className="px-4 py-3 font-medium">时间</th><th className="px-4 py-3 font-medium">操作</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {exports.map((item) => (
              <tr key={item.id} className="align-top hover:bg-muted/30">
                <td className="px-4 py-3">
                  <p className="font-medium">{item.fileName ?? `${item.id}.${item.format}`}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.format} · {item.storageProvider ?? "local"}</p>
                </td>
                <td className="px-4 py-3">{item.courseTopic ? <Link href={`/admin/courses/${item.courseId}`} className="hover:underline">{item.courseTopic}</Link> : item.courseId}</td>
                <td className="px-4 py-3 text-muted-foreground">{item.userEmail ?? item.userId ?? "未知用户"}</td>
                <td className="px-4 py-3"><StatusPill tone={item.status === "failed" ? "bad" : item.status === "succeeded" ? "good" : "info"}>{JOB_STATUS_LABEL[item.status] ?? item.status}</StatusPill></td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(item.createdAt)}</td>
                <td className="px-4 py-3"><AdminActionButton action="delete_export" payload={{ exportId: item.id }} label="删除记录" confirmText={`确认删除导出记录 ${item.id}？`} variant="danger" /></td>
              </tr>
            ))}
            {!exports.length && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">暂无导出记录。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
