import "server-only";

import { createGenerationJob, upsertGenerationJob } from "./jobs";
import { AdminAppSettings, getAdminAppSettings, saveAdminAppSettings } from "./adminSettings";
import { MODEL_AGENT_NAMES, ModelOverrides, normalizeModelOverrides } from "./modelOverrides";
import { createSupabaseServiceClient } from "./supabase/server";
import { deleteServerCourseByAdmin, snapshotChapterBeforeRegen } from "./serverStore";
import { normalizeCourse, normalizeLearningMode, normalizeStyles } from "./normalizeCourse";
import { buildStyleGuidance } from "./prompts/styleGuidance";
import { Chapter, Course, CourseDifficulty, ExplanationStyle, ExportJob, GenerationJob, LearningMode, QualityReport, UsageEvent } from "./types";

export const ACTIVE_ADMIN_JOB_STATUSES: GenerationJob["status"][] = ["pending", "queued", "running", "retrying"];
export const INACTIVE_ADMIN_JOB_STATUSES: GenerationJob["status"][] = ["succeeded", "failed"];
export const USAGE_ACTIONS: UsageEvent["action"][] = ["create_course", "generate_chapter", "ask_tutor", "export", "revise"];

export type AdminUserRow = {
  id: string;
  email: string;
  createdAt: string;
  bannedUntil?: string;
  isBanned: boolean;
  courseCount: number;
  jobCount: number;
  activeJobCount: number;
  usageCount: number;
  lastActivityAt?: string;
};

export type AdminCourseRow = {
  id: string;
  userId?: string;
  userEmail?: string;
  topic: string;
  goal: string;
  background?: string;
  preference?: string;
  difficulty?: CourseDifficulty;
  targetChapterCount?: number;
  createdAt: string;
  updatedAt?: string;
  chapterCount: number;
  readyCount: number;
  qualityFailedCount: number;
  activeJobCount: number;
  course: Course;
};

export type AdminChapterRow = {
  id: string;
  courseId: string;
  userId?: string;
  userEmail?: string;
  courseTopic: string;
  title: string;
  description: string;
  status: Chapter["status"];
  qualityStatus?: QualityReport["status"];
  qualityScore?: number;
  generationJobId?: string;
  updatedAt?: string;
  chapter: Chapter;
};

export type AdminJobRow = {
  id: string;
  type: GenerationJob["type"];
  mode?: GenerationJob["mode"];
  status: GenerationJob["status"];
  activeAgent?: GenerationJob["activeAgent"];
  courseId?: string;
  chapterId?: string;
  courseTopic?: string;
  chapterTitle?: string;
  userId?: string;
  userEmail?: string;
  error?: string;
  attempts?: number;
  lockedBy?: string;
  lockedUntil?: string;
  createdAt: string;
  updatedAt: string;
  events: GenerationJob["events"];
  job: GenerationJob;
};

export type AdminQualityRow = {
  id: string;
  userId?: string;
  userEmail?: string;
  courseId?: string;
  courseTopic?: string;
  chapterId?: string;
  chapterTitle?: string;
  targetType: QualityReport["targetType"];
  targetId: string;
  score: number;
  status: QualityReport["status"];
  issueCount: number;
  createdAt: string;
  report: QualityReport;
};

export type AdminUsageRow = {
  id: string;
  userId?: string;
  userEmail?: string;
  action: UsageEvent["action"];
  createdAt: string;
};

export type AdminExportRow = {
  id: string;
  userId?: string;
  userEmail?: string;
  courseId: string;
  courseTopic?: string;
  format: ExportJob["format"];
  status: ExportJob["status"];
  fileName?: string;
  storageProvider?: ExportJob["storageProvider"];
  createdAt: string;
  updatedAt: string;
  exportJob: ExportJob;
};

export type AdminAuditLogRow = {
  id: string;
  adminUsername: string;
  action: string;
  targetType: string;
  targetId?: string;
  summary: string;
  createdAt: string;
};

type ListOptions = {
  query?: string;
  userId?: string;
  status?: string;
  courseId?: string;
  latest?: boolean;
  type?: string;
  action?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
};

type AdminActionContext = {
  adminUsername: string;
};

export async function getAdminOverview() {
  const [courses, jobs, users, usageEvents, qualityReports, exports] = await Promise.all([
    listAdminCourses({ limit: 1000 }),
    listAdminJobs({ limit: 1000 }),
    listAdminUsers({ limit: 1000 }),
    listAdminUsageEvents({ limit: 2000 }),
    listAdminQualityReports({ limit: 500 }),
    listAdminExports({ limit: 500 }),
  ]);

  const activeJobs = jobs.filter((job) => ACTIVE_ADMIN_JOB_STATUSES.includes(job.status));
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const qualityFailedChapters = courses.reduce((total, course) => total + course.qualityFailedCount, 0);
  const readyChapters = courses.reduce((total, course) => total + course.readyCount, 0);
  const totalChapters = courses.reduce((total, course) => total + course.chapterCount, 0);

  return {
    stats: {
      userCount: users.length,
      bannedUserCount: users.filter((user) => user.isBanned).length,
      courseCount: courses.length,
      activeJobCount: activeJobs.length,
      failedJobCount: failedJobs.length,
      qualityFailedChapters,
      readyChapters,
      totalChapters,
      usageEventCount: usageEvents.length,
      exportCount: exports.length,
      failedQualityReportCount: qualityReports.filter((report) => report.status === "failed").length,
    },
    recentCourses: courses.slice(0, 6),
    recentJobs: jobs.slice(0, 10),
    activeJobs,
    failedJobs: failedJobs.slice(0, 10),
    lowQualityReports: qualityReports.filter((report) => report.status === "failed" || report.score < 80).slice(0, 10),
  };
}

