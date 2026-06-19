import assert from "node:assert/strict";
import test from "node:test";
import { resolveRepairAnchor } from "../../src/lib/repairAnchor";

test("resolves rendered bold text to its Markdown source", () => {
  const source = "前文。\n\n**定义 8.1（论文公式解构）**：后文。";
  assert.equal(
    resolveRepairAnchor(source, "定义 8.1（论文公式解构）"),
    "**定义 8.1（论文公式解构）**",
  );
});

test("resolves formula text while preserving surrounding math delimiters", () => {
  const source = "错误公式：$2 + 2 = 5$。";
  assert.equal(resolveRepairAnchor(source, "2 + 2 = 5"), "$2 + 2 = 5$");
});

test("rejects a rendered selection that is not unique", () => {
  const source = "**相同内容**\n\n相同内容";
  assert.equal(resolveRepairAnchor(source, "相同内容"), undefined);
});

test("uses a unique paragraph when rendered math differs from LaTeX", () => {
  const source = [
    "这是无关段落，介绍课程背景。",
    "对于损失函数 $\\mathcal{L}(\\theta)$，我们需要检查公式是否正确，并修复其中明显的符号错误。",
  ].join("\n\n");
  assert.equal(
    resolveRepairAnchor(
      source,
      "对于损失函数 L(θ)，我们需要检查公式是否正确，并修复其中明显的符号错误。",
    ),
    "对于损失函数 $\\mathcal{L}(\\theta)$，我们需要检查公式是否正确，并修复其中明显的符号错误。",
  );
});
