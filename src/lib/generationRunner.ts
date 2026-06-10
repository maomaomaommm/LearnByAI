import "server-only";

import { appendJobEvent, completeGenerationJob, createGenerationJob, failGenerationJob, getGenerationJob, patchGenerationJob, upsertGenerationJob } from "./jobs";
import { shouldRunInlineGeneration } from "./config";
import { generateChapter, planCourseOutline } from "./maol/client";
import { parseModelOverridesFromHeaders } from "./modelOverrides";
import { withQuotaConsumption } from "./quota";
import { safeErrorMessage } from "./safeError";
import {
  getServerCourse,
  getServerGenerationJob,
  saveServerCourse,
  saveServerGenerationJob,
  saveServerQualityReport,
  updateServerChapter,
} from "./serverStore";
import { GenerationJob } from "./types";

export async function runCourseGenerationJob(input: {
  jobId: string;
  request?: Request;
  retry?: boolean;
}) {
  const overrides = parseModelOverridesFromHeaders(input.request?.headers);
  const persistedJob = await getServerGenerationJob(input.jobId, input.request);
  let job = getGenerationJob(input.jobId) ?? (persistedJob ? upsertGenerationJob(persistedJob) : undefined);

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
  const courseId = job.courseId;

  if (job.status === "succeeded" && !input.retry) {
    const course = await getServerCourse(courseId, input.request);
    return { job, course } as const;
  }

  if (job.status === "running" && !input.retry) {
    const course = await getServerCourse(courseId, input.request);
    return { job, course } as const;
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

  const course = await getServerCourse(courseId, input.request);
  if (!course) {
    const failedJob = failGenerationJob(job.id, "Persisted course unavailable for course planning job.");
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
    message: "课程大纲规划在后台恢复执行。",
  });
  if (resumedJob) await saveServerGenerationJob(resumedJob, input.request);

  try {
    const generated = await planCourseOutline(course, job.id, {
      overrides,
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

    const firstChapter = chapters[0];
    if (firstChapter) {
      const linkedChapterJob = patchGenerationJob(firstChapterJob.id, {
        courseId: course.id,
        chapterId: firstChapter.id,
      });
      if (linkedChapterJob) await saveServerGenerationJob(linkedChapterJob, input.request);
    }

    if (firstChapter?.generationJobId && shouldRunInlineGeneration(input.request)) {
      void runChapterGenerationJob({
        jobId: firstChapter.generationJobId,
        request: input.request,
      }).catch((error) => {
        console.error("Background chapter generation failed", error);
      });
    }

    return {
      job: getGenerationJob(job.id) ?? completedJob,
      course: plannedCourse,
    } as const;
  } catch (error) {
    const failedJob = failGenerationJob(job.id, safeErrorMessage(error, "课程大纲规划失败。"));
    if (failedJob) await saveServerGenerationJob(failedJob, input.request);
    return {
      error: "课程大纲规划失败",
      status: 500,
      job: getGenerationJob(job.id) ?? failedJob ?? job,
      course,
    } as const;
  }
}

export async function runChapterGenerationJob(input: {
  jobId: string;
  request?: Request;
  retry?: boolean;
}) {
  const overrides = parseModelOverridesFromHeaders(input.request?.headers);
  const persistedJob = await getServerGenerationJob(input.jobId, input.request);
  let job = getGenerationJob(input.jobId) ?? (persistedJob ? upsertGenerationJob(persistedJob) : undefined);

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
    const course = persistedCourse;
    return {
      job,
      course,
      chapter: course?.chapters.find((item) => item.id === chapterId),
    } as const;
  }

  if ((job.status === "running" || job.status === "retrying") && !input.retry) {
    const chapterId = job.chapterId;
    const persistedCourse = job.courseId ? await getServerCourse(job.courseId, input.request) : undefined;
    const course = persistedCourse;
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
  const course = persistedCourse;
  if (!course) {
    const failedJob = appendJobEvent(job.id, {
      agent: "ASSISTANT",
      status: "failed",
      message: "Persisted course unavailable for queued chapter job.",
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
        overrides,
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
