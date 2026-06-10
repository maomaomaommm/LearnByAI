"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Menu, Sparkles, X } from "lucide-react";
import { ModelSettings } from "./ModelSettings";
import { ThemeToggle } from "./ThemeToggle";

export function Navigation() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  if (pathname?.includes("/chapters/")) {
    return null;
  }

  const navLinks = [
    { label: "Home", href: "/" },
    { label: "Courses", href: "/courses" },
    { label: "Create", href: "/create" },
    { label: "Login", href: "/login" },
    { label: "About", href: "/about" },
  ];

  const isActive = (href: string) =>
    pathname === href || (pathname?.startsWith(href) && href !== "/");

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
          <div className="ml-2 flex items-center gap-1">
            <ModelSettings showLabel />
            <ThemeToggle />
          </div>
        </div>

        <button
          type="button"
          className="p-2 -mr-2 md:hidden"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
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
