import "server-only";

/**
 * 从用户上传的文件中提取纯文本，供课程生成 prompt 作为参考资料。
 * 只用于本次生成，不落库、不持久化。
 *
 * 支持格式：txt / md / pdf / docx
 * 解析失败时返回空字符串而非抛错，避免单个坏文件阻断整个课程创建流程。
 */

/** 单文件提取文本的字符上限，防止 prompt 过长。 */
const MAX_CHARS_PER_FILE = 12_000;

/** 所有文件合并后的总字符上限。 */
const MAX_TOTAL_CHARS = 24_000;

export async function extractFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".txt") || name.endsWith(".md")) {
      return truncate(await file.text());
    }
    if (name.endsWith(".pdf")) {
      return truncate(await extractPdf(file));
    }
    if (name.endsWith(".docx")) {
      return truncate(await extractDocx(file));
    }
    console.warn(`[fileExtract] 不支持的文件类型，已跳过: ${file.name}`);
    return "";
  } catch (error) {
    console.warn(`[fileExtract] 解析失败，已跳过 ${file.name}:`, error);
    return "";
  }
}

/** 合并多个文件的提取结果，带文件名分隔与总量截断。 */
export async function extractFilesText(files: File[]): Promise<string | undefined> {
  if (!files.length) return undefined;

  const parts: string[] = [];
  let total = 0;
  for (const file of files) {
    const text = (await extractFileText(file)).trim();
    if (!text) continue;
    const block = `【文件：${file.name}】\n${text}`;
    if (total + block.length > MAX_TOTAL_CHARS) {
      const remaining = Math.max(0, MAX_TOTAL_CHARS - total);
      if (remaining > 0) {
        parts.push(block.slice(0, remaining) + "\n…（已达参考资料总量上限，后续文件已截断）");
      }
      break;
    }
    parts.push(block);
    total += block.length;
  }

  const merged = parts.join("\n\n---\n\n").trim();
  return merged || undefined;
}

function truncate(text: string): string {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (cleaned.length <= MAX_CHARS_PER_FILE) return cleaned;
  return cleaned.slice(0, MAX_CHARS_PER_FILE) + "\n…（该文件内容已截断）";
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
