import "server-only";

import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 300_000;

export class TeXCompileError extends Error {
  engine?: string;
  log?: string;
  projectDir?: string;

  constructor(message: string, options: { engine?: string; log?: string; projectDir?: string } = {}) {
    super(message);
    this.name = "TeXCompileError";
    this.engine = options.engine;
    this.log = options.log;
    this.projectDir = options.projectDir;
  }
}

export async function compileLatexProject(mainTexPath: string, options: {
  timeoutMs?: number;
  engine?: string;
} = {}) {
  const timeoutMs = options.timeoutMs ?? readPositiveInteger(process.env.LEARNBYAI_TEX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const projectDir = dirname(mainTexPath);
  const outputDir = join(projectDir, "build");
  await mkdir(outputDir, { recursive: true });
  const engines = options.engine
    ? [options.engine]
    : preferredEngines(process.env.LEARNBYAI_TEX_ENGINE);
  const usable = [];

  for (const engine of engines) {
    if (await canRun(engine)) usable.push(engine);
  }

  if (usable.length === 0) {
    throw new TeXCompileError(
      "TeX engine not found. Install TeX Live/MiKTeX with xelatex or latexmk, or set LEARNBYAI_TEX_ENGINE.",
      { projectDir },
    );
  }

  let lastError: TeXCompileError | undefined;
  for (const engine of usable) {
    try {
      await runEngine(engine, mainTexPath, outputDir, timeoutMs);
      const pdfPath = join(outputDir, `${basename(mainTexPath, ".tex")}.pdf`);
      return {
        engine,
        pdf: await readFile(pdfPath),
        log: await readLog(outputDir, mainTexPath),
        projectDir,
      };
    } catch (error) {
      const log = await readLog(outputDir, mainTexPath);
      lastError = new TeXCompileError(
        `TeX compile failed with ${engine}: ${compactError(error)}`,
        { engine, log, projectDir },
      );
    }
  }

  throw lastError ?? new TeXCompileError("TeX compile failed.", { projectDir });
}

function preferredEngines(envEngine?: string) {
  const normalized = envEngine?.trim();
  if (normalized) return [normalized];
  return ["latexmk", "xelatex", "lualatex", "pdflatex", "tectonic"];
}

async function canRun(command: string) {
  try {
    await execFileAsync(command, ["--version"], { timeout: 10_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function runEngine(engine: string, mainTexPath: string, outputDir: string, timeoutMs: number) {
  if (engine === "latexmk") {
    await execFileAsync(
      engine,
      ["-pdfxe", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", `-outdir=${outputDir}`, mainTexPath],
      { cwd: dirname(mainTexPath), timeout: timeoutMs, windowsHide: true },
    );
    return;
  }

  if (engine === "tectonic") {
    await execFileAsync(
      engine,
      ["--keep-logs", "--outdir", outputDir, mainTexPath],
      { cwd: dirname(mainTexPath), timeout: timeoutMs, windowsHide: true },
    );
    return;
  }

  const args = ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", `-output-directory=${outputDir}`, mainTexPath];
  await execFileAsync(engine, args, { cwd: dirname(mainTexPath), timeout: timeoutMs, windowsHide: true });
  // Run twice so table-of-contents and counters settle.
  await execFileAsync(engine, args, { cwd: dirname(mainTexPath), timeout: timeoutMs, windowsHide: true });
}

async function readLog(outputDir: string, mainTexPath: string) {
  try {
    return await readFile(join(outputDir, `${basename(mainTexPath, ".tex")}.log`), "utf8");
  } catch {
    return "";
  }
}

function compactError(error: unknown) {
  if (!error || typeof error !== "object") return String(error);
  const record = error as { message?: string; stdout?: string; stderr?: string };
  return [record.message, record.stderr, record.stdout]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
