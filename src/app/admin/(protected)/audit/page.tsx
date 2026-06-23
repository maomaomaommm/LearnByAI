import { listAdminAuditLogs } from "@/lib/adminData";
import { AdminPageHeader, AdminTable } from "../../admin-ui";
import { formatDate } from "../../format";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const logs = await listAdminAuditLogs();

  return (
    <div className="space-y-6">
      <AdminPageHeader title="操作日志" description="管理员在后台执行过的全部操作记录。" />

      <AdminTable head={["时间", "管理员", "动作", "目标", "摘要"]} isEmpty={!logs.length} empty="暂无操作日志。">
        {logs.map((log) => (
          <tr key={log.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 text-muted-foreground">{formatDate(log.createdAt)}</td>
            <td className="px-4 py-3">{log.adminUsername}</td>
            <td className="px-4 py-3 font-mono text-xs">{log.action}</td>
            <td className="px-4 py-3 text-muted-foreground">{log.targetType}{log.targetId ? ` · ${log.targetId}` : ""}</td>
            <td className="px-4 py-3">{log.summary}</td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
