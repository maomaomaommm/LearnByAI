import { listAdminUsageEvents, USAGE_ACTIONS } from "@/lib/adminData";
import { USAGE_ACTION_LABEL } from "../../parts";
import { AdminFilterBar, AdminPageHeader, AdminTable, ADMIN_INPUT_CLASS } from "../../admin-ui";
import { formatDate } from "../../format";

export const dynamic = "force-dynamic";

export default async function AdminUsagePage({ searchParams }: { searchParams: Promise<{ action?: string; userId?: string }> }) {
  const params = await searchParams;
  const usage = await listAdminUsageEvents({ action: params.action, userId: params.userId });
  const totals = usage.reduce<Record<string, number>>((acc, event) => {
    acc[event.action] = (acc[event.action] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <AdminPageHeader title="用量统计" description="按动作统计的近期用量事件。" />

      <section className="grid gap-4 md:grid-cols-4">
        {USAGE_ACTIONS.map((action) => (
          <div key={action} className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">{USAGE_ACTION_LABEL[action]}</p>
            <p className="mt-3 font-mono text-2xl font-semibold">{totals[action] ?? 0}</p>
          </div>
        ))}
      </section>

      <AdminFilterBar clearHref="/admin/usage">
        <select name="action" defaultValue={params.action ?? ""} className={ADMIN_INPUT_CLASS + " w-auto"}>
          <option value="">全部动作</option>
          {USAGE_ACTIONS.map((action) => <option key={action} value={action}>{USAGE_ACTION_LABEL[action]}</option>)}
        </select>
        {params.userId && <input type="hidden" name="userId" value={params.userId} />}
      </AdminFilterBar>

      <AdminTable head={["动作", "用户", "时间", "ID"]} isEmpty={!usage.length} empty="暂无用量记录。">
        {usage.map((event) => (
          <tr key={event.id} className="hover:bg-muted/30">
            <td className="px-4 py-3">{USAGE_ACTION_LABEL[event.action] ?? event.action}</td>
            <td className="px-4 py-3 text-muted-foreground">{event.userEmail ?? event.userId ?? "未知用户"}</td>
            <td className="px-4 py-3 text-muted-foreground">{formatDate(event.createdAt)}</td>
            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{event.id}</td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
