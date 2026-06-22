"use client";

import { useCallback, useRef, useState } from "react";
import { apiFetch } from "@/lib/clientApi";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { Annotation, Course } from "@/lib/types";

export const TUTOR_REQUEST_TIMEOUT_MS = 70_000;

export type TutorTarget =
  | { scope: "anchored"; selectedText: string; sectionId?: string }
  | { scope: "chapter" };

export function useTutor(course: Course | undefined, chapterId: string) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [active, setActive] = useState<Annotation>();
  const [target, setTarget] = useState<TutorTarget>();
  const [answering, setAnswering] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const reloadAnnotations = useCallback(() => {
    apiFetch(`/api/annotations?chapterId=${chapterId}`)
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data) => {
        if (data?.annotations) setAnnotations(data.annotations);
      })
      .catch(() => undefined);
  }, [chapterId]);

  const startAnchored = useCallback((selectedText: string, sectionId?: string) => {
    setTarget({ scope: "anchored", selectedText, sectionId });
    setActive(undefined);
  }, []);

  const startGeneral = useCallback(() => {
    setTarget({ scope: "chapter" });
    setActive(undefined);
  }, []);

  const openThread = useCallback((annotation: Annotation) => {
    setActive(annotation);
    setTarget(
      annotation.scope === "chapter" || !annotation.selectedText
        ? { scope: "chapter" }
        : { scope: "anchored", selectedText: annotation.selectedText, sectionId: annotation.sectionId },
    );
  }, []);

  const clear = useCallback(() => {
    setActive(undefined);
    setTarget(undefined);
  }, []);

  const streamAnswer = useCallback(
    async (annotation: Annotation, question: string) => {
      if (!course) return;
      setAnswering(true);
      const pendingId = crypto.randomUUID();
      annotation.messages.push({ id: pendingId, role: "assistant", content: "" });
      setActive({ ...annotation });

      let saved: Annotation | undefined;
      const controller = new AbortController();
      controllerRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), TUTOR_REQUEST_TIMEOUT_MS);
      try {
        saved = await askTutorStreaming({
          topic: course.topic,
          selectedText: annotation.selectedText ?? "",
          question,
          history: annotation.messages.filter((message) => message.id !== pendingId),
          sectionId: annotation.sectionId,
          annotation,
          signal: controller.signal,
          onToken: (chunk) => {
            annotation.messages = annotation.messages.map((message) =>
              message.id === pendingId ? { ...message, content: message.content + chunk } : message,
            );
            setActive({ ...annotation });
          },
        });
      } catch (error) {
        const message = controller.signal.aborted
          ? "导师回答已停止。"
          : publicSafeErrorMessage(error, "导师暂时无法回答，请稍后重试。");
        annotation.messages = annotation.messages.map((item) =>
          item.id === pendingId ? { ...item, content: message } : item,
        );
        setActive({ ...annotation });
      } finally {
        window.clearTimeout(timeout);
        setAnswering(false);
        controllerRef.current = null;
      }

      if (saved) setAnnotations((current) => upsertAnnotation(current, saved!));
      setActive({ ...(saved ?? annotation) });
    },
    [course],
  );

  const ask = useCallback(
    async (question: string) => {
      if (!course || !question.trim() || (!active && !target)) return;
      const isChapter = active
        ? active.scope === "chapter" || !active.selectedText
        : target?.scope === "chapter";

      const annotation: Annotation =
        active ??
        ({
          id: crypto.randomUUID(),
          courseId: course.id,
          chapterId,
          sectionId: target?.scope === "anchored" ? target.sectionId : undefined,
          scope: isChapter ? "chapter" : "anchored",
          selectedText: target?.scope === "anchored" ? target.selectedText : undefined,
          question,
          messages: [],
          createdAt: new Date().toISOString(),
        } satisfies Annotation);

      annotation.messages.push({ id: crypto.randomUUID(), role: "user", content: question });
      setActive({ ...annotation });
      await streamAnswer(annotation, question);
    },
    [active, chapterId, course, streamAnswer, target],
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const regenerateLast = useCallback(async () => {
    if (!active || answering) return;
    const lastUser = [...active.messages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    const lastUserIndex = active.messages.map((m) => m.id).lastIndexOf(lastUser.id);
    const trimmed: Annotation = { ...active, messages: active.messages.slice(0, lastUserIndex + 1) };
    setActive(trimmed);
    await streamAnswer(trimmed, lastUser.content);
  }, [active, answering, streamAnswer]);

  const deleteThread = useCallback(async (id: string) => {
    await apiFetch(`/api/annotations?id=${id}`, { method: "DELETE" }).catch(() => undefined);
    setAnnotations((current) => current.filter((item) => item.id !== id));
    setActive((current) => (current?.id === id ? undefined : current));
  }, []);

  return {
    annotations,
    active,
    target,
    answering,
    reloadAnnotations,
    startAnchored,
    startGeneral,
    openThread,
    clear,
    ask,
    stop,
    regenerateLast,
    deleteThread,
  };
}

function upsertAnnotation(annotations: Annotation[], annotation: Annotation) {
  const index = annotations.findIndex((item) => item.id === annotation.id);
  if (index === -1) return [...annotations, annotation];
  return annotations.map((item) => (item.id === annotation.id ? annotation : item));
}

async function askTutorStreaming(input: {
  topic: string;
  selectedText: string;
  question: string;
  history: { role: string; content: string }[];
  sectionId?: string;
  annotation: Annotation;
  signal?: AbortSignal;
  onToken: (chunk: string) => void;
}): Promise<Annotation | undefined> {
  const response = await apiFetch("/api/annotations", {
    method: "POST",
    signal: input.signal,
    body: JSON.stringify({
      topic: input.topic,
      selectedText: input.selectedText,
      question: input.question,
      history: input.history,
      sectionId: input.sectionId,
      annotation: input.annotation,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error ?? `Tutor request failed (${response.status}).`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming not supported.");

  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const lines = part.split("\n");
      let eventType = "message";
      let data = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          data = line.slice(6);
        }
      }

      if (!data) continue;

      try {
        const parsed = JSON.parse(data);
        if (eventType === "token") {
          input.onToken(parsed.text ?? "");
        } else if (eventType === "done") {
          return parsed.annotation ?? undefined;
        } else if (eventType === "error") {
          throw new Error(parsed.error ?? "Tutor request failed.");
        }
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }

  return undefined;
}
