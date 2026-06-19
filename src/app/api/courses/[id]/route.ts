import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { shouldRunInlineGeneration } from "@/lib/config";
import { runChapterGenerationJob } from "@/lib/generationRunner";
import { createGenerationJob } from "@/lib/jobs";
import { parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { publicGenerationJob } from "@/lib/publicGenerationJob";
import { deleteServerCourse, getActiveServerGenerationJobForChapter, getServerCourse, saveServerGenerationJob, updateServerChapter } from "@/lib/serverStore";
import { resolveModelOverrides } from "@/lib/userModelConfig";
import { Chapter, Course, GenerationJob } from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const course = await getServerCourse(id, request);

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const { course: hydratedCourse, jobs } = await enqueueDraftReviewJobs(course, request, auth.userId);

  return NextResponse.json({ course: hydratedCourse, jobs: jobs.map(publicGenerationJob) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const deleted = await deleteServerCourse(id, request);
  if (!deleted) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

async function enqueueDraftReviewJobs(course: Course, request: Request, userId: string) {
  let nextCourse = course;
  const jobs: GenerationJob[] = [];
  const headerOverrides = parseModelOverridesFromHeaders(request.headers);
  const modelOverrides = await resolveModelOverrides(userId, headerOverrides);

  for (const chapter of course.chapters) {
    if (!needsDraftReview(chapter)) continue;

    const activeJob = await getActiveServerGenerationJobForChapter(chapter.id, request);
    if (activeJob) {
      jobs.push(activeJob);
      continue;
    }

    const job = createGenerationJob({
      type: "chapter",
      mode: "review_draft",
      courseId: course.id,
      chapterId: chapter.id,
      userId,
      activeAgent: "POLISHER",
      status: "queued",
      modelOverrides,
      message: "Draft queued for quality review.",
    });
    const persistedJob = await saveServerGenerationJob(job, request);
    jobs.push(persistedJob);
    nextCourse = await updateServerChapter(
      nextCourse,
      chapter.id,
      {
        status: "draft_ready",
        generationJobId: persistedJob.id,
      },
      request,
    );

    if (shouldRunInlineGeneration(request)) {
      scheduleDraftReview(request, persistedJob.id);
    }
  }

  return { course: nextCourse, jobs };
}

function needsDraftReview(chapter: Chapter) {
  if (chapter.qualityReport) return false;
  if (!chapter.content && !chapter.sections?.length) return false;
  const status = chapter.status ?? "pending";
  return status === "draft_ready" || status === "generating" || status === "queued";
}

function scheduleDraftReview(request: Request, jobId: string) {
  const runnerRequest = new Request(request.url, {
    headers: new Headers(request.headers),
  });

  void runChapterGenerationJob({
    jobId,
    request: runnerRequest,
  }).catch((error: unknown) => {
    console.error("Background draft quality review failed", error);
  });
}
