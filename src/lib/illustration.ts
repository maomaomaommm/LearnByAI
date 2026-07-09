import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath, sep } from "node:path";
import { dispatchAgentText } from "./maol/dispatcher";
import { ModelOverrides } from "./modelOverrides";
import { buildIllustrationPlanPrompt } from "./prompts/illustrator";
import { parseJson } from "./ai";
import { safeErrorMessage } from "./safeError";
import { snapshotChapterBeforeRegen, updateServerChapter } from "./serverStore";
import { createSupabaseServiceClient } from "./supabase/server";
import { Course } from "./types";

/**
 * Chapter illustration (beta). Pipeline: a text agent (course owner's model
 * config, REVIEWER slot) plans up to N figure spots for a finished chapter →
 * a dedicated image model renders each figure in a consistent textbook style →
 * images are stored in a private Supabase bucket (local dir in fallback mode)
 * and served through /api/illustrations/* → figure Markdown is inserted after
 * the anchor paragraph. The chapter is snapshotted first so the whole insertion
 * can be reverted through the existing revision-revert endpoint.
 *
 * The image credential is a dedicated ILLUSTRATION_API_KEY — it is NOT a global
 * content-agent key; chapter planning still runs on the owner's model config.
 */

const ILLUSTRATIONS_BUCKET = "learnbyai-illustrations";
export const ILLUSTRATION_URL_PREFIX = "/api/illustrations/";

// Consistent figure style across every generated illustration; the per-figure
// prompt from the planner is appended to this.
const STYLE_PREAMBLE =
  "Clean professional 2D flat vector illustration for a top-tier university press textbook. " +
  "White background, muted academic palette (navy, slate gray, soft orange accent), precise thin lines, " +
  "generous whitespace, publication quality. No watermark, no photorealism, no 3D render. " +
  "All text labels in simplified Chinese plain text unless specified otherwise; never render LaTeX syntax. ";

const localIllustrationStoreDir = resolvePath(process.cwd(), ".next", "local-beta-illustrations");

export function getIllustrationConfig() {
  return {
    apiKey: process.env.ILLUSTRATION_API_KEY ?? "",
    baseUrl: (process.env.ILLUSTRATION_API_BASE_URL || "https://nikoapi.xyz").replace(/\/$/, ""),
    model: process.env.ILLUSTRATION_MODEL || "gpt-image-2",
    maxPerChapter: readPositiveInteger(process.env.ILLUSTRATION_MAX_PER_CHAPTER, 3),
    timeoutMs: readPositiveInteger(process.env.ILLUSTRATION_TIMEOUT_MS, 300_000),
  };
}

export function isIllustrationEnabled() {
  return Boolean(getIllustrationConfig().apiKey);
}

export type IllustrationPlanItem = { anchor: string; caption: string; prompt: string };

export function parseIllustrationPlan(raw: string, maxCount: number): IllustrationPlanItem[] {
  const parsed = parseJson<{ illustrations?: unknown }>(raw);
  return normalizeIllustrationPlanItems(parsed.illustrations, maxCount);
}

export function normalizeIllustrationPlanItems(list: unknown, maxCount: number): IllustrationPlanItem[] {
  if (!Array.isArray(list)) return [];
  const items: IllustrationPlanItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const anchor = typeof record.anchor === "string" ? record.anchor.trim() : "";
    const caption = typeof record.caption === "string" ? record.caption.trim() : "";
    const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
    if (!anchor || !caption || !prompt) continue;
    items.push({ anchor, caption: caption.slice(0, 60), prompt });
    if (items.length >= maxCount) break;
  }
  return items;
}

export type IllustrationInsert = { anchor: string; markdown: string };
export type IllustrationSkip = { anchor: string; reason: string };

/**
 * Locate the paragraph containing each verbatim anchor and return its insertion
 * offset (the end of that paragraph/block), or the reason it must be skipped.
 * Anchors inside code fences or display-math blocks are rejected — a figure
 * there would corrupt the block.
 */
export function resolveIllustrationAnchor(content: string, anchor: string): { offset: number } | { reason: string } {
  const trimmed = anchor.trim();
  if (trimmed.length < 8) return { reason: "anchor too short" };
  const first = content.indexOf(trimmed);
  if (first === -1) return { reason: "anchor not found in chapter" };
  if (content.indexOf(trimmed, first + 1) !== -1) return { reason: "anchor is not unique" };
  const offset = findParagraphEnd(content, first + trimmed.length);
  if (isInsideFencedBlock(content, offset)) return { reason: "anchor sits inside a code or math block" };
  return { offset };
}

