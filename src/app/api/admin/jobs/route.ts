import { NextResponse } from "next/server";
import { adminJsonError, requireAdminApiSession } from "@/lib/adminRoute";
import { listAdminJobs } from "@/lib/adminData";

export async function GET(request: Request) {
  const auth = await requireAdminApiSession();
  if ("response" in auth) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    return NextResponse.json({
      jobs: await listAdminJobs({
        query: searchParams.get("q") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        type: searchParams.get("type") ?? undefined,
        courseId: searchParams.get("courseId") ?? undefined,
        userId: searchParams.get("userId") ?? undefined,
      }),
    });
  } catch (error) {
    return adminJsonError(error, "读取任务列表失败。");
  }
}
