import { NextResponse } from "next/server";
import { readIllustrationImage } from "@/lib/illustration";

/**
 * Serves chapter illustrations referenced from chapter Markdown as
 * ![...](/api/illustrations/{courseId}/{chapterId}/{uuid}.png). <img> tags
 * cannot carry a bearer token, so this route is unauthenticated by design;
 * the path embeds an unguessable UUID filename and the strict shape check in
 * readIllustrationImage rejects anything else. Content is immutable once
 * written, hence the long cache.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const storagePath = (path ?? []).join("/");
  const image = await readIllustrationImage(storagePath);
  if (!image) {
    return NextResponse.json({ error: "Illustration not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
