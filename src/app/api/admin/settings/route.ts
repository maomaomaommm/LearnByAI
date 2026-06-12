import { NextResponse } from "next/server";
import { adminJsonError, requireAdminApiSession } from "@/lib/adminRoute";
import { getAdminSettings } from "@/lib/adminData";

export async function GET() {
  const auth = await requireAdminApiSession();
  if ("response" in auth) return auth.response;

  try {
    return NextResponse.json({ settings: await getAdminSettings() });
  } catch (error) {
    return adminJsonError(error, "读取系统设置失败。");
  }
}
