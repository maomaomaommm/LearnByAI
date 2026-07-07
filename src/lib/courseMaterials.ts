import "server-only";

import { CourseInputMaterial, CourseMaterialPurpose, CourseMaterialRole } from "./types";

const MAX_FILES = 6;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_CHARS_PER_FILE = 12_000;

const ROLE_LIMITS: Record<CourseMaterialRole, number> = {
  requirements: 12_000,
  reference: 16_000,
  style: 6_000,
};

const ALLOWED_EXTENSIONS = new Set([".txt", ".md", ".pdf", ".docx"]);

export type CourseMaterialInput = {
  file: File;
  purpose?: CourseMaterialPurpose | string;
};

export type CourseMaterialBundle = {
  courseRequirements?: string;
  referenceMaterial?: string;
  styleSample?: string;
  inputMaterials: CourseInputMaterial[];
};

type ExtractedText = {
  text: string;
  truncated: boolean;
};

export async function extractCourseMaterials(inputs: CourseMaterialInput[]): Promise<CourseMaterialBundle> {
  const limitedInputs = inputs.slice(0, MAX_FILES);
  const inputMaterials: CourseInputMaterial[] = [];
  const buckets: Record<CourseMaterialRole, string[]> = {
    requirements: [],
    reference: [],
    style: [],
  };
  const lengths: Record<CourseMaterialRole, number> = {
    requirements: 0,
    reference: 0,
    style: 0,
  };

  if (inputs.length > MAX_FILES) {
    for (const input of inputs.slice(MAX_FILES)) {
      inputMaterials.push(skippedMaterial(input.file, normalizePurpose(input.purpose), `最多支持 ${MAX_FILES} 个文件。`));
    }
  }

  let totalBytes = 0;
  for (const input of limitedInputs) {
    const purpose = normalizePurpose(input.purpose);
    const file = input.file;
    const extension = fileExtension(file.name);

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      inputMaterials.push(skippedMaterial(file, purpose, "暂不支持该文件类型。"));
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      inputMaterials.push(skippedMaterial(file, purpose, "单个文件超过 8MB。"));
      continue;
    }
    if (totalBytes + file.size > MAX_TOTAL_BYTES) {
      inputMaterials.push(skippedMaterial(file, purpose, "本次上传文件总大小超过 24MB。"));
      continue;
    }

    totalBytes += file.size;
    const extracted = await extractFileText(file, extension);
    if (!extracted.text.trim()) {
      inputMaterials.push(skippedMaterial(file, purpose, "未提取到可用文本。"));
      continue;
    }

    const role = purpose === "auto" ? inferMaterialRole(file.name, extracted.text) : purpose;
    const block = formatMaterialBlock(file.name, role, extracted.text);
    const appended = appendLimited(buckets[role], lengths[role], block, ROLE_LIMITS[role]);
    lengths[role] = appended.length;
    if (appended.text) buckets[role].push(appended.text);

    inputMaterials.push({
      name: file.name,
      size: file.size,
      type: file.type || undefined,
      purpose,
      role,
      status: appended.text ? "used" : "skipped",
      chars: extracted.text.length,
      truncated: extracted.truncated || appended.truncated,
      reason: appended.text ? undefined : `${roleLabel(role)}资料已达本次上限。`,
    });
  }

  return {
    courseRequirements: joinBucket(buckets.requirements),
    referenceMaterial: joinBucket(buckets.reference),
    styleSample: joinBucket(buckets.style),
    inputMaterials,
  };
}

function normalizePurpose(value: unknown): CourseMaterialPurpose {
  return value === "requirements" || value === "reference" || value === "style" ? value : "auto";
}

function skippedMaterial(file: File, purpose: CourseMaterialPurpose, reason: string): CourseInputMaterial {
  return {
    name: file.name,
    size: file.size,
    type: file.type || undefined,
    purpose,
    status: "skipped",
    reason,
  };
}

function fileExtension(name: string) {
  const lower = name.toLowerCase();
  const index = lower.lastIndexOf(".");
  return index >= 0 ? lower.slice(index) : "";
}

async function extractFileText(file: File, extension: string): Promise<ExtractedText> {
  try {
    const text =
      extension === ".pdf"
        ? await extractPdf(file)
        : extension === ".docx"
          ? await extractDocx(file)
          : await file.text();
    return truncateText(cleanText(text));
  } catch (error) {
    console.warn(`[courseMaterials] Failed to extract ${file.name}:`, error);
    return { text: "", truncated: false };
  }
}

function truncateText(text: string): ExtractedText {
  if (text.length <= MAX_CHARS_PER_FILE) return { text, truncated: false };
  return {
    text: `${text.slice(0, MAX_CHARS_PER_FILE).trim()}\n...（该文件内容已截断）`,
    truncated: true,
  };
}

function cleanText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

async function extractPdf(file: File): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const data = new Uint8Array(await file.arrayBuffer());
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

function inferMaterialRole(fileName: string, text: string): CourseMaterialRole {
  const sample = `${fileName}\n${text.slice(0, 2400)}`.toLowerCase();
  if (/目录|大纲|要求|教学目标|课程目标|课程安排|章节安排|syllabus|outline|requirement/u.test(sample)) {
    return "requirements";
  }
  if (/风格|文风|样例|范文|style|tone|sample/u.test(sample)) {
    return "style";
  }
  return "reference";
}

function formatMaterialBlock(fileName: string, role: CourseMaterialRole, text: string) {
  return `【${roleLabel(role)}：${fileName}】\n${text}`;
}

function roleLabel(role: CourseMaterialRole) {
  if (role === "requirements") return "课程要求";
  if (role === "style") return "写作风格样例";
  return "参考资料";
}

function appendLimited(parts: string[], currentLength: number, block: string, limit: number) {
  const separatorLength = parts.length > 0 ? "\n\n---\n\n".length : 0;
  const nextLength = currentLength + separatorLength + block.length;
  if (nextLength <= limit) {
    return { text: block, length: nextLength, truncated: false };
  }

  const suffix = "\n...（该类资料已达本次上限，后续内容已截断）";
  const remaining = limit - currentLength - separatorLength - suffix.length;
  if (remaining <= 0) {
    return { text: "", length: currentLength, truncated: true };
  }

  return {
    text: `${block.slice(0, remaining).trim()}${suffix}`,
    length: limit,
    truncated: true,
  };
}

function joinBucket(parts: string[]) {
  const joined = parts.join("\n\n---\n\n").trim();
  return joined || undefined;
}
