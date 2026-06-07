import { createClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext } from "@playwright/test";

type SmokeIdentity = {
  headers: Record<string, string>;
  trackStoragePath: (path?: string) => void;
  cleanup: () => Promise<void>;
};

type JobResponse = {
  job: {
    id: string;
    status: string;
    events?: { agent: string; status: string }[];
  };
};

type CourseResponse = {
  course: {
    id: string;
    topic: string;
    chapters: {
      id: string;
      title: string;
      status?: string;
      generationJobId?: string;
      content?: string;
      sections?: { id: string; content: string }[];
      qualityReport?: { status: string; score: number };
    }[];
  };
};

type UsageResponse = {
  totals: Record<string, number | undefined>;
};

test("real provider smoke test covers course, chapter, tutor, and export", async ({ request }) => {
  test.setTimeout(180_000);
  const shouldSkip = process.env.AI_SMOKE !== "true" || !process.env.AI_API_KEY;
  if (shouldSkip && process.env.AI_SMOKE_REQUIRED === "true") {
    throw new Error("AI smoke required but AI_SMOKE=true and AI_API_KEY are not both configured.");
  }
  test.skip(shouldSkip, "Set AI_SMOKE=true and AI_API_KEY for real provider smoke test.");

  const identity = await createSmokeIdentity("owner");
  const otherIdentity = await createSmokeIdentity("other");

  const response = await request.post("/api/courses", {
    headers: identity.headers,
    data: {
      topic: "Linear Regression",
      goal: "Understand least squares and basic diagnostics",
      background: "Basic Python",
      preference: "Intuitive explanations with formulas",
      weeklyHours: 3,
    },
  });

  try {
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.course.topic).toBe("Linear Regression");
    expect(data.job.id).toBeTruthy();

    if (process.env.GENERATION_WORKER_MODE === "external") {
      await assertWorkerRejectsMissingSecret(request, data.job.id);
      await runWorkerJob(request, data.job.id);
    }

    const courseJob = await waitForJob(request, data.job.id, identity.headers, "succeeded");
    expectJobAgents(courseJob.job, ["ARCHITECT"]);

    const courseResponse = await request.get(`/api/courses/${data.course.id}`, {
      headers: identity.headers,
    });
    expect(courseResponse.ok()).toBeTruthy();
    let planned = (await courseResponse.json()) as CourseResponse;
    expect(planned.course.chapters.length).toBeGreaterThan(0);

    const otherCourseResponse = await request.get(`/api/courses/${data.course.id}`, {
      headers: otherIdentity.headers,
    });
    expect(otherCourseResponse.status()).toBe(404);

    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const localHeaderResponse = await request.get(`/api/courses/${data.course.id}`, {
        headers: { "x-learnbyai-user-id": `forged-${crypto.randomUUID()}@example.com` },
      });
      expect(localHeaderResponse.status()).toBe(401);
    }

    const chapterJobId = planned.course.chapters[0].generationJobId;
    expect(chapterJobId).toBeTruthy();
    if (process.env.GENERATION_WORKER_MODE === "external") {
      await runWorkerJob(request, chapterJobId);
    }

    const chapterJob = await waitForJob(request, chapterJobId, identity.headers, "succeeded");
    expectJobAgents(chapterJob.job, ["AUTHOR", "POLISHER", "REVIEWER"]);

    planned = await readCourse(request, data.course.id, identity.headers);
    const chapter = planned.course.chapters[0];
    expect(chapter.status).toBe("ready");
    expect(chapter.sections?.length ?? 0).toBeGreaterThan(0);
    expect(chapter.qualityReport?.status).not.toBe("failed");
    expect(chapter.qualityReport?.score ?? 0).toBeGreaterThanOrEqual(70);

    const selectedText = chapter.sections?.[0]?.content.slice(0, 240) || chapter.content?.slice(0, 240) || chapter.title;
    const tutorResponse = await request.post("/api/annotations", {
      headers: identity.headers,
      data: {
        topic: planned.course.topic,
        selectedText,
        question: "Summarize this idea in one practical sentence.",
        history: [],
        annotation: {
          id: crypto.randomUUID(),
          courseId: planned.course.id,
          chapterId: chapter.id,
          sectionId: chapter.sections?.[0]?.id,
          selectedText,
          question: "Summarize this idea in one practical sentence.",
          messages: [
            {
              id: crypto.randomUUID(),
              role: "user",
              content: "Summarize this idea in one practical sentence.",
            },
          ],
          createdAt: new Date().toISOString(),
        },
      },
    });
    expect(tutorResponse.ok()).toBeTruthy();
    const tutorJson = await tutorResponse.json();
    expect(String(tutorJson.answer ?? "").length).toBeGreaterThan(20);
    expect(tutorJson.annotation?.messages?.length).toBe(2);

    const pdfExport = await createAndDownloadExport(request, identity.headers, planned.course.id, "pdf");
    identity.trackStoragePath(pdfExport.export.storagePath);
    expect(pdfExport.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfExport.job.status).toBe("succeeded");
    expect(pdfExport.export.storagePath).toBeTruthy();

    const otherPdfDownload = await request.get(`/api/exports/${pdfExport.export.id}`, {
      headers: otherIdentity.headers,
    });
    expect(otherPdfDownload.status()).toBe(404);

    const texExport = await createAndDownloadExport(request, identity.headers, planned.course.id, "tex");
    identity.trackStoragePath(texExport.export.storagePath);
    expect(texExport.bytes.toString("utf8")).toContain("\\documentclass{article}");
    expect(texExport.job.status).toBe("succeeded");
    expect(texExport.export.storagePath).toBeTruthy();

    await expectUsageTotals(request, identity.headers, {
      create_course: 1,
      generate_chapter: 1,
      ask_tutor: 1,
      export: 2,
    });
  } finally {
    await Promise.allSettled([identity.cleanup(), otherIdentity.cleanup()]);
  }
});