export function insertIllustrationsIntoMarkdown(content: string, items: IllustrationInsert[]) {
  const inserts: { offset: number; markdown: string }[] = [];
  const skipped: IllustrationSkip[] = [];

  for (const item of items) {
    const resolved = resolveIllustrationAnchor(content, item.anchor);
    if ("reason" in resolved) {
      skipped.push({ anchor: item.anchor, reason: resolved.reason });
      continue;
    }
    inserts.push({ offset: resolved.offset, markdown: item.markdown });
  }

  let next = content;
  for (const insert of [...inserts].sort((a, b) => b.offset - a.offset)) {
    const before = next.slice(0, insert.offset).replace(/\s+$/u, "");
    const after = next.slice(insert.offset).replace(/^\s+/u, "");
    next = after
      ? `${before}\n\n${insert.markdown}\n\n${after}`
      : `${before}\n\n${insert.markdown}\n`;
  }

  return { content: next, inserted: inserts.length, skipped };
}

export function buildIllustrationMarkdown(figureLabel: string, caption: string, url: string) {
  // Only [ ] and newlines can break ![alt](url) syntax — parens in the alt
  // text are safe (the URL is ours and contains none), so "TD(0)" stays intact.
  const safeCaption = caption.replace(/[\[\]\n]/gu, " ").replace(/\s+/gu, " ").trim();
  return `![${figureLabel}　${safeCaption}](${url})\n\n*${figureLabel}　${safeCaption}*`;
}

export async function generateIllustrationImage(prompt: string) {
  const config = getIllustrationConfig();
  if (!config.apiKey) throw new Error("Illustration API is not configured.");

  let lastError: unknown;
  // The upstream image gateway occasionally drops long-running connections;
  // one retry recovers most of those.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const payload = await fetchJsonWithTimeout(
        `${config.baseUrl}/v1/images/generations`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            prompt: `${STYLE_PREAMBLE}${prompt}`,
            n: 1,
            response_format: "url",
          }),
        },
        config.timeoutMs,
      );
      const item = (payload as { data?: { url?: string; b64_json?: string }[] }).data?.[0];
      if (item?.b64_json) {
        return { bytes: Buffer.from(item.b64_json, "base64"), contentType: "image/png", ext: "png" };
      }
      if (item?.url) {
        return downloadIllustration(item.url, config.timeoutMs);
      }
      throw new Error("Illustration API returned no image.");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Illustration generation failed.");
}

export async function saveIllustrationImage(input: {
  courseId: string;
  chapterId: string;
  bytes: Buffer;
  contentType: string;
  ext: string;
}) {
  const storagePath = `${input.courseId}/${input.chapterId}/${randomUUID()}.${input.ext}`;

  const supabase = createSupabaseServiceClient();
  if (supabase) {
    await ensureIllustrationsBucket(supabase);
    const { error } = await supabase.storage
      .from(ILLUSTRATIONS_BUCKET)
      .upload(storagePath, input.bytes, { contentType: input.contentType, upsert: true });
    if (error) {
      throw new Error(`Illustration upload failed: ${error.message}`);
    }
  } else {
    const path = localIllustrationPath(storagePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.bytes);
  }

  return { storagePath, url: `${ILLUSTRATION_URL_PREFIX}${storagePath}` };
}

export async function readIllustrationImage(storagePath: string) {
  if (!isValidIllustrationPath(storagePath)) return undefined;

  const supabase = createSupabaseServiceClient();
  if (supabase) {
    const { data, error } = await supabase.storage.from(ILLUSTRATIONS_BUCKET).download(storagePath);
    if (error || !data) return undefined;
    return {
      bytes: Buffer.from(await data.arrayBuffer()),
      contentType: contentTypeForPath(storagePath),
    };
  }

  try {
    return {
      bytes: await readFile(localIllustrationPath(storagePath)),
      contentType: contentTypeForPath(storagePath),
    };
  } catch {
    return undefined;
  }
}

export function isValidIllustrationPath(storagePath: string) {
  return /^[0-9a-zA-Z-]{1,64}\/[0-9a-zA-Z-]{1,64}\/[0-9a-f-]{36}\.(png|jpg|webp)$/u.test(storagePath);
}

export type IllustrateChapterResult = {
  status: "ok" | "skipped" | "no_targets" | "failed";
  inserted: number;
  illustrations: { caption: string; url: string }[];
  skipped: IllustrationSkip[];
};

