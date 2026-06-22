import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { askTutor } from "@/lib/maol/client";
import { parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { withQuotaConsumption } from "@/lib/quota";
import { safeErrorMessage } from "@/lib/safeError";
import { deleteServerAnnotation, getServerCourse, listServerAnnotations, saveServerAnnotation, saveServerGenerationJob } from "@/lib/serverStore";
import { encodeSseEvent } from "@/lib/sse";
import { resolveModelOverrides } from "@/lib/userModelConfig";
import { Annotation, Chapter, Course } from "@/lib/types";

const TUTOR_ROUTE_TIMEOUT_MS = 65_000;

export const dynamic = "force-dynamic";

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

export async function DELETE(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await deleteServerAnnotation(id, request);
  return NextResponse.json({ deleted: true });
}

export async function POST(request: Request) {
  const input = await request.json();
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const anchor = await validateAnnotationAnchor(input.annotation, request);
  if ("response" in anchor) return anchor.response;

  const course = anchor.course ?? await resolveTutorCourse(input, request);
  const chapter = resolveTutorChapter(course, anchor.annotation);

  const userId = auth.userId;
  const headerOverrides = parseModelOverridesFromHeaders(request.headers);
  const overrides = await resolveModelOverrides(userId, headerOverrides);

  if (input.stream) {
    return handleStreamingPost({ input, userId, overrides, course, chapter, anchor, request });
  }

  try {
    const result = await withDeadline(withQuotaConsumption(userId, "ask_tutor", async () => {
      const response = await askTutor({
        topic: input.topic,
        selectedText: input.selectedText,
        question: input.question,
        history: input.history ?? [],
        context: course
          ? {
              goal: course.goal,
              learnerProfile: course.profile,
              teachingStyle: course.courseBible?.teachingStyle,
              styles: course.styles,
              learningMode: course.learningMode,
              chapterTitle: chapter?.title,
              chapterDescription: chapter?.description,
              chapterPurpose: chapter?.purpose,
              previousChapterTitle: previousChapter(course, chapter)?.title,
              nextChapterTitle: nextChapter(course, chapter)?.title,
              chapterSummary: chapter?.contract?.summaryForNext,
              terminology: course.courseBible?.terminology,
            }
          : undefined,
        overrides,
        onJobUpdate: async (updatedJob) => {
          await saveServerGenerationJob(updatedJob, request);
        },
      });
      if (response.job) {
        await saveServerGenerationJob(response.job, request);
      }

      let annotation: Annotation | undefined;
      const clientAnnotation = stripClientOnlyMessages(anchor.annotation);
      if (clientAnnotation) {
        const now = new Date().toISOString();
        annotation = clientAnnotation;
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

async function handleStreamingPost(params: {
  input: Record<string, unknown>;
  userId: string;
  overrides: ReturnType<typeof parseModelOverridesFromHeaders>;
  course: Course | undefined;
  chapter: Chapter | undefined;
  anchor: { annotation?: Annotation };
  request: Request;
}) {
  const { input, userId, overrides, course, chapter, anchor, request } = params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (event: string, data: string) => {
        controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
      };

      try {
        const result = await withDeadline(withQuotaConsumption(userId, "ask_tutor", async () => {
          let fullAnswer = "";
          let hasChunks = false;
          const response = await askTutor({
            topic: input.topic as string,
            selectedText: input.selectedText as string,
            question: input.question as string,
            history: (input.history as { role: "user" | "assistant"; content: string }[]) ?? [],
            context: course
              ? {
                  goal: course.goal,
                  learnerProfile: course.profile,
                  teachingStyle: course.courseBible?.teachingStyle,
              styles: course.styles,
              learningMode: course.learningMode,
                  chapterTitle: chapter?.title,
                  chapterDescription: chapter?.description,
                  chapterPurpose: chapter?.purpose,
                  previousChapterTitle: previousChapter(course, chapter)?.title,
                  nextChapterTitle: nextChapter(course, chapter)?.title,
                  chapterSummary: chapter?.contract?.summaryForNext,
                  terminology: course.courseBible?.terminology,
                }
              : undefined,
            overrides,
            onChunk: (chunk) => {
              hasChunks = true;
              fullAnswer += chunk;
              enqueue("token", JSON.stringify({ text: chunk }));
            },
            onJobUpdate: async (updatedJob) => {
              await saveServerGenerationJob(updatedJob, request);
            },
          });

          // Fallback: mock mode doesn't fire onChunk — use the full response
          if (!hasChunks && response.answer) {
            fullAnswer = response.answer;
            enqueue("token", JSON.stringify({ text: response.answer }));
          }

          if (response.job) {
            await saveServerGenerationJob(response.job, request);
          }

          let savedAnnotation: Annotation | undefined;
          const clientAnnotation = stripClientOnlyMessages(anchor.annotation);
          if (clientAnnotation) {
            const now = new Date().toISOString();
            const annotation = clientAnnotation;
            annotation.messages = [
              ...annotation.messages,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: fullAnswer,
              },
            ];
            annotation.createdAt = annotation.createdAt ?? now;
            savedAnnotation = await saveServerAnnotation(annotation, request);
          }

          return { fullAnswer, savedAnnotation };
        }), TUTOR_ROUTE_TIMEOUT_MS);

        if (!result.ok) {
          enqueue("error", JSON.stringify({ error: result.quota.message }));
        } else {
          enqueue("done", JSON.stringify({
            answer: result.value.fullAnswer,
            annotation: result.value.savedAnnotation ?? null,
          }));
        }
      } catch (error) {
        enqueue("error", JSON.stringify({
          error: tutorErrorMessage(error),
        }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function stripClientOnlyMessages(annotation: Annotation | undefined) {
  if (!annotation) return undefined;
  return {
    ...annotation,
    messages: annotation.messages.filter((message) => message.role !== "assistant" || message.content.trim()),
  };
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Tutor request timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (timeout) clearTimeout(timeout);
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

async function resolveTutorCourse(
  input: Record<string, unknown>,
  request: Request,
) {
  const courseId = input.courseId as string | undefined;
  if (!courseId) return undefined;
  return getServerCourse(courseId, request);
}

function resolveTutorChapter(
  course: Course | undefined,
  annotation?: Annotation,
) {
  if (!course) return undefined;
  const chapterId = annotation?.chapterId;
  if (!chapterId) return undefined;
  return course.chapters.find((ch) => ch.id === chapterId);
}

function previousChapter(course: Course | undefined, chapter: Chapter | undefined) {
  if (!course || !chapter) return undefined;
  const idx = course.chapters.findIndex((ch) => ch.id === chapter.id);
  return idx > 0 ? course.chapters[idx - 1] : undefined;
}

function nextChapter(course: Course | undefined, chapter: Chapter | undefined) {
  if (!course || !chapter) return undefined;
  const idx = course.chapters.findIndex((ch) => ch.id === chapter.id);
  return idx >= 0 && idx < course.chapters.length - 1 ? course.chapters[idx + 1] : undefined;
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
