import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { shouldRunInlineGeneration } from "@/lib/config";
import { runCourseGenerationJob } from "@/lib/generationRunner";
import { createGenerationJob } from "@/lib/jobs";
import { parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { publicGenerationJob } from "@/lib/publicGenerationJob";
import { withQuotaConsumption } from "@/lib/quota";
import { listServerCourses, saveServerCourse, saveServerGenerationJob } from "@/lib/serverStore";
import { ChapterLength, Course } from "@/lib/types";

type CourseInput = {
  topic: string;
  goal: string;
  background: string;
  preference: string;
  weeklyHours: number;
  chapterLength?: ChapterLength;
};

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  return NextResponse.json({ courses: await listServerCourses(request) });
}

export async function POST(request: Request) {
  const input = (await request.json()) as CourseInput;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const userId = auth.userId;
  const modelOverrides = parseModelOverridesFromHeaders(request.headers);
  const result = await withQuotaConsumption(userId, "create_course", async () => {
    const course = await saveServerCourse(createPendingCourse(input, userId), request);
    const job = createGenerationJob({
      type: "course",
      courseId: course.id,
      userId,
      activeAgent: "ARCHITECT",
      status: "pending",
      modelOverrides,
      message: "课程大纲规划已进入队列。",
    });
    const linkedCourse = await saveServerCourse({ ...course, generationJobId: job.id }, request);
    const persistedJob = await saveServerGenerationJob(job, request);
    return { course: linkedCourse, job: persistedJob };
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.quota.message }, { status: 429 });
  }

  const { course: linkedCourse, job: persistedJob } = result.value;

  if (shouldRunInlineGeneration(request)) {
    scheduleCoursePlanning(request, persistedJob.id);
  }
  return NextResponse.json({ course: linkedCourse, job: publicGenerationJob(persistedJob) });
}

function scheduleCoursePlanning(request: Request, jobId: string) {
  const runnerRequest = new Request(request.url, {
    headers: new Headers(request.headers),
  });

  void runCourseGenerationJob({
    jobId,
    request: runnerRequest,
  }).catch((error) => {
    console.error("Background course planning failed", error);
  });
}

function createPendingCourse(input: CourseInput, userId: string): Course {
  return {
    id: crypto.randomUUID(),
    userId,
    ...input,
    chapterLength: normalizeChapterLength(input.chapterLength),
    profile: "课程规划队列中。",
    courseBible: {
      targetLearner: input.background,
      finalOutcomes: [input.goal],
      teachingStyle: input.preference,
      prerequisites: [],
      globalNarrative: "课程规划队列中。",
      terminology: [],
      chapterDependencies: [],
    },
    chapters: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeChapterLength(value: unknown): ChapterLength {
  return value === "short" || value === "long" ? value : "medium";
}
