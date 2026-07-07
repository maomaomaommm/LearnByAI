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
import { normalizeLearningMode, normalizeStyles } from "@/lib/normalizeCourse";
import { buildStyleGuidance } from "@/lib/prompts/styleGuidance";
import { extractCourseMaterials } from "@/lib/courseMaterials";
import { Course, CourseDifficulty, CourseInputMaterial, CourseMaterialPurpose, ExplanationStyle, GenerationProfile, LearningMode } from "@/lib/types";

type CourseInput = {
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
  courseRequirements?: string;
  referenceMaterial?: string;
  styleSample?: string;
  inputMaterials?: CourseInputMaterial[];
};

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  return NextResponse.json({ courses: await listServerCourses(request) });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const input = await parseCourseInput(request);
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

/**
 * 解析课程创建请求。同时支持两种 Content-Type：
 * - multipart/form-data：可携带上传文件（txt/md/pdf/docx），文本字段从 formData 读取
 * - application/json：保持原有行为，不带文件
 * 上传的文件会被提取为纯文本，按用途分为课程要求、参考资料和写作风格样例。
 */
async function parseCourseInput(request: Request): Promise<CourseInput> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();

    const styles = form.getAll("styles").map(String) as ExplanationStyle[];
    const directCount = Number(form.get("chapterCount"));
    const customCount = Number(form.get("chapterCountCustom"));
    const presetCount = Number(form.get("chapterCountPreset"));
    const chapterCount = Number.isFinite(directCount) && directCount > 0
      ? directCount
      : Number.isFinite(customCount) && customCount > 0
        ? customCount
        : (Number.isFinite(presetCount) && presetCount > 0 ? presetCount : 8);

    const materialEntries = readFiles(form, "materials");
    const legacyFileEntries = materialEntries.length ? [] : readFiles(form, "files");
    const files = materialEntries.length ? materialEntries : legacyFileEntries;
    const purposes = form.getAll("materialKinds").map(String);
    const materials = await extractCourseMaterials(
      files.map((file, index) => ({
        file,
        purpose: purposes[index] as CourseMaterialPurpose | undefined,
      })),
    );

    return {
      topic: String(form.get("topic") ?? ""),
      goal: String(form.get("goal") ?? ""),
      background: String(form.get("background") ?? ""),
      preference: String(form.get("preference") ?? "") || undefined,
      styles,
      learningMode: (String(form.get("learningMode") || "standard") as LearningMode),
      chapterCount,
      difficulty: (String(form.get("difficulty") || "intermediate") as CourseDifficulty),
      generationProfile: (String(form.get("generationProfile") || "fast") as GenerationProfile),
      includeRecentResearch: form.get("includeRecentResearch") === "on",
      ...materials,
    };
  }

  return (await request.json()) as CourseInput;
}

function readFiles(form: FormData, key: string): File[] {
  return form.getAll(key).filter((entry): entry is File => entry instanceof File && entry.size > 0);
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
    courseRequirements: input.courseRequirements,
    referenceMaterial: input.referenceMaterial,
    styleSample: input.styleSample,
    inputMaterials: input.inputMaterials,
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
