import "server-only";

import { appendJobEvent, completeGenerationJob, createGenerationJob, failGenerationJob, getGenerationJob, patchGenerationJob, upsertGenerationJob } from "./jobs";
import { shouldRunInlineGeneration } from "./config";
import { generateChapter, planCourseOutline, reviewExistingChapterDraft } from "./maol/client";
import { parseModelOverridesFromHeaders } from "./modelOverrides";
import { withQuotaConsumption } from "./quota";
import { safeErrorMessage } from "./safeError";
import {
  getServerCourse,
  getActiveServerGenerationJobForChapter,
  getServerGenerationJob,
  saveServerCourse,
  saveServerGenerationJob,
  saveServerGenerationJobs,
  saveServerQualityReport,
  updateServerChapter,
} from "./serverStore";
import { Chapter, Course, GenerationJob } from "./types";

export async function runCourseGenerationJob(input: {
  jobId: string;
  request?: Request;
  retry?: boolean;
  claimed?: boolean;
}) {
  const headerOverrides = parseModelOverridesFromHeaders(input.request?.headers);
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

  if (job.status === "running" && !input.retry && !input.claimed) {
    const course = await getServerCourse(courseId, input.request);
    return { job, course } as const;
  }

  if (input.retry) {
    const retryingJob = patchGenerationJob(job.id, {
      status: "retrying",
      error: undefined,
      modelOverrides: headerOverrides ?? job.modelOverrides,
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

  const overrides = job.modelOverrides ?? headerOverrides;
  job = patchGenerationJob(job.id, {
    activeAgent: "ARCHITECT",
    status: "running",
    modelOverrides: overrides,
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
    const chapters = generated.chapters.map((chapter) => ({
      ...chapter,
      id: crypto.randomUUID(),
      status: "pending" as const,
    }));
    const chapterJobs = chapters.map((chapter) =>
      createGenerationJob({
        type: "chapter",
        courseId: course.id,
        chapterId: chapter.id,
        userId: course.userId,
        activeAgent: "AUTHOR",
        status: "queued",
        modelOverrides: overrides,
        message: "Chapter queued for background generation.",
      }),
    );
    const linkedChapters = chapters.map((chapter, index) => ({
      ...chapter,
      status: "queued" as const,
      generationJobId: chapterJobs[index]?.id,
    }));
    const plannedCourse = await saveServerCourse(
      {
        ...course,
        profile: generated.profile,
        courseBible: generated.courseBible,
        chapters: linkedChapters,
        updatedAt: new Date().toISOString(),
      },
      input.request,
    );

    const completedJob = completeGenerationJob(job.id, course.id);
    if (completedJob) {
      await saveServerGenerationJob(completedJob, input.request);
    }

    await saveServerGenerationJobs(chapterJobs, input.request);

    const firstChapter = linkedChapters[0];
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
  claimed?: boolean;
}) {
  const headerOverrides = parseModelOverridesFromHeaders(input.request?.headers);
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

  if ((job.status === "running" || job.status === "retrying") && !input.retry && !input.claimed) {
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
      modelOverrides: headerOverrides ?? job.modelOverrides,
    });
    if (retryingJob) {
      await saveServerGenerationJob(retryingJob, input.request);
      job = retryingJob;
    }
  }

  const chapterId = job.chapterId;
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

  const chapter = course.chapters.find((item) => item.id === chapterId);
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

  const overrides = job.modelOverrides ?? headerOverrides;
  if (job.mode === "review_draft" && !hasChapterBody(chapter)) {
    const convertedJob = patchGenerationJob(job.id, {
      mode: undefined,
      activeAgent: "AUTHOR",
      status: "retrying",
      modelOverrides: overrides,
    });
    if (convertedJob) {
      job = convertedJob;
      await saveServerGenerationJob(convertedJob, input.request);
      const convertedEventJob = appendJobEvent(job.id, {
        agent: "AUTHOR",
        status: "retrying",
        message: "Empty draft retry converted to chapter regeneration.",
      }, { preserveJobStatus: true });
      if (convertedEventJob) {
        job = convertedEventJob;
        await saveServerGenerationJob(convertedEventJob, input.request);
      }
    }
  }

  try {
    if (job.mode === "review_draft") {
      return await runDraftReviewChapterJob({
        job,
        course,
        chapter,
        overrides,
        request: input.request,
      });
    }

    const runningJob = patchGenerationJob(job.id, {
      activeAgent: "AUTHOR",
      status: "running",
      modelOverrides: overrides,
    }) ?? job;
    await saveServerGenerationJob(runningJob, input.request);
    await updateServerChapter(
      course,
      chapter.id,
      {
        status: "generating",
        generationJobId: job.id,
      },
      input.request,
    );

    const result = await withQuotaConsumption(job.userId ?? course.userId, "generate_chapter", async () => {
      const response = await generateChapter(course, chapter, {
        jobId: job.id,
        overrides,
        onJobUpdate: async (updatedJob) => {
          await saveServerGenerationJob(updatedJob, input.request);
        },
        onStage: async (stage) => {
          const currentCourse = await getServerCourse(course.id, input.request);
          if (!currentCourse) return;
          await updateServerChapter(
            currentCourse,
            chapter.id,
            {
              content: stage.content,
              sections: stage.sections,
              review: stage.review,
              status: stage.stage === "draft" ? "draft_ready" : "generating",
              generationJobId: job.id,
            },
            input.request,
          );
        },
      });
      if (response.job) {
        await saveServerGenerationJob(response.job, input.request);
      }
      await saveServerQualityReport(response.qualityReport, input.request);
      const latestCourse = await getServerCourse(course.id, input.request);
      const updated = await updateServerChapter(
        latestCourse ?? course,
        chapter.id,
        {
          content: response.content,
          sections: response.sections,
          review: response.review,
          qualityReport: response.qualityReport,
          status: response.qualityReport.status === "failed" ? "quality_failed" : "ready",
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
      const latestCourse = await getServerCourse(course.id, input.request);
      const latestChapter = latestCourse?.chapters.find((item) => item.id === chapter.id) ?? chapter;
      const updated = await updateServerChapter(
        latestCourse ?? course,
        chapter.id,
        {
          status: interruptedChapterStatus(latestChapter),
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
    const latestCourse = await getServerCourse(course.id, input.request);
    const latestChapter = latestCourse?.chapters.find((item) => item.id === chapter.id) ?? chapter;
    const updated = await updateServerChapter(
      latestCourse ?? course,
      chapter.id,
      {
        status: interruptedChapterStatus(latestChapter),
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

async function runDraftReviewChapterJob(input: {
  job: GenerationJob;
  course: Course;
  chapter: Chapter;
  overrides: ReturnType<typeof parseModelOverridesFromHeaders>;
  request?: Request;
}) {
  const { job, course, chapter, overrides, request } = input;
  const content = getChapterBody(chapter);
  if (!content) {
    const failedJob = failGenerationJob(job.id, "Draft content unavailable for quality review.");
    if (failedJob) await saveServerGenerationJob(failedJob, request);
    const updated = await updateServerChapter(
      course,
      chapter.id,
      {
        status: "failed",
        generationJobId: job.id,
      },
      request,
    );
    return {
      error: "Draft content unavailable",
      status: 404,
      job: getGenerationJob(job.id) ?? failedJob ?? job,
      course: updated,
      chapter: updated.chapters.find((item) => item.id === chapter.id),
    } as const;
  }

  const runningJob = patchGenerationJob(job.id, {
    activeAgent: "POLISHER",
    status: "running",
    modelOverrides: overrides ?? job.modelOverrides,
  }) ?? job;
  await saveServerGenerationJob(runningJob, request);
  await updateServerChapter(
    course,
    chapter.id,
    {
      status: "generating",
      generationJobId: job.id,
    },
    request,
  );

  try {
    const result = await withQuotaConsumption(job.userId ?? course.userId, "generate_chapter", async () => {
      const response = await reviewExistingChapterDraft(course, chapter, content, {
        jobId: job.id,
        overrides: overrides ?? job.modelOverrides,
        onJobUpdate: async (updatedJob) => {
          await saveServerGenerationJob(updatedJob, request);
        },
        onStage: async (stage) => {
          const currentCourse = await getServerCourse(course.id, request);
          if (!currentCourse) return;
          await updateServerChapter(
            currentCourse,
            chapter.id,
            {
              content: stage.content,
              sections: stage.sections,
              review: stage.review,
              status: "generating",
              generationJobId: job.id,
            },
            request,
          );
        },
      });

      if (response.job) {
        await saveServerGenerationJob(response.job, request);
      }
      await saveServerQualityReport(response.qualityReport, request);
      const latestCourse = await getServerCourse(course.id, request);
      const updated = await updateServerChapter(
        latestCourse ?? course,
        chapter.id,
        {
          content: response.content,
          sections: response.sections,
          review: response.review,
          qualityReport: response.qualityReport,
          status: response.qualityReport.status === "failed" ? "quality_failed" : "ready",
          generationJobId: response.job?.id ?? job.id,
        },
        request,
      );

      return {
        job: getGenerationJob(response.job?.id ?? job.id) as GenerationJob | undefined,
        course: updated,
        chapter: updated.chapters.find((item) => item.id === chapter.id),
      } as const;
    });

    if (!result.ok) {
      const quotaMessage = result.quota.message ?? "Draft quality review quota exceeded.";
      const failedJob = appendJobEvent(job.id, {
        agent: "ASSISTANT",
        status: "failed",
        message: quotaMessage,
      });
      if (failedJob) await saveServerGenerationJob(failedJob, request);
      const latestCourse = await getServerCourse(course.id, request);
      const latestChapter = latestCourse?.chapters.find((item) => item.id === chapter.id) ?? chapter;
      const updated = await updateServerChapter(
        latestCourse ?? course,
        chapter.id,
        {
          status: interruptedChapterStatus(latestChapter),
          generationJobId: job.id,
        },
        request,
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
    const message = safeErrorMessage(error, "Draft quality review failed.");
    const failedJob = failGenerationJob(job.id, message);
    if (failedJob) await saveServerGenerationJob(failedJob, request);
    const latestCourse = await getServerCourse(course.id, request);
    const latestChapter = latestCourse?.chapters.find((item) => item.id === chapter.id) ?? chapter;
    const updated = await updateServerChapter(
      latestCourse ?? course,
      chapter.id,
      {
        status: interruptedChapterStatus(latestChapter),
        generationJobId: job.id,
      },
      request,
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

function hasChapterBody(chapter: Chapter) {
  return Boolean(chapter.content || chapter.sections?.length);
}

function getChapterBody(chapter: Chapter) {
  return chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n") ?? "";
}

function interruptedChapterStatus(chapter: Chapter) {
  if (!hasChapterBody(chapter)) return "failed";
  return chapter.qualityReport?.status === "failed" ? "quality_failed" : "draft_ready";
}

export async function enqueueNextChapterJobsForCourse(course: Course, request?: Request, limit = 2) {
  const activeCount = course.chapters.filter((chapter) => {
    const status = chapter.status ?? "pending";
    return status === "queued" || status === "generating" || status === "draft_ready";
  }).length;
  const openSlots = Math.max(0, limit - activeCount);
  if (openSlots === 0) return course;

  let nextCourse = course;
  for (const chapter of course.chapters.filter((item) => (item.status ?? "pending") === "pending").slice(0, openSlots)) {
    const activeJob = await getActiveServerGenerationJobForChapter(chapter.id, request);
    const job = activeJob ?? createGenerationJob({
      type: "chapter",
      courseId: course.id,
      chapterId: chapter.id,
      userId: course.userId,
      activeAgent: "AUTHOR",
      status: "queued",
      message: "Chapter queued for background generation.",
    });
    const persistedJob = activeJob ?? await saveServerGenerationJob(job, request);
    nextCourse = await updateServerChapter(
      nextCourse,
      chapter.id,
      {
        status: "queued",
        generationJobId: persistedJob.id,
      },
      request,
    );
  }

  return nextCourse;
}
