import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { shouldRunInlineGeneration } from "@/lib/config";
import { runCourseGenerationJob } from "@/lib/generationRunner";
import { createGenerationJob } from "@/lib/jobs";
import { parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { publicGenerationJob } from "@/lib/publicGenerationJob";
import { withQuotaConsumption } from "@/lib/quota";
import { listServerCourses, saveServerCourse, saveServerGenerationJob } from "@/lib/serverStore";
import { resolveModelOverrides } from "@/lib/userModelConfig";
import { normalizeContentMode, normalizeLearningMode, normalizeStyles } from "@/lib/normalizeCourse";
import { buildStyleGuidance } from "@/lib/prompts/styleGuidance";
import { ContentMode, Course, CourseDifficulty, ExplanationStyle, GenerationProfile, LearningMode } from "@/lib/types";

type CourseInput = {
  contentMode?: ContentMode;
  topic: string;
  goal: string;
  background: string;
  preference?: string;
  styles?: ExplanationStyle[];
  learningMode?: LearningMode;
  chapterCount?: number;
  difficulty?: CourseDifficulty;
  generationProfile?: GenerationProfile;
  includeRecentResearch?: boolean;
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
  const headerOverrides = parseModelOverridesFromHeaders(request.headers);
  const modelOverrides = await resolveModelOverrides(userId, headerOverrides);
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
  const styles = normalizeStyles(input.styles);
  const learningMode = normalizeLearningMode(input.learningMode);
  const preference = typeof input.preference === "string" ? input.preference : undefined;
  return {
    id: crypto.randomUUID(),
    userId,
    contentMode: normalizeContentMode(input.contentMode),
    topic: input.topic,
    goal: input.goal,
    background: input.background,
    preference,
    styles,
    learningMode,
    chapterCount: normalizeChapterCount(input.chapterCount),
    difficulty: normalizeDifficulty(input.difficulty),
    generationProfile: normalizeGenerationProfile(input.generationProfile),
    includeRecentResearch: input.includeRecentResearch === true,
    profile: "课程规划队列中。",
    courseBible: {
      targetLearner: input.background,
      finalOutcomes: [input.goal],
      teachingStyle: buildStyleGuidance(styles, preference),
      prerequisites: [],
      globalNarrative: "课程规划队列中。",
      terminology: [],
      chapterDependencies: [],
    },
    ...(normalizeContentMode(input.contentMode) === "textbook"
      ? {
          textbookMeta: {
            title: input.topic,
            subtitle: input.goal,
            language: "zh-CN" as const,
            outlineStatus: "planning" as const,
            numbering: {
              figurePrefix: "图",
              tablePrefix: "表",
              definitionPrefix: "定义",
              examplePrefix: "例",
              theoremPrefix: "定理",
              algorithmPrefix: "算法",
              equationStyle: "chapter" as const,
            },
          },
        }
      : {}),
    chapters: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeChapterCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 8;
  return Math.min(20, Math.max(3, Math.round(parsed)));
}

function normalizeDifficulty(value: unknown): CourseDifficulty {
  return value === "intro" || value === "research" ? value : "intermediate";
}

function normalizeGenerationProfile(value: unknown): GenerationProfile {
  return value === "deep" ? "deep" : "fast";
}
