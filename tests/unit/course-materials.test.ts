import assert from "node:assert/strict";
import { File } from "node:buffer";
import { test } from "node:test";
import { extractCourseMaterials } from "../../src/lib/courseMaterials";

test("course materials classify uploaded text and keep only extracted metadata", async () => {
  const result = await extractCourseMaterials([
    {
      file: new File(["课程目标：掌握状态空间建模和控制器设计。"], "syllabus.txt", { type: "text/plain" }),
      purpose: "auto",
    },
    {
      file: new File(["Bellman 方程和动态规划是强化学习的核心。"], "reference.md", { type: "text/markdown" }),
      purpose: "reference",
    },
    {
      file: new File(["用问题引出概念，再给出推导。"], "style.md", { type: "text/markdown" }),
      purpose: "style",
    },
  ]);

  assert.match(result.courseRequirements ?? "", /状态空间建模/u);
  assert.match(result.referenceMaterial ?? "", /Bellman 方程/u);
  assert.match(result.styleSample ?? "", /问题引出概念/u);
  assert.equal(result.inputMaterials.length, 3);
  assert.deepEqual(result.inputMaterials.map((material) => material.status), ["used", "used", "used"]);
  assert.equal("content" in result.inputMaterials[0]!, false);
});
