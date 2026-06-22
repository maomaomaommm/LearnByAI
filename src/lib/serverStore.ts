import "server-only";

import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { claimGenerationJob, deleteGenerationJobsForCourse, patchGenerationJob, releaseGenerationJob, upsertGenerationJob } from "./jobs";
import { publishCourseChanged, publishGenerationJobChanged } from "./courseEvents";
import { Annotation, Course, ExportJob, GenerationJob, QualityReport, Revision, UsageEvent } from "./types";
import { normalizeCourse } from "./normalizeCourse";
import { createSupabaseServiceClient, resolveUserId } from "./supabase/server";

const localCourses = new Map<string, Course>();
const localAnnotations = new Map<string, Annotation>();
const localRevisions = new Map<string, Revision>();
const localExports = new Map<string, ExportJob>();
const localGenerationJobs = new Map<string, GenerationJob>();
const localQualityReports = new Map<string, QualityReport>();
const localUsageEvents: UsageEvent[] = [];
const localStorePath = process.env.LEARNBYAI_LOCAL_STORE_PATH || join(process.cwd(), ".learnbyai", "local-beta-store.json");
const localStoreLockPath = `${localStorePath}.lock`;
const LOCAL_STORE_LOCK_TIMEOUT_MS = 10_000;
const LOCAL_STORE_STALE_LOCK_MS = 30_000;
const ACTIVE_GENERATION_JOB_STATUSES: GenerationJob["status"][] = ["pending", "queued", "retrying", "running"];
const GENERATION_HEARTBEAT_STALE_MS = readPositiveInteger(process.env.GENERATION_HEARTBEAT_STALE_MS, 5 * 60 * 1000);
let localStoreWriteQueue = Promise.resolve();