export async function listAdminUsers(options: ListOptions = {}): Promise<AdminUserRow[]> {
  const supabase = requireAdminSupabaseClient();
  const [{ data: usersData, error: usersError }, { data: coursesData, error: coursesError }, { data: usageData, error: usageError }, jobs] = await Promise.all([
    safeListAdminAuthUsers(),
    supabase.from("courses").select("user_id, updated_at"),
    supabase.from("usage_events").select("user_id, created_at").order("created_at", { ascending: false }).limit(5000),
    listAdminJobs({ limit: 5000 }),
  ]);

  logAdminSoftError("读取用户", usersError);
  assertAdminNoError("读取课程用户统计", coursesError);
  assertAdminNoError("读取用量统计", usageError);

  const courseCounts = new Map<string, number>();
  const usageCounts = new Map<string, number>();
  const lastActivity = new Map<string, string>();
  const jobCounts = new Map<string, number>();
  const activeJobCounts = new Map<string, number>();

  for (const row of coursesData ?? []) {
    if (!row.user_id) continue;
    courseCounts.set(row.user_id, (courseCounts.get(row.user_id) ?? 0) + 1);
    updateMaxDate(lastActivity, row.user_id, row.updated_at);
  }
  for (const row of usageData ?? []) {
    if (!row.user_id) continue;
    usageCounts.set(row.user_id, (usageCounts.get(row.user_id) ?? 0) + 1);
    updateMaxDate(lastActivity, row.user_id, row.created_at);
  }
  for (const job of jobs) {
    if (!job.userId) continue;
    jobCounts.set(job.userId, (jobCounts.get(job.userId) ?? 0) + 1);
    if (ACTIVE_ADMIN_JOB_STATUSES.includes(job.status)) {
      activeJobCounts.set(job.userId, (activeJobCounts.get(job.userId) ?? 0) + 1);
    }
    updateMaxDate(lastActivity, job.userId, job.updatedAt);
  }

  const query = options.query?.trim().toLowerCase();
  const authUserRows = (usersData.users ?? []).map((user) => {
    const bannedUntil = user.banned_until ?? undefined;
    return {
      id: user.id,
      email: user.email ?? "未设置邮箱",
      createdAt: user.created_at,
      bannedUntil,
      isBanned: Boolean(bannedUntil && Date.parse(bannedUntil) > Date.now()),
      courseCount: courseCounts.get(user.id) ?? 0,
      jobCount: jobCounts.get(user.id) ?? 0,
      activeJobCount: activeJobCounts.get(user.id) ?? 0,
      usageCount: usageCounts.get(user.id) ?? 0,
      lastActivityAt: lastActivity.get(user.id),
    } satisfies AdminUserRow;
  });

  const rows = authUserRows.length ? authUserRows : buildFallbackAdminUsers(coursesData ?? [], usageData ?? [], jobs, courseCounts, usageCounts, jobCounts, activeJobCounts, lastActivity);

  return paginate(
    rows
      .filter((user) => !query || `${user.email} ${user.id}`.toLowerCase().includes(query))
      .filter((user) => !options.status || (options.status === "banned" ? user.isBanned : !user.isBanned))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    options,
  );
}

export async function getAdminUser(id: string) {
  const [users, courses, jobs, usage] = await Promise.all([
    listAdminUsers({ limit: 1000 }),
    listAdminCourses({ userId: id, limit: 1000 }),
    listAdminJobs({ userId: id, limit: 500 }),
    listAdminUsageEvents({ userId: id, limit: 500 }),
  ]);
  const user = users.find((item) => item.id === id);
  if (!user) return undefined;
  return { ...user, courses, jobs, usage };
}

export async function listAdminCourses(options: ListOptions = {}): Promise<AdminCourseRow[]> {
  const supabase = requireAdminSupabaseClient();
  const [{ data: courseRows, error: coursesError }, users, jobs] = await Promise.all([
    supabase.from("courses").select("id, user_id, topic, goal, payload, created_at, updated_at").order("updated_at", { ascending: false }),
    listAdminUsersLight(),
    listAdminJobs({ limit: 5000 }),
  ]);
  assertAdminNoError("读取课程", coursesError);

  const usersById = new Map(users.map((user) => [user.id, user]));
  const activeJobsByCourse = new Map<string, number>();
  for (const job of jobs) {
    if (!job.courseId || !ACTIVE_ADMIN_JOB_STATUSES.includes(job.status)) continue;
    activeJobsByCourse.set(job.courseId, (activeJobsByCourse.get(job.courseId) ?? 0) + 1);
  }

  const query = options.query?.trim().toLowerCase();
  return paginate(
    (courseRows ?? [])
      .map((row) => {
        const course = normalizeCourse(row.payload as Course);
        const chapterStats = getChapterStats(course.chapters ?? []);
        return {
          id: row.id,
          userId: row.user_id,
          userEmail: usersById.get(row.user_id)?.email,
          topic: course.topic ?? row.topic,
          goal: course.goal ?? row.goal,
          background: course.background,
          preference: course.preference,
          difficulty: course.difficulty,
          targetChapterCount: course.chapterCount,
          createdAt: course.createdAt ?? row.created_at,
          updatedAt: course.updatedAt ?? row.updated_at,
          chapterCount: chapterStats.total,
          readyCount: chapterStats.ready,
          qualityFailedCount: chapterStats.qualityFailed,
          activeJobCount: activeJobsByCourse.get(row.id) ?? 0,
          course,
        } satisfies AdminCourseRow;
      })
      .filter((row) => !options.userId || row.userId === options.userId)
      .filter((row) => !query || `${row.topic} ${row.goal} ${row.userEmail ?? ""}`.toLowerCase().includes(query))
      .filter((row) => {
        if (!options.status) return true;
        if (options.status === "active") return row.activeJobCount > 0;
        if (options.status === "quality_failed") return row.qualityFailedCount > 0;
        if (options.status === "ready") return row.chapterCount > 0 && row.readyCount === row.chapterCount;
        return true;
      }),
    options,
  );
}

