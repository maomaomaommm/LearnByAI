import { NextResponse } from "next/server";
import { adminJsonError, requireAdminApiSession } from "@/lib/adminRoute";
import {
  acknowledgeAdminJob,
  acknowledgeAdminQualityReport,
  acknowledgeAllFailedAdminJobs,
  acknowledgeAllFailedQuality,
  banAdminUser,
  cancelActiveAdminJobs,
  cancelAdminJob,
  createAdminChapter,
  createAdminCourse,
  createAdminUser,
  deleteAdminChapter,
  deleteAdminCourse,
  deleteAdminExport,
  deleteAdminJob,
  deleteAdminUser,
  enqueueAdminChapterGeneration,
  enqueueAdminChapterReview,
  repairAdminChapterStatus,
  resetAdminUserPassword,
  retryAdminJob,
  saveAdminSettingsAction,
  unbanAdminUser,
  updateAdminChapter,
  updateAdminCourse,
} from "@/lib/adminData";
import { Chapter, ChapterDepthWeight, CourseDifficulty, ExplanationStyle, LearningMode } from "@/lib/types";

type AdminActionInput =
  | { action: "cancel_job"; jobId?: string }
  | { action: "delete_job"; jobId?: string }
  | { action: "retry_job"; jobId?: string }
  | { action: "acknowledge_job"; jobId?: string }
  | { action: "acknowledge_all_jobs" }
  | { action: "acknowledge_quality"; reportId?: string }
  | { action: "acknowledge_all_quality" }
  | { action: "cancel_active_jobs"; userId?: string; courseId?: string; chapterId?: string }
  | { action: "review_chapter"; courseId?: string; chapterId?: string }
  | { action: "regenerate_chapter"; courseId?: string; chapterId?: string }
  | { action: "repair_chapter_status"; courseId?: string; chapterId?: string; status?: Chapter["status"] }
  | { action: "create_chapter"; courseId?: string; title?: string; description?: string; depthWeight?: ChapterDepthWeight }
  | { action: "update_chapter"; courseId?: string; chapterId?: string; title?: string; description?: string; depthWeight?: ChapterDepthWeight }
  | { action: "delete_chapter"; courseId?: string; chapterId?: string }
  | { action: "delete_course"; courseId?: string }
  | { action: "create_course"; userId?: string; topic?: string; goal?: string; background?: string; preference?: string; styles?: ExplanationStyle[]; learningMode?: LearningMode; chapterCount?: number; difficulty?: CourseDifficulty }
  | { action: "update_course"; courseId?: string; topic?: string; goal?: string; background?: string; preference?: string; styles?: ExplanationStyle[]; learningMode?: LearningMode; chapterCount?: number; difficulty?: CourseDifficulty }
  | { action: "create_user"; email?: string; password?: string }
  | { action: "delete_user"; userId?: string }
  | { action: "ban_user"; userId?: string }
  | { action: "unban_user"; userId?: string }
  | { action: "reset_user_password"; userId?: string; password?: string }
  | { action: "delete_export"; exportId?: string }
  | { action: "save_settings"; settings?: Parameters<typeof saveAdminSettingsAction>[0] };

