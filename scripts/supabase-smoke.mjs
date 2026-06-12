import "./load-env.mjs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_EXPORTS_BUCKET || "learnbyai-exports";
const testUserId = process.env.SUPABASE_SMOKE_USER_ID;
const runRlsSmoke = process.env.SUPABASE_SMOKE_RLS === "true";
const requireSmoke = process.env.SUPABASE_SMOKE_REQUIRED === "true";
const expectedSchemaVersion = "learnbyai-beta-2026-06-07-03";
const expectedExportMimes = [
  "application/pdf",
  "application/x-tex",
  "text/plain",
  "application/octet-stream",
];
const applicationTables = [
  "profiles",
  "courses",
  "chapters",
  "sections",
  "annotations",
  "annotation_messages",
  "generation_jobs",
  "quality_reports",
  "exports",
  "usage_events",
  "quota_reservations",
];

if (!url || !anonKey || !serviceRoleKey) {
  const message = "set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.";
  if (requireSmoke) {
    console.error(`Supabase smoke required but missing configuration: ${message}`);
    process.exit(1);
  }
  console.log(`Skipping Supabase smoke: ${message}`);
  process.exit(0);
}

const service = createClient(url, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

for (const table of applicationTables) {
  await assertTableReadable(table);
}
await assertSchemaVersion();
await assertBucketExists();

if (testUserId) {
  await assertStorageRoundTrip(testUserId);
} else {
  console.log("Skipping Storage upload/download round trip: set SUPABASE_SMOKE_USER_ID to an existing auth user id.");
}

if (runRlsSmoke) {
  await assertRlsIsolation();
} else {
  console.log("Skipping RLS/worker-claim smoke: set SUPABASE_SMOKE_RLS=true to create temporary users, verify isolation, and verify generation job lease claims.");
}

console.log("Supabase live smoke passed.");

async function assertTableReadable(table) {
  const { error } = await service.from(table).select("id").limit(1);
  if (error) {
    throw new Error(`Supabase table check failed for ${table}: ${error.message}`);
  }
}

async function assertSchemaVersion() {
  const { data, error } = await service.rpc("learnbyai_schema_version");
  if (error) {
    throw new Error(`Supabase schema version check failed: ${error.message}`);
  }
  if (data !== expectedSchemaVersion) {
    throw new Error(
      `Supabase schema version mismatch: expected ${expectedSchemaVersion}, got ${String(data ?? "empty")}. Apply supabase/schema.sql before running the Beta gate.`,
    );
  }
}

async function assertBucketExists() {
  const { data, error } = await service.storage.getBucket(bucket);
  if (error || !data) {
    throw new Error(`Supabase Storage bucket check failed for ${bucket}: ${error?.message ?? "not found"}`);
  }
  if (data.public) {
    throw new Error(`Supabase Storage bucket ${bucket} must be private.`);
  }
  if (Number(data.file_size_limit) !== 10_485_760) {
    throw new Error(`Supabase Storage bucket ${bucket} must keep a 10 MiB file size limit.`);
  }
  const allowedMimes = Array.isArray(data.allowed_mime_types) ? data.allowed_mime_types : [];
  const missingMimes = expectedExportMimes.filter((mime) => !allowedMimes.includes(mime));
  if (missingMimes.length > 0) {
    throw new Error(`Supabase Storage bucket ${bucket} missing MIME types: ${missingMimes.join(", ")}.`);
  }
}

async function assertStorageRoundTrip(userId) {
  const path = `${userId}/supabase-smoke/${crypto.randomUUID()}.txt`;
  const bytes = Buffer.from("learnbyai supabase smoke", "utf8");
  const storage = service.storage.from(bucket);

  const { error: uploadError } = await storage.upload(path, bytes, {
    contentType: "text/plain",
    upsert: true,
  });
  if (uploadError) {
    throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
  }

  const { data, error: downloadError } = await storage.download(path);
  if (downloadError || !data) {
    throw new Error(`Supabase Storage download failed: ${downloadError?.message ?? "no data"}`);
  }

  const downloaded = Buffer.from(await data.arrayBuffer()).toString("utf8");
  if (downloaded !== "learnbyai supabase smoke") {
    throw new Error("Supabase Storage round trip content mismatch.");
  }

  await storage.remove([path]);
}

async function assertRlsIsolation() {
  const password = `LearnByAI-${crypto.randomUUID()}!aA1`;
  const userA = await createTempUser("a", password);
  const userB = await createTempUser("b", password);
  const cleanup = createCleanup();
  cleanup.profiles.push(userA.id, userB.id);

  try {
    const clientA = await signInTempUser(userA.email, password);
    const clientB = await signInTempUser(userB.email, password);
    const courseId = crypto.randomUUID();
    const chapterId = crypto.randomUUID();
    const sectionId = crypto.randomUUID();
    const annotationId = crypto.randomUUID();
    const annotationMessageId = crypto.randomUUID();
    const exportId = crypto.randomUUID();
    const generationJobId = crypto.randomUUID();
    const qualityReportId = crypto.randomUUID();
    const usageEventId = crypto.randomUUID();
    const quotaReservationId = crypto.randomUUID();
    const storagePath = `${userA.id}/supabase-smoke/${exportId}.txt`;
    cleanup.courses.push(courseId);
    cleanup.generationJobs.push(generationJobId);
    cleanup.qualityReports.push(qualityReportId);
    cleanup.usageEvents.push(usageEventId);
    cleanup.quotaReservations.push(quotaReservationId);
    cleanup.storagePaths.push(storagePath);

    await insertCourseFixture(courseId, userA.id);
    await insertChapterFixture(chapterId, courseId, userA.id);
    await insertSectionFixture(sectionId, chapterId, courseId, userA.id);
    await insertAnnotationFixture(annotationId, sectionId, chapterId, courseId, userA.id);
    await insertAnnotationMessageFixture(annotationMessageId, annotationId, userA.id);
    await insertExportFixture(exportId, courseId, userA.id, storagePath);
    await insertGenerationJobFixture(generationJobId, courseId, userA.id);
    await insertQualityReportFixture(qualityReportId, chapterId, userA.id);
    await insertUsageEventFixture(usageEventId, userA.id);
    await insertQuotaReservationFixture(quotaReservationId, userA.id);
    await service.storage.from(bucket).upload(storagePath, Buffer.from("rls smoke", "utf8"), {
      contentType: "text/plain",
      upsert: true,
    });

    await assertAuthProfileTriggerAndRls(clientA, clientB, userA);
    await assertUserCanReadOwnCourse(clientA, courseId);
    await assertUserCannotReadOtherCourse(clientB, courseId);
    await assertClientCannotMutateApiOwnedTables(clientA, userA.id, {
      annotationId,
      annotationMessageId,
      chapterId,
      courseId,
      exportId,
      generationJobId,
      qualityReportId,
      quotaReservationId,
      sectionId,
      usageEventId,
    });
    await assertUserCanDownloadOwnExportObject(clientA, storagePath);
    await assertUserCannotDownloadOtherExportObject(clientB, storagePath);
    await assertGenerationJobClaimLease(generationJobId);
    await assertUsageQuotaReservationRpc(userA.id, cleanup);
    await assertClientCannotCallInternalRpcs(clientA, {
      generationJobId,
      userId: userA.id,
    });
  } finally {
    await cleanupFixtures(cleanup);
    await service.auth.admin.deleteUser(userA.id).catch(() => undefined);
    await service.auth.admin.deleteUser(userB.id).catch(() => undefined);
  }
}

async function insertGenerationJobFixture(jobId, courseId, userId) {
  const now = new Date().toISOString();
  const generationJob = {
    id: jobId,
    userId,
    courseId,
    type: "course",
    status: "pending",
    activeAgent: "ARCHITECT",
    events: [],
    createdAt: now,
    updatedAt: now,
  };

  const { error } = await service.from("generation_jobs").insert({
    id: jobId,
    user_id: userId,
    course_id: courseId,
    type: generationJob.type,
    status: generationJob.status,
    attempts: 0,
    payload: generationJob,
    created_at: now,
    updated_at: now,
  });
  if (error) {
    throw new Error(`Failed to insert Supabase smoke generation job: ${error.message}`);
  }
}

async function assertGenerationJobClaimLease(jobId) {
  const firstClaim = await claimGenerationJob(jobId, "smoke-worker-a", 60_000);
  if (!firstClaim) {
    throw new Error("Supabase generation job claim failed on first attempt.");
  }
  if (firstClaim.lockedBy !== "smoke-worker-a" || firstClaim.attempts !== 1 || !firstClaim.lockedUntil) {
    throw new Error("Supabase generation job claim did not persist lease metadata.");
  }

  const duplicateClaim = await claimGenerationJob(jobId, "smoke-worker-b", 60_000);
  if (duplicateClaim) {
    throw new Error("Supabase generation job duplicate claim was not blocked by lease.");
  }

  const expiredPayload = {
    ...firstClaim,
    lockedBy: "smoke-worker-a",
    lockedUntil: new Date(Date.now() - 1000).toISOString(),
    attempts: 1,
  };
  const { error } = await service
    .from("generation_jobs")
    .update({
      locked_by: "smoke-worker-a",
      locked_until: expiredPayload.lockedUntil,
      attempts: 1,
      payload: expiredPayload,
    })
    .eq("id", jobId);
  if (error) {
    throw new Error(`Failed to expire Supabase smoke generation job lease: ${error.message}`);
  }

  const secondClaim = await claimGenerationJob(jobId, "smoke-worker-b", 60_000);
  if (!secondClaim || secondClaim.lockedBy !== "smoke-worker-b" || secondClaim.attempts !== 2) {
    throw new Error("Supabase generation job was not claimable after lease expiration.");
  }
}

async function claimGenerationJob(jobId, workerId, leaseMs) {
  const { data, error } = await service.rpc("claim_generation_job", {
    target_job_id: jobId,
    worker_id: workerId,
    lease_ms: leaseMs,
    max_course_chapter_jobs: 2,
  });
  if (error) {
    throw new Error(`Supabase claim_generation_job RPC failed: ${error.message}`);
  }

  const claimed = Array.isArray(data) ? data[0] : data;
  return claimed?.payload;
}

async function assertUsageQuotaReservationRpc(userId, cleanup) {
  const releaseId = crypto.randomUUID();
  const commitId = crypto.randomUUID();
  const blockedId = crypto.randomUUID();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  cleanup.quotaReservations.push(releaseId, blockedId);
  cleanup.usageEvents.push(commitId);

  const firstReservation = await reserveUsageQuota(userId, "ask_tutor", 1, since, releaseId);
  if (!firstReservation.allowed || firstReservation.used_count !== 1) {
    throw new Error("Supabase quota reservation RPC did not allow the first reservation.");
  }

  const blockedReservation = await reserveUsageQuota(userId, "ask_tutor", 1, since, blockedId);
  if (blockedReservation.allowed) {
    throw new Error("Supabase quota reservation RPC allowed a duplicate reservation over the limit.");
  }

  const { data: released, error: releaseError } = await service.rpc("release_usage_quota_reservation", {
    reservation_id: releaseId,
  });
  if (releaseError || released !== true) {
    throw new Error(`Supabase quota reservation release failed: ${releaseError?.message ?? String(released)}`);
  }

  const commitReservation = await reserveUsageQuota(userId, "ask_tutor", 1, since, commitId);
  if (!commitReservation.allowed) {
    throw new Error("Supabase quota reservation RPC did not allow reservation after release.");
  }

  const { data: committed, error: commitError } = await service.rpc("commit_usage_quota_reservation", {
    reservation_id: commitId,
  });
  if (commitError) {
    throw new Error(`Supabase quota reservation commit failed: ${commitError.message}`);
  }
  const committedEvent = Array.isArray(committed) ? committed[0] : committed;
  if (committedEvent?.id !== commitId || committedEvent?.action !== "ask_tutor") {
    throw new Error("Supabase quota reservation commit did not return the usage event.");
  }

  const blockedAfterCommit = await reserveUsageQuota(userId, "ask_tutor", 1, since, blockedId);
  if (blockedAfterCommit.allowed) {
    throw new Error("Supabase quota reservation RPC ignored committed usage events.");
  }
}

async function reserveUsageQuota(userId, action, limit, since, reservationId) {
  const { data, error } = await service.rpc("reserve_usage_quota", {
    target_user_id: userId,
    target_action: action,
    quota_limit: limit,
    since_iso: since,
    reservation_id: reservationId,
    reservation_ttl_ms: 600_000,
  });
  if (error) {
    throw new Error(`Supabase reserve_usage_quota RPC failed: ${error.message}`);
  }

  const reservation = Array.isArray(data) ? data[0] : data;
  return {
    allowed: Boolean(reservation?.allowed),
    used_count: Number(reservation?.used_count ?? 0),
  };
}

async function assertClientCannotCallInternalRpcs(client, fixtures) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const calls = [
    {
      name: "claim_generation_job",
      invoke: () =>
        client.rpc("claim_generation_job", {
          target_job_id: fixtures.generationJobId,
          worker_id: "forbidden-client",
          lease_ms: 60_000,
          max_course_chapter_jobs: 2,
        }),
    },
    {
      name: "reserve_usage_quota",
      invoke: () =>
        client.rpc("reserve_usage_quota", {
          target_user_id: fixtures.userId,
          target_action: "ask_tutor",
          quota_limit: 1,
          since_iso: since,
          reservation_id: crypto.randomUUID(),
          reservation_ttl_ms: 600_000,
        }),
    },
    {
      name: "commit_usage_quota_reservation",
      invoke: () =>
        client.rpc("commit_usage_quota_reservation", {
          reservation_id: crypto.randomUUID(),
        }),
    },
    {
      name: "release_usage_quota_reservation",
      invoke: () =>
        client.rpc("release_usage_quota_reservation", {
          reservation_id: crypto.randomUUID(),
        }),
    },
  ];

  const allowed = [];
  for (const call of calls) {
    const { error } = await call.invoke();
    if (!error) allowed.push(call.name);
  }

  if (allowed.length) {
    throw new Error(`Authenticated client could call internal RPCs directly: ${allowed.join(", ")}.`);
  }
}

