import { NextResponse } from "next/server";
import { adminJsonError, requireAdminApiSession } from "@/lib/adminRoute";
import { listAdminUsageEvents } from "@/lib/adminData";

export async function GET(request: Request) {
  const auth = await requireAdminApiSession();
  if ("response" in auth) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    return NextResponse.json({
      usage: await listAdminUsageEvents({
        action: searchParams.get("action") ?? undefined,
        userId: searchParams.get("userId") ?? undefined,
      }),
    });
  } catch (error) {
    return adminJsonError(error, "读取用量失败。");
  }
}
