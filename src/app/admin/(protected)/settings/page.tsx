import { getAdminSettings } from "@/lib/adminData";
import { AdminSettingsForm } from "../../settings-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const settings = await getAdminSettings();

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold">系统设置</h1>
        <p className="mt-2 text-sm text-muted-foreground">后台设置会作为环境变量之上的全局默认值，新任务会读取这些配置。</p>
      </div>
      <AdminSettingsForm settings={settings} />
    </div>
  );
}
