import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Legacy chapter generation endpoint is disabled. Use POST /api/chapters/:id/generate with an owned course.",
    },
    { status: 410 },
  );
}
