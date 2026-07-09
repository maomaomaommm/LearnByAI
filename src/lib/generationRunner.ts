import "server-only";

import { appendJobEvent, completeGenerationJob, createGenerationJob, failGenerationJob, getGenerationJob, patchGenerationJob, upsertGenerationJob } from "./jobs";
import { shouldRunInlineGeneration } from "./config";
import { processChapterFigures } from "./figures";
import { generateChapter, generateChapterDraft, planCourseOutline, reviewExistingChapterDraft } from "./maol/client";
import { markdownToSections } from "./maol/integrator";
import { ModelOverrides } from "./modelOverrides";
import { withQuotaConsumption } from "./quota";
import { shouldAcceptQualityCandidate, summarizeQualityForDecision } from "./quality/candidate";
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
import { Chapter, ChapterGenerateResponse, Course, GenerationJob, QualityReport, TextbookMeta } from "./types";

type ChapterGenerationJobResult = {
  error?: string;
  status?: number;
  job?: GenerationJob;
  course?: Course;
  chapter?: Chapter;
};

export async function runCourseGenerationJob(input: {
  jobId: string;
  request?: Request;
  retry?: boolean;
  claimed?: boolean;
}) {
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
      modelOverrides: job.modelOverrides,
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

  const overrides = job.modelOverrides;
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
    let chapters: Chapter[] = generated.chapters.map((chapter) => ({
      ...chapter,
      id: crypto.randomUUID(),
      status: "pending" as const,
    }));
    const isTextbook = course.contentMode === "textbook";
    if (isTextbook) {
      chapters = normalizeTextbookChapters(course, chapters);
    }
    const chapterJobs = isTextbook
      ? []
      : chapters.map((chapter) =>
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
    const linkedChapters = chapters.map((chapter, index) =>
      isTextbook
        ? { ...chapter, status: "pending" as const, generationJobId: undefined }
        : {
            ...chapter,
            status: "queued" as const,
            generationJobId: chapterJobs[index]?.id,
          },
    );
    const plannedCourse = await saveServerCourse(
      {
        ...course,
        profile: generated.profile,
        courseBible: generated.courseBible,
        ...(isTextbook
          ? { textbookMeta: buildTextbookMeta(course, linkedChapters) }
          : {}),
        chapters: linkedChapters,
        updatedAt: new Date().toISOString(),
      },
      input.request,
    );

    const completedJob = completeGenerationJob(job.id, course.id);
    if (completedJob) {
      await saveServerGenerationJob(completedJob, input.request);
    }

    if (chapterJobs.length) {
      await saveServerGenerationJobs(chapterJobs, input.request);
    }

    const firstChapter = linkedChapters[0];
    if (!isTextbook && firstChapter?.generationJobId && shouldRunInlineGeneration(input.request)) {
      void runChapterGenerationJob({
        jobId: firstChapter.generationJobId,
        request: input.request,
      }).catch((error: unknown) => {
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
}): Promise<ChapterGenerationJobResult> {
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
      modelOverrides: job.modelOverrides,
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

  const overrides = job.modelOverrides;
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
      if (shouldUseAsyncDraftReview(course)) {
        const response = await generateChapterDraft(course, chapter, {
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
                status: "draft_ready",
                generationJobId: job.id,
              },
              input.request,
            );
          },
        });
        const illustratedResponse = await applyFigurePipeline(course, chapter, response, overrides);
        if (illustratedResponse.job) {
          await saveServerGenerationJob(illustratedResponse.job, input.request);
        }
        const latestCourse = await getServerCourse(course.id, input.request);
        const draftCourse = await updateServerChapter(
          latestCourse ?? course,
          chapter.id,
          {
            content: illustratedResponse.content,
            sections: illustratedResponse.sections,
            review: illustratedResponse.review,
            qualityReport: undefined,
            status: "draft_ready",
            generationJobId: illustratedResponse.job?.id ?? job.id,
          },
          input.request,
        );
        const reviewJob = createGenerationJob({
          type: "chapter",
          mode: "review_draft",
          courseId: course.id,
          chapterId: chapter.id,
          userId: job.userId ?? course.userId,
          activeAgent: "POLISHER",
          status: "queued",
          modelOverrides: overrides,
          message: "Draft queued for background quality review.",
        });
        const persistedReviewJob = await saveServerGenerationJob(reviewJob, input.request);
        const reviewQueuedCourse = await updateServerChapter(
          draftCourse,
          chapter.id,
          {
            status: "draft_ready",
            generationJobId: persistedReviewJob.id,
          },
          input.request,
        );
        // In inline mode nothing else picks up queued jobs (production uses the
        // external worker), so chain the review run here or the chapter would
        // sit at draft_ready forever.
        if (shouldRunInlineGeneration(input.request)) {
          void runChapterGenerationJob({
            jobId: persistedReviewJob.id,
            request: input.request,
          }).catch((error: unknown) => {
            console.error("Inline draft quality review failed", error);
          });
        }
        return {
          job: persistedReviewJob,
          course: reviewQueuedCourse,
          chapter: reviewQueuedCourse.chapters.find((item) => item.id === chapter.id),
        } as const;
      }

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
      const illustratedResponse = await applyFigurePipeline(course, chapter, response, overrides);
      if (illustratedResponse.job) {
        await saveServerGenerationJob(illustratedResponse.job, input.request);
      }
      await saveServerQualityReport(illustratedResponse.qualityReport, input.request);
      const latestCourse = await getServerCourse(course.id, input.request);
      const updated = await updateServerChapter(
        latestCourse ?? course,
        chapter.id,
        {
          content: illustratedResponse.content,
          sections: illustratedResponse.sections,
          review: illustratedResponse.review,
          qualityReport: illustratedResponse.qualityReport,
          status: illustratedResponse.qualityReport.status === "failed" ? "quality_failed" : "ready",
          generationJobId: illustratedResponse.job?.id ?? job.id,
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
  overrides: ModelOverrides | undefined;
  request?: Request;
}): Promise<ChapterGenerationJobResult> {
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
      });

      if (response.job) {
        await saveServerGenerationJob(response.job, request);
      }
      // Check for a forced AUTHOR rewrite BEFORE generating figures — figure
      // generation costs a paid image call per figure, and a draft that is
      // about to be regenerated would discard them all.
      if (response.qualityReport.issues.some((issue) => issue.check === "review_repair.author_rewrite_required")) {
        const rewriteJob = patchGenerationJob(job.id, {
          mode: undefined,
          activeAgent: "AUTHOR",
          status: "retrying",
          modelOverrides: overrides ?? job.modelOverrides,
        }) ?? job;
        const eventJob = appendJobEvent(rewriteJob.id, {
          agent: "AUTHOR",
          status: "retrying",
          message: "Precise repair could not produce an acceptable candidate; switched to full chapter regeneration.",
        }, { preserveJobStatus: true }) ?? rewriteJob;
        await saveServerGenerationJob(eventJob, request);
        const latestCourse = await getServerCourse(course.id, request);
        const markedCourse = await updateServerChapter(
          latestCourse ?? course,
          chapter.id,
          {
            status: "generating",
            generationJobId: eventJob.id,
          },
          request,
        );
        return {
          job: eventJob,
          course: markedCourse,
          chapter: markedCourse.chapters.find((item) => item.id === chapter.id),
          needsAuthorRewrite: true,
        } as const;
      }
      const illustratedResponse = await applyFigurePipeline(course, chapter, response, overrides ?? job.modelOverrides);
      await saveServerQualityReport(illustratedResponse.qualityReport, request);
      const latestCourse = await getServerCourse(course.id, request);
      const updated = await updateServerChapter(
        latestCourse ?? course,
        chapter.id,
        {
          content: illustratedResponse.content,
          sections: illustratedResponse.sections,
          review: illustratedResponse.review,
          qualityReport: illustratedResponse.qualityReport,
          status: illustratedResponse.qualityReport.status === "failed" ? "quality_failed" : "ready",
          generationJobId: illustratedResponse.job?.id ?? job.id,
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

    if (result.value.needsAuthorRewrite) {
      return runAuthorRewriteCandidate({
        job: result.value.job,
        course: result.value.course,
        baselineChapter: result.value.chapter ?? chapter,
        overrides: overrides ?? job.modelOverrides,
        request,
      });
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

async function runAuthorRewriteCandidate(input: {
  job: GenerationJob;
  course: Course;
  baselineChapter: Chapter;
  overrides: ModelOverrides | undefined;
  request?: Request;
}): Promise<ChapterGenerationJobResult> {
  const { job, course, baselineChapter, overrides, request } = input;
  const latestCourse = await getServerCourse(course.id, request) ?? course;
  const baseline = latestCourse.chapters.find((item) => item.id === baselineChapter.id) ?? baselineChapter;

  await updateServerChapter(
    latestCourse,
    baseline.id,
    {
      status: "generating",
      generationJobId: job.id,
    },
    request,
  );

  const result = await withQuotaConsumption(job.userId ?? course.userId, "generate_chapter", async () => {
    const workingCourse = await getServerCourse(course.id, request) ?? latestCourse;
    const currentBaseline = workingCourse.chapters.find((item) => item.id === baseline.id) ?? baseline;
    const response = await generateChapter(workingCourse, currentBaseline, {
      jobId: job.id,
      overrides,
      onJobUpdate: async (updatedJob) => {
        await saveServerGenerationJob(updatedJob, request);
      },
    });

    if (response.job) {
      await saveServerGenerationJob(response.job, request);
    }

    const courseForDecision = await getServerCourse(course.id, request) ?? workingCourse;
    const baselineForDecision = courseForDecision.chapters.find((item) => item.id === baseline.id) ?? currentBaseline;
    // Decide acceptance BEFORE the figure pipeline (the pipeline does not touch
    // the quality report): a rejected candidate is discarded wholesale, so
    // generating its figures first would waste a paid image call per figure.
    const accepted = shouldAcceptAuthorRewriteCandidate(baselineForDecision, response.qualityReport);
    const latestJob = getGenerationJob(response.job?.id ?? job.id) ?? response.job ?? job;

    if (!accepted) {
      const rejectedSummary = describeQualityDecision(baselineForDecision.qualityReport, response.qualityReport);
      const rejectedJob = appendJobEvent(latestJob.id, {
        agent: "AUTHOR",
        status: "running",
        message: `AUTHOR rewrite candidate rejected; keeping previous chapter: ${rejectedSummary}.`,
      }, { preserveJobStatus: true }) ?? latestJob;
      await saveServerGenerationJob(rejectedJob, request);
      const restored = await updateServerChapter(
        courseForDecision,
        baselineForDecision.id,
        {
          content: baselineForDecision.content,
          sections: baselineForDecision.sections,
          review: baselineForDecision.review,
          qualityReport: baselineForDecision.qualityReport,
          status: statusForStoredChapter(baselineForDecision),
          generationJobId: rejectedJob.id,
        },
        request,
      );
      return {
        job: getGenerationJob(rejectedJob.id) ?? rejectedJob,
        course: restored,
        chapter: restored.chapters.find((item) => item.id === baselineForDecision.id),
      } as const;
    }

    const illustratedResponse = await applyFigurePipeline(workingCourse, currentBaseline, response, overrides);
    await saveServerQualityReport(illustratedResponse.qualityReport, request);
    const acceptedCourse = await updateServerChapter(
      courseForDecision,
      baselineForDecision.id,
      {
        content: illustratedResponse.content,
        sections: illustratedResponse.sections,
        review: illustratedResponse.review,
        qualityReport: illustratedResponse.qualityReport,
        status: illustratedResponse.qualityReport.status === "failed" ? "quality_failed" : "ready",
        generationJobId: latestJob.id,
      },
      request,
    );

    return {
      job: latestJob,
      course: acceptedCourse,
      chapter: acceptedCourse.chapters.find((item) => item.id === baselineForDecision.id),
    } as const;
  });

  if (!result.ok) {
    const quotaMessage = result.quota.message ?? "Author rewrite quota exceeded.";
    const failedJob = appendJobEvent(job.id, {
      agent: "ASSISTANT",
      status: "failed",
      message: quotaMessage,
    });
    if (failedJob) await saveServerGenerationJob(failedJob, request);
    const latest = await getServerCourse(course.id, request) ?? latestCourse;
    const latestChapter = latest.chapters.find((item) => item.id === baseline.id) ?? baseline;
    const restored = await updateServerChapter(
      latest,
      latestChapter.id,
      {
        status: statusForStoredChapter(latestChapter),
        generationJobId: job.id,
      },
      request,
    );
    return {
      error: quotaMessage,
      status: 429,
      job: getGenerationJob(job.id) ?? failedJob ?? job,
      course: restored,
      chapter: restored.chapters.find((item) => item.id === latestChapter.id),
    } as const;
  }

  return result.value;
}

function hasChapterBody(chapter: Chapter) {
  return Boolean(chapter.content || chapter.sections?.length);
}

/**
 * The textbook planner prompt already asks for a native 引言 first chapter and
 * 总结与展望 last chapter. This normalization is a FALLBACK for planners that
 * ignore the rule — when the planner complied, its richer content (research
 * context, tailored contract) is kept and only the depth/role are pinned.
 */
function normalizeTextbookChapters(course: Course, chapters: Chapter[]) {
  if (chapters.length === 0) return chapters;
  return chapters.map((chapter, index) => {
    if (index === 0) {
      if (/引言|导论|绪论/u.test(chapter.title)) {
        return {
          ...chapter,
          depthWeight: "light" as const,
          contract: chapter.contract ? { ...chapter.contract, chapterTitle: chapter.title } : chapter.contract,
        };
      }
      return {
        ...chapter,
        title: "引言",
        description: "说明本教材的背景、研究近况、前沿问题与阅读路线。",
        purpose: "建立全书问题背景和阅读动机。",
        depthWeight: "light" as const,
        contract: {
          chapterTitle: "引言",
          requiredTopics: ["背景与意义", "研究近况", "当前前沿", "全书阅读路线"],
          bridgeFromPrevious: "这是全书起点。",
          bridgeToNext: chapters[1]?.title ? `自然引出${chapters[1].title}。` : "自然引出主体章节。",
          forbiddenEarlyTopics: [],
          requiredExamples: [],
          requiredFormulas: [],
          summaryForNext: "引言建立问题背景，并说明后续章节如何逐步展开。",
        },
      };
    }
    if (index === chapters.length - 1) {
      if (/总结|展望|结语/u.test(chapter.title)) {
        return {
          ...chapter,
          depthWeight: "light" as const,
          contract: chapter.contract ? { ...chapter.contract, chapterTitle: chapter.title } : chapter.contract,
        };
      }
      return {
        ...chapter,
        title: "总结与展望",
        description: "回顾全书主线，给出未来方向、学习建议和对读者的鼓励。",
        purpose: "完成全书收束，帮助读者形成继续深入的路线。",
        depthWeight: "light" as const,
        contract: {
          chapterTitle: "总结与展望",
          requiredTopics: ["全书回顾", "方法脉络", "前沿展望", "后续学习建议"],
          bridgeFromPrevious: chapters[index - 1]?.title ? `承接${chapters[index - 1].title}。` : "承接主体章节。",
          bridgeToNext: "这是全书收束。",
          forbiddenEarlyTopics: [],
          requiredExamples: [],
          requiredFormulas: [],
          summaryForNext: "总结与展望收束全书，不再引入新的核心概念。",
        },
      };
    }
    return {
      ...chapter,
      contract: chapter.contract
        ? { ...chapter.contract, chapterTitle: chapter.title }
        : chapter.contract,
    };
  });
}

function buildTextbookMeta(course: Course, chapters: Chapter[]): TextbookMeta {
  const outlineChapters = chapters.map((chapter, index) => {
    const fixedRole = index === 0
      ? "introduction" as const
      : index === chapters.length - 1
        ? "conclusion" as const
        : undefined;
    const topics = fixedRole ? [] : (chapter.contract?.requiredTopics ?? []).slice(0, 7);
    return {
      id: chapter.id,
      title: chapter.title,
      description: chapter.description,
      order: index,
      ...(fixedRole ? { fixedRole } : {}),
      outlineMarkdown: [
        `# 第 ${index + 1} 章 ${chapter.title}`,
        chapter.description,
        chapter.purpose ? `\n## 本章任务\n${chapter.purpose}` : "",
        chapter.connectionFromPrevious ? `\n## 承接\n${chapter.connectionFromPrevious}` : "",
        chapter.setupForNext ? `\n## 铺垫\n${chapter.setupForNext}` : "",
      ].filter(Boolean).join("\n\n"),
      sections: topics.map((topic, topicIndex) => ({
        id: crypto.randomUUID(),
        title: topic,
        description: `围绕“${topic}”展开教材化讲解。`,
        order: topicIndex,
        outlineMarkdown: `# ${index + 1}.${topicIndex + 1} ${topic}\n\n围绕“${topic}”展开教材化讲解。`,
      })),
    };
  });

  return {
    title: textbookTitle(course.topic),
    subtitle: course.goal,
    language: "zh-CN",
    outlineStatus: "ready",
    outline: {
      bookOutlineMarkdown: [
        `# ${textbookTitle(course.topic)}`,
        course.goal,
        "",
        ...chapters.map((chapter, index) => `${index + 1}. ${chapter.title}：${chapter.description}`),
      ].join("\n"),
      chapters: outlineChapters,
    },
    numbering: {
      figurePrefix: "图",
      tablePrefix: "表",
      definitionPrefix: "定义",
      examplePrefix: "例",
      theoremPrefix: "定理",
      algorithmPrefix: "算法",
      equationStyle: "chapter",
    },
  };
}

function textbookTitle(topic: string) {
  const trimmed = topic.replace(/\s+/gu, " ").trim();
  if (!trimmed) return "未命名教材";
  return trimmed.length > 34 ? trimmed.slice(0, 34) : trimmed;
}

async function applyFigurePipeline<T extends {
  content: string;
  sections: ChapterGenerateResponse["sections"];
  review: string;
}>(
  course: Course,
  chapter: Chapter,
  response: T,
  overrides: ModelOverrides | undefined,
): Promise<T> {
  const processed = await processChapterFigures({
    course,
    chapter,
    content: response.content,
    overrides,
  });
  if (processed.assets.length === 0 && processed.skipped.length === 0) return response;

  const modeLabel = processed.assets[0]?.generationMode ?? processed.skipped[0]?.mode;
  const modeText = modeLabel === "model" ? "模型生图" : "代码渲染";
  const note = `插图处理完成：${modeText}，成功 ${processed.assets.length} 张，跳过 ${processed.skipped.length} 张。`;
  return {
    ...response,
    content: processed.content,
    sections: markdownToSections(chapter, processed.content),
    review: response.review ? `${response.review}\n${note}` : note,
  };
}

function getChapterBody(chapter: Chapter) {
  return chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n") ?? "";
}

function interruptedChapterStatus(chapter: Chapter) {
  if (!hasChapterBody(chapter)) return "failed";
  return chapter.qualityReport?.status === "failed" ? "quality_failed" : "draft_ready";
}

function shouldUseAsyncDraftReview(course: Course) {
  return (course.generationProfile ?? "fast") !== "deep";
}

function statusForStoredChapter(chapter: Chapter): Chapter["status"] {
  if (!hasChapterBody(chapter)) return "failed";
  if (chapter.qualityReport?.status === "failed") return "quality_failed";
  if (chapter.qualityReport?.status === "passed" || chapter.qualityReport?.status === "warning") return "ready";
  return chapter.status ?? "draft_ready";
}

function shouldAcceptAuthorRewriteCandidate(current: Chapter, candidate: QualityReport) {
  const currentReport = current.qualityReport;
  if (!currentReport || !hasChapterBody(current)) return true;
  return shouldAcceptQualityCandidate(currentReport, candidate);
}

function describeQualityDecision(current: QualityReport | undefined, candidate: QualityReport) {
  if (!current) return `no baseline -> score ${candidate.score}, status ${candidate.status}.`;
  const before = summarizeQualityForDecision(current);
  const after = summarizeQualityForDecision(candidate);
  return `score ${current.score} -> ${candidate.score}, status ${current.status} -> ${candidate.status}, errors ${before.errors} -> ${after.errors}, blocking ${before.blocking} -> ${after.blocking}, warnings ${before.warnings} -> ${after.warnings}`;
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
