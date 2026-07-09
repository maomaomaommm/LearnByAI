import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import {
  createFailedFigureMarkdownRe,
  createFigureMarkdownRe,
  createTextbookMapFigure,
  parseFailedFigureMarker,
  regenerateChapterFigure,
  renumberChapterFigures,
} from "@/lib/figures";
import { markdownToSections } from "@/lib/maol/integrator";
import { parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { getServerCourse, saveServerCourse } from "@/lib/serverStore";
import { resolveModelOverrides } from "@/lib/userModelConfig";
import type { Chapter, Course, FigurePlaceholder } from "@/lib/types";

type RetryFigureInput = {
  courseId?: string;
  chapterId?: string;
  /** "book-map" retries the course-level textbook map instead of a chapter figure. */
  target?: "figure" | "book-map";
  label?: string;
  caption?: string;
  prompt?: string;
  diagramSpec?: string;
};

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as RetryFigureInput;
  if (!body.courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }

  const course = await getServerCourse(body.courseId, request);
  if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

  const headerOverrides = parseModelOverridesFromHeaders(request.headers);
  const overrides = await resolveModelOverrides(auth.userId, headerOverrides);

  if (body.target === "book-map") {
    return retryBookMap(course, overrides, request);
  }

  if (!body.chapterId) {
    return NextResponse.json({ error: "chapterId is required" }, { status: 400 });
  }
  const chapter = course.chapters.find((item) => item.id === body.chapterId);
  if (!chapter) return NextResponse.json({ error: "Chapter not found" }, { status: 404 });

  const content = getChapterBody(chapter);
  const chapterNumber = Math.max(0, course.chapters.findIndex((item) => item.id === chapter.id)) + 1;
  // A retry targets either an already-rendered figure or a failed-figure
  // marker (the case that needs retrying most).
  const match = findFigure(content, body) ?? findFailedFigure(content, body);
  if (!match) return NextResponse.json({ error: "Figure not found" }, { status: 404 });

  const placeholder: FigurePlaceholder = {
    caption: body.caption?.trim() || match.placeholder.caption,
    prompt: body.prompt?.trim() || match.placeholder.prompt,
    ...(body.diagramSpec?.trim()
      ? { diagramSpec: body.diagramSpec.trim() }
      : match.placeholder.diagramSpec
        ? { diagramSpec: match.placeholder.diagramSpec }
        : {}),
    textLabelsAllowed: match.placeholder.textLabelsAllowed ?? true,
  };

  try {
    const asset = await regenerateChapterFigure({
      course,
      chapter,
      label: match.label ?? `图 ${chapterNumber}.0`,
      order: figureOrderFromLabel(match.label),
      placeholder,
      overrides,
    });
    const replaced = `${content.slice(0, match.start)}${buildFigureMarkdown(asset.label ?? "图 0.0", asset.caption, asset.url ?? "")}${content.slice(match.end)}`;
    // Renumber by document order so numbering stays continuous — this also
    // assigns the right number when a previously failed figure comes back.
    const nextContent = renumberChapterFigures(replaced, chapterNumber);
    const note = `单图重试完成：${asset.generationMode === "model" ? "模型生图" : "代码渲染"}。`;
    const nextChapter: Chapter = {
      ...chapter,
      content: nextContent,
      sections: markdownToSections(chapter, nextContent),
      review: chapter.review ? `${chapter.review}\n${note}` : note,
    };
    const savedCourse = await saveServerCourse({
      ...course,
      chapters: course.chapters.map((item) => item.id === chapter.id ? nextChapter : item),
    }, request);
    return NextResponse.json({ course: savedCourse, chapter: nextChapter, asset });
  } catch (error) {
    return NextResponse.json({ error: publicSafeErrorMessage(error, "Figure retry failed.") }, { status: 500 });
  }
}

async function retryBookMap(
  course: Course,
  overrides: Awaited<ReturnType<typeof resolveModelOverrides>>,
  request: Request,
) {
  if (course.contentMode !== "textbook" || !course.textbookMeta) {
    return NextResponse.json({ error: "Course has no textbook map" }, { status: 400 });
  }
  try {
    const textbookMap = await createTextbookMapFigure(course, overrides);
    const savedCourse = await saveServerCourse({
      ...course,
      textbookMeta: { ...course.textbookMeta, textbookMap },
    }, request);
    return NextResponse.json({ course: savedCourse, asset: textbookMap });
  } catch (error) {
    return NextResponse.json({ error: publicSafeErrorMessage(error, "Textbook map retry failed.") }, { status: 500 });
  }
}

type FigureMatch = {
  start: number;
  end: number;
  label?: string;
  placeholder: FigurePlaceholder;
};

function findFigure(content: string, input: RetryFigureInput): FigureMatch | undefined {
  const re = createFigureMarkdownRe();
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const label = (match[1] ?? "").trim();
    const caption = ((match[4] ?? match[2]) ?? "").trim();
    if (!matchesTarget(input, label, caption)) continue;
    return {
      start: match.index,
      end: match.index + match[0].length,
      label,
      placeholder: {
        caption,
        prompt: `重新绘制教材插图：${caption}`,
        diagramSpec: caption,
      },
    };
  }
  return undefined;
}

function findFailedFigure(content: string, input: RetryFigureInput): FigureMatch | undefined {
  const re = createFailedFigureMarkdownRe();
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const placeholder = parseFailedFigureMarker(match[1] ?? "");
    if (!placeholder) continue;
    if (!matchesTarget(input, undefined, placeholder.caption)) continue;
    return {
      start: match.index,
      end: match.index + match[0].length,
      placeholder,
    };
  }
  return undefined;
}

function matchesTarget(input: RetryFigureInput, label: string | undefined, caption: string) {
  if (!input.label && !input.caption) return true;
  if (input.label && label && normalize(input.label) === normalize(label)) return true;
  if (input.caption && normalize(caption).includes(normalize(input.caption))) return true;
  return false;
}

function buildFigureMarkdown(label: string, caption: string, url: string) {
  return `![${label}　${caption}](${url})\n\n*${label}　${caption}*`;
}

function getChapterBody(chapter: Chapter) {
  return chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n") ?? "";
}

function figureOrderFromLabel(label: string | undefined) {
  const value = Number(label?.split(/[.\-]/u).at(-1));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function normalize(value: string) {
  return value.replace(/\s+/gu, "").trim();
}