export async function getAdminCourse(id: string) {
  const courses = await listAdminCourses({ limit: 5000 });
  const course = courses.find((item) => item.id === id);
  if (!course) return undefined;
  const jobs = await listAdminJobs({ courseId: id, limit: 200 });
  return { ...course, jobs };
}

export async function listAdminChapters(options: ListOptions = {}): Promise<AdminChapterRow[]> {
  const courses = await listAdminCourses({ query: options.query, userId: options.userId, limit: 5000 });
  const rows = courses.flatMap((course) =>
    (course.course.chapters ?? []).map((chapter) => ({
      id: chapter.id,
      courseId: course.id,
      userId: course.userId,
      userEmail: course.userEmail,
      courseTopic: course.topic,
      title: chapter.title,
      description: chapter.description,
      status: chapter.status,
      qualityStatus: chapter.qualityReport?.status,
      qualityScore: chapter.qualityReport?.score,
      generationJobId: chapter.generationJobId,
      updatedAt: course.updatedAt,
      chapter,
    })),
  );
  return paginate(
    rows.filter((row) => !options.status || row.status === options.status || row.qualityStatus === options.status),
    options,
  );
}

export async function listAdminJobs(options: ListOptions & { courseId?: string } = {}): Promise<AdminJobRow[]> {
  const supabase = requireAdminSupabaseClient();
  let query = supabase
    .from("generation_jobs")
    .select("id, user_id, course_id, chapter_id, type, status, attempts, locked_by, locked_until, payload, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(options.limit ?? 200);

  if (options.status) query = query.eq("status", options.status);
  if (options.type) query = query.eq("type", options.type);
  if (options.courseId) query = query.eq("course_id", options.courseId);
  if (options.userId) query = query.eq("user_id", options.userId);

  const [{ data: jobRows, error }, { data: courseRows, error: coursesError }, users] = await Promise.all([
    query,
    supabase.from("courses").select("id, user_id, topic, payload"),
    listAdminUsersLight(),
  ]);
  assertAdminNoError("读取生成任务", error);
  assertAdminNoError("读取任务关联课程", coursesError);

  const usersById = new Map(users.map((user) => [user.id, user]));
  const coursesById = new Map((courseRows ?? []).map((row) => [row.id, normalizeCourse(row.payload as Course)]));
  const queryText = options.query?.trim().toLowerCase();

  return paginate(
    (jobRows ?? [])
      .map((row) => {
        const job = row.payload as GenerationJob;
        const course = row.course_id ? coursesById.get(row.course_id) : undefined;
        const chapter = row.chapter_id ? course?.chapters.find((item) => item.id === row.chapter_id) : undefined;
        return {
          id: row.id,
          type: job.type ?? row.type,
          mode: job.mode,
          status: job.status ?? row.status,
          activeAgent: job.activeAgent,
          courseId: job.courseId ?? row.course_id ?? undefined,
          chapterId: job.chapterId ?? row.chapter_id ?? undefined,
          courseTopic: course?.topic,
          chapterTitle: chapter?.title,
          userId: job.userId ?? row.user_id ?? undefined,
          userEmail: usersById.get(job.userId ?? row.user_id ?? "")?.email,
          error: job.error,
          attempts: job.attempts ?? row.attempts ?? 0,
          lockedBy: job.lockedBy ?? row.locked_by ?? undefined,
          lockedUntil: job.lockedUntil ?? row.locked_until ?? undefined,
          createdAt: job.createdAt ?? row.created_at,
          updatedAt: job.updatedAt ?? row.updated_at,
          events: job.events ?? [],
          job,
        } satisfies AdminJobRow;
      })
      .filter((job) => !queryText || `${job.id} ${job.courseTopic ?? ""} ${job.chapterTitle ?? ""} ${job.userEmail ?? ""} ${job.error ?? ""}`.toLowerCase().includes(queryText)),
    options,
  );
}

export async function listAdminUsageEvents(options: ListOptions = {}): Promise<AdminUsageRow[]> {
  const supabase = requireAdminSupabaseClient();
  let query = supabase
    .from("usage_events")
    .select("id, user_id, action, created_at")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 500);
  if (options.userId) query = query.eq("user_id", options.userId);
  if (options.action) query = query.eq("action", options.action);
  const [{ data, error }, users] = await Promise.all([query, listAdminUsersLight()]);
  assertAdminNoError("读取用量事件", error);
  const usersById = new Map(users.map((user) => [user.id, user]));
  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail: usersById.get(row.user_id)?.email,
    action: row.action as UsageEvent["action"],
    createdAt: row.created_at,
  }));
}

