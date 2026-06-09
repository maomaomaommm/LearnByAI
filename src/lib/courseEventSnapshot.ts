import "server-only";

import { getGenerationJobForRequest } from "./generationJobStatus";
import { getServerCourse } from "./serverStore";
import { Course, GenerationJob } from "./types";

export const ACTIVE_JOB_STATUSES = ["pending", "queued", "retrying", "running"] as const;

export async function getCourseEventSnapshot(courseId: string, request: Request) {
  const course = await getServerCourse(courseId, request);
  if (!course) {
    return {
      course: undefined,
      jobs: [] as GenerationJob[],
    };
  }

  const jobs = (
    await Promise.all(getCourseGenerationJobIds(course).map((jobId) => getGenerationJobForRequest(jobId, request)))
  ).filter((job): job is GenerationJob => Boolean(job));

  return { course, jobs };
}

export function getCourseGenerationJobIds(course: Course) {
  return [
    course.generationJobId,
    ...course.chapters.map((chapter) => chapter.generationJobId),
  ].filter((jobId, index, jobIds): jobId is string => Boolean(jobId) && jobIds.indexOf(jobId) === index);
}

export function hasActiveGenerationJobs(jobs: GenerationJob[]) {
  return jobs.some((job) => isActiveGenerationJob(job));
}

export function isActiveGenerationJob(job: GenerationJob) {
  return ACTIVE_JOB_STATUSES.includes(job.status as (typeof ACTIVE_JOB_STATUSES)[number]);
}
