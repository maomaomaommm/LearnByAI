import "server-only";

import { appendJobEvent, completeGenerationJob, createGenerationJob, failGenerationJob, getGenerationJob, patchGenerationJob, upsertGenerationJob } from "./jobs";
import { shouldRunInlineGeneration } from "./config";
import { generateChapter, planCourseOutline } from "./maol/client";
import { withQuotaConsumption } from "./quota";
import { safeErrorMessage } from "./safeError";
import {
  canUseCourseSnapshot,
  getServerCourse,
  getServerGenerationJob,
  saveServerCourse,
  saveServerGenerationJob,
  saveServerQualityReport,
  updateServerChapter,
} from "./serverStore";
import { Course, GenerationJob } from "./types";

export async function runCourseGenerationJob(input: {
  jobId: string;
  request?: Request;
  courseSnapshot?: Course;
}) {
  const persistedJob = await getServerGenerationJob(input.jobId, input.request);
  let job = getGenerationJob(input.jobId) ?? (persistedJob ? upsertGenerationJob(persistedJob) : undefined);
  const allowedSnapshot = (await canUseCourseSnapshot(input.courseSnapshot, input.request)) ? input.courseSnapshot : undefined;

  if (!job) {
    return {
      error: "Generation job not found",
      status: 404,
      job: undefined,
    } as const;
  }

  if (job.type !== "course" || !job.courseId) {
    return { job } as const;
  }

  if (job.status === "succeeded") {
    const course = await getServerCourse(job.courseId, input.request);
    return { job, course } as const;
  }

  if (job.status === "running") {
    const course = await getServerCourse(job.courseId, input.request);
    return { job, course } as const;
  }

  const course = (await getServerCourse(job.courseId, input.request)) ?? allowedSnapshot;
  if (!course) {
    const failedJob = failGenerationJob(job.id, "Course snapshot unavailable for course planning job.");
    if (failedJob) await saveServerGenerationJob(failedJob, input.request);
    return {
      error: "Course not found",
      status: 404,
      job: getGenerationJob(job.id) ?? job,
    } as const;
  }

  job = patchGenerationJob(job.id, {
    activeAgent: "ARCHITECT",
    status: "running",
  }) ?? job;
  await saveServerGenerationJob(job, input.request);
  const resumedJob = appendJobEvent(job.id, {
    agent: "ARCHITECT",
    status: "running",
    message: "Course planning resumed in background.",
  });
  if (resumedJob) await saveServerGenerationJob(resumedJob, input.request);

  try {
    const generated = await planCourseOutline(course, job.id, {
      onJobUpdate: async (updatedJob) => {
        await saveServerGenerationJob(updatedJob, input.request);
      },
    });
    const firstChapterJob = createGenerationJob({
      type: "chapter",
      courseId: course.id,
      userId: course.userId,
      activeAgent: "AUTHOR",
      status: "queued",
      message: "First chapter queued for background generation.",
    });

    const chapters = generated.chapters.map((chapter, index) => ({
      ...chapter,
      id: crypto.randomUUID(),
      status: index === 0 ? ("queued" as const) : ("pending" as const),
      generationJobId: index === 0 ? firstChapterJob.id : undefined,
    }));
    const firstChapter = chapters[0];
    if (firstChapter) {
      const linkedChapterJob = patchGenerationJob(firstChapterJob.id, {
        courseId: course.id,
        chapterId: firstChapter.id,
      });
      if (linkedChapterJob) await saveServerGenerationJob(linkedChapterJob, input.request);
    }

    const plannedCourse = await saveServerCourse(
      {
        ...course,
        profile: generated.profile,
        courseBible: generated.courseBible,
        chapters,
        updatedAt: new Date().toISOString(),
      },
      input.request,
    );

    const completedJob = completeGenerationJob(job.id, course.id);
    if (completedJob) {
      await saveServerGenerationJob(completedJob, input.request);
    }

    if (firstChapter?.generationJobId && shouldRunInlineGeneration(input.request)) {
      void runChapterGenerationJob({
        jobId: firstChapter.generationJobId,
        request: input.request,
        courseSnapshot: plannedCourse,
      }).catch((error) => {
        console.error("Background chapter generation failed", error);
      });
    }

    return {
      job: getGenerationJob(job.id) ?? completedJob,
      course: plannedCourse,
    } as const;
  } catch (error) {
    const failedJob = failGenerationJob(job.id, safeErrorMessage(error, "Course planning failed."));
    if (failedJob) await saveServerGenerationJob(failedJob, input.request);
    return {
      error: "Course planning failed",
      status: 500,
      job: getGenerationJob(job.id) ?? failedJob ?? job,
      course,
    } as const;
  }
}

