import "server-only";

import { NextResponse } from "next/server";
import { getAdminSessionFromCookies } from "./adminAuth";

export async function requireAdminApiSession() {
  const session = await getAdminSessionFromCookies();
  if (session) return { session };
  return {
    response: NextResponse.json({ error: "需要管理员登录。" }, { status: 401 }),
  };
}

export function adminJsonError(error: unknown, fallback = "操作失败。", status = 500) {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status });
}
