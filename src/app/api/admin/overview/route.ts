import { NextResponse } from "next/server";
import { adminJsonError, requireAdminApiSession } from "@/lib/adminRoute";
import { getAdminOverview } from "@/lib/adminData";

export async function GET() {
  const auth = await requireAdminApiSession();
  if ("response" in auth) return auth.response;

  try {
    return NextResponse.json(await getAdminOverview());
  } catch (error) {
    return adminJsonError(error, "读取后台总览失败。");
  }
}
