"use client";

import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/clientApi";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { Course, Revision, RevisionMode, RevisionScope } from "@/lib/types";

export const REVISE_REQUEST_TIMEOUT_MS = 70_000;

export type ReviseTarget = { selectedText: string; sectionId?: string };

export function useRevise(
  course: Course | undefined,
  chapterId: string,
  onCourseUpdate: (course: Course) => void,
) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [proposal, setProposal] = useState<Revision>();
  const [target, setTarget] = useState<ReviseTarget>();
  const [mode, setMode] = useState<RevisionMode>("rewrite");
  const [scope, setScope] = useState<RevisionScope>("selection");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reloadRevisions = useCallback(() => {
    apiFetch(`/api/revisions?chapterId=${chapterId}`)
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data) => {
        if (data?.revisions) setRevisions(data.revisions);
      })
      .catch(() => undefined);
  }, [chapterId]);

  const start = useCallback((selectedText: string, sectionId?: string) => {
    setTarget({ selectedText, sectionId });
    setProposal(undefined);
    setError("");
  }, []);

  const clear = useCallback(() => {
    setTarget(undefined);
    setProposal(undefined);
    setError("");
  }, []);

  const propose = useCallback(
    async (intent: string) => {
      if (!course || !target || !intent.trim()) return;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), REVISE_REQUEST_TIMEOUT_MS);
      setBusy(true);
      setError("");
      setProposal(undefined);
      try {
        const response = await apiFetch("/api/revisions", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            courseId: course.id,
            chapterId,
            sectionId: target.sectionId,
            selectedText: target.selectedText,
            userMessage: intent,
            mode,
            scope,
          }),
        });
        const data = (await response.json().catch(() => null)) as { revision?: Revision; error?: string } | null;
        if (!response.ok) throw new Error(data?.error ?? `Revision request failed (${response.status}).`);
        if (!data?.revision) throw new Error("Revision suggestion is empty.");
        setProposal(data.revision);
      } catch (error) {
        setError(
          controller.signal.aborted
            ? "改写建议生成超时，请稍后重试。"
            : publicSafeErrorMessage(error, "暂时无法生成改写建议，请稍后重试。"),
        );
      } finally {
        window.clearTimeout(timeout);
        setBusy(false);
      }
    },
    [course, target, mode, scope, chapterId],
  );

  const apply = useCallback(async () => {
    if (!proposal || proposal.status !== "proposed") return;
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/revisions/apply", {
        method: "POST",
        body: JSON.stringify({ revisionId: proposal.id }),
      });
      const data = (await response.json().catch(() => null)) as
        | { course?: Course; revision?: Revision; error?: string }
        | null;
      if (!response.ok) throw new Error(data?.error ?? `Apply revision failed (${response.status}).`);
      if (data?.course) onCourseUpdate(data.course);
      if (data?.revision) setProposal(data.revision);
      reloadRevisions();
    } catch (error) {
      setError(publicSafeErrorMessage(error, "应用改写失败，请稍后重试。"));
    } finally {
      setBusy(false);
    }
  }, [proposal, onCourseUpdate, reloadRevisions]);

  const revert = useCallback(
    async (revisionId: string) => {
      setBusy(true);
      setError("");
      try {
        const response = await apiFetch(`/api/revisions/${revisionId}/revert`, { method: "POST" });
        const data = (await response.json().catch(() => null)) as { course?: Course; error?: string } | null;
        if (!response.ok) throw new Error(data?.error ?? `Revert failed (${response.status}).`);
        if (data?.course) onCourseUpdate(data.course);
        reloadRevisions();
      } catch (error) {
        setError(publicSafeErrorMessage(error, "撤销失败，请稍后重试。"));
      } finally {
        setBusy(false);
      }
    },
    [onCourseUpdate, reloadRevisions],
  );

  return {
    revisions,
    proposal,
    target,
    mode,
    setMode,
    scope,
    setScope,
    busy,
    error,
    reloadRevisions,
    start,
    clear,
    propose,
    apply,
    revert,
  };
}