export async function listAdminQualityReports(options: ListOptions = {}): Promise<AdminQualityRow[]> {
  const supabase = requireAdminSupabaseClient();
  let query = supabase
    .from("quality_reports")
    .select("id, user_id, target_type, target_id, score, status, payload, created_at")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 300);
  if (options.userId) query = query.eq("user_id", options.userId);
  if (options.status) query = query.eq("status", options.status);

  const [{ data, error }, courses, users] = await Promise.all([query, listAdminCourses({ limit: 5000 }), listAdminUsersLight()]);
  assertAdminNoError("读取质检报告", error);

  const usersById = new Map(users.map((user) => [user.id, user]));
  const courseByTarget = new Map<string, AdminCourseRow>();
  const chapterByTarget = new Map<string, { course: AdminCourseRow; chapter: Chapter }>();
  for (const course of courses) {
    courseByTarget.set(course.id, course);
    for (const chapter of course.course.chapters ?? []) {
      chapterByTarget.set(chapter.id, { course, chapter });
      for (const section of chapter.sections ?? []) {
        chapterByTarget.set(section.id, { course, chapter });
      }
    }
  }

  const mapped: AdminQualityRow[] = (data ?? []).map((row) => {
    const report = row.payload as QualityReport;
    const course = courseByTarget.get(row.target_id);
    const chapterMatch = chapterByTarget.get(row.target_id);
    return {
      id: row.id,
      userId: row.user_id,
      userEmail: usersById.get(row.user_id)?.email,
      courseId: course?.id ?? chapterMatch?.course.id,
      courseTopic: course?.topic ?? chapterMatch?.course.topic,
      chapterId: chapterMatch?.chapter.id,
      chapterTitle: chapterMatch?.chapter.title,
      targetType: row.target_type as QualityReport["targetType"],
      targetId: row.target_id,
      score: row.score,
      status: row.status as QualityReport["status"],
      issueCount: report.issues?.length ?? 0,
      createdAt: row.created_at,
      report,
    };
  });

  let filtered = options.courseId ? mapped.filter((row) => row.courseId === options.courseId) : mapped;

  if (options.latest) {
    const latestByTarget = new Map<string, AdminQualityRow>();
    for (const row of filtered) {
      const existing = latestByTarget.get(row.targetId);
      if (!existing || new Date(row.createdAt) > new Date(existing.createdAt)) {
        latestByTarget.set(row.targetId, row);
      }
    }
    filtered = Array.from(latestByTarget.values());
  }

  return paginate(filtered, options);
}

export async function listAdminExports(options: ListOptions = {}): Promise<AdminExportRow[]> {
  const supabase = requireAdminSupabaseClient();
  let query = supabase
    .from("exports")
    .select("id, user_id, course_id, format, status, file_name, storage_provider, payload, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 300);
  if (options.userId) query = query.eq("user_id", options.userId);
  if (options.status) query = query.eq("status", options.status);

  const [{ data, error }, courses, users] = await Promise.all([query, listAdminCourses({ limit: 5000 }), listAdminUsersLight()]);
  assertAdminNoError("读取导出记录", error);
  const coursesById = new Map(courses.map((course) => [course.id, course]));
  const usersById = new Map(users.map((user) => [user.id, user]));

  return paginate(
    (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      userEmail: usersById.get(row.user_id)?.email,
      courseId: row.course_id,
      courseTopic: coursesById.get(row.course_id)?.topic,
      format: row.format as ExportJob["format"],
      status: row.status as ExportJob["status"],
      fileName: row.file_name ?? undefined,
      storageProvider: row.storage_provider as ExportJob["storageProvider"] | undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      exportJob: row.payload as ExportJob,
    })),
    options,
  );
}

export async function listAdminAuditLogs(options: ListOptions = {}): Promise<AdminAuditLogRow[]> {
  const supabase = requireAdminSupabaseClient();
  const { data, error } = await supabase
    .from("admin_audit_logs")
    .select("id, admin_username, action, target_type, target_id, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 300);
  assertAdminNoError("读取操作日志", error);
  return (data ?? []).map((row) => ({
    id: row.id,
    adminUsername: row.admin_username,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id ?? undefined,
    summary: row.summary,
    createdAt: row.created_at,
  }));
}

export async function getAdminSettings() {
  return getAdminAppSettings();
}

export async function saveAdminSettingsAction(input: AdminAppSettings, context: AdminActionContext) {
  const previous = await getAdminAppSettings();
  const settings = await saveAdminAppSettings(preserveHiddenModelSecrets(input, previous), context.adminUsername);
  await recordAdminAudit(context, "save_settings", "settings", undefined, "保存系统设置");
  return settings;
}

export async function createAdminCourse(input: {
  userId: string;
  topic: string;
  goal: string;
  background: string;
  preference: string;
  styles?: ExplanationStyle[];
  learningMode?: LearningMode;
  chapterCount: number;
  difficulty: CourseDifficulty;
}, context: AdminActionContext) {
  const now = new Date().toISOString();
  const preference = input.preference.trim();
  const styles = normalizeStyles(input.styles);
  const learningMode = normalizeLearningMode(input.learningMode);
  const course: Course = {
    id: crypto.randomUUID(),
    userId: input.userId,
    topic: input.topic.trim(),
    goal: input.goal.trim(),
    background: input.background.trim(),
    preference,
    styles,
    learningMode,
    chapterCount: input.chapterCount,
    difficulty: input.difficulty,
    profile: "课程规划已进入队列。",
    courseBible: {
      targetLearner: input.background.trim(),
      finalOutcomes: [input.goal.trim()],
      teachingStyle: buildStyleGuidance(styles, preference),
      prerequisites: [],
      globalNarrative: "等待 ARCHITECT 生成课程全局设定。",
      terminology: [],
      chapterDependencies: [],
    },
    chapters: [],
    createdAt: now,
    updatedAt: now,
  };
  const job = createGenerationJob({
    type: "course",
    courseId: course.id,
    userId: input.userId,
    activeAgent: "ARCHITECT",
    status: "queued",
    message: "管理员创建课程并排队规划。",
  });
  const courseWithJob = { ...course, generationJobId: job.id };
  await persistAdminCourse(courseWithJob);
  await updateGenerationJobRow(job);
  upsertGenerationJob(job);
  await recordAdminAudit(context, "create_course", "course", course.id, `创建课程：${course.topic}`);
  return { course: courseWithJob, job };
}

export async function updateAdminCourse(input: {
  courseId: string;
  topic: string;
  goal: string;
  background: string;
  preference: string;
  styles?: ExplanationStyle[];
  learningMode?: LearningMode;
  chapterCount: number;
  difficulty: CourseDifficulty;
}, context: AdminActionContext) {
  const course = await readAdminCoursePayload(input.courseId);
  const nextCourse: Course = {
    ...course,
    topic: input.topic.trim(),
    goal: input.goal.trim(),
    background: input.background.trim(),
    preference: input.preference.trim(),
    styles: input.styles ? normalizeStyles(input.styles) : course.styles,
    learningMode: input.learningMode ? normalizeLearningMode(input.learningMode) : course.learningMode,
    chapterCount: input.chapterCount,
    difficulty: input.difficulty,
    updatedAt: new Date().toISOString(),
  };
  await persistAdminCourse(nextCourse);
  await recordAdminAudit(context, "update_course", "course", input.courseId, `编辑课程：${nextCourse.topic}`);
  return nextCourse;
}

export async function deleteAdminUser(userId: string, context: AdminActionContext) {
  await cancelActiveAdminJobs({ userId }, context, false);
  const supabase = requireAdminSupabaseClient();
  const { error } = await supabase.auth.admin.deleteUser(userId);
  assertAdminNoError("删除用户", error);
  await recordAdminAudit(context, "delete_user", "user", userId, "删除用户及其关联数据");
  return { ok: true };
}

export async function banAdminUser(userId: string, context: AdminActionContext) {
  const supabase = requireAdminSupabaseClient();
  const { data, error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
  });
  assertAdminNoError("封禁用户", error);
  await recordAdminAudit(context, "ban_user", "user", userId, `封禁用户：${data.user?.email ?? userId}`);
  return data.user;
}

