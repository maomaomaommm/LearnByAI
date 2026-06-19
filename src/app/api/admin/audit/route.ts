import { NextResponse } from "next/server";
import { adminJsonError, requireAdminApiSession } from "@/lib/adminRoute";
import { listAdminAuditLogs } from "@/lib/adminData";

export async function GET() {
  const auth = await requireAdminApiSession();
  if ("response" in auth) return auth.response;

  try {
    return NextResponse.json({ logs: await listAdminAuditLogs() });
  } catch (error) {
    return adminJsonError(error, "读取操作日志失败。");
  }
}