export async function runChapterGenerationJob(input: {
  jobId: string;
  request?: Request;
  courseSnapshot?: Course;
  retry?: boolean;
}) {
  const persistedJob = await getServerGenerationJob(input.jobId, input.request);
  let job = getGenerationJob(input.jobId) ?? (persistedJob ? upsertGenerationJob(persistedJob) : undefined);
  const allowedSnapshot = (await canUseCourseSnapshot(input.courseSnapshot, input.request)) ? input.courseSnapshot : undefined;

  if (!job && allowedSnapshot) {
    const chapter = allowedSnapshot.chapters.find((item) => item.generationJobId === input.jobId);
    if (chapter) {
      const synthetic = createGenerationJob({
        type: "chapter",
        courseId: allowedSnapshot.id,
        chapterId: chapter.id,
        userId: allowedSnapshot.userId,
        activeAgent: "AUTHOR",
        status: "queued",
        message: "Recovered queued chapter job from course snapshot.",
      });
      job = synthetic;
      await saveServerGenerationJob(synthetic, input.request);
    }
  }

  if (!job) {
    return {
      error: "Generation job not found",
      status: 404,
      job: undefined,
    } as const;
  }

  if (job.type !== "chapter" || !job.chapterId) {
    return { job } as const;
  }

  if (job.status === "succeeded" && !input.retry) {
    const chapterId = job.chapterId;
    const persistedCourse = job.courseId ? await getServerCourse(job.courseId, input.request) : undefined;
    const course = persistedCourse ?? allowedSnapshot;
    return {
      job,
      course,
      chapter: course?.chapters.find((item) => item.id === chapterId),
    } as const;
  }

  if ((job.status === "running" || job.status === "retrying") && !input.retry) {
    const chapterId = job.chapterId;
    const persistedCourse = job.courseId ? await getServerCourse(job.courseId, input.request) : undefined;
    const course = persistedCourse ?? allowedSnapshot;
    return {
      job,
      course,
      chapter: course?.chapters.find((item) => item.id === chapterId),
    } as const;
  }

  if (input.retry) {
    const retryingJob = patchGenerationJob(job.id, {
      status: "retrying",
      error: undefined,
    });
    if (retryingJob) {
      await saveServerGenerationJob(retryingJob, input.request);
      job = retryingJob;
    }
  }

  const persistedCourse = job.courseId ? await getServerCourse(job.courseId, input.request) : undefined;
  const course = persistedCourse ?? allowedSnapshot;
  if (!course) {
    const failedJob = appendJobEvent(job.id, {
      agent: "ASSISTANT",
      status: "failed",
      message: "Course snapshot unavailable for queued chapter job.",
    });
    if (failedJob) {
      await saveServerGenerationJob(failedJob, input.request);
    }
    return {
      error: "Course not found",
      status: 404,
      job: getGenerationJob(job.id) ?? job,
    } as const;
  }

  const chapter = course.chapters.find((item) => item.id === job.chapterId);
  if (!chapter) {
    const failedJob = appendJobEvent(job.id, {
      agent: "ASSISTANT",
      status: "failed",
      message: "Chapter unavailable for queued chapter job.",
    });
    if (failedJob) {
      await saveServerGenerationJob(failedJob, input.request);
    }
    return {
      error: "Chapter not found",
      status: 404,
      job: getGenerationJob(job.id) ?? job,
    } as const;
  }

  try {
    const result = await withQuotaConsumption(job.userId ?? course.userId, "generate_chapter", async () => {
      const response = await generateChapter(course, chapter, {
        jobId: job.id,
        onJobUpdate: async (updatedJob) => {
          await saveServerGenerationJob(updatedJob, input.request);
        },
      });
      if (response.job) {
        await saveServerGenerationJob(response.job, input.request);
      }
      await saveServerQualityReport(response.qualityReport, input.request);
      const updated = await updateServerChapter(
        course,
        chapter.id,
        {
          content: response.content,
          sections: response.sections,
          review: response.review,
          qualityReport: response.qualityReport,
          status: response.qualityReport.status === "failed" ? "failed" : "ready",
          generationJobId: response.job?.id ?? job.id,
        },
        input.request,
      );

      return {
        job: getGenerationJob(response.job?.id ?? job.id) as GenerationJob | undefined,
        course: updated,
        chapter: updated.chapters.find((item) => item.id === chapter.id),
      } as const;
    });

    if (!result.ok) {
      const quotaMessage = result.quota.message ?? "Chapter generation quota exceeded.";
      const failedJob = appendJobEvent(job.id, {
        agent: "ASSISTANT",
        status: "failed",
        message: quotaMessage,
      });
      if (failedJob) {
        await saveServerGenerationJob(failedJob, input.request);
      }
      const updated = await updateServerChapter(
        course,
        chapter.id,
        {
          status: "failed",
          generationJobId: job.id,
        },
        input.request,
      );

      return {
        error: quotaMessage,
        status: 429,
        job: getGenerationJob(job.id) ?? failedJob ?? job,
        course: updated,
        chapter: updated.chapters.find((item) => item.id === chapter.id),
      } as const;
    }

    return result.value;
  } catch (error) {
    const message = safeErrorMessage(error, "Chapter generation failed.");
    const failedJob = failGenerationJob(job.id, message);
    if (failedJob) await saveServerGenerationJob(failedJob, input.request);
    const updated = await updateServerChapter(
      course,
      chapter.id,
      {
        status: "failed",
        generationJobId: job.id,
      },
      input.request,
    );

    return {
      error: message,
      status: 500,
      job: getGenerationJob(job.id) ?? failedJob ?? job,
      course: updated,
      chapter: updated.chapters.find((item) => item.id === chapter.id),
    } as const;
  }
}
