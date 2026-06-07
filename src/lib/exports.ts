import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getSupabaseExportsBucket, hasSupabaseServerConfig } from "./config";
import { resolveLocalExportPath } from "./exportPaths";
import { createSupabaseServiceClient } from "./supabase/server";
import { Course, ExportJob } from "./types";

const exportJobs = new Map<string, ExportJob>();
const UNGENERATED_CHAPTER_TEXT = "This chapter has not been generated yet.";

export async function createCourseExport(course: Course, format: ExportJob["format"], userId?: string) {
  const now = new Date().toISOString();
  const exportId = crypto.randomUUID();
  const content = format === "tex" ? toTex(course) : createPdfBytes(toPdfText(course));
  const job: ExportJob = {
    id: exportId,
    userId,
    courseId: course.id,
    format,
    status: "succeeded",
    fileName: `${sanitize(course.topic)}.${format}`,
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

function toPdfText(course: Course) {
  return [
    `LearnByAI Export: ${course.topic}`,
    course.goal,
    ...course.chapters.map((chapter) => `\n# ${chapter.title}\n${chapter.content ?? UNGENERATED_CHAPTER_TEXT}`),
  ].join("\n\n");
}

function createPdfBytes(text: string) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((line) => wrapLine(line, 82))
    .slice(0, 120);
  const stream = [
    "BT",
    "/F1 10 Tf",
    "50 790 Td",
    "14 TL",
    ...lines.map((line, index) => `${index === 0 ? "" : "T* "}${pdfString(line)} Tj`),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function wrapLine(line: string, width: number) {
  if (!line) return [""];
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += width) {
    chunks.push(line.slice(index, index + width));
  }
  return chunks;
}

function pdfString(value: string) {
  const ascii = value.replace(/[^\x20-\x7E]/g, "?");
  return `(${ascii.replace(/[()\\]/g, "\\$&")})`;
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
