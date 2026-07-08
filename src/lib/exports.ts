import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getSupabaseExportsBucket, hasSupabaseServerConfig } from "./config";
import { resolveLocalExportPath } from "./exportPaths";
import { createSupabaseServiceClient } from "./supabase/server";
import { renderCoursePdf } from "./pdf";
import { Course, ExportJob } from "./types";

const exportJobs = new Map<string, ExportJob>();
const UNGENERATED_CHAPTER_TEXT = "This chapter has not been generated yet.";

export async function createCourseExport(
  course: Course,
  format: ExportJob["format"],
  userId?: string,
  options: { chapterId?: string } = {},
) {
  const now = new Date().toISOString();
  const exportId = crypto.randomUUID();
  const chapter = options.chapterId
    ? course.chapters.find((item) => item.id === options.chapterId)
    : undefined;
  const content =
    format === "tex" ? toTex(course) : await renderCoursePdf(course.id, { chapterId: chapter?.id });
  const baseName = chapter
    ? `${sanitize(course.topic)}-${sanitize(chapter.title)}`
    : sanitize(course.topic);
  const job: ExportJob = {
    id: exportId,
    userId,
    courseId: course.id,
    format,
    status: "succeeded",
    fileName: `${baseName}.${format}`,
    storagePath: `${pathSegment(userId ?? "local-beta-user")}/${pathSegment(course.id)}/${exportId}.${format}`,
    contentType: format === "tex" ? "application/x-tex" : "application/pdf",
    encoding: format === "tex" ? "utf8" : "base64",
    createdAt: now,
    updatedAt: now,
  };

  await writeExportContent(job, content);
  exportJobs.set(job.id, job);
  return job;
}

export function getExportJob(id: string) {
  return exportJobs.get(id);
}

export async function readExportContent(job: ExportJob) {
  if (job.content) {
    return job.encoding === "base64"
      ? Buffer.from(job.content, "base64")
      : Buffer.from(job.content, "utf8");
  }

  if (job.storageProvider === "supabase" && job.storagePath) {
    const remote = await readSupabaseExportContent(job);
    if (remote) return remote;
  }

  return readFile(localExportPath(job));
}

async function writeExportContent(job: ExportJob, content: string | Buffer) {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const remoteStored = await writeSupabaseExportContent(job, bytes);
  if (remoteStored) {
    job.storageProvider = "supabase";
    return;
  }

  if (hasSupabaseServerConfig() && isUuid(job.userId)) {
    throw new Error("Supabase export upload failed.");
  }

  job.storageProvider = "local";
  const path = localExportPath(job);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function writeSupabaseExportContent(job: ExportJob, bytes: Buffer) {
  if (!job.storagePath) return false;
  if (!isUuid(job.userId)) return false;
  const supabase = createSupabaseServiceClient();
  if (!supabase) return false;

  const { error } = await supabase.storage
    .from(getSupabaseExportsBucket())
    .upload(job.storagePath, bytes, {
      contentType: job.contentType ?? "application/octet-stream",
      upsert: true,
    });

  if (error) {
    throw new Error(`Supabase export upload failed: ${error.message}`);
  }

  return !error;
}

async function readSupabaseExportContent(job: ExportJob) {
  if (!job.storagePath) return undefined;
  const supabase = createSupabaseServiceClient();
  if (!supabase) return undefined;

  const { data, error } = await supabase.storage
    .from(getSupabaseExportsBucket())
    .download(job.storagePath);
  if (error) {
    throw new Error(`Supabase export download failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("Supabase export download failed: no data returned.");
  }

  return Buffer.from(await data.arrayBuffer());
}

function localExportPath(job: ExportJob) {
  return resolveLocalExportPath(job.storagePath, `${job.id}.${job.format}`);
}

function toTex(course: Course) {
  const chapters = course.chapters
    .map((chapter) => `\\section{${escapeTex(chapter.title)}}\n${escapeTex(chapter.content ?? UNGENERATED_CHAPTER_TEXT)}`)
    .join("\n\n");
  return `\\documentclass{article}
\\usepackage{ctex}
\\begin{document}
\\title{${escapeTex(course.topic)}}
\\maketitle
${chapters}
\\end{document}
`;
}

function sanitize(value: string) {
  return value.replace(/[^\w\u4e00-\u9fa5-]+/gu, "-").replace(/-+/gu, "-");
}

function pathSegment(value: string) {
  return value.replace(/[^\w-]+/gu, "-").replace(/-+/gu, "-").slice(0, 120);
}

function escapeTex(value: string) {
  return value.replace(/[&%$#_{}]/gu, (char) => `\\${char}`);
}

function isUuid(value?: string) {
  return Boolean(
    value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  );
}
