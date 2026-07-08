import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { test } from "node:test";
import { getLocalExportStoreDir, resolveLocalExportPath } from "../../src/lib/exportPaths";

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

test("PDF export delegates to the headless renderer instead of stripping non-ASCII text", () => {
  const source = readFileSync("src/lib/exports.ts", "utf8");
  // PDF is now produced by a real headless browser (renderCoursePdf), which
  // renders CJK via system fonts — no hand-rolled PDF, no non-ASCII replacement.
  assert.match(source, /renderCoursePdf/u);
  assert.doesNotMatch(source, /STSong-Light/u);
  assert.doesNotMatch(source, /replace\(\s*\/\[\^\\x20-\\x7E\]\/g,\s*"\?"/u);
});