async function waitForJob(
  request: APIRequestContext,
  jobId: string,
  headers: Record<string, string>,
  status: string,
) {
  await expect
    .poll(
      async () => {
        const jobResponse = await request.get(`/api/generation-jobs/${jobId}`, { headers });
        if (!jobResponse.ok()) return "missing";
        return ((await jobResponse.json()) as JobResponse).job.status;
      },
      { timeout: 120_000 },
    )
    .toBe(status);

  const jobResponse = await request.get(`/api/generation-jobs/${jobId}`, { headers });
  expect(jobResponse.ok()).toBeTruthy();
  return (await jobResponse.json()) as JobResponse;
}

async function readCourse(request: APIRequestContext, courseId: string, headers: Record<string, string>) {
  const response = await request.get(`/api/courses/${courseId}`, { headers });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as CourseResponse;
}

async function runWorkerJob(request: APIRequestContext, jobId: string) {
  const workerResponse = await request.post("/api/internal/generation-worker", {
    headers: workerHeaders(),
    data: { jobId },
  });
  expect(workerResponse.ok()).toBeTruthy();
}

async function assertWorkerRejectsMissingSecret(request: APIRequestContext, jobId: string) {
  const workerResponse = await request.post("/api/internal/generation-worker", {
    data: { jobId },
  });
  expect(workerResponse.status()).toBe(401);
}

async function createAndDownloadExport(
  request: APIRequestContext,
  headers: Record<string, string>,
  courseId: string,
  format: "pdf" | "tex",
) {
  const response = await request.post("/api/exports", {
    headers,
    data: { courseId, format },
  });
  expect(response.ok()).toBeTruthy();
  const json = await response.json();
  expect(json.export.status).toBe("succeeded");
  expect(json.export.storageProvider).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "local");
  expect(json.export.content).toBeUndefined();

  const download = await request.get(`/api/exports/${json.export.id}`, { headers });
  expect(download.ok()).toBeTruthy();

  return {
    export: json.export,
    job: json.job,
    bytes: Buffer.from(await download.body()),
  };
}

async function expectUsageTotals(
  request: APIRequestContext,
  headers: Record<string, string>,
  minimums: Record<string, number>,
) {
  const response = await request.get("/api/usage", { headers });
  expect(response.ok()).toBeTruthy();
  const json = (await response.json()) as UsageResponse;
  for (const [action, minimum] of Object.entries(minimums)) {
    expect(json.totals[action] ?? 0).toBeGreaterThanOrEqual(minimum);
  }
}

function expectJobAgents(job: JobResponse["job"], agents: string[]) {
  const recorded = new Set(job.events?.map((event) => event.agent) ?? []);
  for (const agent of agents) {
    expect(recorded.has(agent)).toBeTruthy();
  }
}

async function createSmokeIdentity(label: string): Promise<SmokeIdentity> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceRoleKey) {
    return {
      headers: { "x-learnbyai-user-id": `ai-smoke-${label}-${crypto.randomUUID()}@example.com` },
      trackStoragePath: () => undefined,
      cleanup: async () => undefined,
    };
  }

  const service = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `learnbyai-ai-smoke-${label}-${crypto.randomUUID()}@example.com`;
  const password = `LearnByAI-${crypto.randomUUID()}!aA1`;
  const storagePaths = new Set<string>();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(error, error?.message).toBeFalsy();
  expect(data.user?.id).toBeTruthy();

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await client.auth.signInWithPassword({ email, password });
  expect(session.error, session.error?.message).toBeFalsy();
  const accessToken = session.data.session?.access_token;
  expect(accessToken).toBeTruthy();

  return {
    headers: { authorization: `Bearer ${accessToken}` },
    trackStoragePath: (path) => {
      if (path) storagePaths.add(path);
    },
    cleanup: async () => {
      if (storagePaths.size > 0) {
        await service.storage
          .from(process.env.SUPABASE_EXPORTS_BUCKET || "learnbyai-exports")
          .remove([...storagePaths])
          .catch(() => undefined);
      }
      if (data.user?.id) {
        await service.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      }
    },
  };
}

function workerHeaders() {
  const secret = process.env.INTERNAL_WORKER_SECRET;
  return secret ? { authorization: `Bearer ${secret}` } : {};
}
