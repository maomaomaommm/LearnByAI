import { NextResponse } from "next/server";
import { getAdminCredentialsConfigured, setAdminSessionCookie, verifyAdminCredentials } from "@/lib/adminAuth";

export async function POST(request: Request) {
  const input = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  if (!getAdminCredentialsConfigured()) {
    return NextResponse.json({ error: "管理员登录服务未配置。" }, { status: 503 });
  }

  if (!verifyAdminCredentials(input.username ?? "", input.password ?? "")) {
    return NextResponse.json({ error: "管理员账号或密码不正确。" }, { status: 401 });
  }

  await setAdminSessionCookie(input.username ?? "");
  return NextResponse.json({ ok: true });
}
