import { NextResponse } from "next/server";
import { canRunInternalWorkerRequest } from "@/lib/config";
import { illustrateChapter, isIllustrationEnabled } from "@/lib/illustration";
import { safeErrorMessage } from "@/lib/safeError";
import { getServerCourseForRender } from "@/lib/serverStore";
import { resolveModelOverrides } from "@/lib/userModelConfig";

/**
 * Beta: generate textbook illustrations for one chapter and insert them into
 * its content. Internal-secret gated (same trust model as the generation
 * worker) — not exposed to user UI yet.
 */
export async function POST(request: Request) {
  if (!canRunInternalWorkerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized worker request" }, { status: 401 });
  }
  if (!isIllustrationEnabled()) {
    return NextResponse.json({ error: "Illustration API is not configured." }, { status: 503 });
  }

  const input = (await request.json().catch(() => ({}))) as {
    courseId?: string;
    chapterId?: string;
    force?: boolean;
    plan?: unknown;
  };
  if (!input.courseId || !input.chapterId) {
    return NextResponse.json({ error: "courseId and chapterId are required." }, { status: 400 });
  }

  const course = await getServerCourseForRender(input.courseId);
  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  try {
    const overrides = await resolveModelOverrides(course.userId);
    const result = await illustrateChapter({
      course,
      chapterId: input.chapterId,
      overrides,
      force: input.force === true,
      plan: input.plan,
      request: requestForCourseOwner(request, course.userId),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "Illustration failed.") }, { status: 500 });
  }
}

// Same pattern as the generation worker: persistence helpers resolve the user
// from the request, so carry the course owner's id on the trusted request.
function requestForCourseOwner(request: Request, userId?: string) {
  const headers = new Headers(request.headers);
  if (userId) headers.set("x-learnbyai-user-id", userId);
  return new Request(request.url, { headers });
}
