"use client";

import { Annotation, Course } from "./types";

const COURSES_KEY = "learnbyai:courses";
const ANNOTATIONS_KEY = "learnbyai:annotations";

export function getCourses(): Course[] {
  if (typeof window === "undefined") return [];
  return JSON.parse(localStorage.getItem(COURSES_KEY) ?? "[]");
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
  const all: Annotation[] = JSON.parse(localStorage.getItem(ANNOTATIONS_KEY) ?? "[]");
  return all.filter((annotation) => annotation.chapterId === chapterId);
}

export function saveAnnotation(annotation: Annotation) {
  const all: Annotation[] = JSON.parse(localStorage.getItem(ANNOTATIONS_KEY) ?? "[]");
  const index = all.findIndex((item) => item.id === annotation.id);
  if (index >= 0) all[index] = annotation;
  else all.push(annotation);
  localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(all));
}