async function createTempUser(label, password) {
  const email = `learnbyai-smoke-${label}-${crypto.randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Failed to create Supabase smoke user ${label}: ${error?.message ?? "no user"}`);
  }
  return { id: data.user.id, email };
}

async function signInTempUser(email, password) {
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Failed to sign in Supabase smoke user: ${error.message}`);
  }
  return client;
}

async function insertCourseFixture(courseId, userId) {
  const now = new Date().toISOString();
  const course = {
    id: courseId,
    userId,
    topic: "Supabase RLS Smoke",
    goal: "Verify row isolation",
    background: "Smoke test",
    preference: "Concise",
    weeklyHours: 1,
    profile: "Smoke test learner",
    courseBible: {
      targetLearner: "Smoke test learner",
      finalOutcomes: ["RLS verified"],
      teachingStyle: "Concise",
      prerequisites: [],
      globalNarrative: "Smoke test",
      terminology: [],
      chapterDependencies: [],
    },
    chapters: [],
    createdAt: now,
    updatedAt: now,
  };

  const { error } = await service.from("courses").insert({
    id: courseId,
    user_id: userId,
    topic: course.topic,
    goal: course.goal,
    payload: course,
    created_at: now,
    updated_at: now,
  });
  if (error) {
    throw new Error(`Failed to insert Supabase smoke course: ${error.message}`);
  }
}

async function insertChapterFixture(chapterId, courseId, userId) {
  const now = new Date().toISOString();
  const chapter = {
    id: chapterId,
    title: "Supabase RLS Smoke Chapter",
    description: "Fixture chapter for RLS validation",
    status: "ready",
    orderIndex: 0,
    content: "# Supabase RLS Smoke Chapter",
    sections: [],
    updatedAt: now,
  };

  const { error } = await service.from("chapters").insert({
    id: chapterId,
    course_id: courseId,
    user_id: userId,
    title: chapter.title,
    status: chapter.status,
    order_index: 0,
    payload: chapter,
    updated_at: now,
  });
  if (error) {
    throw new Error(`Failed to insert Supabase smoke chapter: ${error.message}`);
  }
}

async function insertSectionFixture(sectionId, chapterId, courseId, userId) {
  const now = new Date().toISOString();
  const section = {
    id: sectionId,
    chapterId,
    courseId,
    title: "Supabase RLS Smoke Section",
    purpose: "Fixture section for RLS validation",
    content: "Smoke section content.",
    status: "ready",
    orderIndex: 0,
    updatedAt: now,
  };

  const { error } = await service.from("sections").insert({
    id: sectionId,
    chapter_id: chapterId,
    course_id: courseId,
    user_id: userId,
    title: section.title,
    status: section.status,
    order_index: 0,
    payload: section,
    updated_at: now,
  });
  if (error) {
    throw new Error(`Failed to insert Supabase smoke section: ${error.message}`);
  }
}

async function insertAnnotationFixture(annotationId, sectionId, chapterId, courseId, userId) {
  const now = new Date().toISOString();
  const annotation = {
    id: annotationId,
    courseId,
    chapterId,
    sectionId,
    selectedText: "Smoke selected text.",
    question: "Smoke question?",
    messages: [],
    createdAt: now,
  };

  const { error } = await service.from("annotations").insert({
    id: annotationId,
    user_id: userId,
    course_id: courseId,
    chapter_id: chapterId,
    section_id: sectionId,
    selected_text: annotation.selectedText,
    question: annotation.question,
    payload: annotation,
    created_at: now,
  });
  if (error) {
    throw new Error(`Failed to insert Supabase smoke annotation: ${error.message}`);
  }
}

async function insertAnnotationMessageFixture(messageId, annotationId, userId) {
  const now = new Date().toISOString();
  const { error } = await service.from("annotation_messages").insert({
    id: messageId,
    annotation_id: annotationId,
    user_id: userId,
    role: "user",
    content: "Smoke message content.",
    created_at: now,
  });
  if (error) {
    throw new Error(`Failed to insert Supabase smoke annotation message: ${error.message}`);
  }
}

async function insertExportFixture(exportId, courseId, userId, storagePath) {
  const now = new Date().toISOString();
  const exportJob = {
    id: exportId,
    userId,
    courseId,
    format: "pdf",
    status: "succeeded",
    fileName: "supabase-smoke.pdf",
    storagePath,
    storageProvider: "supabase",
    contentType: "text/plain",
    encoding: "utf8",
    createdAt: now,
    updatedAt: now,
  };

  const { error } = await service.from("exports").insert({
    id: exportId,
    user_id: userId,
    course_id: courseId,
    format: exportJob.format,
    status: exportJob.status,
    file_name: exportJob.fileName,
    storage_path: storagePath,
    storage_provider: "supabase",
    payload: exportJob,
    created_at: now,
    updated_at: now,
  });
  if (error) {
    throw new Error(`Failed to insert Supabase smoke export: ${error.message}`);
  }
}

async function insertQualityReportFixture(reportId, chapterId, userId) {
  const now = new Date().toISOString();
  const report = {
    id: reportId,
    targetType: "chapter",
    targetId: chapterId,
    score: 100,
    status: "passed",
    issues: [],
    createdAt: now,
  };

  const { error } = await service.from("quality_reports").insert({
    id: reportId,
    user_id: userId,
    target_type: report.targetType,
    target_id: chapterId,
    score: report.score,
    status: report.status,
    payload: report,
    created_at: now,
  });
  if (error) {
    throw new Error(`Failed to insert Supabase smoke quality report: ${error.message}`);
  }
}

async function insertUsageEventFixture(eventId, userId) {
  const now = new Date().toISOString();
  const { error } = await service.from("usage_events").insert({
    id: eventId,
    user_id: userId,
    action: "create_course",
    created_at: now,
  });
  if (error) {
    throw new Error(`Failed to insert Supabase smoke usage event: ${error.message}`);
  }
}

async function insertQuotaReservationFixture(reservationId, userId) {
  const now = new Date();
  const { error } = await service.from("quota_reservations").insert({
    id: reservationId,
    user_id: userId,
    action: "create_course",
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
  });
  if (error) {
    throw new Error(`Failed to insert Supabase smoke quota reservation: ${error.message}`);
  }
}

async function assertUserCanReadOwnCourse(client, courseId) {
  const { data, error } = await client.from("courses").select("id").eq("id", courseId);
  if (error || data.length !== 1) {
    throw new Error(`Owner could not read own course through RLS: ${error?.message ?? `rows=${data.length}`}`);
  }
}

async function assertUserCannotReadOtherCourse(client, courseId) {
  const { data, error } = await client.from("courses").select("id").eq("id", courseId);
  if (error) {
    throw new Error(`Other user course read returned unexpected error: ${error.message}`);
  }
  if (data.length !== 0) {
    throw new Error("Other user could read a course owned by someone else.");
  }
}

async function assertAuthProfileTriggerAndRls(ownerClient, otherClient, ownerUser) {
  const { data: ownRows, error: ownError } = await ownerClient
    .from("profiles")
    .select("id,email")
    .eq("id", ownerUser.id);
  if (ownError || ownRows.length !== 1) {
    throw new Error(`Owner could not read auto-created profile through RLS: ${ownError?.message ?? `rows=${ownRows.length}`}`);
  }
  if (ownRows[0].email !== ownerUser.email) {
    throw new Error("Auto-created profile email does not match the Supabase auth user.");
  }

  const { data: otherRows, error: otherError } = await otherClient.from("profiles").select("id").eq("id", ownerUser.id);
  if (otherError) {
    throw new Error(`Other user profile read returned unexpected error: ${otherError.message}`);
  }
  if (otherRows.length !== 0) {
    throw new Error("Other user could read a profile owned by someone else.");
  }
}

async function assertClientCannotMutateApiOwnedTables(client, userId, fixtures) {
  const now = new Date().toISOString();
  const insertCandidates = createForbiddenInsertCandidates(userId, fixtures, now);
  const updateCandidates = createForbiddenUpdateCandidates(fixtures);
  const deleteCandidates = createForbiddenDeleteCandidates(fixtures);
  const allowedMutations = [];

  for (const candidate of insertCandidates) {
    const { error } = await client.from(candidate.table).insert(candidate.row);
    if (!error) {
      allowedMutations.push(`insert:${candidate.table}`);
      await service.from(candidate.table).delete().eq("id", candidate.row.id).catch(() => undefined);
    }
  }

  for (const candidate of updateCandidates) {
    const { data, error } = await client
      .from(candidate.table)
      .update(candidate.patch)
      .eq("id", candidate.id)
      .select("id");
    if (!error && data.length > 0) {
      allowedMutations.push(`update:${candidate.table}`);
    }
  }

  for (const candidate of deleteCandidates) {
    const { data, error } = await client.from(candidate.table).delete().eq("id", candidate.id).select("id");
    if (!error && data.length > 0) {
      allowedMutations.push(`delete:${candidate.table}`);
    }
  }

  if (allowedMutations.length > 0) {
    throw new Error(
      `Authenticated client could directly mutate API-owned application rows: ${allowedMutations.join(
        ", ",
      )}. Writes must go through the API so ownership, quota, and audit checks cannot be bypassed.`,
    );
  }
}

function createForbiddenInsertCandidates(userId, fixtures, now) {
  const courseId = crypto.randomUUID();
  const chapterId = crypto.randomUUID();
  const sectionId = crypto.randomUUID();
  const annotationId = crypto.randomUUID();
  const generationJobId = crypto.randomUUID();
  const qualityReportId = crypto.randomUUID();
  const exportId = crypto.randomUUID();
  const usageEventId = crypto.randomUUID();
  const annotationMessageId = crypto.randomUUID();

  return [
    {
      table: "courses",
      row: {
        id: courseId,
        user_id: userId,
        topic: "Forbidden Direct Client Write",
        goal: "Verify API-only writes",
        payload: {
          id: courseId,
          userId,
          topic: "Forbidden Direct Client Write",
          goal: "Verify API-only writes",
          background: "Smoke test",
          preference: "Concise",
          weeklyHours: 1,
          profile: "Forbidden direct write",
          courseBible: {
            targetLearner: "Smoke test",
            finalOutcomes: [],
            teachingStyle: "Concise",
            prerequisites: [],
            globalNarrative: "Smoke test",
            terminology: [],
            chapterDependencies: [],
          },
          chapters: [],
          createdAt: now,
          updatedAt: now,
        },
        created_at: now,
        updated_at: now,
      },
    },
    {
      table: "chapters",
      row: {
        id: chapterId,
        course_id: fixtures.courseId,
        user_id: userId,
        title: "Forbidden Direct Client Chapter",
        status: "ready",
        order_index: 99,
        payload: {
          id: chapterId,
          title: "Forbidden Direct Client Chapter",
          status: "ready",
          orderIndex: 99,
          content: "# Forbidden",
          updatedAt: now,
        },
        updated_at: now,
      },
    },
    {
      table: "sections",
      row: {
        id: sectionId,
        chapter_id: fixtures.chapterId,
        course_id: fixtures.courseId,
        user_id: userId,
        title: "Forbidden Direct Client Section",
        status: "ready",
        order_index: 99,
        payload: {
          id: sectionId,
          chapterId: fixtures.chapterId,
          courseId: fixtures.courseId,
          title: "Forbidden Direct Client Section",
          content: "Forbidden",
          status: "ready",
          orderIndex: 99,
          updatedAt: now,
        },
        updated_at: now,
      },
    },
    {
      table: "annotations",
      row: {
        id: annotationId,
        user_id: userId,
        course_id: fixtures.courseId,
        chapter_id: fixtures.chapterId,
        section_id: fixtures.sectionId,
        selected_text: "Forbidden selected text.",
        question: "Forbidden question?",
        payload: {
          id: annotationId,
          courseId: fixtures.courseId,
          chapterId: fixtures.chapterId,
          sectionId: fixtures.sectionId,
          selectedText: "Forbidden selected text.",
          question: "Forbidden question?",
          messages: [],
          createdAt: now,
        },
        created_at: now,
      },
    },
    {
      table: "annotation_messages",
      row: {
        id: annotationMessageId,
        annotation_id: fixtures.annotationId,
        user_id: userId,
        role: "user",
        content: "Forbidden direct message.",
        created_at: now,
      },
    },
    {
      table: "generation_jobs",
      row: {
        id: generationJobId,
        user_id: userId,
        course_id: fixtures.courseId,
        type: "course",
        status: "pending",
        attempts: 0,
        payload: {
          id: generationJobId,
          userId,
          courseId: fixtures.courseId,
          type: "course",
          status: "pending",
          events: [],
          createdAt: now,
          updatedAt: now,
        },
        created_at: now,
        updated_at: now,
      },
    },
    {
      table: "quality_reports",
      row: {
        id: qualityReportId,
        user_id: userId,
        target_type: "chapter",
        target_id: fixtures.chapterId,
        score: 100,
        status: "passed",
        payload: {
          id: qualityReportId,
          targetType: "chapter",
          targetId: fixtures.chapterId,
          score: 100,
          status: "passed",
          issues: [],
          createdAt: now,
        },
        created_at: now,
      },
    },
    {
      table: "exports",
      row: {
        id: exportId,
        user_id: userId,
        course_id: fixtures.courseId,
        format: "pdf",
        status: "succeeded",
        file_name: "forbidden.pdf",
        storage_path: `${userId}/forbidden/${exportId}.pdf`,
        storage_provider: "supabase",
        payload: {
          id: exportId,
          userId,
          courseId: fixtures.courseId,
          format: "pdf",
          status: "succeeded",
          fileName: "forbidden.pdf",
          storagePath: `${userId}/forbidden/${exportId}.pdf`,
          storageProvider: "supabase",
          createdAt: now,
          updatedAt: now,
        },
        created_at: now,
        updated_at: now,
      },
    },
    {
      table: "usage_events",
      row: {
        id: usageEventId,
        user_id: userId,
        action: "create_course",
        created_at: now,
      },
    },
    {
      table: "quota_reservations",
      row: {
        id: crypto.randomUUID(),
        user_id: userId,
        action: "create_course",
        created_at: now,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    },
  ];
}

function createForbiddenUpdateCandidates(fixtures) {
  return [
    { table: "courses", id: fixtures.courseId, patch: { topic: "Forbidden direct update" } },
    { table: "chapters", id: fixtures.chapterId, patch: { title: "Forbidden direct update" } },
    { table: "sections", id: fixtures.sectionId, patch: { title: "Forbidden direct update" } },
    { table: "annotations", id: fixtures.annotationId, patch: { question: "Forbidden direct update?" } },
    { table: "annotation_messages", id: fixtures.annotationMessageId, patch: { content: "Forbidden direct update." } },
    { table: "generation_jobs", id: fixtures.generationJobId, patch: { status: "failed" } },
    { table: "quality_reports", id: fixtures.qualityReportId, patch: { status: "failed" } },
    { table: "exports", id: fixtures.exportId, patch: { status: "failed" } },
    { table: "usage_events", id: fixtures.usageEventId, patch: { action: "export" } },
    { table: "quota_reservations", id: fixtures.quotaReservationId, patch: { action: "export" } },
  ];
}

function createForbiddenDeleteCandidates(fixtures) {
  return [
    { table: "annotation_messages", id: fixtures.annotationMessageId },
    { table: "quality_reports", id: fixtures.qualityReportId },
    { table: "usage_events", id: fixtures.usageEventId },
    { table: "quota_reservations", id: fixtures.quotaReservationId },
    { table: "sections", id: fixtures.sectionId },
    { table: "annotations", id: fixtures.annotationId },
    { table: "generation_jobs", id: fixtures.generationJobId },
    { table: "exports", id: fixtures.exportId },
    { table: "chapters", id: fixtures.chapterId },
    { table: "courses", id: fixtures.courseId },
  ];
}

async function assertUserCanDownloadOwnExportObject(client, storagePath) {
  const { data, error } = await client.storage.from(bucket).download(storagePath);
  if (error || !data) {
    throw new Error(`Owner could not download own export object: ${error?.message ?? "no data"}`);
  }
}

async function assertUserCannotDownloadOtherExportObject(client, storagePath) {
  const { data, error } = await client.storage.from(bucket).download(storagePath);
  if (!error || data) {
    throw new Error("Other user could download an export object owned by someone else.");
  }
}

function createCleanup() {
  return {
    courses: [],
    generationJobs: [],
    profiles: [],
    quotaReservations: [],
    qualityReports: [],
    storagePaths: [],
    usageEvents: [],
  };
}

async function cleanupFixtures(cleanup) {
  if (cleanup.storagePaths.length) {
    await service.storage.from(bucket).remove(cleanup.storagePaths).catch(() => undefined);
  }
  if (cleanup.generationJobs.length) {
    await service.from("generation_jobs").delete().in("id", cleanup.generationJobs).catch(() => undefined);
  }
  if (cleanup.qualityReports.length) {
    await service.from("quality_reports").delete().in("id", cleanup.qualityReports).catch(() => undefined);
  }
  if (cleanup.usageEvents.length) {
    await service.from("usage_events").delete().in("id", cleanup.usageEvents).catch(() => undefined);
  }
  if (cleanup.quotaReservations.length) {
    await service.from("quota_reservations").delete().in("id", cleanup.quotaReservations).catch(() => undefined);
  }
  if (cleanup.courses.length) {
    await service.from("courses").delete().in("id", cleanup.courses).catch(() => undefined);
  }
  if (cleanup.profiles.length) {
    await service.from("profiles").delete().in("id", cleanup.profiles).catch(() => undefined);
  }
}
