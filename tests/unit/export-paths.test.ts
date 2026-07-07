import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { test } from "node:test";
import { createCourseExport, findExportAsset, readExportContent } from "../../src/lib/exports";
import { getLocalExportStoreDir, resolveLocalExportPath } from "../../src/lib/exportPaths";
import type { Course } from "../../src/lib/types";

test("local export paths stay inside the configured export directory", () => {
  const root = getLocalExportStoreDir();
  const path = resolveLocalExportPath("user/course/export.pdf", "fallback.pdf");
  const relativePath = relative(root, path);

  assert.ok(relativePath);
  assert.equal(isAbsolute(relativePath), false);
  assert.equal(relativePath.startsWith(".."), false);
  assert.match(relativePath.replace(/\\/gu, "/"), /^user\/course\/export\.pdf$/u);
});

test("local export path rejects traversal and absolute input", () => {
  assert.throws(() => resolveLocalExportPath("../secret.pdf", "fallback.pdf"), /Invalid export storage path/u);
  assert.throws(() => resolveLocalExportPath("user/../../secret.pdf", "fallback.pdf"), /Invalid export storage path/u);
  assert.throws(() => resolveLocalExportPath("/tmp/secret.pdf", "fallback.pdf"), /Invalid export storage path/u);
  assert.throws(() => resolveLocalExportPath("C:/tmp/secret.pdf", "fallback.pdf"), /Invalid export storage path/u);
  assert.throws(() => resolveLocalExportPath("user\\..\\secret.pdf", "fallback.pdf"), /Invalid export storage path/u);
});

test("PDF export uses a CJK-capable Type0 font instead of replacing non-ASCII text", () => {
  const source = readFileSync("src/lib/exports.ts", "utf8");
  assert.match(source, /\/Subtype \/Type0/u);
  assert.match(source, /\/Encoding \/UniGB-UCS2-H/u);
  assert.match(source, /Buffer\.from\(value, "utf16le"\)/u);
  assert.doesNotMatch(source, /replace\(\s*\/\[\^\\x20-\\x7E\]\/g,\s*"\?"/u);
});

test("PDF export writes a complete multi-page PDF and keeps a TeX source asset", async () => {
  const previousRenderer = process.env.LEARNBYAI_PDF_RENDERER;
  process.env.LEARNBYAI_PDF_RENDERER = "plain";
  try {
    const course = makeExportCourse();
    const job = await createCourseExport(course, "pdf", "local-export-user@example.com");
    const pdf = await readExportContent(job);
    const texAsset = findExportAsset(job, "tex");

    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.match(pdf.toString("utf8"), /\/Count [2-9]\d*/u);
    assert.ok(texAsset, "PDF export should store a TeX source asset");
    assert.equal(texAsset?.format, "tex");
    assert.equal(texAsset?.storageProvider, "local");

    const tex = (await readExportContent(job, texAsset)).toString("utf8");
    assert.match(tex, /\\documentclass\[UTF8\]\{ctexart\}/u);
    assert.match(tex, /\\section\{第一章 导出测试\}/u);
    assert.match(tex, /\$E=mc\^2\$/u);
    assert.match(tex, /第 160 行完整内容/u);
  } finally {
    if (previousRenderer === undefined) delete process.env.LEARNBYAI_PDF_RENDERER;
    else process.env.LEARNBYAI_PDF_RENDERER = previousRenderer;
  }
});

function makeExportCourse(): Course {
  const content = [
    "# 第一章 导出测试",
    "",
    "这里有一个公式 $E=mc^2$，应该保留在 TeX 源文件中。",
    "",
    ...Array.from({ length: 160 }, (_, index) => `第 ${index + 1} 行完整内容，用来确认 PDF 导出不会在第一页附近截断。`),
  ].join("\n");

  return {
    id: "course-export-test",
    topic: "导出测试课程",
    goal: "确认 PDF 和 TeX 导出",
    background: "测试用户",
    styles: [],
    learningMode: "standard",
    chapterCount: 1,
    difficulty: "intermediate",
    profile: "测试路线",
    courseBible: {
      targetLearner: "测试用户",
      finalOutcomes: ["完成导出"],
      teachingStyle: "清晰",
      prerequisites: [],
      globalNarrative: "测试",
      terminology: [],
      chapterDependencies: [],
    },
    chapters: [
      {
        id: "chapter-export-test",
        title: "第一章 导出测试",
        description: "测试导出",
        time: {
          readingMinutes: 10,
          exerciseMinutes: 0,
          practiceMinutes: 0,
          extensionMinutes: 0,
        },
        content,
        sections: [],
      },
    ],
    createdAt: new Date().toISOString(),
  };
}
