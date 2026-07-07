import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { shouldRunInlineGeneration } from "@/lib/config";
import { runCourseGenerationJob } from "@/lib/generationRunner";
import { createGenerationJob } from "@/lib/jobs";
import { parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { publicGenerationJob } from "@/lib/publicGenerationJob";
import { withQuotaConsumption } from "@/lib/quota";
import { listServerCourses, saveServerCourse, saveServerGenerationJob } from "@/lib/serverStore";
import { extractCourseMaterials } from "@/lib/courseMaterials";
import { ChapterLength, Course, CourseInputMaterial, CourseMaterialPurpose } from "@/lib/types";

type CourseInput = {
  topic: string;
  goal: string;
  background: string;
  preference: string;
  weeklyHours: number;
  chapterLength?: ChapterLength;
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

async function parseCourseInput(request: Request): Promise<CourseInput> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return (await request.json()) as CourseInput;
  }

  const form = await request.formData();
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
    topic: formString(form, "topic"),
    goal: formString(form, "goal"),
    background: formString(form, "background"),
    preference: formString(form, "preference"),
    weeklyHours: Number(formString(form, "weeklyHours") || 6),
    chapterLength: normalizeChapterLength(formString(form, "chapterLength")),
    ...materials,
  };
}

function readFiles(form: FormData, key: string): File[] {
  return form.getAll(key).filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

function formString(form: FormData, key: string) {
  return String(form.get(key) ?? "");
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
    topic: input.topic,
    goal: input.goal,
    background: input.background,
    preference: input.preference,
    weeklyHours: input.weeklyHours,
    chapterLength: normalizeChapterLength(input.chapterLength),
    courseRequirements: input.courseRequirements,
    referenceMaterial: input.referenceMaterial,
    styleSample: input.styleSample,
    inputMaterials: input.inputMaterials,
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
