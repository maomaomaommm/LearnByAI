import Link from "next/link";
import { listAdminUsageEvents, USAGE_ACTIONS } from "@/lib/adminData";
import { USAGE_ACTION_LABEL } from "../../parts";
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
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Usage</p>
        <h1 className="mt-2 text-3xl font-semibold">用量统计</h1>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        {USAGE_ACTIONS.map((action) => (
          <div key={action} className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">{USAGE_ACTION_LABEL[action]}</p>
            <p className="mt-3 font-mono text-2xl font-semibold">{totals[action] ?? 0}</p>
          </div>
        ))}
      </section>

      <form className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
        <select name="action" defaultValue={params.action ?? ""} className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground">
          <option value="">全部动作</option>
          {USAGE_ACTIONS.map((action) => <option key={action} value={action}>{USAGE_ACTION_LABEL[action]}</option>)}
        </select>
        <button className="rounded-md bg-foreground px-4 py-2 text-sm text-background">筛选</button>
        <Link href="/admin/usage" className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">清空</Link>
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="px-4 py-3 font-medium">动作</th><th className="px-4 py-3 font-medium">用户</th><th className="px-4 py-3 font-medium">时间</th><th className="px-4 py-3 font-medium">ID</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {usage.map((event) => (
              <tr key={event.id} className="hover:bg-muted/30">
                <td className="px-4 py-3">{USAGE_ACTION_LABEL[event.action] ?? event.action}</td>
                <td className="px-4 py-3 text-muted-foreground">{event.userEmail ?? event.userId ?? "未知用户"}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(event.createdAt)}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{event.id}</td>
              </tr>
            ))}
            {!usage.length && <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">暂无用量记录。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
