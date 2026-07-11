import { getTexProjectStoreDir } from "../src/lib/exportPaths";
import { createCourseExport } from "../src/lib/exports";
import { processChapterFigures } from "../src/lib/figures";
import { markdownToSections } from "../src/lib/maol/integrator";
import { postRepairMarkdown } from "../src/lib/prompts/formatGuard";
import { getServerCourseForRender, saveServerCourse, saveServerExport } from "../src/lib/serverStore";
import { resolveModelOverrides } from "../src/lib/userModelConfig";
import type { Course } from "../src/lib/types";
import { join } from "node:path";

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

for (const chapter of course.chapters) {
  const original = chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n") ?? "";
  if (!original.trim()) continue;

  const repaired = postRepairMarkdown(original);
  const figures = await processChapterFigures({
    course: working,
    chapter,
    content: repaired,
    overrides,
  });
  const nextContent = figures.content;
  renderedFigures += figures.assets.length;
  skippedFigures += figures.skipped.length;

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
  exportId: exportJob.id,
  fileName: exportJob.fileName,
  localPdfPath: join(getTexProjectStoreDir(), exportJob.id, "build", "main.pdf"),
}, null, 2));
