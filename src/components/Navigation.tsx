"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, BookOpen, Sparkles } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

export function Navigation() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Hide navigation on the reader page
  if (pathname?.includes("/chapters/")) {
    return null;
  }

  const navLinks = [
    { label: "首页", href: "/" },
    { label: "我的课程", href: "/courses" },
    { label: "创建课程", href: "/create" },
    { label: "关于", href: "/about" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 h-14">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity">
          <BookOpen size={20} className="text-primary" />
          <span className="font-mono text-base font-bold tracking-tight">
            LearnByAI
          </span>
          <Sparkles size={14} className="text-yellow-500" />
        </Link>

        {/* Desktop Nav */}
        <div className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-mono tracking-wider transition-colors hover:text-primary ${
                pathname === link.href || (pathname?.startsWith(link.href) && link.href !== "/")
                  ? "text-primary font-medium"
                  : "text-muted-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <div className="ml-2">
            <ThemeToggle />
          </div>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden p-2 -mr-2"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? (
            <X size={22} className="text-foreground" />
          ) : (
            <Menu size={22} className="text-foreground" />
          )}
        </button>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="border-t border-border bg-background px-4 py-4 md:hidden">
          <div className="flex flex-col gap-3">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`block py-2 text-sm font-mono tracking-wider ${
                  pathname === link.href || (pathname?.startsWith(link.href) && link.href !== "/")
                    ? "text-primary font-medium"
                    : "text-muted-foreground"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-4 border-t border-border/50">
              <ThemeToggle />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
