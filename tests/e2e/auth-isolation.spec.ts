import { expect, test, type APIRequestContext } from "@playwright/test";

type PlannedCourseResponse = {
  course: {
    id: string;
    chapters: {
      generationJobId?: string;
      status?: string;
      sections?: unknown[];
    }[];
  };
};

type GenerationJobResponse = {
  job: {
    id: string;
    status: string;
    events: { agent: string; status: string; message: string }[];
  };
};

const E2E_WORKER_SECRET = "e2e-worker-secret";

async function waitForGenerationJobStatus(
  request: APIRequestContext,
  jobId: string,
  headers: Record<string, string>,
  status: string,
) {
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/generation-jobs/${jobId}`, { headers });
        if (!response.ok()) return "missing";
        return ((await response.json()) as { job: { status: string } }).job.status;
      },
      { timeout: 30_000 },
    )
    .toBe(status);
}

async function waitForPlannedCourse(
  request: APIRequestContext,
  courseId: string,
  jobId: string,
  headers: Record<string, string>,
) {
  await waitForGenerationJobStatus(request, jobId, headers, "succeeded");

  const response = await request.get(`/api/courses/${courseId}`, { headers });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as PlannedCourseResponse;
}

async function readGenerationJob(
  request: APIRequestContext,
  jobId: string,
  headers: Record<string, string>,
) {
  const response = await request.get(`/api/generation-jobs/${jobId}`, { headers });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as GenerationJobResponse;
}

function expectJobAgents(job: GenerationJobResponse["job"], agents: string[]) {
  const recordedAgents = new Set(job.events.map((event) => event.agent));
  for (const agent of agents) {
    expect(recordedAgents.has(agent)).toBeTruthy();
  }
}

test("course API isolates local beta users by header", async ({ request }) => {
  const userA = { "x-learnbyai-user-id": `user-a-${crypto.randomUUID()}@example.com` };
  const userB = { "x-learnbyai-user-id": `user-b-${crypto.randomUUID()}@example.com` };
  const create = await request.post("/api/courses", {
    headers: userA,
    data: {
      topic: "用户隔离测试",
      goal: "验证课程归属隔离",
      background: "本地 Beta 用户",
      preference: "简洁说明",
      chapterCount: 5, difficulty: "intermediate",
    },
  });

  expect(create.ok()).toBeTruthy();
  const created = await create.json();
  const courseId = created.course.id;

  const ownRead = await request.get(`/api/courses/${courseId}`, {
    headers: userA,
  });
  expect(ownRead.ok()).toBeTruthy();

  const otherRead = await request.get(`/api/courses/${courseId}`, {
    headers: userB,
  });
  expect(otherRead.status()).toBe(404);

  const snapshotByOther = await request.post("/api/exports", {
    headers: userB,
    data: { courseId, format: "pdf" },
  });
  expect(snapshotByOther.status()).toBe(404);
});

test("local beta quota blocks over-limit course creation", async ({ request }) => {
  const headers = { "x-learnbyai-user-id": `quota-${crypto.randomUUID()}@example.com` };
  const body = {
    topic: "Quota Test",
    goal: "Verify quota rejection",
    background: "Local beta user",
    preference: "Concise",
    chapterCount: 5, difficulty: "intermediate",
  };

  expect((await request.post("/api/courses", { headers, data: body })).ok()).toBeTruthy();
  expect((await request.post("/api/courses", { headers, data: body })).ok()).toBeTruthy();

  const blocked = await request.post("/api/courses", { headers, data: body });
  expect(blocked.status()).toBe(429);
  expect((await blocked.json()).error).toBeTruthy();
});

test("concurrent course creation cannot bypass local beta quota", async ({ request }) => {
  const headers = { "x-learnbyai-user-id": `quota-race-${crypto.randomUUID()}@example.com` };
  const body = {
    topic: "Quota Race",
    goal: "Verify serialized quota checks",
    background: "Local beta user",
    preference: "Concise",
    chapterCount: 5, difficulty: "intermediate",
  };

  const responses = await Promise.all(
    [0, 1, 2].map((index) =>
      request.post("/api/courses", {
        headers,
        data: { ...body, topic: `${body.topic} ${index + 1}` },
      }),
    ),
  );
  const statuses = responses.map((response) => response.status()).sort();
  expect(statuses).toEqual([200, 200, 429]);

  const usage = await request.get("/api/usage?action=create_course", { headers });
  expect(usage.ok()).toBeTruthy();
  expect((await usage.json()).totals.create_course).toBe(2);
});

test("export downloads are isolated by local beta user", async ({ request }) => {
  const userA = { "x-learnbyai-user-id": `export-a-${crypto.randomUUID()}@example.com` };
  const userB = { "x-learnbyai-user-id": `export-b-${crypto.randomUUID()}@example.com` };
  const create = await request.post("/api/courses", {
    headers: userA,
    data: {
      topic: "Export Isolation",
      goal: "Verify export ownership",
      background: "Local beta user",
      preference: "Concise",
      chapterCount: 5, difficulty: "intermediate",
    },
  });

  expect(create.ok()).toBeTruthy();
  const { course } = await create.json();
  const exportResponse = await request.post("/api/exports", {
    headers: userA,
    data: { courseId: course.id, format: "pdf" },
  });
  expect(exportResponse.ok()).toBeTruthy();
  const exportJson = await exportResponse.json();
  const { export: exportJob, job: exportGenerationJob } = exportJson;
  expect(exportJob.status).toBe("succeeded");
  expect(exportJob.storagePath).toBeTruthy();
  expect(exportJob.storageProvider).toBe("local");
  expect(exportJob.content).toBeUndefined();
  expect(exportGenerationJob.status).toBe("succeeded");
  expect(exportGenerationJob.resultId).toBe(exportJob.id);

  const exportJobRead = await request.get(`/api/generation-jobs/${exportGenerationJob.id}`, { headers: userA });
  expect(exportJobRead.ok()).toBeTruthy();
  expect((await exportJobRead.json()).job.resultId).toBe(exportJob.id);

  const ownExports = await request.get(`/api/exports?courseId=${course.id}`, { headers: userA });
  expect(ownExports.ok()).toBeTruthy();
  const ownExportsJson = await ownExports.json();
  expect(ownExportsJson.exports.some((item: { id: string; status: string }) => item.id === exportJob.id && item.status === "succeeded")).toBeTruthy();

  const ownDownload = await request.get(`/api/exports/${exportJob.id}`, { headers: userA });
  expect(ownDownload.ok()).toBeTruthy();
  const bytes = Buffer.from(await ownDownload.body());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

  const otherDownload = await request.get(`/api/exports/${exportJob.id}`, { headers: userB });
  expect(otherDownload.status()).toBe(404);

  const otherExports = await request.get(`/api/exports?courseId=${course.id}`, { headers: userB });
  expect(otherExports.ok()).toBeTruthy();
  expect((await otherExports.json()).exports).toHaveLength(0);
});

test("export quota records only valid owned export attempts", async ({ request }) => {
  const headers = { "x-learnbyai-user-id": `export-quota-${crypto.randomUUID()}@example.com` };
  const otherHeaders = { "x-learnbyai-user-id": `export-quota-other-${crypto.randomUUID()}@example.com` };
  const create = await request.post("/api/courses", {
    headers,
    data: {
      topic: "Export Quota",
      goal: "Verify export quota audit",
      background: "Local beta user",
      preference: "Concise",
      chapterCount: 5, difficulty: "intermediate",
    },
  });

  expect(create.ok()).toBeTruthy();
  const { course } = await create.json();

  const notFound = await request.post("/api/exports", {
    headers,
    data: { courseId: crypto.randomUUID(), format: "pdf" },
  });
  expect(notFound.status()).toBe(404);

  const first = await request.post("/api/exports", {
    headers,
    data: { courseId: course.id, format: "pdf" },
  });
  expect(first.ok()).toBeTruthy();

  const second = await request.post("/api/exports", {
    headers,
    data: { courseId: course.id, format: "tex" },
  });
  expect(second.ok()).toBeTruthy();

  const blocked = await request.post("/api/exports", {
    headers,
    data: { courseId: course.id, format: "pdf" },
  });
  expect(blocked.status()).toBe(429);
  expect((await blocked.json()).error).toContain("Daily quota");

  const usage = await request.get("/api/usage?action=export", { headers });
  expect(usage.ok()).toBeTruthy();
  const usageJson = await usage.json();
  expect(usageJson.usage).toHaveLength(2);
  expect(usageJson.totals.export).toBe(2);

  const otherUsage = await request.get("/api/usage?action=export", { headers: otherHeaders });
  expect(otherUsage.ok()).toBeTruthy();
  expect((await otherUsage.json()).usage).toHaveLength(0);
});

test("course creation schedules first chapter in the background", async ({ request }) => {
  const headers = { "x-learnbyai-user-id": `background-${crypto.randomUUID()}@example.com` };
  const create = await request.post("/api/courses", {
    headers,
    data: {
      topic: "Background Generation",
      goal: "Verify first chapter job starts without opening course page",
      background: "Local beta user",
      preference: "Concise",
      chapterCount: 5, difficulty: "intermediate", generationProfile: "deep",
    },
  });

  expect(create.ok()).toBeTruthy();
  const { course, job } = await create.json();
  expect(job.status).toBe("pending");
  expect(course.chapters).toHaveLength(0);

  const plannedJson = await waitForPlannedCourse(request, course.id, job.id, headers);
  const courseJob = await readGenerationJob(request, job.id, headers);
  expectJobAgents(courseJob.job, ["ARCHITECT"]);

  const chapterJobId = plannedJson.course.chapters[0].generationJobId;
  expect(chapterJobId).toBeTruthy();

  await waitForGenerationJobStatus(request, chapterJobId, headers, "succeeded");
  const chapterJob = await readGenerationJob(request, chapterJobId, headers);
  expectJobAgents(chapterJob.job, ["AUTHOR", "POLISHER", "REVIEWER"]);

  const read = await request.get(`/api/courses/${course.id}`, { headers });
  expect(read.ok()).toBeTruthy();
  const readJson = await read.json();
  expect(readJson.course.chapters[0].status).toBe("ready");
  expect(readJson.course.chapters[0].sections.length).toBeGreaterThan(0);
});

test("internal generation worker resumes queued course and chapter jobs", async ({ request }) => {
  const headers = {
    "x-learnbyai-user-id": `worker-${crypto.randomUUID()}@example.com`,
    "x-learnbyai-worker-mode": "external",
    "x-internal-worker-secret": E2E_WORKER_SECRET,
  };
  const create = await request.post("/api/courses", {
    headers,
    data: {
      topic: "Worker Recovery",
      goal: "Verify internal worker can resume queued jobs",
      background: "Local beta user",
      preference: "Concise",
      chapterCount: 5, difficulty: "intermediate", generationProfile: "deep",
    },
  });

  expect(create.ok()).toBeTruthy();
  const { course, job } = await create.json();
  expect(job.status).toBe("pending");

  const pendingRead = await request.get(`/api/generation-jobs/${job.id}`, { headers });
  expect(pendingRead.ok()).toBeTruthy();
  expect((await pendingRead.json()).job.status).toBe("pending");

  const courseWorker = await request.post("/api/internal/generation-worker", {
    headers,
    data: { jobId: job.id },
  });
  expect(courseWorker.ok()).toBeTruthy();
  const courseWorkerJson = await courseWorker.json();
  expect(courseWorkerJson.processed).toBeGreaterThan(0);

  const planned = await waitForPlannedCourse(request, course.id, job.id, headers);
  const chapterJobId = planned.course.chapters[0].generationJobId;
  expect(chapterJobId).toBeTruthy();

  const chapterWorker = await request.post("/api/internal/generation-worker", {
    headers,
    data: { jobId: chapterJobId },
  });
  expect(chapterWorker.ok()).toBeTruthy();

  await waitForGenerationJobStatus(request, chapterJobId, headers, "succeeded");
  const read = await request.get(`/api/courses/${course.id}`, { headers });
  expect(read.ok()).toBeTruthy();
  const readJson = await read.json();
  expect(readJson.course.chapters[0].status).toBe("ready");
});

test("trusted internal worker resumes an exact job without user headers", async ({ request }) => {
  const userHeaders = {
    "x-learnbyai-user-id": `secret-worker-${crypto.randomUUID()}@example.com`,
    "x-learnbyai-worker-mode": "external",
  };
  const create = await request.post("/api/courses", {
    headers: userHeaders,
    data: {
      topic: "Secret Worker Recovery",
      goal: "Verify internal worker can run by secret and job id",
      background: "Local beta user",
      preference: "Concise",
      chapterCount: 5, difficulty: "intermediate",
    },
  });

  expect(create.ok()).toBeTruthy();
  const { course, job } = await create.json();
  expect(job.status).toBe("pending");

  const worker = await request.post("/api/internal/generation-worker", {
    headers: {
      authorization: `Bearer ${E2E_WORKER_SECRET}`,
    },
    data: { jobId: job.id },
  });
  expect(worker.ok()).toBeTruthy();
  expect((await worker.json()).processed).toBe(1);

  await waitForPlannedCourse(request, course.id, job.id, userHeaders);
});

test("internal generation worker claims a queued job only once", async ({ request }) => {
  const headers = {
    "x-learnbyai-user-id": `claim-${crypto.randomUUID()}@example.com`,
    "x-learnbyai-worker-mode": "external",
    "x-internal-worker-secret": E2E_WORKER_SECRET,
  };
  const create = await request.post("/api/courses", {
    headers,
    data: {
      topic: "Worker Claim",
      goal: "Verify duplicate workers do not process the same job",
      background: "Local beta user",
      preference: "Concise",
      chapterCount: 5, difficulty: "intermediate",
    },
  });

  expect(create.ok()).toBeTruthy();
  const { course, job } = await create.json();

  const [first, second] = await Promise.all([
    request.post("/api/internal/generation-worker", { headers, data: { jobId: job.id } }),
    request.post("/api/internal/generation-worker", { headers, data: { jobId: job.id } }),
  ]);
  expect(first.ok()).toBeTruthy();
  expect(second.ok()).toBeTruthy();

  const processed = [(await first.json()).processed, (await second.json()).processed];
  expect(processed.reduce((total, value) => total + value, 0)).toBe(1);

  await waitForPlannedCourse(request, course.id, job.id, headers);
});

test("chapter generation job respects generate_chapter quota", async ({ request }) => {
  const headers = { "x-learnbyai-user-id": `chapter-quota-${crypto.randomUUID()}@example.com` };
  const create = await request.post("/api/courses", {
    headers,
    data: {
      topic: "Chapter Quota",
      goal: "Verify chapter quota rejection",
      background: "Local beta user",
      preference: "Concise",
      chapterCount: 5, difficulty: "intermediate", generationProfile: "deep",
    },
  });

  expect(create.ok()).toBeTruthy();
  const created = await create.json();
  const { course } = await waitForPlannedCourse(request, created.course.id, created.job.id, headers);
  const chapter = course.chapters[0];
  const jobId = chapter.generationJobId;
  expect(jobId).toBeTruthy();
  await waitForGenerationJobStatus(request, jobId, headers, "succeeded");

  const allowedRetry = await request.post(`/api/generation-jobs/${jobId}`, {
    headers,
    data: { retry: true },
  });
  expect(allowedRetry.ok()).toBeTruthy();
  const worker = await request.post("/api/internal/generation-worker", {
    headers: { ...headers, "x-internal-worker-secret": E2E_WORKER_SECRET },
    data: { jobId },
  });
  expect(worker.ok()).toBeTruthy();
  await waitForGenerationJobStatus(request, jobId, headers, "succeeded");

  const blockedRetry = await request.post(`/api/generation-jobs/${jobId}`, {
    headers,
    data: { retry: true },
  });
  expect(blockedRetry.status()).toBe(429);
  const blockedJson = await blockedRetry.json();
  expect(blockedJson.error).toBeTruthy();
  expect(blockedJson.job.status).toBe("failed");
  expect(blockedJson.chapter.status).toBe("failed");
});

test("chapter generation job can be retried through the job API", async ({ request }) => {
  const headers = { "x-learnbyai-user-id": `retry-${crypto.randomUUID()}@example.com` };
  const create = await request.post("/api/courses", {
    headers,
    data: {
      topic: "Retry Flow",
      goal: "Verify job retry",
      background: "Local beta user",
      preference: "Concise",
      chapterCount: 5, difficulty: "intermediate", generationProfile: "deep",
    },
  });

  expect(create.ok()).toBeTruthy();
  const created = await create.json();
  const { course } = await waitForPlannedCourse(request, created.course.id, created.job.id, headers);
  const chapter = course.chapters[0];
  const jobId = chapter.generationJobId;
  expect(jobId).toBeTruthy();
  await waitForGenerationJobStatus(request, jobId, headers, "succeeded");

  const firstRun = await request.post(`/api/generation-jobs/${jobId}`, {
    headers,
    data: {},
  });
  expect(firstRun.ok()).toBeTruthy();
  const firstRunJson = await firstRun.json();
  expect(firstRunJson.job.status).toBe("succeeded");
  expect(firstRunJson.chapter.status).toBe("ready");

  const retryRun = await request.post(`/api/generation-jobs/${jobId}`, {
    headers,
    data: { retry: true },
  });
  expect(retryRun.ok()).toBeTruthy();
  await waitForGenerationJobStatus(request, jobId, headers, "succeeded");
  const retryJson = await readGenerationJob(request, jobId, headers);
  expect(retryJson.job.status).toBe("succeeded");
  const retriedCourse = await request.get(`/api/courses/${course.id}`, { headers });
  expect(retriedCourse.ok()).toBeTruthy();
  expect((await retriedCourse.json()).course.chapters[0].status).toBe("ready");
});

test("legacy chapter generation endpoint is disabled without consuming quota", async ({ request }) => {
  const headers = { "x-learnbyai-user-id": `legacy-chapter-${crypto.randomUUID()}@example.com` };
  const response = await request.post("/api/chapters", {
    headers,
    data: {
      topic: "Legacy Chapter",
      goal: "Verify old endpoint is disabled",
      background: "Local beta user",
      preference: "Concise",
      title: "Legacy endpoint chapter",
      time: {
        readingMinutes: 10,
        exerciseMinutes: 0,
        practiceMinutes: 0,
        extensionMinutes: 0,
      },
    },
  });

  expect(response.status()).toBe(410);
  expect((await response.json()).error).toContain("Legacy chapter generation endpoint is disabled");

  const usage = await request.get("/api/usage?action=generate_chapter", { headers });
  expect(usage.ok()).toBeTruthy();
  expect((await usage.json()).usage).toHaveLength(0);
});

test("annotation history persists assistant messages server-side", async ({ request }) => {
  const headers = { "x-learnbyai-user-id": `annotation-${crypto.randomUUID()}@example.com` };
  const create = await request.post("/api/courses", {
    headers,
    data: {
      topic: "Annotation Persistence",
      goal: "Verify anchored annotation persistence",
      background: "Local beta user",
      preference: "Concise",
      chapterCount: 5, difficulty: "intermediate",
    },
  });
  expect(create.ok()).toBeTruthy();
  const created = await create.json();
  const { course } = await waitForPlannedCourse(request, created.course.id, created.job.id, headers);
  const chapterId = course.chapters[0].id;
  const annotation = {
    id: crypto.randomUUID(),
    courseId: course.id,
    chapterId,
    sectionId: course.chapters[0].sections?.[0]?.id,
    selectedText: "A selected paragraph",
    question: "Explain this",
    messages: [{ id: crypto.randomUUID(), role: "user", content: "Explain this" }],
    createdAt: new Date().toISOString(),
  };

  const answer = await request.post("/api/annotations", {
    headers,
    data: {
      topic: "Annotation Persistence",
      selectedText: annotation.selectedText,
      question: annotation.question,
      history: annotation.messages,
      annotation,
    },
  });
  expect(answer.ok()).toBeTruthy();
  const answerJson = await answer.json();
  expect(answerJson.annotation.messages).toHaveLength(2);
  expect(answerJson.annotation.messages[1].role).toBe("assistant");
  expect(answerJson.job?.id).toBeTruthy();

  const tutorJob = await readGenerationJob(request, answerJson.job.id, headers);
  expectJobAgents(tutorJob.job, ["TUTOR"]);

  const listed = await request.get(`/api/annotations?chapterId=${chapterId}`, { headers });
  expect(listed.ok()).toBeTruthy();
  const listedJson = await listed.json();
  expect(listedJson.annotations).toHaveLength(1);
  expect(listedJson.annotations[0].messages.map((message: { role: string }) => message.role)).toEqual([
    "user",
    "assistant",
  ]);
});

test("annotation creation rejects anchors owned by another user before consuming quota", async ({ request }) => {
  const ownerHeaders = { "x-learnbyai-user-id": `annotation-owner-${crypto.randomUUID()}@example.com` };
  const attackerHeaders = { "x-learnbyai-user-id": `annotation-attacker-${crypto.randomUUID()}@example.com` };
  const create = await request.post("/api/courses", {
    headers: ownerHeaders,
    data: {
      topic: "Annotation Isolation",
      goal: "Verify annotation anchor ownership",
      background: "Local beta user",
      preference: "Concise",
      chapterCount: 5, difficulty: "intermediate",
    },
  });

  expect(create.ok()).toBeTruthy();
  const created = await create.json();
  const { course } = await waitForPlannedCourse(request, created.course.id, created.job.id, ownerHeaders);
  const chapter = course.chapters[0];
  const forgedAnnotation = {
    id: crypto.randomUUID(),
    courseId: course.id,
    chapterId: chapter.id,
    sectionId: chapter.sections?.[0]?.id,
    selectedText: "A selected paragraph",
    question: "Explain this",
    messages: [{ id: crypto.randomUUID(), role: "user", content: "Explain this" }],
    createdAt: new Date().toISOString(),
  };

  const rejected = await request.post("/api/annotations", {
    headers: attackerHeaders,
    data: {
      topic: "Annotation Isolation",
      selectedText: forgedAnnotation.selectedText,
      question: forgedAnnotation.question,
      history: forgedAnnotation.messages,
      annotation: forgedAnnotation,
    },
  });
  expect(rejected.status()).toBe(404);

  const usage = await request.get("/api/usage?action=ask_tutor", { headers: attackerHeaders });
  expect(usage.ok()).toBeTruthy();
  expect((await usage.json()).usage).toHaveLength(0);

  const ownerAnnotations = await request.get(`/api/annotations?chapterId=${chapter.id}`, { headers: ownerHeaders });
  expect(ownerAnnotations.ok()).toBeTruthy();
  expect((await ownerAnnotations.json()).annotations).toHaveLength(0);
});

test("annotation creation rejects a section outside the target chapter", async ({ request }) => {
  const headers = { "x-learnbyai-user-id": `annotation-section-${crypto.randomUUID()}@example.com` };
  const create = await request.post("/api/courses", {
    headers,
    data: {
      topic: "Annotation Section Isolation",
      goal: "Verify section anchor validation",
      background: "Local beta user",
      preference: "Concise",
      chapterCount: 5, difficulty: "intermediate",
    },
  });

  expect(create.ok()).toBeTruthy();
  const created = await create.json();
  const { course } = await waitForPlannedCourse(request, created.course.id, created.job.id, headers);
  const chapter = course.chapters[0];

  const rejected = await request.post("/api/annotations", {
    headers,
    data: {
      topic: "Annotation Section Isolation",
      selectedText: "A selected paragraph",
      question: "Explain this",
      history: [],
      annotation: {
        id: crypto.randomUUID(),
        courseId: course.id,
        chapterId: chapter.id,
        sectionId: crypto.randomUUID(),
        selectedText: "A selected paragraph",
        question: "Explain this",
        messages: [{ id: crypto.randomUUID(), role: "user", content: "Explain this" }],
        createdAt: new Date().toISOString(),
      },
    },
  });

  expect(rejected.status()).toBe(404);
  expect((await rejected.json()).error).toBe("Section not found");

  const usage = await request.get("/api/usage?action=ask_tutor", { headers });
  expect(usage.ok()).toBeTruthy();
  expect((await usage.json()).usage).toHaveLength(0);
});

test("tutor quota records usage and blocks over-limit questions", async ({ request }) => {
  const headers = { "x-learnbyai-user-id": `tutor-quota-${crypto.randomUUID()}@example.com` };
  const body = (question: string) => ({
    topic: "Tutor Quota",
    selectedText: "A focused passage for the tutor.",
    question,
    history: [],
  });

  const first = await request.post("/api/annotations", {
    headers,
    data: body("Explain this once"),
  });
  expect(first.ok()).toBeTruthy();

  const second = await request.post("/api/annotations", {
    headers,
    data: body("Explain this twice"),
  });
  expect(second.ok()).toBeTruthy();

  const blocked = await request.post("/api/annotations", {
    headers,
    data: body("Explain this third time"),
  });
  expect(blocked.status()).toBe(429);
  expect((await blocked.json()).error).toContain("Daily quota");

  const usage = await request.get("/api/usage?action=ask_tutor", { headers });
  expect(usage.ok()).toBeTruthy();
  const usageJson = await usage.json();
  expect(usageJson.usage).toHaveLength(2);
  expect(usageJson.totals.ask_tutor).toBe(2);

  const invalidUsage = await request.get("/api/usage?action=unknown", { headers });
  expect(invalidUsage.status()).toBe(400);
});
