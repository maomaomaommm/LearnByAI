import { NextResponse } from "next/server";
import { adminJsonError, requireAdminApiSession } from "@/lib/adminRoute";
import { listAdminExports } from "@/lib/adminData";

export async function GET(request: Request) {
  const auth = await requireAdminApiSession();
  if ("response" in auth) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    return NextResponse.json({
      exports: await listAdminExports({
        status: searchParams.get("status") ?? undefined,
        userId: searchParams.get("userId") ?? undefined,
      }),
    });
  } catch (error) {
    return adminJsonError(error, "读取导出记录失败。");
  }
}
