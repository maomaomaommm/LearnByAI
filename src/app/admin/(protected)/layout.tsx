import Link from "next/link";
import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getAdminSessionFromCookies } from "@/lib/adminAuth";
import { getAdminAttentionCounts } from "@/lib/adminData";
import { AdminLogoutButton, AdminNav } from "../parts";

export const dynamic = "force-dynamic";

export default async function AdminProtectedLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSessionFromCookies();
  if (!session) redirect("/admin/login");
  const badges = await getAdminAttentionCounts();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground lg:flex-row">
      <aside className="border-b border-border bg-card px-4 py-5 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="mb-5 px-2">
          <Link href="/admin" className="font-mono text-base font-bold tracking-widest">LearnByAI</Link>
          <p className="mt-1 text-xs text-muted-foreground">管理后台 · {session.username}</p>
        </div>
        <AdminNav badges={badges} />
        <div className="mt-6 border-t border-border px-2 pt-4">
          <AdminLogoutButton />
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
