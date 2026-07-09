import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { normalizeTextbookMeta, validateTextbookMeta } from "@/lib/textbookOutline";
import { getServerCourse, saveServerCourse } from "@/lib/serverStore";
import type { TextbookMeta } from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const course = await getServerCourse(id, request);
  if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });
  if (course.contentMode !== "textbook") {
    return NextResponse.json({ error: "Course is not in textbook mode" }, { status: 400 });
  }

  return NextResponse.json({ textbookMeta: course.textbookMeta ?? null });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const course = await getServerCourse(id, request);
  if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });
  if (course.contentMode !== "textbook") {
    return NextResponse.json({ error: "Course is not in textbook mode" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { textbookMeta?: TextbookMeta };
  const textbookMeta = normalizeTextbookMeta(body.textbookMeta ?? course.textbookMeta);
  const validation = validateTextbookMeta(textbookMeta);
  if (validation) return NextResponse.json({ error: validation }, { status: 400 });

  const saved = await saveServerCourse({
    ...course,
    textbookMeta: {
      ...textbookMeta,
      // "confirmed" is only ever minted by the confirm endpoint (which builds
      // contracts and queues chapter jobs). A PUT can keep an already-confirmed
      // course confirmed, but a client-asserted "confirmed" on a draft would
      // skip that whole pipeline — so derive from server state, not the body.
      outlineStatus: course.textbookMeta?.outlineStatus === "confirmed" ? "confirmed" : "ready",
    },
  }, request);

  return NextResponse.json({ course: saved, textbookMeta: saved.textbookMeta });
}


