import { NextResponse } from "next/server";
import { adminJsonError, requireAdminApiSession } from "@/lib/adminRoute";
import { listAdminChapters } from "@/lib/adminData";

export async function GET(request: Request) {
  const auth = await requireAdminApiSession();
  if ("response" in auth) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    return NextResponse.json({
      chapters: await listAdminChapters({
        query: searchParams.get("q") ?? undefined,
        userId: searchParams.get("userId") ?? undefined,
        status: searchParams.get("status") ?? undefined,
      }),
    });
  } catch (error) {
    return adminJsonError(error, "读取章节失败。");
  }
}
