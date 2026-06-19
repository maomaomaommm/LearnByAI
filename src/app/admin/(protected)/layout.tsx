import Link from "next/link";
import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getAdminSessionFromCookies } from "@/lib/adminAuth";
import { AdminLogoutButton } from "../parts";

const NAV_ITEMS = [
  { href: "/admin", label: "总览" },
  { href: "/admin/users", label: "用户" },
  { href: "/admin/courses", label: "课程" },
  { href: "/admin/chapters", label: "章节" },
  { href: "/admin/jobs", label: "任务" },
  { href: "/admin/quality", label: "质检" },
  { href: "/admin/usage", label: "用量" },
  { href: "/admin/exports", label: "导出" },
  { href: "/admin/settings", label: "系统设置" },
  { href: "/admin/audit", label: "操作日志" },
];

export default async function AdminProtectedLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSessionFromCookies();
  if (!session) redirect("/admin/login");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link href="/admin" className="font-mono text-lg font-bold tracking-widest">
              LearnByAI 管理后台
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">当前管理员：{session.username}</p>
          </div>
          <nav className="flex flex-wrap items-center gap-2">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <a
              href="/project/default"
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Supabase 高级后台
            </a>
            <AdminLogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
