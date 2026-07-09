import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { normalizeTextbookMeta, validateTextbookMeta } from "@/lib/textbookOutline";
import { shouldRunInlineGeneration } from "@/lib/config";
import { createTextbookMapFigure } from "@/lib/figures";
import { runChapterGenerationJob } from "@/lib/generationRunner";
import { createGenerationJob } from "@/lib/jobs";
import { parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { publicGenerationJob } from "@/lib/publicGenerationJob";
import { safeErrorMessage } from "@/lib/safeError";
import {
  getActiveServerGenerationJobForChapter,
  getServerCourse,
  saveServerCourse,
  saveServerGenerationJobs,
} from "@/lib/serverStore";
import { resolveModelOverrides } from "@/lib/userModelConfig";
import type {
  Chapter,
  ChapterContract,
  Course,
  FigureAsset,
  GenerationJob,
  TextbookMeta,
  TextbookOutlineChapter,
} from "@/lib/types";

export async function POST(
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

  const textbookMeta = normalizeTextbookMeta(course.textbookMeta);
  const validation = validateTextbookMeta(textbookMeta);
  if (validation) return NextResponse.json({ error: validation }, { status: 400 });

  const headerOverrides = parseModelOverridesFromHeaders(request.headers);
  const modelOverrides = await resolveModelOverrides(auth.userId, headerOverrides);
  const preparedChapters = buildChaptersFromOutline(course, textbookMeta);
  const existingJobs: GenerationJob[] = [];
  const newJobs: GenerationJob[] = [];

  for (const chapter of preparedChapters) {
    if (!shouldQueueChapter(chapter)) continue;
    const activeJob = await getActiveServerGenerationJobForChapter(chapter.id, request);
    if (activeJob) {
      existingJobs.push(activeJob);
      chapter.status = "queued";
      chapter.generationJobId = activeJob.id;
      continue;
    }

    const job = createGenerationJob({
      type: "chapter",
      courseId: course.id,
      chapterId: chapter.id,
      userId: auth.userId,
      activeAgent: "AUTHOR",
      status: "queued",
      modelOverrides,
      message: "Textbook chapter queued for generation.",
    });
    newJobs.push(job);
    chapter.status = "queued";
    chapter.generationJobId = job.id;
  }

  const textbookMap = await createTextbookMapSafely({
    ...course,
    chapters: preparedChapters,
    textbookMeta,
  }, modelOverrides);

  const courseToSave: Course = {
    ...course,
    chapters: preparedChapters,
    courseBible: {
      ...course.courseBible,
      chapterContracts: preparedChapters.map((chapter) => chapter.contract).filter(Boolean) as ChapterContract[],
      chapterDependencies: preparedChapters.map((chapter, index) => ({
        chapterTitle: chapter.title,
        dependsOn: index > 0 ? [preparedChapters[index - 1]!.title] : [],
        introduces: chapter.contract?.requiredTopics.slice(0, 3) ?? [],
        preparesFor: index < preparedChapters.length - 1 ? [preparedChapters[index + 1]!.title] : [],
      })),
    },
    textbookMeta: {
      ...textbookMeta,
      outlineStatus: "confirmed",
      ...(textbookMap ? { textbookMap } : {}),
    },
    updatedAt: new Date().toISOString(),
  };

  const savedCourse = await saveServerCourse(courseToSave, request);
  const savedNewJobs = await saveServerGenerationJobs(newJobs, request);
  const jobs = [...existingJobs, ...savedNewJobs];

  const firstNewJob = savedNewJobs[0];
  if (firstNewJob && shouldRunInlineGeneration(request)) {
    scheduleChapterGeneration(request, firstNewJob.id);
  }

  return NextResponse.json({
    course: savedCourse,
    jobs: jobs.map(publicGenerationJob),
  });
}



function buildChaptersFromOutline(course: Course, meta: TextbookMeta): Chapter[] {
  const outlineChapters = meta.outline?.chapters ?? [];
  return outlineChapters.map((outlineChapter, index) => {
    const existing = course.chapters.find((chapter) => chapter.id === outlineChapter.id);
    const previous = outlineChapters[index - 1];
    const next = outlineChapters[index + 1];
    const contract = buildContract(outlineChapter, previous, next);
    return {
      id: outlineChapter.id || existing?.id || crypto.randomUUID(),
      title: outlineChapter.title.trim(),
      description: outlineChapter.description.trim(),
      minutes: existing?.minutes,
      purpose: existing?.purpose ?? outlineChapter.description.trim(),
      connectionFromPrevious: existing?.connectionFromPrevious ?? (previous ? `承接《${previous.title}》的关键概念。` : "说明全书背景、研究近况与学习路径。"),
      setupForNext: existing?.setupForNext ?? (next ? `为《${next.title}》准备必要概念。` : "回收全书主线并给出后续展望。"),
      contract,
      time: existing?.time ?? {
        readingMinutes: outlineChapter.fixedRole ? 90 : 150,
        exerciseMinutes: outlineChapter.fixedRole ? 30 : 90,
        practiceMinutes: outlineChapter.fixedRole ? 30 : 120,
        extensionMinutes: outlineChapter.fixedRole ? 30 : 60,
      },
      depthWeight: existing?.depthWeight ?? (outlineChapter.fixedRole ? "light" : "normal"),
      status: existing?.status === "ready" ? "ready" : "pending",
      content: existing?.content,
      review: existing?.review,
      sections: existing?.sections,
      qualityReport: existing?.qualityReport,
      generationJobId: existing?.generationJobId,
    };
  });
}

function buildContract(
  chapter: TextbookOutlineChapter,
  previous: TextbookOutlineChapter | undefined,
  next: TextbookOutlineChapter | undefined,
): ChapterContract {
  const requiredTopics = chapter.fixedRole
    ? [chapter.description]
    : chapter.sections.map((section) => `${section.order + 1}. ${section.title}：${section.description}`).slice(0, 8);

  return {
    chapterTitle: chapter.title,
    requiredTopics: requiredTopics.filter(Boolean),
    bridgeFromPrevious: previous ? `从《${previous.title}》自然过渡到本章问题。` : "以背景、研究近况和前沿信息建立全书问题意识。",
    bridgeToNext: next ? `本章结尾要为《${next.title}》留下明确问题。` : "总结全书脉络，给出展望、阅读建议和对读者的鼓励。",
    forbiddenEarlyTopics: next ? [`不要提前完整展开《${next.title}》的主体内容。`] : [],
    requiredExamples: chapter.fixedRole ? [] : ["至少包含一个服务本章核心概念的例子或示意图。"],
    requiredFormulas: [],
    summaryForNext: next ? `读完本章后，读者应能理解为什么下一章《${next.title}》是自然推进。` : "全书收束。呼应引言，指出可继续深入的方向。",
  };
}

function shouldQueueChapter(chapter: Chapter) {
  const status = chapter.status ?? "pending";
  return status === "pending" || status === "failed" || status === "quality_failed";
}

async function createTextbookMapSafely(course: Course, overrides: GenerationJob["modelOverrides"]) {
  try {
    return await createTextbookMapFigure(course, overrides);
  } catch (error) {
    const now = new Date().toISOString();
    const message = safeErrorMessage(error, "Textbook map generation failed.");
    const failedAsset: FigureAsset = {
      id: crypto.randomUUID(),
      courseId: course.id,
      chapterId: "book-map",
      order: 0,
      label: "教材地图",
      caption: "全书结构地图",
      prompt: "根据确认后的教材大纲生成全书结构地图。",
      diagramSpec: course.chapters.map((chapter, index) => `${index + 1}. ${chapter.title}`).join("；"),
      textLabelsAllowed: true,
      generationMode: overrides?.image ? "model" : "code",
      status: "failed",
      error: message,
      createdAt: now,
      updatedAt: now,
    };
    return failedAsset;
  }
}

function scheduleChapterGeneration(request: Request, jobId: string) {
  const runnerRequest = new Request(request.url, {
    headers: new Headers(request.headers),
  });

  void runChapterGenerationJob({
    jobId,
    request: runnerRequest,
  }).catch((error: unknown) => {
    console.error("Background textbook chapter generation failed", error);
  });
}
