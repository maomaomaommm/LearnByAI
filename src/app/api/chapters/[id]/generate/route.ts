import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { shouldRunInlineGeneration } from "@/lib/config";
import { runChapterGenerationJob } from "@/lib/generationRunner";
import { createGenerationJob } from "@/lib/jobs";
import { parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { publicGenerationJob } from "@/lib/publicGenerationJob";
import { getActiveServerGenerationJobForChapter, getServerCourse, getServerGenerationJob, saveServerGenerationJob, snapshotChapterBeforeRegen, updateServerChapter } from "@/lib/serverStore";
import { resolveModelOverrides } from "@/lib/userModelConfig";
import { Chapter } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const input = (await request.json()) as { courseId: string; retry?: boolean };
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const course = await getServerCourse(input.courseId, request);

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const chapter = course.chapters.find((item) => item.id === id);
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  const userId = auth.userId;
  const headerOverrides = parseModelOverridesFromHeaders(request.headers);
  const overrides = await resolveModelOverrides(userId, headerOverrides);

  if (chapter.generationJobId) {
    const existingJob = await getServerGenerationJob(chapter.generationJobId, request);
    if (existingJob && isActiveJobStatus(existingJob.status)) {
      return NextResponse.json(
        {
          course,
          job: publicGenerationJob(existingJob),
          queued: true,
        },
        { status: 202 },
      );
    }
  }

  const activeJob = await getActiveServerGenerationJobForChapter(chapter.id, request);
  if (activeJob) {
    const updatedCourse =
      chapter.generationJobId === activeJob.id
        ? course
        : await updateServerChapter(
            course,
            id,
            {
              status: activeJob.status === "running" ? "generating" : "queued",
              generationJobId: activeJob.id,
            },
            request,
          );

    return NextResponse.json(
      {
        course: updatedCourse,
        job: publicGenerationJob(activeJob),
        queued: true,
      },
      { status: 202 },
    );
  }

  if (hasChapterBody(chapter) && !input.retry) {
    return NextResponse.json({
      content: chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n") ?? "",
      sections: chapter.sections ?? [],
      review: chapter.review ?? "",
      qualityReport: chapter.qualityReport,
    });
  }

  // Reaching here with an existing body means this is a retry/regeneration; snapshot
  // the current chapter so it can be reverted if the new generation is worse.
  if (hasChapterBody(chapter)) {
    await snapshotChapterBeforeRegen(course, id, request);
  }

  const job = createGenerationJob({
    type: "chapter",
    courseId: course.id,
    chapterId: chapter.id,
    userId,
    activeAgent: "AUTHOR",
    status: "queued",
    modelOverrides: overrides,
    message: "Chapter generation queued.",
  });
  const persistedJob = await saveServerGenerationJob(job, request);
  const updatedCourse = await updateServerChapter(
    course,
    id,
    {
      content: undefined,
      sections: undefined,
      review: undefined,
      qualityReport: undefined,
      status: "queued",
      generationJobId: persistedJob.id,
    },
    request,
  );

  if (shouldRunInlineGeneration(request)) {
    scheduleChapterGeneration(request, persistedJob.id);
  }

  return NextResponse.json(
    {
      course: updatedCourse,
      job: publicGenerationJob(persistedJob),
      queued: true,
    },
    { status: 202 },
  );
}

function hasChapterBody(chapter: Chapter) {
  return Boolean(chapter.content || chapter.sections?.length);
}

function isActiveJobStatus(status: string) {
  return ["pending", "queued", "retrying", "running"].includes(status);
}

function scheduleChapterGeneration(request: Request, jobId: string) {
  const runnerRequest = new Request(request.url, {
    headers: new Headers(request.headers),
  });

  void runChapterGenerationJob({
    jobId,
    request: runnerRequest,
  }).catch((error: unknown) => {
    console.error("Background chapter generation failed", error);
  });
}
