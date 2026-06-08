"use client";

import { Annotation, Course } from "./types";
import { totalMinutes } from "./time";

const COURSES_KEY = "learnbyai:courses";
const ANNOTATIONS_KEY = "learnbyai:annotations";

export function getCourses(): Course[] {
  if (typeof window === "undefined") return [];
  const courses = readStorageArray<Course>(COURSES_KEY);
  const migrated = courses.map(normalizeCourse);
  if (JSON.stringify(courses) !== JSON.stringify(migrated)) {
    localStorage.setItem(COURSES_KEY, JSON.stringify(migrated));
  }
  return migrated;
}

function normalizeCourse(course: Course): Course {
  const courseBible =
    course.courseBible ??
    ({
      targetLearner: course.background,
      finalOutcomes: [course.goal],
      teachingStyle: course.preference,
      prerequisites: [],
      globalNarrative: `围绕「${course.topic}」建立一条从基础到应用的学习主线。`,
      terminology: [],
      chapterDependencies: [],
    } satisfies Course["courseBible"]);

  return {
    ...course,
    courseBible,
    chapters: course.chapters.map((chapter, index) => ({
      ...chapter,
      purpose: chapter.purpose ?? chapter.description,
      connectionFromPrevious:
        chapter.connectionFromPrevious ?? (index === 0 ? "这是课程起点。" : "承接上一章。"),
      setupForNext: chapter.setupForNext ?? "为后续章节铺垫。",
      time:
        chapter.minutes && (!chapter.time || totalMinutes(chapter.time) !== chapter.minutes)
          ? splitLegacyMinutes(chapter.minutes)
          : chapter.time ?? splitLegacyMinutes(180),
      status: chapter.status ?? (chapter.sections?.length || chapter.content ? "ready" : "pending"),
      sections:
        chapter.sections ??
        (chapter.content
          ? [
              {
                id: `${chapter.id}:legacy-section`,
                chapterId: chapter.id,
                title: chapter.title,
                purpose: chapter.purpose ?? chapter.description,
                content: chapter.content,
                status: "ready",
                order: 0,
              },
            ]
          : undefined),
    })),
  };
}

function splitLegacyMinutes(minutes: number) {
  return {
    readingMinutes: Math.round(minutes * 0.45),
    exerciseMinutes: Math.round(minutes * 0.2),
    practiceMinutes: Math.round(minutes * 0.25),
    extensionMinutes: minutes - Math.round(minutes * 0.45) - Math.round(minutes * 0.2) - Math.round(minutes * 0.25),
  };
}

export function getCourse(id: string): Course | undefined {
  return getCourses().find((course) => course.id === id);
}

export function saveCourse(course: Course) {
  const courses = getCourses();
  const index = courses.findIndex((item) => item.id === course.id);
  if (index >= 0) courses[index] = course;
  else courses.unshift(course);
  localStorage.setItem(COURSES_KEY, JSON.stringify(courses));
}

export function getAnnotations(chapterId: string): Annotation[] {
  if (typeof window === "undefined") return [];
  const all = readStorageArray<Annotation>(ANNOTATIONS_KEY);
  return all.filter((annotation) => annotation.chapterId === chapterId);
}

export function saveAnnotation(annotation: Annotation) {
  const all = readStorageArray<Annotation>(ANNOTATIONS_KEY);
  const index = all.findIndex((item) => item.id === annotation.id);
  if (index >= 0) all[index] = annotation;
  else all.push(annotation);
  localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(all));
}

function readStorageArray<T>(key: string): T[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
