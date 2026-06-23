"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ChapterDepthWeight, CourseDifficulty } from "@/lib/types";

export const JOB_STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  queued: "队列中",
  running: "运行中",
  retrying: "重试中",
  succeeded: "已完成",
  failed: "失败",
};

export const CHAPTER_STATUS_LABEL: Record<string, string> = {
  pending: "待生成",
  queued: "队列中",
  generating: "生成中",
  draft_ready: "待质检",
  quality_failed: "质检未通过",
  ready: "质检通过",
  failed: "生成失败",
};

export const QUALITY_STATUS_LABEL: Record<string, string> = {
  passed: "质检通过",
  warning: "质检通过",
  failed: "质检未通过",
};

export const USAGE_ACTION_LABEL: Record<string, string> = {
  create_course: "创建课程",
  generate_chapter: "生成章节",
  ask_tutor: "导师问答",
  export: "导出",
  revise: "局部改写",
};

export const DIFFICULTY_LABEL: Record<CourseDifficulty, string> = {
  intro: "入门科普",
  intermediate: "进阶系统",
  research: "研究前沿",
};

export const DEPTH_LABEL: Record<ChapterDepthWeight, string> = {
  core: "核心章",
  normal: "常规章",
  light: "轻量章",
};

export function AdminLogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={loading}
      className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      {loading ? "退出中" : "退出"}
    </button>
  );
}

export function AdminActionButton({
  action,
  payload,
  label,
  confirmText,
  variant = "default",
}: {
  action: string;
  payload?: Record<string, unknown>;
  label: string;
  confirmText?: string;
  variant?: "default" | "danger";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runAction() {
    if (confirmText && !window.confirm(confirmText)) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(payload ?? {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "操作失败。");
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "操作失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={runAction}
        disabled={loading}
        className={
          variant === "danger"
            ? "rounded-md border border-destructive/30 px-2.5 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            : "rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        }
      >
        {loading ? "处理中" : label}
      </button>
      {error && <span className="max-w-64 text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function RowMenu({ children, label = "更多操作" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block text-left">
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        ⋯
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <span className="absolute right-0 z-20 mt-1 flex min-w-44 flex-col items-stretch gap-1 rounded-md border border-border bg-card p-2 shadow-md">
            {children}
          </span>
        </>
      )}
    </span>
  );
}

export function AdminJsonForm({
  action,
  children,
  confirmText,
  successPath,
}: {
  action: string;
  children: React.ReactNode;
  confirmText?: string;
  successPath?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmText && !window.confirm(confirmText)) return;
    setLoading(true);
    setError("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload: Record<string, unknown> = { action };
    for (const [key, value] of formData.entries()) {
      if (typeof value !== "string") continue;
      payload[key] = key.includes("Hours") || key.includes("Limit") || key.includes("Quota") ? Number(value) : value;
    }

    try {
      const response = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "保存失败。");
      if (successPath) router.push(successPath);
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "保存失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {children}
      {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <button type="submit" disabled={loading} className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50">
        {loading ? "保存中" : "保存"}
      </button>
    </form>
  );
}

type AdminNavBadges = { failedJobCount: number; qualityFailedCount: number };

const ADMIN_NAV_GROUPS: Array<{
  label: string;
  items: Array<{ href: string; label: string; badge?: "job" | "quality" }>;
}> = [
  {
    label: "运营监控",
    items: [
      { href: "/admin", label: "总览" },
      { href: "/admin/jobs", label: "任务", badge: "job" },
      { href: "/admin/quality", label: "质检", badge: "quality" },
      { href: "/admin/usage", label: "用量" },
    ],
  },
  {
    label: "内容资产",
    items: [
      { href: "/admin/users", label: "用户" },
      { href: "/admin/courses", label: "课程" },
      { href: "/admin/chapters", label: "章节" },
      { href: "/admin/exports", label: "导出" },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/admin/settings", label: "系统设置" },
      { href: "/admin/audit", label: "操作日志" },
    ],
  },
];

export function AdminNav({ badges }: { badges: AdminNavBadges }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  return (
    <nav className="space-y-5">
      {ADMIN_NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-2 pb-1.5 text-xs text-muted-foreground/70">{group.label}</p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(item.href);
              const badge = item.badge === "job" ? badges.failedJobCount : item.badge === "quality" ? badges.qualityFailedCount : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
                >
                  <span>{item.label}</span>
                  {item.badge && badge > 0 && (
                    <span
                      className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium ${item.badge === "job" ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-600 dark:text-amber-300"}`}
                    >
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      <div>
        <p className="px-2 pb-1.5 text-xs text-muted-foreground/70">外部</p>
        <a
          href="/project/default"
          className="block rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          Supabase 高级后台
        </a>
      </div>
    </nav>
  );
}

export function StatusPill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "good" | "warn" | "bad" | "info" }) {
  const className = {
    muted: "border-border bg-background text-muted-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    bad: "border-destructive/30 bg-destructive/10 text-destructive",
    info: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  }[tone];

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>{children}</span>;
}
