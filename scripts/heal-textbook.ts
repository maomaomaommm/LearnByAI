import { getTexProjectStoreDir } from "../src/lib/exportPaths";
import { createCourseExport } from "../src/lib/exports";
import {
  createFailedFigureMarkdownRe,
  parseFailedFigureMarker,
  processChapterFigures,
  regenerateChapterFigure,
  renumberChapterFigures,
} from "../src/lib/figures";
import { markdownToSections } from "../src/lib/maol/integrator";
import { postRepairMarkdown } from "../src/lib/prompts/formatGuard";
import { getServerCourseForRender, saveServerCourse, saveServerExport } from "../src/lib/serverStore";
import { resolveModelOverrides } from "../src/lib/userModelConfig";
import type { Course } from "../src/lib/types";
import { join } from "node:path";

async function main() {
const courseId = process.argv[2]?.trim();
if (!courseId) {
  throw new Error("Usage: tsx scripts/heal-textbook.ts <course-id>");
}

const course = await getServerCourseForRender(courseId);
if (!course) throw new Error(`Course not found: ${courseId}`);
if (!course.userId) throw new Error("Course has no user owner.");

const secret = process.env.INTERNAL_WORKER_SECRET;
if (!secret) throw new Error("INTERNAL_WORKER_SECRET is required for a production healing run.");

const request = new Request("http://learnbyai.internal/heal-textbook", {
  headers: {
    "x-internal-worker-secret": secret,
    "x-learnbyai-user-id": course.userId,
  },
});
const overrides = await resolveModelOverrides(course.userId);

let working: Course = course;
let changedChapters = 0;
let renderedFigures = 0;
let skippedFigures = 0;
let retriedFailedFigures = 0;

for (const chapter of course.chapters) {
  const original = chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n") ?? "";
  if (!original.trim()) continue;

  const retried = await retryFailedChapterFigures(
    postRepairMarkdown(original),
    working,
    chapter,
    overrides,
  );
  const figures = await processChapterFigures({
    course: working,
    chapter,
    content: retried.content,
    overrides,
  });
  const nextContent = figures.content;
  renderedFigures += figures.assets.length;
  skippedFigures += figures.skipped.length;
  retriedFailedFigures += retried.retried;

  if (nextContent === original) continue;
  changedChapters += 1;
  working = {
    ...working,
    chapters: working.chapters.map((item) =>
      item.id === chapter.id
        ? {
            ...item,
            content: nextContent,
            sections: markdownToSections(item, nextContent),
          }
        : item,
    ),
  };
}

const saved = await saveServerCourse(working, request);
const exportJob = await createCourseExport(saved, "pdf", saved.userId);
await saveServerExport(exportJob, request);

console.log(JSON.stringify({
  courseId: saved.id,
  changedChapters,
  renderedFigures,
  skippedFigures,
  retriedFailedFigures,
  exportId: exportJob.id,
  fileName: exportJob.fileName,
  localPdfPath: join(getTexProjectStoreDir(), exportJob.id, "build", "main.pdf"),
}, null, 2));
}

async function retryFailedChapterFigures(
  content: string,
  currentCourse: Course,
  chapter: Course["chapters"][number],
  overrides: Awaited<ReturnType<typeof resolveModelOverrides>>,
) {
  const chapterNumber = Math.max(0, currentCourse.chapters.findIndex((item) => item.id === chapter.id)) + 1;
  const re = createFailedFigureMarkdownRe();
  let output = "";
  let last = 0;
  let retried = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(content))) {
    const placeholder = parseFailedFigureMarker(match[1] ?? "");
    if (!placeholder) continue;

    try {
      const asset = await regenerateChapterFigure({
        course: currentCourse,
        chapter,
        label: `图 ${chapterNumber}.0`,
        order: 1,
        placeholder,
        overrides,
      });
      output += content.slice(last, match.index);
      output += `![${asset.label ?? `图 ${chapterNumber}.0`}　${asset.caption}](${asset.url})\n\n*${asset.label ?? `图 ${chapterNumber}.0`}　${asset.caption}*`;
      last = match.index + match[0].length;
      retried += 1;
    } catch {
      // Keep the original marker when the upstream image provider is still
      // unavailable; a later healing run can retry the exact same payload.
    }
  }

  if (last === 0) return { content, retried };
  return {
    content: renumberChapterFigures(`${output}${content.slice(last)}`, chapterNumber),
    retried,
  };
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
