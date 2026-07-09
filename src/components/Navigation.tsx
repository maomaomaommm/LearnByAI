"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BookOpen, LogOut, Menu, Sparkles, X } from "lucide-react";
import { ModelSettings } from "./ModelSettings";
import { ThemeToggle } from "./ThemeToggle";
import { useUser } from "@/lib/hooks/useUser";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function Navigation() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const user = useUser();

  if (pathname?.includes("/chapters/")) {
    return null;
  }

  const navLinks = [
    { label: "首页", href: "/" },
    { label: "课程", href: "/courses" },
    { label: "创建", href: "/create/mode" },
    { label: "关于", href: "/about" },
  ];

  const isActive = (href: string) =>
    pathname === href || (pathname?.startsWith(href) && href !== "/");

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    await supabase?.auth.signOut();
    setMobileOpen(false);
    router.replace("/");
    router.refresh();
  }

  return (
    <nav className="fixed left-0 right-0 top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-foreground transition-opacity hover:opacity-80"
        >
          <BookOpen size={20} className="text-primary" />
          <span className="font-mono text-base font-bold tracking-tight">LearnByAI</span>
          <Sparkles size={14} className="text-yellow-500" />
        </Link>

        <div className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-mono tracking-wider transition-colors hover:text-primary ${
                isActive(link.href) ? "font-medium text-primary" : "text-muted-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}
          {user === undefined ? null : user ? (
            <div className="flex items-center gap-2">
              <span className="max-w-[140px] truncate font-mono text-xs text-muted-foreground" title={user.email ?? ""}>{user.email}</span>
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <LogOut size={13} /> 退出
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className={`text-sm font-mono tracking-wider transition-colors hover:text-primary ${isActive("/login") ? "font-medium text-primary" : "text-muted-foreground"}`}
            >
              登录 / 注册
            </Link>
          )}
          <div className="ml-2 flex items-center gap-1">
            <ModelSettings showLabel />
            <ThemeToggle />
          </div>
        </div>

        <button
          type="button"
          className="p-2 -mr-2 md:hidden"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={mobileOpen ? "关闭导航菜单" : "打开导航菜单"}
        >
          {mobileOpen ? (
            <X size={22} className="text-foreground" />
          ) : (
            <Menu size={22} className="text-foreground" />
          )}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-background px-4 py-4 md:hidden">
          <div className="flex flex-col gap-3">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`block py-2 text-sm font-mono tracking-wider ${
                  isActive(link.href) ? "font-medium text-primary" : "text-muted-foreground"
                }`}
              >
                {link.label}
              </Link>
            ))}
            {user ? (
              <div className="flex items-center justify-between border-t border-border/50 pt-3">
                <span className="max-w-[180px] truncate font-mono text-xs text-muted-foreground">{user.email}</span>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground"
                >
                  <LogOut size={13} /> 退出
                </button>
              </div>
            ) : user === null ? (
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="block border-t border-border/50 pt-3 text-sm font-mono tracking-wider text-muted-foreground"
              >
                登录 / 注册
              </Link>
            ) : null}
            <div className="border-t border-border/50 pt-4">
              <div className="flex items-center gap-2">
                <ModelSettings size="icon" />
                <ThemeToggle />
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
