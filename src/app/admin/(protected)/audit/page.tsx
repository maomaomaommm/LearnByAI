import { listAdminAuditLogs } from "@/lib/adminData";
import { formatDate } from "../../format";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const logs = await listAdminAuditLogs();

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Audit Logs</p>
        <h1 className="mt-2 text-3xl font-semibold">操作日志</h1>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="px-4 py-3 font-medium">时间</th><th className="px-4 py-3 font-medium">管理员</th><th className="px-4 py-3 font-medium">动作</th><th className="px-4 py-3 font-medium">目标</th><th className="px-4 py-3 font-medium">摘要</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-muted/30">
                <td className="px-4 py-3 text-muted-foreground">{formatDate(log.createdAt)}</td>
                <td className="px-4 py-3">{log.adminUsername}</td>
                <td className="px-4 py-3 font-mono text-xs">{log.action}</td>
                <td className="px-4 py-3 text-muted-foreground">{log.targetType}{log.targetId ? ` · ${log.targetId}` : ""}</td>
                <td className="px-4 py-3">{log.summary}</td>
              </tr>
            ))}
            {!logs.length && <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">暂无操作日志。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
