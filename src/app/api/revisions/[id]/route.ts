import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { deleteServerRevision, getServerRevision } from "@/lib/serverStore";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const revision = await getServerRevision(id, request);
  if (!revision) return NextResponse.json({ error: "Revision not found" }, { status: 404 });

  await deleteServerRevision(id, request);
  return NextResponse.json({ deleted: true });
}
