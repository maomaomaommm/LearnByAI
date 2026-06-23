import Link from "next/link";
import { listAdminExports } from "@/lib/adminData";
import { AdminActionButton, JOB_STATUS_LABEL, StatusPill } from "../../parts";
import { AdminFilterBar, AdminPageHeader, AdminTable, ADMIN_INPUT_CLASS } from "../../admin-ui";
import { formatDate } from "../../format";

export const dynamic = "force-dynamic";

export default async function AdminExportsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  const exports = await listAdminExports({ status: params.status });

  return (
    <div className="space-y-6">
      <AdminPageHeader title="导出管理" description="用户导出记录与状态。" />

      <AdminFilterBar clearHref="/admin/exports">
        <select name="status" defaultValue={params.status ?? ""} className={ADMIN_INPUT_CLASS + " w-auto"}>
          <option value="">全部状态</option>
          <option value="pending">待处理</option>
          <option value="running">运行中</option>
          <option value="succeeded">已完成</option>
          <option value="failed">失败</option>
        </select>
      </AdminFilterBar>

      <AdminTable head={["导出", "课程", "用户", "状态", "时间", "操作"]} isEmpty={!exports.length} empty="暂无导出记录。">
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
      </AdminTable>
    </div>
  );
}
