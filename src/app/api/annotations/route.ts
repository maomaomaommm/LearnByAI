import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { askTutor } from "@/lib/maol/client";
import { explicitAgentOverride, parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { withQuotaConsumption } from "@/lib/quota";
import { safeErrorMessage } from "@/lib/safeError";
import { getServerCourse, listServerAnnotations, saveServerAnnotation, saveServerGenerationJob } from "@/lib/serverStore";
import { Annotation, Course } from "@/lib/types";

const TUTOR_ROUTE_TIMEOUT_MS = 65_000;

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { searchParams } = new URL(request.url);
  const chapterId = searchParams.get("chapterId");
  if (!chapterId) {
    return NextResponse.json({ error: "chapterId is required" }, { status: 400 });
  }

  return NextResponse.json({ annotations: await listServerAnnotations(chapterId, request) });
}

export async function POST(request: Request) {
  const input = await request.json();
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const annotationValidation = await validateAnnotationAnchor(input.annotation, request);
  if ("response" in annotationValidation) return annotationValidation.response;

  const userId = auth.userId;
  const overrides = explicitAgentOverride(parseModelOverridesFromHeaders(request.headers), "TUTOR");
  const tutorContext = annotationValidation.course && annotationValidation.annotation
    ? buildTutorContext(annotationValidation.course, annotationValidation.annotation)
    : undefined;
  try {
    const result = await withDeadline(withQuotaConsumption(userId, "ask_tutor", async () => {
      const response = await askTutor({
        topic: input.topic,
        selectedText: input.selectedText,
        question: input.question,
        history: input.history ?? [],
        context: tutorContext,
        overrides,
        onJobUpdate: async (updatedJob) => {
          await saveServerGenerationJob(updatedJob, request);
        },
      });
      if (response.job) {
        await saveServerGenerationJob(response.job, request);
      }

      let annotation: Annotation | undefined;
      if (annotationValidation.annotation) {
        const now = new Date().toISOString();
        annotation = annotationValidation.annotation;
        annotation.messages = [
          ...annotation.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: response.answer,
          },
        ];
        annotation.createdAt = annotation.createdAt ?? now;
        annotation = await saveServerAnnotation(annotation, request);
      }

      return { ...response, annotation };
    }), TUTOR_ROUTE_TIMEOUT_MS);
    if (!result.ok) {
      return NextResponse.json({ error: result.quota.message }, { status: 429 });
    }

    return NextResponse.json(result.value);
  } catch (error) {
    return NextResponse.json(
      { error: tutorErrorMessage(error) },
      { status: 502 },
    );
  }
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Tutor route timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function tutorErrorMessage(error: unknown) {
  const message = safeErrorMessage(error, "Tutor answer failed.");
  if (/timed out|timeout|aborted/i.test(message)) {
    return "导师回答超时，请稍后重试。";
  }
  if (/401|unauthorized|api key|authentication/i.test(message)) {
    return "AI 服务鉴权失败，请联系管理员检查模型配置。";
  }
  return "导师暂时无法回答，请稍后重试。";
}

async function validateAnnotationAnchor(annotationInput: unknown, request: Request) {
  if (!annotationInput) return {};

  const annotation = annotationInput as Annotation;
  if (!annotation.courseId) {
    return { response: NextResponse.json({ error: "Annotation courseId is required" }, { status: 400 }) };
  }

  const course = await getServerCourse(annotation.courseId, request);
  if (!course) {
    return { response: NextResponse.json({ error: "Course not found" }, { status: 404 }) };
  }

  if (!courseHasChapter(course, annotation.chapterId)) {
    return { response: NextResponse.json({ error: "Chapter not found" }, { status: 404 }) };
  }

  if (annotation.sectionId && !courseHasSection(course, annotation.chapterId, annotation.sectionId)) {
    return { response: NextResponse.json({ error: "Section not found" }, { status: 404 }) };
  }

  return { annotation, course };
}

function courseHasChapter(course: Course, chapterId: string) {
  return course.chapters.some((chapter) => chapter.id === chapterId);
}

function courseHasSection(course: Course, chapterId: string, sectionId: string) {
  return course.chapters
    .find((chapter) => chapter.id === chapterId)
    ?.sections?.some((section) => section.id === sectionId) ?? false;
}

function buildTutorContext(course: Course, annotation: Annotation) {
  const chapterIndex = course.chapters.findIndex((chapter) => chapter.id === annotation.chapterId);
  const chapter = course.chapters[chapterIndex];
  if (!chapter) return undefined;

  const chapterText = annotation.sectionId
    ? chapter.sections?.find((section) => section.id === annotation.sectionId)?.content
    : chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n");

  return {
    goal: course.goal,
    learnerProfile: course.profile,
    teachingStyle: course.courseBible.teachingStyle,
    chapterTitle: chapter.title,
    chapterDescription: chapter.description,
    chapterPurpose: chapter.purpose,
    previousChapterTitle: course.chapters[chapterIndex - 1]?.title,
    nextChapterTitle: course.chapters[chapterIndex + 1]?.title,
    chapterSummary: summarizeText(chapterText ?? ""),
    terminology: course.courseBible.terminology.slice(0, 12).map((item) => ({
      term: item.term,
      definition: item.definition,
    })),
  };
}

function summarizeText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
}
