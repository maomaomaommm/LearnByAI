"use client";

import { usePathname } from "next/navigation";
import { ModelConfigWarning } from "./ModelConfigWarning";
import { Navigation } from "./Navigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname === "/admin" || pathname?.startsWith("/admin/");
  // The internal print route renders a bare, chrome-free document for PDF export.
  const isBare = pathname?.startsWith("/internal/print");

  if (isBare) return <>{children}</>;

  return (
    <>
      {!isAdmin && <Navigation />}
      <div className={isAdmin ? "" : "pt-14"}>
        {!isAdmin && <ModelConfigWarning />}
        {children}
      </div>
    </>
  );
}