export async function unbanAdminUser(userId: string, context: AdminActionContext) {
  const supabase = requireAdminSupabaseClient();
  const { data, error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  assertAdminNoError("解封用户", error);
  await recordAdminAudit(context, "unban_user", "user", userId, `解封用户：${data.user?.email ?? userId}`);
  return data.user;
}

export async function resetAdminUserPassword(userId: string, password: string, context: AdminActionContext) {
  if (password.length < 6) throw new Error("新密码至少需要 6 位。");
  const supabase = requireAdminSupabaseClient();
  const { data, error } = await supabase.auth.admin.updateUserById(userId, { password });
  assertAdminNoError("重设用户密码", error);
  await recordAdminAudit(context, "reset_user_password", "user", userId, `重设用户密码：${data.user?.email ?? userId}`);
  return { ok: true };
}

export async function deleteAdminCourse(courseId: string, context: AdminActionContext) {
  await cancelActiveAdminJobs({ courseId }, context, false);
  const course = await readAdminCoursePayload(courseId);
  await deleteServerCourseByAdmin(courseId);
  await recordAdminAudit(context, "delete_course", "course", courseId, `删除课程：${course.topic}`);
  return { ok: true };
}

export async function deleteAdminChapter(courseId: string, chapterId: string, context: AdminActionContext) {
  await cancelActiveAdminJobs({ chapterId }, context, false);
  const course = await readAdminCoursePayload(courseId);
  const chapter = course.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在。");
  const now = new Date().toISOString();
  const nextCourse = {
    ...course,
    chapters: course.chapters.filter((item) => item.id !== chapterId),
    updatedAt: now,
  };
  const supabase = requireAdminSupabaseClient();
  const { error: reportError } = await supabase.from("quality_reports").delete().eq("target_id", chapterId);
  assertAdminNoError("删除章节质检报告", reportError);
  const { error: chapterError } = await supabase.from("chapters").delete().eq("id", chapterId);
  assertAdminNoError("删除章节", chapterError);
  await persistAdminCourse(nextCourse);
  await recordAdminAudit(context, "delete_chapter", "chapter", chapterId, `删除章节：${chapter.title}`);
  return nextCourse;
}

export async function repairAdminChapterStatus(courseId: string, chapterId: string, status: Chapter["status"], context: AdminActionContext) {
  const course = await patchAdminChapter(courseId, chapterId, { status });
  await recordAdminAudit(context, "repair_chapter_status", "chapter", chapterId, `修复章节状态为：${status}`);
  return course;
}

export async function cancelAdminJob(jobId: string, context?: AdminActionContext) {
  const job = await markAdminJobCancelled(jobId);
  if (context) await recordAdminAudit(context, "cancel_job", "job", jobId, `取消任务：${jobId}`);
  return job;
}

export async function deleteAdminJob(jobId: string, context: AdminActionContext) {
  const supabase = requireAdminSupabaseClient();
  const { data, error } = await supabase.from("generation_jobs").select("status, payload").eq("id", jobId).maybeSingle();
  assertAdminNoError("读取待删除任务", error);
  if (!data?.payload) throw new Error("任务不存在。");
  const job = data.payload as GenerationJob;
  if (ACTIVE_ADMIN_JOB_STATUSES.includes(job.status)) throw new Error("活跃任务不能直接删除，请先取消。");
  const { error: deleteError } = await supabase.from("generation_jobs").delete().eq("id", jobId);
  assertAdminNoError("删除任务", deleteError);
  await recordAdminAudit(context, "delete_job", "job", jobId, `删除任务：${jobId}`);
  return { ok: true };
}

export async function retryAdminJob(jobId: string, context: AdminActionContext) {
  const supabase = requireAdminSupabaseClient();
  const { data, error } = await supabase.from("generation_jobs").select("payload").eq("id", jobId).maybeSingle();
  assertAdminNoError("读取待重试任务", error);
  if (!data?.payload) throw new Error("任务不存在。");
  const job = data.payload as GenerationJob;
  const modelOverrides = job.modelOverrides ?? await findAdminModelOverridesForChapter(job.courseId, job.chapterId);
  const retryAsGeneration = await shouldRetryAdminJobAsGeneration(job);
  if (job.status !== "failed") throw new Error("只有失败任务可以重试。");
  const now = new Date().toISOString();
  const nextJob: GenerationJob = {
    ...job,
    ...(retryAsGeneration ? { mode: undefined, activeAgent: "AUTHOR" as const } : {}),
    status: "retrying",
    error: undefined,
    lockedBy: undefined,
    lockedUntil: undefined,
    modelOverrides,
    updatedAt: now,
    events: [
      ...(job.events ?? []),
      {
        id: crypto.randomUUID(),
        agent: job.activeAgent ?? "ASSISTANT",
        status: "retrying",
        message: "管理员已重新排队任务。",
        createdAt: now,
      },
    ],
  };
  await updateGenerationJobRow(nextJob);
  if (nextJob.type === "chapter" && nextJob.courseId && nextJob.chapterId) {
    await patchAdminChapter(nextJob.courseId, nextJob.chapterId, {
      status: retryAsGeneration || nextJob.mode !== "review_draft" ? "queued" : "draft_ready",
      generationJobId: nextJob.id,
    });
  }
  await recordAdminAudit(context, "retry_job", "job", jobId, `重试任务：${jobId}`);
  return nextJob;
}

export async function cancelActiveAdminJobs(filters: { userId?: string; courseId?: string; chapterId?: string } = {}, context?: AdminActionContext, audit = true) {
  const jobs = await listAdminJobs({ ...filters, limit: 5000 });
  const active = jobs.filter((job) => ACTIVE_ADMIN_JOB_STATUSES.includes(job.status));
  for (const job of active) {
    await markAdminJobCancelled(job.id);
  }
  if (context && audit) {
    await recordAdminAudit(context, "cancel_active_jobs", "job", filters.userId ?? filters.courseId ?? filters.chapterId, `批量取消活跃任务：${active.length} 个`);
  }
  return { count: active.length };
}

export async function enqueueAdminChapterReview(courseId: string, chapterId: string, context?: AdminActionContext) {
  const course = await readAdminCoursePayload(courseId);
  const chapter = course.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在。");
  if (!hasChapterBody(chapter)) throw new Error("只有已有正文的章节才能重新排队质检。");
  if (!course.userId) throw new Error("课程缺少用户归属，无法创建任务。");

  const existing = await findActiveAdminChapterJob(chapterId);
  if (existing) return existing;

  const modelOverrides = await findAdminModelOverridesForChapter(courseId, chapterId);
  const job = createGenerationJob({
    type: "chapter",
    mode: "review_draft",
    courseId,
    chapterId,
    userId: course.userId,
    activeAgent: "POLISHER",
    status: "queued",
    modelOverrides,
    message: "管理员已重新排队章节质检。",
  });
  await updateGenerationJobRow(job);
  await patchAdminChapter(courseId, chapterId, {
    status: "draft_ready",
    generationJobId: job.id,
  });
  if (context) await recordAdminAudit(context, "review_chapter", "chapter", chapterId, `重新质检章节：${chapter.title}`);
  return job;
}

export async function enqueueAdminChapterGeneration(courseId: string, chapterId: string, context?: AdminActionContext) {
  const course = await readAdminCoursePayload(courseId);
  const chapter = course.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("章节不存在。");
  if (!course.userId) throw new Error("课程缺少用户归属，无法创建任务。");

  const existing = await findActiveAdminChapterJob(chapterId);
  if (existing) return existing;

  const modelOverrides = await findAdminModelOverridesForChapter(courseId, chapterId);
  const job = createGenerationJob({
    type: "chapter",
    courseId,
    chapterId,
    userId: course.userId,
    activeAgent: "AUTHOR",
    status: "queued",
    modelOverrides,
    message: "管理员已重新排队章节生成。",
  });
  await updateGenerationJobRow(job);
  // Best-effort snapshot so an admin regeneration can be reverted to the prior version.
  await snapshotChapterBeforeRegen(course, chapterId).catch(() => undefined);
  await patchAdminChapter(courseId, chapterId, {
    content: undefined,
    sections: undefined,
    review: undefined,
    qualityReport: undefined,
    status: "queued",
    generationJobId: job.id,
  });
  if (context) await recordAdminAudit(context, "regenerate_chapter", "chapter", chapterId, `重新生成章节：${chapter.title}`);
  return job;
}

export async function deleteAdminExport(exportId: string, context: AdminActionContext) {
  const supabase = requireAdminSupabaseClient();
  const { error } = await supabase.from("exports").delete().eq("id", exportId);
  assertAdminNoError("删除导出记录", error);
  await recordAdminAudit(context, "delete_export", "export", exportId, `删除导出记录：${exportId}`);
  return { ok: true };
}

async function markAdminJobCancelled(jobId: string) {
  const supabase = requireAdminSupabaseClient();
  const { data, error } = await supabase.from("generation_jobs").select("payload, status").eq("id", jobId).maybeSingle();
  assertAdminNoError("读取待取消任务", error);
  if (!data?.payload) throw new Error("任务不存在。");

  const job = data.payload as GenerationJob;
  if (!ACTIVE_ADMIN_JOB_STATUSES.includes(job.status)) {
    throw new Error("只能取消待处理、队列中、运行中或重试中的任务。");
  }

  const now = new Date().toISOString();
  const nextJob: GenerationJob = {
    ...job,
    status: "failed",
    error: "管理员已取消该任务。",
    lockedBy: undefined,
    lockedUntil: undefined,
    updatedAt: now,
    events: [
      ...(job.events ?? []),
      {
        id: crypto.randomUUID(),
        agent: job.activeAgent ?? "ASSISTANT",
        status: "failed",
        message: "管理员已取消该任务。",
        createdAt: now,
      },
    ],
  };

  await updateGenerationJobRow(nextJob);
  upsertGenerationJob(nextJob);
  if (nextJob.courseId && nextJob.chapterId) {
    await patchAdminChapter(nextJob.courseId, nextJob.chapterId, {
      status: "failed",
      generationJobId: nextJob.id,
    });
  }
  return nextJob;
}

async function findActiveAdminChapterJob(chapterId: string) {
  const supabase = requireAdminSupabaseClient();
  const { data, error } = await supabase
    .from("generation_jobs")
    .select("payload, updated_at")
    .eq("chapter_id", chapterId)
    .in("status", ACTIVE_ADMIN_JOB_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertAdminNoError("读取章节活跃任务", error);
  return data?.payload as GenerationJob | undefined;
}

async function shouldRetryAdminJobAsGeneration(job: GenerationJob) {
  if (job.type !== "chapter" || job.mode !== "review_draft" || !job.courseId || !job.chapterId) return false;
  const course = await readAdminCoursePayload(job.courseId);
  const chapter = course.chapters.find((item) => item.id === job.chapterId);
  return Boolean(chapter && !hasChapterBody(chapter));
}

async function findAdminModelOverridesForChapter(courseId?: string, chapterId?: string): Promise<ModelOverrides | undefined> {
  const supabase = requireAdminSupabaseClient();
  const rows: Array<{ payload: unknown; updated_at?: string | null; created_at?: string | null }> = [];

  if (chapterId) {
    const { data, error } = await supabase
      .from("generation_jobs")
      .select("payload, created_at, updated_at")
      .eq("chapter_id", chapterId)
      .order("updated_at", { ascending: false })
      .limit(20);
    assertAdminNoError("Read chapter model overrides", error);
    rows.push(...(data ?? []));
  }

  if (courseId) {
    const { data, error } = await supabase
      .from("generation_jobs")
      .select("payload, created_at, updated_at")
      .eq("course_id", courseId)
      .order("updated_at", { ascending: false })
      .limit(50);
    assertAdminNoError("Read course model overrides", error);
    rows.push(...(data ?? []));
  }

  rows.sort((a, b) => Date.parse(b.updated_at ?? b.created_at ?? "") - Date.parse(a.updated_at ?? a.created_at ?? ""));
  for (const row of rows) {
    const job = row.payload as Partial<GenerationJob> | undefined;
    const overrides = normalizeModelOverrides(job?.modelOverrides);
    if (overrides) return overrides;
  }

  return undefined;
}

async function updateGenerationJobRow(job: GenerationJob) {
  const supabase = requireAdminSupabaseClient();
  const { error } = await supabase.from("generation_jobs").upsert({
    id: job.id,
    user_id: job.userId,
    course_id: job.courseId ?? null,
    chapter_id: job.chapterId ?? null,
    type: job.type,
    status: job.status,
    locked_by: job.lockedBy ?? null,
    locked_until: job.lockedUntil ?? null,
    attempts: job.attempts ?? 0,
    payload: job,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  });
  assertAdminNoError("保存生成任务", error);
}

async function patchAdminChapter(courseId: string, chapterId: string, patch: Partial<Chapter>) {
  const course = await readAdminCoursePayload(courseId);
  const now = new Date().toISOString();
  const chapters = course.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, ...patch } : chapter));
  const nextCourse = { ...course, chapters, updatedAt: now };
  const nextChapter = chapters.find((chapter) => chapter.id === chapterId);
  if (!nextChapter) throw new Error("章节不存在。");

  const supabase = requireAdminSupabaseClient();
  const [{ error: courseError }, { error: chapterError }] = await Promise.all([
    supabase.from("courses").update({ payload: nextCourse, updated_at: now }).eq("id", courseId),
    supabase
      .from("chapters")
      .update({
        status: nextChapter.status ?? "pending",
        payload: nextChapter,
        updated_at: now,
      })
      .eq("id", chapterId),
  ]);
  assertAdminNoError("更新课程快照", courseError);
  assertAdminNoError("更新章节状态", chapterError);
  return nextCourse;
}

