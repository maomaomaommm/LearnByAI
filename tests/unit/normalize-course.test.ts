import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCourse } from "../../src/lib/normalizeCourse";
import { Course } from "../../src/lib/types";

test("normalizeCourse fills defaults for legacy course payloads", () => {
  // Legacy shape predating the personalization rework.
  const legacy = {
    id: "c1",
    topic: "t",
    goal: "g",
    background: "b",
    preference: "p",
    weeklyHours: 6,
    chapterLength: "long",
    generationProfile: "standard",
    profile: "x",
    courseBible: {
      targetLearner: "",
      finalOutcomes: [],
      teachingStyle: "",
      prerequisites: [],
      globalNarrative: "",
      terminology: [],
      chapterDependencies: [],
    },
    createdAt: "now",
    chapters: [
      { id: "ch1", title: "a", description: "d", time: { readingMinutes: 0, exerciseMinutes: 0, practiceMinutes: 0, extensionMinutes: 0 } },
    ],
  } as unknown as Course;

  const n = normalizeCourse(legacy);

  assert.equal(n.chapterCount, 1, "missing chapterCount falls back to chapter count");
  assert.equal(n.difficulty, "intermediate");
  assert.equal(n.generationProfile, "fast", "legacy 'standard' collapses to 'fast'");
  assert.equal(n.includeRecentResearch, false);
  assert.equal(n.chapters[0].depthWeight, "normal", "missing depthWeight defaults to normal");
});

test("normalizeCourse preserves valid new-shape values", () => {
  const modern = {
    id: "c2",
    topic: "t",
    goal: "g",
    background: "b",
    preference: "p",
    chapterCount: 12,
    difficulty: "research",
    generationProfile: "deep",
    includeRecentResearch: true,
    profile: "x",
    courseBible: {
      targetLearner: "",
      finalOutcomes: [],
      teachingStyle: "",
      prerequisites: [],
      globalNarrative: "",
      terminology: [],
      chapterDependencies: [],
    },
    createdAt: "now",
    chapters: [
      { id: "ch1", title: "a", description: "d", depthWeight: "core", time: { readingMinutes: 0, exerciseMinutes: 0, practiceMinutes: 0, extensionMinutes: 0 } },
    ],
  } as unknown as Course;

  const n = normalizeCourse(modern);

  assert.equal(n.chapterCount, 12);
  assert.equal(n.difficulty, "research");
  assert.equal(n.generationProfile, "deep");
  assert.equal(n.includeRecentResearch, true);
  assert.equal(n.chapters[0].depthWeight, "core");
});