export async function POST(request: Request) {
  const auth = await requireAdminApiSession();
  if ("response" in auth) return auth.response;

  const context = { adminUsername: auth.session.username };

  try {
    const input = (await request.json()) as AdminActionInput;

    switch (input.action) {
      case "cancel_job":
        requireField(input.jobId, "任务 ID");
        return NextResponse.json({ job: await cancelAdminJob(input.jobId, context) });
      case "delete_job":
        requireField(input.jobId, "任务 ID");
        return NextResponse.json(await deleteAdminJob(input.jobId, context));
      case "retry_job":
        requireField(input.jobId, "任务 ID");
        return NextResponse.json({ job: await retryAdminJob(input.jobId, context) }, { status: 202 });
      case "acknowledge_job":
        requireField(input.jobId, "任务 ID");
        return NextResponse.json(await acknowledgeAdminJob(input.jobId, context));
      case "acknowledge_all_jobs":
        return NextResponse.json(await acknowledgeAllFailedAdminJobs(context));
      case "acknowledge_quality":
        requireField(input.reportId, "质检报告 ID");
        return NextResponse.json(await acknowledgeAdminQualityReport(input.reportId, context));
      case "acknowledge_all_quality":
        return NextResponse.json(await acknowledgeAllFailedQuality(context));
      case "cancel_active_jobs":
        return NextResponse.json(await cancelActiveAdminJobs({ userId: input.userId, courseId: input.courseId, chapterId: input.chapterId }, context));
      case "review_chapter":
        requireField(input.courseId, "课程 ID");
        requireField(input.chapterId, "章节 ID");
        return NextResponse.json({ job: await enqueueAdminChapterReview(input.courseId, input.chapterId, context) }, { status: 202 });
      case "regenerate_chapter":
        requireField(input.courseId, "课程 ID");
        requireField(input.chapterId, "章节 ID");
        return NextResponse.json({ job: await enqueueAdminChapterGeneration(input.courseId, input.chapterId, context) }, { status: 202 });
      case "repair_chapter_status":
        requireField(input.courseId, "课程 ID");
        requireField(input.chapterId, "章节 ID");
        requireField(input.status, "章节状态");
        return NextResponse.json({ course: await repairAdminChapterStatus(input.courseId, input.chapterId, input.status, context) });
      case "create_chapter":
        requireField(input.courseId, "课程 ID");
        requireField(input.title, "章节标题");
        return NextResponse.json(
          { course: await createAdminChapter(input.courseId, { title: input.title, description: input.description ?? "", depthWeight: input.depthWeight }, context) },
          { status: 201 },
        );
      case "update_chapter":
        requireField(input.courseId, "课程 ID");
        requireField(input.chapterId, "章节 ID");
        requireField(input.title, "章节标题");
        return NextResponse.json({ course: await updateAdminChapter(input.courseId, input.chapterId, { title: input.title, description: input.description ?? "", depthWeight: input.depthWeight }, context) });
      case "delete_chapter":
        requireField(input.courseId, "课程 ID");
        requireField(input.chapterId, "章节 ID");
        return NextResponse.json({ course: await deleteAdminChapter(input.courseId, input.chapterId, context) });
      case "delete_course":
        requireField(input.courseId, "课程 ID");
        return NextResponse.json(await deleteAdminCourse(input.courseId, context));
      case "create_course":
        return NextResponse.json({ result: await createAdminCourse(readCourseInput(input), context) }, { status: 201 });
      case "update_course":
        requireField(input.courseId, "课程 ID");
        return NextResponse.json({ course: await updateAdminCourse({ courseId: input.courseId, ...readCourseInput(input) }, context) });
      case "create_user":
        requireField(input.email, "邮箱");
        requireField(input.password, "密码");
        return NextResponse.json({ result: await createAdminUser({ email: input.email, password: input.password }, context) }, { status: 201 });
      case "delete_user":
        requireField(input.userId, "用户 ID");
        return NextResponse.json(await deleteAdminUser(input.userId, context));
      case "ban_user":
        requireField(input.userId, "用户 ID");
        return NextResponse.json({ user: await banAdminUser(input.userId, context) });
      case "unban_user":
        requireField(input.userId, "用户 ID");
        return NextResponse.json({ user: await unbanAdminUser(input.userId, context) });
      case "reset_user_password":
        requireField(input.userId, "用户 ID");
        requireField(input.password, "新密码");
        return NextResponse.json(await resetAdminUserPassword(input.userId, input.password, context));
      case "delete_export":
        requireField(input.exportId, "导出 ID");
        return NextResponse.json(await deleteAdminExport(input.exportId, context));
      case "save_settings":
        if (!input.settings) return NextResponse.json({ error: "缺少系统设置。" }, { status: 400 });
        return NextResponse.json({ settings: await saveAdminSettingsAction(input.settings, context) });
      default:
        return NextResponse.json({ error: "未知管理操作。" }, { status: 400 });
    }
  } catch (error) {
    return adminJsonError(error, "执行管理操作失败。");
  }
}

function readCourseInput(input: {
  userId?: string;
  topic?: string;
  goal?: string;
  background?: string;
  preference?: string;
  styles?: ExplanationStyle[];
  learningMode?: LearningMode;
  chapterCount?: number;
  difficulty?: CourseDifficulty;
}) {
  requireField(input.userId, "用户 ID");
  requireField(input.topic, "课程主题");
  requireField(input.goal, "学习目标");
  const parsedCount = Number(input.chapterCount);
  return {
    userId: input.userId,
    topic: input.topic,
    goal: input.goal,
    background: input.background ?? "",
    preference: input.preference ?? "",
    styles: input.styles,
    learningMode: input.learningMode,
    chapterCount: Number.isFinite(parsedCount) ? Math.min(20, Math.max(3, Math.round(parsedCount))) : 8,
    difficulty: (input.difficulty === "intro" || input.difficulty === "research" ? input.difficulty : "intermediate") as CourseDifficulty,
  };
}

function requireField<T>(value: T | undefined | null | "", label: string): asserts value is T {
  if (value === undefined || value === null || value === "") {
    throw new Error(`缺少${label}。`);
  }
}
