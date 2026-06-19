import { NextResponse } from "next/server";
import { adminJsonError, requireAdminApiSession } from "@/lib/adminRoute";
import { listAdminUsers } from "@/lib/adminData";

export async function GET(request: Request) {
  const auth = await requireAdminApiSession();
  if ("response" in auth) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    return NextResponse.json({
      users: await listAdminUsers({
        query: searchParams.get("q") ?? undefined,
        status: searchParams.get("status") ?? undefined,
      }),
    });
  } catch (error) {
    return adminJsonError(error, "读取用户列表失败。");
  }
}
