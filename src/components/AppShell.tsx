"use client";

import { usePathname } from "next/navigation";
import { Navigation } from "./Navigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname === "/admin" || pathname?.startsWith("/admin/");

  return (
    <>
      {!isAdmin && <Navigation />}
      <div className={isAdmin ? "" : "pt-14"}>{children}</div>
    </>
  );
}
