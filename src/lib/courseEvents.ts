import "server-only";

import { GenerationJob } from "./types";

export type CourseEventSignal = {
  type: "course" | "job";
  courseId: string;
  jobId?: string;
  emittedAt: number;
};

type CourseEventListener = (event: CourseEventSignal) => void;

const listeners = new Map<string, Set<CourseEventListener>>();

export function subscribeCourseEvents(courseId: string, listener: CourseEventListener) {
  const courseListeners = listeners.get(courseId) ?? new Set<CourseEventListener>();
  courseListeners.add(listener);
  listeners.set(courseId, courseListeners);

  return () => {
    courseListeners.delete(listener);
    if (courseListeners.size === 0) listeners.delete(courseId);
  };
}

export function publishCourseChanged(courseId: string) {
  publishCourseEvent({
    type: "course",
    courseId,
    emittedAt: Date.now(),
  });
}

export function publishGenerationJobChanged(job: GenerationJob) {
  if (!job.courseId) return;

  publishCourseEvent({
    type: "job",
    courseId: job.courseId,
    jobId: job.id,
    emittedAt: Date.now(),
  });
}

function publishCourseEvent(event: CourseEventSignal) {
  const courseListeners = listeners.get(event.courseId);
  if (!courseListeners?.size) return;

  for (const listener of courseListeners) {
    listener(event);
  }
}
