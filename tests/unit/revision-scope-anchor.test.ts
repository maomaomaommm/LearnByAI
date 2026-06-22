import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownSections, resolveRevisionScopeAnchor } from "../../src/lib/markdownSections";

const content = [
  "# 第一章：能量平衡",
  "",
  "## 1.1 净辐射",
  "",
  "净辐射是地表能量收支的核心。它由短波和长波组成。",
  "",
  "地表吸收的短波越多，可用能量越大。",
  "",
  "## 1.2 感热通量",
  "",
  "感热通量 $H$ 描述湍流向大气的热量输送。",
].join("\n");

test("selection scope returns the unique anchor", () => {
  const result = resolveRevisionScopeAnchor(content, "selection", "湍流向大气的热量输送");
  assert.equal(result, "湍流向大气的热量输送");
});

test("paragraph scope expands to the blank-line-delimited block", () => {
  const result = resolveRevisionScopeAnchor(content, "paragraph", "可用能量越大");
  assert.equal(result, "地表吸收的短波越多，可用能量越大。");
});

test("section scope expands to the deepest enclosing heading block", () => {
  const result = resolveRevisionScopeAnchor(content, "section", "可用能量越大");
  assert.ok(result?.startsWith("## 1.1 净辐射"));
  assert.ok(result?.includes("净辐射是地表能量收支的核心"));
  assert.ok(result?.includes("地表吸收的短波越多，可用能量越大。"));
  // Must not bleed into the next section.
  assert.ok(!result?.includes("感热通量"));
});

test("chapter scope returns the whole content", () => {
  assert.equal(resolveRevisionScopeAnchor(content, "chapter", "可用能量越大"), content);
});

test("returns undefined when the selection cannot be located", () => {
  assert.equal(resolveRevisionScopeAnchor(content, "selection", "不存在的文本ABC"), undefined);
  assert.equal(resolveRevisionScopeAnchor(content, "paragraph", "不存在的文本ABC"), undefined);
  assert.equal(resolveRevisionScopeAnchor(content, "section", "不存在的文本ABC"), undefined);
});

test("every resolved anchor is a verbatim substring of the content (apply invariant)", () => {
  for (const scope of ["selection", "paragraph", "section", "chapter"] as const) {
    const result = resolveRevisionScopeAnchor(content, scope, "可用能量越大");
    assert.ok(result, `expected an anchor for scope ${scope}`);
    assert.ok(content.includes(result), `anchor for scope ${scope} must be a verbatim substring`);
  }
});

test("parseMarkdownSections is shared and still splits by heading level", () => {
  const sections = parseMarkdownSections(content);
  assert.deepEqual(
    sections.map((section) => section.heading),
    ["第一章：能量平衡", "1.1 净辐射", "1.2 感热通量"],
  );
});
