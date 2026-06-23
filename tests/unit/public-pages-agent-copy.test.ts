import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("public pages describe the real seven agents without a fake gatherer", () => {
  const home = readFileSync("src/app/page.tsx", "utf8");
  const about = readFileSync("src/app/about/page.tsx", "utf8");
  const publicCopy = `${home}\n${about}`;

  assert.doesNotMatch(publicCopy, /GATHERER/u);
  assert.doesNotMatch(publicCopy, /8\s*个专业 AI Agent/u);
  assert.match(about, /7 个专业 AI Agent/u);

  for (const agent of ["ASSISTANT", "ARCHITECT", "AUTHOR", "POLISHER", "REVIEWER", "TUTOR", "REVISER"]) {
    assert.match(publicCopy, new RegExp(agent, "u"));
  }

  assert.match(home, /ARCHITECT 规划课程并可调用联网检索/u);
  assert.match(about, /调用联网检索工具/u);
});