async function persistAdminCourse(course: Course) {
  const supabase = requireAdminSupabaseClient();
  if (!course.userId) throw new Error("课程缺少用户归属。");
  const now = course.updatedAt ?? new Date().toISOString();
  const { error } = await supabase.from("courses").upsert({
    id: course.id,
    user_id: course.userId,
    topic: course.topic,
    goal: course.goal,
    payload: course,
    created_at: course.createdAt,
    updated_at: now,
  });
  assertAdminNoError("保存课程", error);

  await Promise.all(
    course.chapters.map((chapter, index) =>
      supabase.from("chapters").upsert({
        id: chapter.id,
        course_id: course.id,
        user_id: course.userId,
        title: chapter.title,
        status: chapter.status ?? "pending",
        order_index: index,
        payload: chapter,
        updated_at: now,
      }),
    ),
  );
  return course;
}

async function readAdminCoursePayload(courseId: string) {
  const supabase = requireAdminSupabaseClient();
  const { data, error } = await supabase.from("courses").select("payload").eq("id", courseId).maybeSingle();
  assertAdminNoError("读取课程", error);
  if (!data?.payload) throw new Error("课程不存在。");
  return normalizeCourse(data.payload as Course);
}

async function listAdminUsersLight() {
  const { data, error } = await safeListAdminAuthUsers();
  logAdminSoftError("读取用户", error);
  return (data.users ?? []).map((user) => ({
    id: user.id,
    email: user.email ?? "未设置邮箱",
  }));
}