export async function illustrateChapter(input: {
  course: Course;
  chapterId: string;
  overrides?: ModelOverrides;
  force?: boolean;
  request?: Request;
  /** Internal/ops override: a pre-written plan skips the planning agent (e.g. when the owner's text model is unavailable). */
  plan?: unknown;
}): Promise<IllustrateChapterResult> {
  const config = getIllustrationConfig();
  if (!config.apiKey) throw new Error("Illustration API is not configured.");

  const chapterIndex = input.course.chapters.findIndex((chapter) => chapter.id === input.chapterId);
  if (chapterIndex === -1) throw new Error("Chapter not found.");
  const chapter = input.course.chapters[chapterIndex];
  const content = chapter.content?.trim();
  if (!content) throw new Error("Chapter has no content to illustrate.");
  if (!input.force && content.includes(ILLUSTRATION_URL_PREFIX)) {
    return { status: "skipped", inserted: 0, illustrations: [], skipped: [] };
  }

  let planned: IllustrationPlanItem[];
  if (input.plan !== undefined) {
    planned = normalizeIllustrationPlanItems(input.plan, config.maxPerChapter);
  } else {
    // Plan on the owner's model config; the REVIEWER slot fits (read + judge, JSON out).
    const planText = await dispatchAgentText({
      agent: "REVIEWER",
      prompt: buildIllustrationPlanPrompt({
        course: input.course,
        chapterTitle: chapter.title,
        chapterNumber: chapterIndex + 1,
        content,
        maxCount: config.maxPerChapter,
      }),
      temperature: 0.2,
      maxTokens: 4096,
      responseFormat: "json_object",
      overrides: input.overrides,
      mock: () => JSON.stringify({ illustrations: [] }),
    });
    planned = parseIllustrationPlan(planText, config.maxPerChapter);
  }
  const skipped: IllustrationSkip[] = [];

  // Validate anchors before paying ~1 minute per image, and keep figures in
  // document order so 图 N-1 appears before 图 N-2.
  const targets = planned
    .map((item) => {
      const resolved = resolveIllustrationAnchor(content, item.anchor);
      if ("reason" in resolved) {
        skipped.push({ anchor: item.anchor, reason: resolved.reason });
        return undefined;
      }
      return { ...item, offset: resolved.offset };
    })
    .filter((item): item is IllustrationPlanItem & { offset: number } => Boolean(item))
    .sort((a, b) => a.offset - b.offset);

  if (targets.length === 0) {
    return { status: "no_targets", inserted: 0, illustrations: [], skipped };
  }

  const prepared: (IllustrationInsert & { caption: string; url: string })[] = [];
  for (const [index, target] of targets.entries()) {
    try {
      const image = await generateIllustrationImage(target.prompt);
      const stored = await saveIllustrationImage({
        courseId: input.course.id,
        chapterId: input.chapterId,
        ...image,
      });
      const label = `图 ${chapterIndex + 1}-${index + 1}`;
      prepared.push({
        anchor: target.anchor,
        markdown: buildIllustrationMarkdown(label, target.caption, stored.url),
        caption: target.caption,
        url: stored.url,
      });
    } catch (error) {
      skipped.push({ anchor: target.anchor, reason: safeErrorMessage(error, "image generation failed") });
    }
  }

  if (prepared.length === 0) {
    return { status: "failed", inserted: 0, illustrations: [], skipped };
  }

  const insertion = insertIllustrationsIntoMarkdown(content, prepared);
  if (insertion.inserted > 0) {
    // Snapshot first so the whole insertion is revertable via the existing
    // revision-revert endpoint, exactly like whole-chapter regeneration.
    await snapshotChapterBeforeRegen(input.course, input.chapterId, input.request, "插图插入前的自动快照");
    await updateServerChapter(input.course, input.chapterId, { content: insertion.content }, input.request);
  }

  return {
    status: "ok",
    inserted: insertion.inserted,
    illustrations: prepared.map((item) => ({ caption: item.caption, url: item.url })),
    skipped: [...skipped, ...insertion.skipped],
  };
}

async function downloadIllustration(url: string, timeoutMs: number) {
  const response = await fetchWithTimeout(url, {}, timeoutMs);
  if (!response.ok) {
    throw new Error(`Illustration download failed with status ${response.status}.`);
  }
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  const ext = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: ext === "png" ? "image/png" : contentType,
    ext,
  };
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  if (!response.ok) {
    throw new Error(`Illustration API returned status ${response.status}.`);
  }
  return response.json() as Promise<unknown>;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function ensureIllustrationsBucket(supabase: NonNullable<ReturnType<typeof createSupabaseServiceClient>>) {
  // Beta: the bucket is provisioned at runtime instead of in schema.sql; fold
  // it into the schema contract (with a version bump) when this feature GAs.
  const { error } = await supabase.storage.createBucket(ILLUSTRATIONS_BUCKET, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  });
  if (error && !/already exist|duplicate/iu.test(error.message ?? "")) {
    throw new Error(`Illustration bucket create failed: ${error.message}`);
  }
}

function localIllustrationPath(storagePath: string) {
  const target = resolvePath(localIllustrationStoreDir, storagePath);
  if (!target.startsWith(`${localIllustrationStoreDir}${sep}`)) {
    throw new Error("Invalid illustration storage path.");
  }
  return target;
}

function contentTypeForPath(storagePath: string) {
  if (storagePath.endsWith(".jpg")) return "image/jpeg";
  if (storagePath.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function findParagraphEnd(content: string, from: number) {
  const pattern = /\n[ \t]*\n/gu;
  pattern.lastIndex = from;
  const hit = pattern.exec(content);
  return hit ? hit.index : content.length;
}

function isInsideFencedBlock(content: string, offset: number) {
  const before = content.slice(0, offset);
  const fenceCount = (before.match(/^[ \t]*(?:```|~~~)/gmu) ?? []).length;
  if (fenceCount % 2 === 1) return true;
  const mathCount = (before.match(/^[ \t]*\$\$[ \t]*$/gmu) ?? []).length;
  return mathCount % 2 === 1;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
