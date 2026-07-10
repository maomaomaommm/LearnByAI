import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const localExportStoreDir = resolve(
  process.env.LEARNBYAI_EXPORT_DIR ??
    process.env.LEARNBYAI_LOCAL_EXPORT_DIR ??
    join(tmpdir(), "learnbyai-exports"),
);
const texProjectStoreDir = resolve(process.env.LEARNBYAI_TEX_EXPORT_DIR ?? join(localExportStoreDir, "tex-projects"));

export function getLocalExportStoreDir() {
  return localExportStoreDir;
}

export function getTexProjectStoreDir() {
  return texProjectStoreDir;
}

export function resolveLocalExportPath(storagePath: string | undefined, fallbackName: string) {
  const safeRelativePath = normalizeExportStoragePath(storagePath ?? fallbackName);
  const targetPath = resolve(localExportStoreDir, safeRelativePath);

  if (!isPathInside(localExportStoreDir, targetPath)) {
    throw new Error("Invalid export storage path.");
  }

  return targetPath;
}

export function isPathInside(parentPath: string, childPath: string) {
  const relativePath = relative(parentPath, childPath);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function normalizeExportStoragePath(value: string) {
  const normalized = value.trim().replace(/\\/gu, "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[a-z]:\//iu.test(normalized)) {
    throw new Error("Invalid export storage path.");
  }

  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === ".." || segment.includes(":"))) {
    throw new Error("Invalid export storage path.");
  }

  return segments.join("/");
}