async function recordAdminAudit(context: AdminActionContext, action: string, targetType: string, targetId: string | undefined, summary: string) {
  const supabase = requireAdminSupabaseClient();
  const { error } = await supabase.from("admin_audit_logs").insert({
    id: crypto.randomUUID(),
    admin_username: context.adminUsername,
    action,
    target_type: targetType,
    target_id: targetId ?? null,
    summary,
    created_at: new Date().toISOString(),
  });
  assertAdminNoError("记录管理员操作日志", error);
}

function requireAdminSupabaseClient() {
  const supabase = createSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务未配置，无法使用中文后台。");
  return supabase;
}

function preserveHiddenModelSecrets(input: AdminAppSettings, previous: AdminAppSettings): AdminAppSettings {
  const previousModel = previous.modelOverrides;
  const inputModel = input.modelOverrides;
  if (!previousModel?.default?.apiKey && !previousModel?.agents) return input;

  const defaultFields = {
    ...(inputModel?.default ?? {}),
  };
  if (!defaultFields.apiKey && previousModel.default?.apiKey) {
    defaultFields.apiKey = previousModel.default.apiKey;
  }

  const agents: NonNullable<AdminAppSettings["modelOverrides"]>["agents"] = {};
  for (const agent of MODEL_AGENT_NAMES) {
    const fields = {
      ...(inputModel?.agents?.[agent] ?? {}),
    };
    const previousApiKey = previousModel.agents?.[agent]?.apiKey;
    if (!fields.apiKey && previousApiKey) {
      fields.apiKey = previousApiKey;
    }
    if (Object.keys(fields).length) agents[agent] = fields;
  }

  return {
    ...input,
    modelOverrides: {
      version: 1,
      ...(Object.keys(defaultFields).length ? { default: defaultFields } : {}),
      ...(agents && Object.keys(agents).length ? { agents } : {}),
    },
  };
}

