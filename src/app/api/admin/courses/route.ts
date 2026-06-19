import { NextResponse } from "next/server";
import { adminJsonError, requireAdminApiSession } from "@/lib/adminRoute";
import { listAdminCourses } from "@/lib/adminData";

export async function GET(request: Request) {
  const auth = await requireAdminApiSession();
  if ("response" in auth) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    return NextResponse.json({
      courses: await listAdminCourses({
        query: searchParams.get("q") ?? undefined,
        userId: searchParams.get("userId") ?? undefined,
        status: searchParams.get("status") ?? undefined,
      }),
    });
  } catch (error) {
    return adminJsonError(error, "读取课程列表失败。");
  }
}
