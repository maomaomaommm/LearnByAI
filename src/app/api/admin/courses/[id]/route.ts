import { NextResponse } from "next/server";
import { adminJsonError, requireAdminApiSession } from "@/lib/adminRoute";
import { getAdminCourse } from "@/lib/adminData";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApiSession();
  if ("response" in auth) return auth.response;

  try {
    const { id } = await params;
    const course = await getAdminCourse(id);
    if (!course) return NextResponse.json({ error: "课程不存在。" }, { status: 404 });
    return NextResponse.json({ course });
  } catch (error) {
    return adminJsonError(error, "读取课程详情失败。");
  }
}
