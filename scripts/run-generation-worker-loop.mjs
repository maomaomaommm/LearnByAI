import { setTimeout as delay } from "node:timers/promises";
import "./load-env.mjs";
import { runGenerationWorkerOnce } from "./run-generation-worker-once.mjs";

const idleMs = readPositiveInteger(process.env.GENERATION_WORKER_IDLE_MS, 5_000);
const errorMs = readPositiveInteger(process.env.GENERATION_WORKER_ERROR_MS, 15_000);
const concurrency = Math.min(readPositiveInteger(process.env.GENERATION_WORKER_CONCURRENCY, 1), 4);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
  });
}

await recoverInterruptedJobs();

const workers = Array.from({ length: concurrency }, (_, index) => runWorkerSlot(index + 1));
await Promise.all(workers);

async function runWorkerSlot(slot) {
  if (slot > 1) await delay(Math.min((slot - 1) * 1_000, idleMs));
  while (!stopping) {
    try {
      const result = await runGenerationWorkerOnce({ limit: process.env.GENERATION_WORKER_LIMIT ?? "8" });
      const processed = Number(result?.processed ?? 0);
      const scanned = Number(result?.scanned ?? 0);
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          slot,
          scanned,
          processed,
        }),
      );
      if (processed === 0 || scanned === 0) await delay(idleMs);
    } catch (error) {
      console.error(JSON.stringify({
        at: new Date().toISOString(),
        slot,
        error: error instanceof Error ? error.message : String(error),
      }));
      await delay(errorMs);
    }
  }
}

function readPositiveInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function recoverInterruptedJobs() {
  const maxAttempts = readPositiveInteger(process.env.GENERATION_WORKER_RECOVER_ATTEMPTS, 12);
  for (let attempt = 1; attempt <= maxAttempts && !stopping; attempt += 1) {
    try {
      const result = await runGenerationWorkerOnce({ recover: "true" });
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          recovered: Number(result?.recovered ?? 0),
          phase: "recover",
        }),
      );
      return;
    } catch (error) {
      console.error(JSON.stringify({
        at: new Date().toISOString(),
        attempt,
        error: error instanceof Error ? error.message : String(error),
        phase: "recover",
      }));
      await delay(Math.min(errorMs, idleMs));
    }
  }
}
