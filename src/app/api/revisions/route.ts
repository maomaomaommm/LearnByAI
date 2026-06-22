import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { proposeRevision } from "@/lib/maol/client";
import { resolveRevisionScopeAnchor } from "@/lib/markdownSections";
import { parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { withQuotaConsumption } from "@/lib/quota";
import { safeErrorMessage } from "@/lib/safeError";
import { getServerCourse, listServerRevisions, saveServerRevision, updateServerRevision } from "@/lib/serverStore";
import { resolveModelOverrides } from "@/lib/userModelConfig";
import { Chapter, Revision, RevisionMode, RevisionScope } from "@/lib/types";

const VALID_MODES: RevisionMode[] = ["fix", "rewrite"];
const VALID_SCOPES: RevisionScope[] = ["selection", "paragraph", "section"];

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { searchParams } = new URL(request.url);
  const chapterId = searchParams.get("chapterId");
  if (!chapterId) {
    return NextResponse.json({ error: "chapterId is required" }, { status: 400 });
  }

  return NextResponse.json({ revisions: await listServerRevisions(chapterId, request) });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  try {
    const input = await request.json();
    const courseId = String(input.courseId ?? "");
    const chapterId = String(input.chapterId ?? "");
    const selectedText = String(input.selectedText ?? "").trim();
    const userMessage = String(input.userMessage ?? "").trim();
    const sectionId = input.sectionId ? String(input.sectionId) : undefined;
    const mode: RevisionMode = VALID_MODES.includes(input.mode) ? input.mode : "fix";
    const scope: RevisionScope = VALID_SCOPES.includes(input.scope) ? input.scope : "selection";

    if (!courseId || !chapterId || !selectedText || !userMessage) {
      return NextResponse.json(
        { error: "courseId, chapterId, selectedText, and userMessage are required." },
        { status: 400 },
      );
    }

    const course = await getServerCourse(courseId, request);
    if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

    const chapter = course.chapters.find((item) => item.id === chapterId);
    if (!chapter) return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
    if (sectionId && !chapter.sections?.some((section) => section.id === sectionId)) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    const anchor = resolveChapterRevisionAnchor(chapter, sectionId, scope, selectedText);
    if (!anchor) {
      return NextResponse.json(
        { error: "无法在当前章节中唯一定位所选内容，请缩小选区或更换范围后重试。" },
        { status: 409 },
      );
    }

    const headerOverrides = parseModelOverridesFromHeaders(request.headers);
    const overrides = await resolveModelOverrides(auth.userId, headerOverrides);

    // Quota is charged on a successful proposal — the expensive LLM call is here,
    // not in /apply (which is a deterministic text swap).
    const result = await withQuotaConsumption(auth.userId, "revise", async () => {
      const suggestion = await proposeRevision({
        course,
        chapterId,
        sectionId: anchor.sectionId,
        mode,
        scope,
        selectedText: anchor.text,
        userMessage,
        overrides,
      });

      const now = new Date().toISOString();
      const revision: Revision = {
        id: crypto.randomUUID(),
        courseId,
        chapterId,
        sectionId: anchor.sectionId,
        mode,
        scope,
        intent: userMessage,
        status: "proposed",
        beforeText: suggestion.beforeText,
        afterText: suggestion.afterText,
        diagnosis: suggestion.diagnosis,
        confidence: suggestion.confidence,
        createdAt: now,
      };
      const saved = await saveServerRevision(revision, request);
      // C8: a new proposal for the same anchor supersedes prior unapplied proposals.
      const prior = await listServerRevisions(chapterId, request);
      await Promise.all(
        prior
          .filter(
            (item) =>
              item.id !== saved.id &&
              item.status === "proposed" &&
              item.sectionId === saved.sectionId &&
              item.beforeText === saved.beforeText,
          )
          .map((item) => updateServerRevision(item.id, { status: "failed" }, request)),
      );
      return saved;
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.quota.message }, { status: 429 });
    }

    return NextResponse.json({ revision: result.value });
  } catch (error) {
    return NextResponse.json({ error: revisionErrorMessage(error) }, { status: 502 });
  }
}

function resolveChapterRevisionAnchor(
  chapter: Chapter,
  preferredSectionId: string | undefined,
  scope: RevisionScope,
  selectedText: string,
) {
  const sections = chapter.sections ?? [];
  if (sections.length > 0) {
    const preferred = sections.find((section) => section.id === preferredSectionId);
    const preferredAnchor = preferred
      ? resolveRevisionScopeAnchor(preferred.content, scope, selectedText)
      : undefined;
    if (preferred && preferredAnchor) {
      return { sectionId: preferred.id, text: preferredAnchor };
    }

    const matches = sections.flatMap((section) => {
      const text = resolveRevisionScopeAnchor(section.content, scope, selectedText);
      return text ? [{ sectionId: section.id, text }] : [];
    });
    return matches.length === 1 ? matches[0] : undefined;
  }

  const text = chapter.content
    ? resolveRevisionScopeAnchor(chapter.content, scope, selectedText)
    : undefined;
  return text ? { sectionId: undefined, text } : undefined;
}

function revisionErrorMessage(error: unknown) {
  const message = safeErrorMessage(error, "Revision suggestion failed.");
  if (/timed out|timeout|aborted/i.test(message)) {
    return "改写建议生成超时，请稍后重试。";
  }
  if (/401|unauthorized|api key|authentication/i.test(message)) {
    return "AI 服务鉴权失败，请联系管理员检查模型配置。";
  }
  return "暂时无法生成改写建议，请稍后重试。";
}
