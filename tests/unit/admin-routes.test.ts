import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const protectedRoutes = [
  "src/app/api/admin/overview/route.ts",
  "src/app/api/admin/courses/route.ts",
  "src/app/api/admin/courses/[id]/route.ts",
  "src/app/api/admin/jobs/route.ts",
  "src/app/api/admin/users/route.ts",
  "src/app/api/admin/chapters/route.ts",
  "src/app/api/admin/quality/route.ts",
  "src/app/api/admin/usage/route.ts",
  "src/app/api/admin/exports/route.ts",
  "src/app/api/admin/settings/route.ts",
  "src/app/api/admin/audit/route.ts",
  "src/app/api/admin/actions/route.ts",
];

test("admin API routes require admin session auth", () => {
  for (const route of protectedRoutes) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /requireAdminApiSession/u, `${route} should require admin session`);
    assert.doesNotMatch(source, /requireApiUser/u, `${route} must not accept ordinary user bearer auth`);
  }
});

test("admin actions include common management capabilities and guard direct active-job deletion", () => {
  const route = readFileSync("src/app/api/admin/actions/route.ts", "utf8");
  const data = readFileSync("src/lib/adminData.ts", "utf8");

  for (const action of [
    "delete_user",
    "ban_user",
    "unban_user",
    "reset_user_password",
    "create_course",
    "update_course",
    "delete_course",
    "delete_chapter",
    "repair_chapter_status",
    "cancel_job",
    "delete_job",
    "retry_job",
    "cancel_active_jobs",
    "save_settings",
  ]) {
    assert.match(route, new RegExp(action, "u"));
  }

  assert.match(data, /ACTIVE_ADMIN_JOB_STATUSES\.includes\(job\.status\).*活跃任务不能直接删除/su);
});

test("dangerous admin actions write audit logs", () => {
  const data = readFileSync("src/lib/adminData.ts", "utf8");

  for (const action of [
    "delete_user",
    "ban_user",
    "unban_user",
    "reset_user_password",
    "create_course",
    "update_course",
    "delete_course",
    "delete_chapter",
    "delete_job",
    "retry_job",
    "save_settings",
  ]) {
    assert.match(data, new RegExp(`recordAdminAudit\\(context, "${action}"`, "u"));
  }
});

test("admin pages hide the public navigation shell for admin routes", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const shell = readFileSync("src/components/AppShell.tsx", "utf8");

  assert.match(layout, /<AppShell>\{children\}<\/AppShell>/u);
  assert.match(shell, /pathname.*startsWith\("\/admin\/"\)/u);
  assert.match(shell, /!\s*isAdmin && <Navigation/u);
  assert.match(shell, /isAdmin \? "" : "pt-14"/u);
});