type LocalStore = {
  courses: Course[];
  annotations: Annotation[];
  revisions: Revision[];
  exports: ExportJob[];
  generationJobs: GenerationJob[];
  qualityReports: QualityReport[];
  usageEvents: UsageEvent[];
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type SupabaseResult = {
  error?: SupabaseErrorLike | null;
};

export async function saveServerCourse(course: Course, request?: Request) {
  const userId = await resolveUserId(request);
  const nextCourse = {
    ...course,
    userId,
    updatedAt: new Date().toISOString(),
  };

  localCourses.set(nextCourse.id, nextCourse);
  await persistLocalStore();

  const supabase = createSupabaseServiceClient();
  if (!supabase || !isUuid(userId)) return publishSavedCourse(nextCourse);

  if (!isUuid(nextCourse.id)) return publishSavedCourse(nextCourse);

  await requireSupabaseWrite(
    "Persist course",
    supabase.from("courses").upsert({
      id: nextCourse.id,
      user_id: userId,
      topic: nextCourse.topic,
      goal: nextCourse.goal,
      payload: nextCourse,
      created_at: nextCourse.createdAt,
      updated_at: nextCourse.updatedAt,
    }),
  );

  await Promise.all(
    nextCourse.chapters
      .filter((chapter) => isUuid(chapter.id))
      .map((chapter, index) =>
        requireSupabaseWrite(
          "Persist chapter",
          supabase.from("chapters").upsert({
            id: chapter.id,
            course_id: nextCourse.id,
            user_id: userId,
            title: chapter.title,
            status: chapter.status ?? "pending",
            order_index: index,
            payload: chapter,
            updated_at: nextCourse.updatedAt,
          }),
        ),
      ),
  );

  await Promise.all(
    nextCourse.chapters.flatMap((chapter) => [
      chapter.qualityReport && isUuid(chapter.qualityReport.id) && isUuid(chapter.qualityReport.targetId)
        ? requireSupabaseWrite(
            "Persist quality report",
            supabase.from("quality_reports").upsert({
              id: chapter.qualityReport.id,
              user_id: userId,
              target_type: chapter.qualityReport.targetType,
              target_id: chapter.qualityReport.targetId,
              score: chapter.qualityReport.score,
              status: chapter.qualityReport.status,
              payload: chapter.qualityReport,
              created_at: chapter.qualityReport.createdAt,
            }),
          )
        : Promise.resolve(),
      // Delete stale sections for this chapter before inserting the new set to avoid duplicates
      ...(chapter.sections && chapter.sections.length > 0 && isUuid(chapter.id)
        ? [
            requireSupabaseWrite(
              "Delete stale sections",
              supabase.from("sections").delete().eq("chapter_id", chapter.id),
            ).catch(() => {
              // Ignore delete failure so upserts below still attempt to overwrite by id
            }),
          ]
        : []),
      ...(chapter.sections ?? []).filter((section) => isUuid(section.id) && isUuid(section.chapterId)).map((section) =>
        requireSupabaseWrite(
          "Persist section",
          supabase.from("sections").upsert({
            id: section.id,
            chapter_id: chapter.id,
            course_id: nextCourse.id,
            user_id: userId,
            title: section.title,
            status: section.status,
            order_index: section.order,
            payload: section,
            updated_at: nextCourse.updatedAt,
          }),
        ),
      ),
    ]),
  );

  return publishSavedCourse(nextCourse);
}

export async function getServerCourse(id: string, request?: Request) {
  const userId = await resolveUserId(request);
  const supabase = createSupabaseServiceClient();

  if (supabase && isUuid(userId)) {
    const { data, error } = await supabase
      .from("courses")
      .select("payload")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    assertSupabaseNoError("Read course", error);
    if (data?.payload) return normalizeCourse(data.payload as Course);
    return undefined;
  }

  await hydrateLocalStore();
  const hydratedCourse = localCourses.get(id);
  if (!hydratedCourse) return undefined;
  const visible = hydratedCourse.userId === userId || userId === "local-beta-user";
  return visible ? normalizeCourse(hydratedCourse) : undefined;
}

export async function listServerCourses(request?: Request) {
  const userId = await resolveUserId(request);
  const supabase = createSupabaseServiceClient();

  if (supabase && isUuid(userId)) {
    const { data, error } = await supabase
      .from("courses")
      .select("payload, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    assertSupabaseNoError("List courses", error);
    return (data ?? []).map((row) => normalizeCourse(row.payload as Course));
  }

  await hydrateLocalStore();
  return [...localCourses.values()]
    .filter((course) => course.userId === userId || userId === "local-beta-user")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map(normalizeCourse);
}

export async function deleteServerCourse(id: string, request?: Request) {
  const userId = await resolveUserId(request);
  const course = await getServerCourse(id, request);
  if (!course) return false;

  // Always delete from Supabase first if available. RLS or user_id mismatch will
  // cause an error that propagates to the caller.
  const supabase = createSupabaseServiceClient();
  if (supabase && isUuid(userId) && isUuid(id)) {
    const qualityTargetIds = [
      course.id,
      ...course.chapters.flatMap((chapter) => [
        chapter.id,
        ...(chapter.sections ?? []).map((section) => section.id),
      ]),
    ].filter(isUuid);

    if (qualityTargetIds.length) {
      await requireSupabaseWrite(
        "Delete course quality reports",
        supabase
          .from("quality_reports")
          .delete()
          .eq("user_id", userId)
          .in("target_id", qualityTargetIds),
      );
    }

    await requireSupabaseWrite(
      "Delete course",
      supabase.from("courses").delete().eq("id", id).eq("user_id", userId),
    );
  }

  // Clean up local fallback cache after Supabase succeeds.
  await clearLocalCourseData(course);
  return true;
}

export async function deleteServerCourseByAdmin(id: string) {
  const supabase = createSupabaseServiceClient();
  if (!supabase || !isUuid(id)) {
    throw new Error("Supabase 服务未配置，无法删除课程。");
  }

  const { data, error: readError } = await supabase
    .from("courses")
    .select("payload")
    .eq("id", id)
    .maybeSingle();

  if (readError) throw new Error(`读取课程失败：${readError.message}`);
  const course = data?.payload ? normalizeCourse(data.payload as Course) : undefined;

  // Deleting the course row cascades to chapters, sections, annotations,
  // exports and generation_jobs. Quality reports are deleted explicitly.
  if (course) {
    const qualityTargetIds = [
      course.id,
      ...course.chapters.flatMap((chapter) => [
        chapter.id,
        ...(chapter.sections ?? []).map((section) => section.id),
      ]),
    ].filter(isUuid);

    if (qualityTargetIds.length) {
      await requireSupabaseWrite(
        "Delete course quality reports",
        supabase.from("quality_reports").delete().in("target_id", qualityTargetIds),
      );
    }
  }

  await requireSupabaseWrite(
    "Delete course",
    supabase.from("courses").delete().eq("id", id),
  );

  if (course) {
    await clearLocalCourseData(course);
  }

  return true;
}

async function clearLocalCourseData(course: Course) {
  const id = course.id;
  const chapterIds = new Set(course.chapters.map((chapter) => chapter.id));
  const qualityTargetIds = new Set([
    id,
    ...course.chapters.flatMap((chapter) => [
      chapter.id,
      ...(chapter.sections ?? []).map((section) => section.id),
    ]),
  ]);

  localCourses.delete(id);
  for (const [annotationId, annotation] of localAnnotations) {
    if (annotation.courseId === id || chapterIds.has(annotation.chapterId)) {
      localAnnotations.delete(annotationId);
    }
  }
  for (const [revisionId, revision] of localRevisions) {
    if (revision.courseId === id || chapterIds.has(revision.chapterId)) {
      localRevisions.delete(revisionId);
    }
  }
  for (const [exportId, exportJob] of localExports) {
    if (exportJob.courseId === id) {
      localExports.delete(exportId);
    }
  }
  for (const [jobId, job] of localGenerationJobs) {
    if (job.courseId === id || (job.chapterId && chapterIds.has(job.chapterId))) {
      localGenerationJobs.delete(jobId);
    }
  }
  for (const [reportId, report] of localQualityReports) {
    if (qualityTargetIds.has(report.targetId)) {
      localQualityReports.delete(reportId);
    }
  }
  deleteGenerationJobsForCourse(id);
  await persistLocalStore({ mergeDisk: false });
}

export async function updateServerChapter(
  course: Course,
  chapterId: string,
  patch: Partial<Course["chapters"][number]>,
  request?: Request,
) {
  const chapters = course.chapters.map((chapter) =>
    chapter.id === chapterId ? { ...chapter, ...patch } : chapter,
  );
  return saveServerCourse({ ...course, chapters }, request);
}

export async function saveServerAnnotation(annotation: Annotation, request?: Request) {
  const userId = await resolveUserId(request);
  const nextAnnotation = {
    ...annotation,
    userId,
  };
  localAnnotations.set(nextAnnotation.id, nextAnnotation);
  await persistLocalStore();

  const supabase = createSupabaseServiceClient();
  if (!supabase || !isUuid(userId) || !isUuid(nextAnnotation.id) || !isUuid(nextAnnotation.chapterId)) return nextAnnotation;

  await requireSupabaseWrite(
    "Persist annotation",
    supabase.from("annotations").upsert({
      id: nextAnnotation.id,
      user_id: userId,
      course_id: isUuid(nextAnnotation.courseId) ? nextAnnotation.courseId : null,
      chapter_id: nextAnnotation.chapterId,
      section_id: nextAnnotation.sectionId ?? null,
      selected_text: nextAnnotation.selectedText ?? null,
      question: nextAnnotation.question,
      payload: nextAnnotation,
      created_at: nextAnnotation.createdAt,
    }),
  );

  await Promise.all(
    nextAnnotation.messages.map((message) =>
      requireSupabaseWrite(
        "Persist annotation message",
        supabase.from("annotation_messages").upsert({
          id: message.id,
          annotation_id: nextAnnotation.id,
          user_id: userId,
          role: message.role,
          content: message.content,
        }),
      ),
    ),
  );

  return nextAnnotation;
}

export async function listServerAnnotations(chapterId: string, request?: Request) {
  const userId = await resolveUserId(request);
  const supabase = createSupabaseServiceClient();

  if (supabase && isUuid(userId)) {
    const { data, error } = await supabase
      .from("annotations")
      .select("payload, created_at")
      .eq("chapter_id", chapterId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    assertSupabaseNoError("List annotations", error);
    return (data ?? []).map((row) => row.payload as Annotation);
  }

  await hydrateLocalStore();
  return [...localAnnotations.values()]
    .filter((annotation) => annotation.chapterId === chapterId && (!annotation.userId || annotation.userId === userId))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export async function deleteServerAnnotation(id: string, request?: Request) {
  const userId = await resolveUserId(request);

  const supabase = createSupabaseServiceClient();
  if (supabase && isUuid(userId) && isUuid(id)) {
    // annotation_messages is FK'd to annotations with on delete cascade.
    await requireSupabaseWrite(
      "Delete annotation",
      supabase.from("annotations").delete().eq("id", id).eq("user_id", userId),
    );
  }

  await hydrateLocalStore();
  const existing = localAnnotations.get(id);
  if (existing && (!existing.userId || existing.userId === userId || userId === "local-beta-user")) {
    localAnnotations.delete(id);
    // mergeDisk:false so the just-deleted row is not re-hydrated from disk before write.
    await persistLocalStore({ mergeDisk: false });
  }

  return true;
}

export async function snapshotChapterBeforeRegen(course: Course, chapterId: string, request?: Request) {
  const chapter = course.chapters.find((item) => item.id === chapterId);
  if (!chapter || !(chapter.content || chapter.sections?.length)) return undefined;
  const now = new Date().toISOString();
  const revision: Revision = {
    id: crypto.randomUUID(),
    userId: course.userId,
    courseId: course.id,
    chapterId,
    mode: "rewrite",
    scope: "chapter",
    intent: "整章重新生成前的自动快照",
    status: "applied",
    beforeChapter: chapter,
    createdAt: now,
    appliedAt: now,
  };
  return saveServerRevision(revision, request);
}

export async function saveServerRevision(revision: Revision, request?: Request) {
  let userId: string | undefined;
  try {
    userId = await resolveUserId(request);
  } catch (error) {
    // Server-side paths without a bearer token (admin/internal) trust the caller-set userId.
    if (revision.userId) userId = revision.userId;
    else throw error;
  }
  const nextRevision: Revision = {
    ...revision,
    userId,
  };
  localRevisions.set(nextRevision.id, nextRevision);
  await persistLocalStore();

  const supabase = createSupabaseServiceClient();
  if (!supabase || !isUuid(userId) || !isUuid(nextRevision.id) || !isUuid(nextRevision.chapterId)) return nextRevision;

  await requireSupabaseWrite(
    "Persist revision",
    supabase.from("revisions").upsert({
      id: nextRevision.id,
      user_id: userId,
      course_id: isUuid(nextRevision.courseId) ? nextRevision.courseId : null,
      chapter_id: nextRevision.chapterId,
      section_id: nextRevision.sectionId ?? null,
      mode: nextRevision.mode,
      scope: nextRevision.scope,
      status: nextRevision.status,
      payload: nextRevision,
      created_at: nextRevision.createdAt,
    }),
  );

  return nextRevision;
}

export async function getServerRevision(id: string, request?: Request) {
  const userId = await resolveUserId(request);
  const supabase = createSupabaseServiceClient();

  if (supabase && isUuid(userId)) {
    const { data, error } = await supabase
      .from("revisions")
      .select("payload")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    assertSupabaseNoError("Read revision", error);
    if (data?.payload) return data.payload as Revision;
    return undefined;
  }

  await hydrateLocalStore();
  const hydrated = localRevisions.get(id);
  if (!hydrated) return undefined;
  return !hydrated.userId || hydrated.userId === userId || userId === "local-beta-user" ? hydrated : undefined;
}

export async function listServerRevisions(chapterId: string, request?: Request) {
  const userId = await resolveUserId(request);
  const supabase = createSupabaseServiceClient();

  if (supabase && isUuid(userId)) {
    const { data, error } = await supabase
      .from("revisions")
      .select("payload, created_at")
      .eq("chapter_id", chapterId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    assertSupabaseNoError("List revisions", error);
    return (data ?? []).map((row) => row.payload as Revision);
  }

  await hydrateLocalStore();
  return [...localRevisions.values()]
    .filter((revision) => revision.chapterId === chapterId && (!revision.userId || revision.userId === userId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function updateServerRevision(
  id: string,
  patch: Partial<Revision>,
  request?: Request,
) {
  const existing = await getServerRevision(id, request);
  if (!existing) return undefined;
  return saveServerRevision({ ...existing, ...patch, id: existing.id }, request);
}

export async function saveServerExport(exportJob: ExportJob) {
  localExports.set(exportJob.id, exportJob);
  await persistLocalStore();

  const supabase = createSupabaseServiceClient();
  if (!supabase || !isUuid(exportJob.userId) || !isUuid(exportJob.courseId)) return exportJob;

  await requireSupabaseWrite(
    "Persist export",
    supabase.from("exports").upsert({
      id: exportJob.id,
      user_id: exportJob.userId,
      course_id: exportJob.courseId,
      format: exportJob.format,
      status: exportJob.status,
      file_name: exportJob.fileName,
      storage_path: exportJob.storagePath,
      storage_provider: exportJob.storageProvider,
      payload: exportJob,
      created_at: exportJob.createdAt,
      updated_at: exportJob.updatedAt,
    }),
  );

  return exportJob;
}

export async function getServerExport(id: string, request?: Request) {
  const userId = await resolveUserId(request);
  const supabase = createSupabaseServiceClient();

  if (supabase && isUuid(userId)) {
    const { data, error } = await supabase
      .from("exports")
      .select("payload")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    assertSupabaseNoError("Read export", error);
    if (data?.payload) return data.payload as ExportJob;
    return undefined;
  }

  await hydrateLocalStore();
  const hydratedExport = localExports.get(id);
  if (!hydratedExport) return undefined;
  return hydratedExport.userId === userId || userId === "local-beta-user" ? hydratedExport : undefined;
}

export async function listServerExports(request?: Request, courseId?: string) {
  const userId = await resolveUserId(request);
  const supabase = createSupabaseServiceClient();

  if (supabase && isUuid(userId)) {
    let query = supabase
      .from("exports")
      .select("payload, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (courseId && isUuid(courseId)) {
      query = query.eq("course_id", courseId);
    }

    const { data, error } = await query;
    assertSupabaseNoError("List exports", error);
    return (data ?? []).map((row) => row.payload as ExportJob);
  }

  await hydrateLocalStore();
  return [...localExports.values()]
    .filter((exportJob) => (!exportJob.userId || exportJob.userId === userId))
    .filter((exportJob) => !courseId || exportJob.courseId === courseId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function saveServerGenerationJob(job: GenerationJob, request?: Request) {
  const userId = await resolveUserId(request);
  const nextJob = {
    ...job,
    userId: job.userId ?? userId,
    updatedAt: job.updatedAt ?? new Date().toISOString(),
  };

  localGenerationJobs.set(nextJob.id, nextJob);
  await persistLocalStore();

  const supabase = createSupabaseServiceClient();
  if (!supabase || !isUuid(nextJob.userId)) return publishSavedGenerationJob(nextJob);

  const relationalCourseId = await resolveGenerationJobCourseId(supabase, nextJob);
  const relationalChapterId = await resolveGenerationJobChapterId(supabase, nextJob);

  const { error } = await supabase.from("generation_jobs").upsert({
      id: nextJob.id,
      user_id: nextJob.userId,
      course_id: relationalCourseId,
      chapter_id: relationalChapterId,
      type: nextJob.type,
      status: nextJob.status,
      locked_by: nextJob.lockedBy ?? null,
      locked_until: nextJob.lockedUntil ?? null,
      attempts: nextJob.attempts ?? 0,
      payload: nextJob,
      created_at: nextJob.createdAt,
      updated_at: nextJob.updatedAt,
    });

  if (isActiveGenerationJobConflict(error)) {
    const activeJob = await getConflictingActiveGenerationJob(nextJob, request);
    if (activeJob) {
      localGenerationJobs.delete(nextJob.id);
      localGenerationJobs.set(activeJob.id, activeJob);
      upsertGenerationJob(activeJob);
      await persistLocalStore();
      return publishSavedGenerationJob(activeJob);
    }
  }

  assertSupabaseNoError("Persist generation job", error);

  return publishSavedGenerationJob(nextJob);
}

export async function saveServerGenerationJobs(jobs: GenerationJob[], request?: Request) {
  return Promise.all(jobs.map((job) => saveServerGenerationJob(job, request)));
}

export async function getServerGenerationJob(id: string, request?: Request) {
  const userId = await resolveUserId(request);
  const supabase = createSupabaseServiceClient();

  if (supabase && isUuid(userId)) {
    const { data, error } = await supabase
      .from("generation_jobs")
      .select("payload")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    assertSupabaseNoError("Read generation job", error);
    if (data?.payload) return data.payload as GenerationJob;
    return undefined;
  }

  await hydrateLocalStore();
  const hydratedJob = localGenerationJobs.get(id);
  if (!hydratedJob) return undefined;
  return hydratedJob.userId === userId || userId === "local-beta-user" ? hydratedJob : undefined;
}

export async function getActiveServerGenerationJobForCourse(courseId: string, request?: Request) {
  return getActiveServerGenerationJob("course_id", courseId, "course", request);
}

export async function getActiveServerGenerationJobForChapter(chapterId: string, request?: Request) {
  return getActiveServerGenerationJob("chapter_id", chapterId, "chapter", request);
}

export async function getServerGenerationJobForWorker(id: string) {
  const supabase = createSupabaseServiceClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("generation_jobs")
      .select("payload")
      .eq("id", id)
      .maybeSingle();

    assertSupabaseNoError("Read worker generation job", error);
    if (data?.payload) return data.payload as GenerationJob;
    return undefined;
  }

  await hydrateLocalStore();
  return localGenerationJobs.get(id);
}

export async function listRunnableGenerationJobs(limit = 10) {
  const statuses: GenerationJob["status"][] = ["pending", "queued", "retrying"];
  const supabase = createSupabaseServiceClient();
  const scanLimit = Math.max(limit, Math.min(100, limit * 5));

  if (supabase) {
    const { data, error } = await supabase
      .from("generation_jobs")
      .select("payload, created_at")
      .in("status", statuses)
      .or(`locked_until.is.null,locked_until.lte.${new Date().toISOString()}`)
      .order("created_at", { ascending: true })
      .limit(scanLimit);

    assertSupabaseNoError("List runnable generation jobs", error);
    return sortRunnableGenerationJobs((data ?? []).map((row) => row.payload as GenerationJob)).slice(0, limit);
  }

  await hydrateLocalStore();
  return sortRunnableGenerationJobs([...localGenerationJobs.values()]
    .filter((job) => statuses.includes(job.status))
    .filter((job) => !job.lockedUntil || Date.parse(job.lockedUntil) <= Date.now()))
    .slice(0, limit);
}

export async function recoverInterruptedGenerationJobs() {
  return recoverExpiredGenerationJobs();
}

export async function recoverExpiredGenerationJobs() {
  const supabase = createSupabaseServiceClient();
  const now = new Date().toISOString();
  const message = "Generation job lock expired without a usable draft heartbeat; returning it to the queue.";

  if (supabase) {
    const { data, error } = await supabase
      .from("generation_jobs")
      .select("id, payload, locked_until, updated_at")
      .in("status", ["running", "retrying"])
      .not("locked_until", "is", null);

    assertSupabaseNoError("List expired generation jobs", error);
    const expired = (data ?? []).filter((row) => shouldRecoverStaleLockedRow(row.payload as GenerationJob, row.locked_until as string | null, row.updated_at as string | null));
    let recovered = 0;
    for (const row of expired) {
      const job = row.payload as GenerationJob;
      if (!(await shouldRecoverExpiredGenerationJob(job, supabase))) continue;
      const recoveredStatus: GenerationJob["status"] = job.status === "running" ? "retrying" : job.status;
      const nextJob: GenerationJob = {
        ...job,
        status: recoveredStatus,
        lockedBy: undefined,
        lockedUntil: undefined,
        updatedAt: now,
        events: [
          ...(job.events ?? []),
          {
            id: crypto.randomUUID(),
            agent: job.activeAgent ?? "ASSISTANT",
            status: recoveredStatus,
            message,
            createdAt: now,
          },
        ],
      };
      localGenerationJobs.set(nextJob.id, nextJob);
      upsertGenerationJob(nextJob);
      await requireSupabaseWrite(
        "Recover interrupted generation job",
        supabase
          .from("generation_jobs")
          .update({
            status: recoveredStatus,
            locked_by: null,
            locked_until: null,
            payload: nextJob,
            updated_at: now,
          })
          .eq("id", nextJob.id),
      );
      publishSavedGenerationJob(nextJob);
      recovered += 1;
    }
    if (recovered) await persistLocalStore();
    return recovered;
  }

  await hydrateLocalStore();
  let recovered = 0;
  for (const job of localGenerationJobs.values()) {
    if (!["running", "retrying"].includes(job.status) || !job.lockedUntil) continue;
    if (!shouldRecoverStaleLockedRow(job, job.lockedUntil, job.updatedAt)) continue;
    if (!shouldRecoverExpiredLocalGenerationJob(job)) continue;
    const recoveredStatus: GenerationJob["status"] = job.status === "running" ? "retrying" : job.status;
    const nextJob: GenerationJob = {
      ...job,
      status: recoveredStatus,
      lockedBy: undefined,
      lockedUntil: undefined,
      updatedAt: now,
      events: [
        ...(job.events ?? []),
        {
          id: crypto.randomUUID(),
          agent: job.activeAgent ?? "ASSISTANT",
          status: recoveredStatus,
          message,
          createdAt: now,
        },
      ],
    };
    localGenerationJobs.set(nextJob.id, nextJob);
    upsertGenerationJob(nextJob);
    publishSavedGenerationJob(nextJob);
    recovered += 1;
  }
  if (recovered) await persistLocalStore();
  return recovered;
}

export async function refreshServerGenerationJobLease(
  jobId: string,
  workerId: string,
  leaseMs: number,
  request?: Request,
) {
  const lockedUntil = new Date(Date.now() + leaseMs).toISOString();
  const now = new Date().toISOString();
  const supabase = createSupabaseServiceClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("generation_jobs")
      .select("payload")
      .eq("id", jobId)
      .eq("locked_by", workerId)
      .in("status", ["running", "retrying"])
      .maybeSingle();

    assertSupabaseNoError("Read generation job before lease refresh", error);
    if (!data?.payload) return undefined;

    const refreshed: GenerationJob = {
      ...(data.payload as GenerationJob),
      lockedBy: workerId,
      lockedUntil,
      updatedAt: now,
    };
    localGenerationJobs.set(refreshed.id, refreshed);
    upsertGenerationJob(refreshed);
    await requireSupabaseWrite(
      "Refresh generation job lease",
      supabase
        .from("generation_jobs")
        .update({
          locked_until: lockedUntil,
          payload: refreshed,
          updated_at: now,
        })
        .eq("id", jobId)
        .eq("locked_by", workerId),
    );
    await persistLocalStore();
    return publishSavedGenerationJob(refreshed);
  }

  await hydrateLocalStore();
  const existing = await getServerGenerationJob(jobId, request);
  if (!existing || existing.lockedBy !== workerId) return existing;
  const refreshed = patchGenerationJob(jobId, {
    lockedBy: workerId,
    lockedUntil,
  });
  if (!refreshed) return existing;
  localGenerationJobs.set(refreshed.id, refreshed);
  await persistLocalStore();
  return publishSavedGenerationJob(refreshed);
}

async function getActiveServerGenerationJob(
  column: "course_id" | "chapter_id",
  id: string,
  type: GenerationJob["type"],
  request?: Request,
) {
  const userId = await resolveUserId(request);
  const supabase = createSupabaseServiceClient();

  if (supabase && isUuid(userId) && isUuid(id)) {
    const { data, error } = await supabase
      .from("generation_jobs")
      .select("payload, updated_at")
      .eq(column, id)
      .eq("user_id", userId)
      .eq("type", type)
      .in("status", ACTIVE_GENERATION_JOB_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    assertSupabaseNoError("Read active generation job", error);
    if (data?.payload) return data.payload as GenerationJob;
    return undefined;
  }

  await hydrateLocalStore();
  const matches = [...localGenerationJobs.values()]
    .filter((job) => job.userId === userId || userId === "local-beta-user")
    .filter((job) => job.type === type)
    .filter((job) => ACTIVE_GENERATION_JOB_STATUSES.includes(job.status))
    .filter((job) => (column === "course_id" ? job.courseId === id : job.chapterId === id))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return matches[0];
}

export async function claimServerGenerationJob(
  jobId: string,
  workerId: string,
  leaseMs: number,
  maxCourseChapterJobs = 2,
  maxUserCourses = 3,
) {
  const supabase = createSupabaseServiceClient();
  if (supabase) {
    const { data, error } = await supabase.rpc("claim_generation_job", {
      target_job_id: jobId,
      worker_id: workerId,
      lease_ms: leaseMs,
      max_course_chapter_jobs: maxCourseChapterJobs,
      max_user_courses: maxUserCourses,
    });
    assertSupabaseNoError("Claim generation job", error);
    const claimed = Array.isArray(data) ? data[0] : data;
    if (!claimed?.payload) return undefined;
    const job = claimed.payload as GenerationJob;
    localGenerationJobs.set(job.id, job);
    upsertGenerationJob(job);
    await persistLocalStore();
    return job;
  }

  await hydrateLocalStore();
  const claimed = claimGenerationJob(jobId, workerId, leaseMs);
  if (!claimed) return undefined;
  localGenerationJobs.set(claimed.id, claimed);
  await persistLocalStore();
  return claimed;
}

export async function releaseServerGenerationJob(jobId: string, workerId: string, request?: Request) {
  const existing = await getServerGenerationJob(jobId, request);
  if (!existing || existing.lockedBy !== workerId) return existing;

  const released = {
    ...existing,
    lockedBy: undefined,
    lockedUntil: undefined,
    updatedAt: new Date().toISOString(),
  };
  releaseGenerationJob(jobId, workerId);
  return saveServerGenerationJob(released, request);
}

export async function saveServerQualityReport(report: QualityReport, request?: Request) {
  const userId = await resolveUserId(request);
  localQualityReports.set(report.id, report);
  await persistLocalStore();

  const supabase = createSupabaseServiceClient();
  if (!supabase || !isUuid(userId) || !isUuid(report.id) || !isUuid(report.targetId)) return report;

  await requireSupabaseWrite(
    "Persist quality report",
    supabase.from("quality_reports").upsert({
      id: report.id,
      user_id: userId,
      target_type: report.targetType,
      target_id: report.targetId,
      score: report.score,
      status: report.status,
      payload: report,
      created_at: report.createdAt,
    }),
  );

  return report;
}

export async function saveServerUsageEvent(event: UsageEvent) {
  localUsageEvents.push(event);
  await persistLocalStore();

  const supabase = createSupabaseServiceClient();
  if (!supabase || !isUuid(event.userId)) return event;

  await requireSupabaseWrite(
    "Persist usage event",
    supabase.from("usage_events").insert({
      id: event.id,
      user_id: event.userId,
      action: event.action,
      created_at: event.createdAt,
    }),
  );

  return event;
}

export async function reserveServerUsageQuota(
  event: UsageEvent,
  limit: number,
  sinceIso: string,
) {
  const supabase = createSupabaseServiceClient();
  if (!supabase || !isUuid(event.userId)) return { ok: true, usedCount: undefined };

  const { data, error } = await supabase.rpc("reserve_usage_quota", {
    target_user_id: event.userId,
    target_action: event.action,
    quota_limit: limit,
    since_iso: sinceIso,
    reservation_id: event.id,
    reservation_ttl_ms: 600_000,
  });
  assertSupabaseNoError("Reserve usage quota", error);

  const reservation = Array.isArray(data) ? data[0] : data;
  return {
    ok: Boolean(reservation?.allowed),
    usedCount: typeof reservation?.used_count === "number" ? reservation.used_count : undefined,
  };
}

export async function commitServerUsageQuotaReservation(event: UsageEvent) {
  const supabase = createSupabaseServiceClient();
  if (!supabase || !isUuid(event.userId)) {
    await saveServerUsageEvent(event);
    return event;
  }

  const { data, error } = await supabase.rpc("commit_usage_quota_reservation", {
    reservation_id: event.id,
  });
  assertSupabaseNoError("Commit usage quota reservation", error);

  const committed = Array.isArray(data) ? data[0] : data;
  if (!committed?.id) {
    throw new Error("Commit usage quota reservation failed: reservation not found");
  }

  const usageEvent = {
    id: committed.id as string,
    userId: committed.user_id as string,
    action: committed.action as UsageEvent["action"],
    createdAt: committed.created_at as string,
  };
  localUsageEvents.push(usageEvent);
  await persistLocalStore();
  return usageEvent;
}

export async function releaseServerUsageQuotaReservation(event: UsageEvent) {
  const supabase = createSupabaseServiceClient();
  if (!supabase || !isUuid(event.userId)) return true;

  const { error } = await supabase.rpc("release_usage_quota_reservation", {
    reservation_id: event.id,
  });
  assertSupabaseNoError("Release usage quota reservation", error);
  return true;
}

export async function countServerUsageEvents(
  userId: string,
  action: UsageEvent["action"],
  sinceIso: string,
) {
  const supabase = createSupabaseServiceClient();

  if (supabase && isUuid(userId)) {
    const { count, error } = await supabase
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", action)
      .gte("created_at", sinceIso);

    assertSupabaseNoError("Count usage events", error);
    return count ?? 0;
  }

  await hydrateLocalStore();
  const since = Date.parse(sinceIso);
  return localUsageEvents.filter(
    (event) =>
      event.userId === userId &&
      event.action === action &&
      Date.parse(event.createdAt) >= since,
    ).length;
}

export async function listServerUsageEvents(request?: Request, action?: UsageEvent["action"]) {
  const userId = await resolveUserId(request);
  const supabase = createSupabaseServiceClient();

  if (supabase && isUuid(userId)) {
    let query = supabase
      .from("usage_events")
      .select("id, user_id, action, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (action) {
      query = query.eq("action", action);
    }

    const { data, error } = await query;
    assertSupabaseNoError("List usage events", error);
    return (data ?? []).map((row) => ({
      id: row.id as string,
      userId: row.user_id as string,
      action: row.action as UsageEvent["action"],
      createdAt: row.created_at as string,
    }));
  }

  await hydrateLocalStore();
  return localUsageEvents
    .filter((event) => event.userId === userId)
    .filter((event) => !action || event.action === action)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

async function hydrateLocalStore() {
  try {
    await localStoreWriteQueue.catch(() => undefined);
    const parsed = await readLocalStoreFromDisk();
    if (parsed) mergeLocalStoreIntoMemory(parsed);
  } catch {
    // Local fallback store is optional.
  }
}

async function persistLocalStore(options: { mergeDisk?: boolean } = {}) {
  const { mergeDisk = true } = options;
  localStoreWriteQueue = localStoreWriteQueue
    .catch(() => undefined)
    .then(() =>
      withLocalStoreLock(async () => {
        if (mergeDisk) {
          const diskStore = await readLocalStoreFromDisk();
          if (diskStore) mergeLocalStoreIntoMemory(diskStore);
        }
        await writeLocalStore(snapshotLocalStore());
      }),
    );
  await localStoreWriteQueue.catch(() => undefined);
}

function snapshotLocalStore(): LocalStore {
  return {
    courses: [...localCourses.values()],
    annotations: [...localAnnotations.values()],
    revisions: [...localRevisions.values()],
    exports: [...localExports.values()],
    generationJobs: [...localGenerationJobs.values()],
    qualityReports: [...localQualityReports.values()],
    usageEvents: [...localUsageEvents],
  };
}

async function readLocalStoreFromDisk() {
  try {
    const raw = await readFile(localStorePath, "utf8");
    if (!raw.trim()) return undefined;
    return JSON.parse(raw) as LocalStore;
  } catch {
    return undefined;
  }
}

function mergeLocalStoreIntoMemory(store: LocalStore) {
  store.courses?.forEach((course) => {
    const existing = localCourses.get(course.id);
    localCourses.set(course.id, chooseCourse(existing, course));
  });
  store.annotations?.forEach((annotation) => {
    const existing = localAnnotations.get(annotation.id);
    localAnnotations.set(annotation.id, chooseByCreatedMessageCount(existing, annotation));
  });
  store.revisions?.forEach((revision) => {
    const existing = localRevisions.get(revision.id);
    localRevisions.set(revision.id, chooseRevision(existing, revision));
  });
  store.exports?.forEach((exportJob) => {
    const existing = localExports.get(exportJob.id);
    localExports.set(exportJob.id, chooseByUpdatedAt(existing, exportJob));
  });
  store.generationJobs?.forEach((job) => {
    const existing = localGenerationJobs.get(job.id);
    localGenerationJobs.set(job.id, chooseJob(existing, job));
  });
  store.qualityReports?.forEach((report) => {
    const existing = localQualityReports.get(report.id);
    localQualityReports.set(report.id, chooseQualityReport(existing, report));
  });
  if (store.usageEvents?.length) {
    const eventsById = new Map(localUsageEvents.map((event) => [event.id, event]));
    store.usageEvents.forEach((event) => eventsById.set(event.id, event));
    localUsageEvents.splice(0, localUsageEvents.length, ...eventsById.values());
  }
}

function chooseCourse(existing: Course | undefined, incoming: Course) {
  if (!existing) return incoming;
  if (courseCompleteness(incoming) > courseCompleteness(existing)) return incoming;
  if (courseCompleteness(existing) > courseCompleteness(incoming)) return existing;
  return Date.parse(incoming.updatedAt ?? incoming.createdAt) >= Date.parse(existing.updatedAt ?? existing.createdAt)
    ? incoming
    : existing;
}

function courseCompleteness(course: Course) {
  return (
    (course.chapters?.length ?? 0) * 1000 +
    course.chapters.reduce((total, chapter) => total + (chapter.sections?.length ?? 0), 0) * 20 +
    course.chapters.filter((chapter) => chapter.content).length * 50 +
    course.chapters.filter((chapter) => chapter.status === "ready").length * 40 +
    course.chapters.filter((chapter) => chapter.status === "draft_ready" || chapter.status === "quality_failed").length * 25 +
    course.chapters.filter((chapter) => chapter.qualityReport).length * 30 +
    (course.profile === "Course planning is queued." ? 0 : 100)
  );
}

function chooseJob(existing: GenerationJob | undefined, incoming: GenerationJob) {
  if (!existing) return incoming;
  if (jobStatusRank(incoming.status) > jobStatusRank(existing.status)) return incoming;
  if (jobStatusRank(existing.status) > jobStatusRank(incoming.status)) return existing;
  if ((incoming.events?.length ?? 0) > (existing.events?.length ?? 0)) return incoming;
  if ((existing.events?.length ?? 0) > (incoming.events?.length ?? 0)) return existing;
  return chooseByUpdatedAt(existing, incoming);
}

function jobStatusRank(status: GenerationJob["status"]) {
  return {
    pending: 0,
    queued: 1,
    retrying: 2,
    running: 3,
    failed: 4,
    succeeded: 5,
  }[status];
}

function sortRunnableGenerationJobs(jobs: GenerationJob[]) {
  return [...jobs].sort((a, b) =>
    generationJobQueuePriority(a) - generationJobQueuePriority(b) ||
    Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
}

function generationJobQueuePriority(job: GenerationJob) {
  if (job.type === "course") return 0;
  if (job.type === "chapter" && job.mode !== "review_draft") return 1;
  if (job.type === "chapter" && job.mode === "review_draft") return 2;
  return 3;
}

async function shouldRecoverExpiredGenerationJob(
  job: GenerationJob,
  supabase: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
) {
  if (job.type !== "chapter") return true;
  return !(await hasPersistedChapterBody(job, supabase));
}

async function hasPersistedChapterBody(
  job: GenerationJob,
  supabase: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
) {
  if (!isUuid(job.chapterId)) return false;
  const { data, error } = await supabase
    .from("chapters")
    .select("payload")
    .eq("id", job.chapterId)
    .maybeSingle();

  assertSupabaseNoError("Read chapter before generation job recovery", error);
  const chapter = data?.payload as { content?: unknown; sections?: unknown[] } | undefined;
  return Boolean(chapter?.content || chapter?.sections?.length);
}

function shouldRecoverExpiredLocalGenerationJob(job: GenerationJob) {
  if (job.type !== "chapter" || !job.chapterId) return true;
  for (const course of localCourses.values()) {
    const chapter = course.chapters.find((item) => item.id === job.chapterId);
    if (chapter?.content || chapter?.sections?.length) return false;
  }
  return true;
}

function shouldRecoverStaleLockedRow(job: GenerationJob, lockedUntil?: string | null, updatedAt?: string | null) {
  const lockedUntilMs = lockedUntil ? Date.parse(lockedUntil) : NaN;
  if (Number.isFinite(lockedUntilMs) && lockedUntilMs <= Date.now()) return true;
  const updatedAtMs = Date.parse(updatedAt ?? job.updatedAt);
  return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs >= GENERATION_HEARTBEAT_STALE_MS;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function chooseQualityReport(existing: QualityReport | undefined, incoming: QualityReport) {
  if (!existing) return incoming;
  return Date.parse(incoming.createdAt) >= Date.parse(existing.createdAt) ? incoming : existing;
}

function chooseByUpdatedAt<T extends { updatedAt?: string; createdAt?: string }>(
  existing: T | undefined,
  incoming: T,
) {
  if (!existing) return incoming;
  return Date.parse(incoming.updatedAt ?? incoming.createdAt ?? "") >=
    Date.parse(existing.updatedAt ?? existing.createdAt ?? "")
    ? incoming
    : existing;
}

function chooseByCreatedMessageCount<T extends { createdAt?: string; messages?: unknown[] }>(
  existing: T | undefined,
  incoming: T,
) {
  if (!existing) return incoming;
  if ((incoming.messages?.length ?? 0) > (existing.messages?.length ?? 0)) return incoming;
  if ((existing.messages?.length ?? 0) > (incoming.messages?.length ?? 0)) return existing;
  return Date.parse(incoming.createdAt ?? "") >= Date.parse(existing.createdAt ?? "") ? incoming : existing;
}

function chooseRevision(existing: Revision | undefined, incoming: Revision) {
  if (!existing) return incoming;
  return revisionLifecycleTime(incoming) >= revisionLifecycleTime(existing) ? incoming : existing;
}

function revisionLifecycleTime(revision: Revision) {
  return Date.parse(revision.revertedAt ?? revision.appliedAt ?? revision.createdAt);
}

async function withLocalStoreLock<T>(operation: () => Promise<T>) {
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(localStoreLockPath);
      break;
    } catch {
      if (await removeStaleLocalStoreLock()) continue;
      if (Date.now() - startedAt > LOCAL_STORE_LOCK_TIMEOUT_MS) {
        return operation();
      }
      await delay(25);
    }
  }

  try {
    return await operation();
  } finally {
    await rm(localStoreLockPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function removeStaleLocalStoreLock() {
  try {
    const lockStats = await stat(localStoreLockPath);
    if (Date.now() - lockStats.mtimeMs < LOCAL_STORE_STALE_LOCK_MS) return false;
    await rm(localStoreLockPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publishSavedCourse(course: Course) {
  publishCourseChanged(course.id);
  return course;
}

function publishSavedGenerationJob(job: GenerationJob) {
  publishGenerationJobChanged(job);
  return job;
}

async function requireSupabaseWrite(label: string, operation: PromiseLike<SupabaseResult>) {
  const { error } = await operation;
  assertSupabaseNoError(label, error);
}

async function resolveGenerationJobCourseId(
  supabase: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
  job: GenerationJob,
) {
  if (!isUuid(job.courseId) || !isUuid(job.userId)) return null;

  const { data, error } = await supabase
    .from("courses")
    .select("id")
    .eq("id", job.courseId)
    .eq("user_id", job.userId)
    .maybeSingle();

  assertSupabaseNoError("Resolve generation job course", error);
  return data?.id ? job.courseId : null;
}

async function resolveGenerationJobChapterId(
  supabase: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
  job: GenerationJob,
) {
  if (!isUuid(job.chapterId) || !isUuid(job.userId)) return null;

  let query = supabase
    .from("chapters")
    .select("id")
    .eq("id", job.chapterId)
    .eq("user_id", job.userId);

  if (isUuid(job.courseId)) {
    query = query.eq("course_id", job.courseId);
  }

  const { data, error } = await query.maybeSingle();
  assertSupabaseNoError("Resolve generation job chapter", error);
  return data?.id ? job.chapterId : null;
}

function assertSupabaseNoError(label: string, error: SupabaseErrorLike | null | undefined) {
  if (!error) return;
  const detail = error.code ? `${error.code}: ${error.message ?? "unknown error"}` : error.message ?? "unknown error";
  throw new Error(`${label} failed: ${detail}`);
}

async function getConflictingActiveGenerationJob(job: GenerationJob, request?: Request) {
  if (job.type === "course" && job.courseId) {
    return getActiveServerGenerationJob("course_id", job.courseId, "course", request);
  }
  if (job.type === "chapter" && job.chapterId) {
    return getActiveServerGenerationJob("chapter_id", job.chapterId, "chapter", request);
  }
  return undefined;
}

function isActiveGenerationJobConflict(error: SupabaseErrorLike | null | undefined) {
  if (error?.code !== "23505") return false;
  return /generation_jobs_active_(course|chapter)_idx/u.test(
    `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`,
  );
}

async function writeLocalStore(store: LocalStore) {
  await mkdir(dirname(localStorePath), { recursive: true });
  const raw = JSON.stringify(store);
  const tmpPath = `${localStorePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tmpPath, raw, "utf8");

  try {
    await rename(tmpPath, localStorePath);
  } catch {
    await unlink(tmpPath).catch(() => undefined);
  }
}

function isUuid(value?: string) {
  return Boolean(
    value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  );
}
