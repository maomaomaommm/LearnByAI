import { spawn } from "node:child_process";

export const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

const supabaseKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SMOKE_RLS",
  "SUPABASE_SMOKE_REQUIRED",
  "SUPABASE_SMOKE_USER_ID",
  "WORKER_HANDOFF_REQUIRED",
];

const aiKeys = [
  "AI_API_KEY",
  "ARCHITECT_API_KEY",
  "AUTHOR_API_KEY",
  "POLISHER_API_KEY",
  "REVIEWER_API_KEY",
  "TUTOR_API_KEY",
];

export function createLocalGateEnv(base = process.env) {
  const env = normalizeEnv({
    ...base,
    AI_API_BASE_URL: base.AI_API_BASE_URL ?? "https://api.yzccc.cloud/v1",
    AI_MODEL: base.AI_MODEL ?? "gpt-5.5",
    AI_MOCK_MODE: "true",
    AI_SMOKE: "",
    BETA_READINESS_STRICT: "",
    GENERATION_WORKER_MODE: "inline",
    INTERNAL_WORKER_SECRET: base.INTERNAL_WORKER_SECRET || "e2e-worker-secret",
  });

  for (const key of [...supabaseKeys, ...aiKeys]) {
    env[key] = "";
  }

  return env;
}

export function createBetaGateEnv(base = process.env) {
  return normalizeEnv({
    ...base,
    AI_MOCK_MODE: "false",
    AI_SMOKE: "true",
    AI_SMOKE_REQUIRED: "true",
    BETA_READINESS_STRICT: "true",
    SUPABASE_SMOKE_REQUIRED: "true",
    SUPABASE_SMOKE_RLS: "true",
    WORKER_HANDOFF_REQUIRED: "true",
  });
}

export function npmStep(label, script, env) {
  const args = ["run", script];
  return process.platform === "win32"
    ? {
        label,
        command: "cmd.exe",
        args: ["/d", "/s", "/c", [npmBin, ...args].join(" ")],
        display: [npmBin, ...args].join(" "),
        env,
      }
    : {
        label,
        command: npmBin,
        args,
        env,
      };
}

export async function runSteps(steps, { dryRun = false } = {}) {
  for (const step of steps) {
    console.log(`[gate] ${step.label}: ${formatStep(step)}`);
    if (dryRun) continue;

    const code = await runStep(step);
    if (code !== 0) {
      console.error(`[gate] ${step.label} failed with exit code ${code}.`);
      return code;
    }
  }

  return 0;
}

export function formatStep(step) {
  return step.display ?? [step.command, ...step.args].join(" ");
}

function runStep(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: process.cwd(),
      env: normalizeEnv(step.env ?? process.env),
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export function normalizeEnv(env) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => key && !key.includes("=") && value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}