function getChapterStats(chapters: Chapter[]) {
  return chapters.reduce(
    (stats, chapter) => {
      stats.total += 1;
      if (chapter.status === "ready" || chapter.qualityReport?.status === "passed" || chapter.qualityReport?.status === "warning") stats.ready += 1;
      if (chapter.status === "quality_failed" || chapter.qualityReport?.status === "failed") stats.qualityFailed += 1;
      return stats;
    },
    { total: 0, ready: 0, qualityFailed: 0 },
  );
}

function hasChapterBody(chapter: Chapter) {
  return Boolean(chapter.content || chapter.sections?.length);
}

function updateMaxDate(map: Map<string, string>, key: string, value?: string) {
  if (!value) return;
  const existing = map.get(key);
  if (!existing || Date.parse(value) > Date.parse(existing)) map.set(key, value);
}

async function safeListAdminAuthUsers(): Promise<{
  data: { users: Array<{ id: string; email?: string | null; created_at: string; banned_until?: string | null }> };
  error: { message?: string; code?: string } | null;
}> {
  try {
    const supabase = requireAdminSupabaseClient();
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    return { data: { users: data.users ?? [] }, error };
  } catch (error) {
    return {
      data: { users: [] },
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function buildFallbackAdminUsers(
  coursesData: Array<{ user_id: string | null; updated_at?: string | null }>,
  usageData: Array<{ user_id: string | null; created_at?: string | null }>,
  jobs: AdminJobRow[],
  courseCounts: Map<string, number>,
  usageCounts: Map<string, number>,
  jobCounts: Map<string, number>,
  activeJobCounts: Map<string, number>,
  lastActivity: Map<string, string>,
) {
  const userIds = new Set<string>();
  for (const row of coursesData) if (row.user_id) userIds.add(row.user_id);
  for (const row of usageData) if (row.user_id) userIds.add(row.user_id);
  for (const job of jobs) if (job.userId) userIds.add(job.userId);

  return Array.from(userIds).map((userId) => ({
    id: userId,
    email: `用户 ${userId.slice(0, 8)}`,
    createdAt: lastActivity.get(userId) ?? new Date(0).toISOString(),
    isBanned: false,
    courseCount: courseCounts.get(userId) ?? 0,
    jobCount: jobCounts.get(userId) ?? 0,
    activeJobCount: activeJobCounts.get(userId) ?? 0,
    usageCount: usageCounts.get(userId) ?? 0,
    lastActivityAt: lastActivity.get(userId),
  }) satisfies AdminUserRow);
}

function logAdminSoftError(label: string, error: { message?: string; code?: string } | null | undefined) {
  if (!error) return;
  console.warn(`[admin] ${label}失败，已降级处理：${error.code ? `${error.code} ` : ""}${error.message ?? "未知错误"}`);
}

function paginate<T>(rows: T[], options: ListOptions) {
  if (options.limit) return rows.slice(0, options.limit);
  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), 500);
  const page = Math.max(options.page ?? 1, 1);
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

function assertAdminNoError(label: string, error: { message?: string; code?: string } | null | undefined) {
  if (!error) return;
  throw new Error(`${label}失败：${error.code ? `${error.code} ` : ""}${error.message ?? "未知错误"}`);
}
