import { AgentName } from "./types";

const DEFAULT_AI_BASE_URL = "https://api.yzccc.cloud/v1";
const DEFAULT_AI_MODEL = "gpt-5.5";

export function isMockMode() {
  return process.env.AI_MOCK_MODE === "true" || !process.env.AI_API_KEY;
}

export function getBaseAIConfig() {
  return {
    apiKey: process.env.AI_API_KEY ?? "",
    baseUrl: trimSlash(process.env.AI_API_BASE_URL ?? DEFAULT_AI_BASE_URL),
    model: process.env.AI_MODEL ?? DEFAULT_AI_MODEL,
    temperature: readNumber(process.env.AI_TEMPERATURE, 0.45),
    maxTokens: readNumber(process.env.AI_MAX_TOKENS, 32768),
    timeoutMs: readNumber(process.env.AI_TIMEOUT_MS, 120_000),
  };
}

export function getAgentConfig(agent: AgentName) {
  const prefix = agent;
  const base = getBaseAIConfig();

  return {
    agent,
    apiKey: process.env[`${prefix}_API_KEY`] || base.apiKey,
    baseUrl: trimSlash(process.env[`${prefix}_API_BASE_URL`] || base.baseUrl),
    model: process.env[`${prefix}_MODEL`] || base.model,
    temperature: readNumber(process.env[`${prefix}_TEMPERATURE`], base.temperature),
    maxTokens: readNumber(process.env[`${prefix}_MAX_TOKENS`], base.maxTokens),
    timeoutMs: readNumber(process.env[`${prefix}_TIMEOUT_MS`], base.timeoutMs),
  };
}

export function hasSupabaseServerConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function hasAnySupabaseAuthConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function getSupabaseExportsBucket() {
  return process.env.SUPABASE_EXPORTS_BUCKET || "learnbyai-exports";
}

export function isTrustedInternalWorkerRequest(request?: Request) {
  const secret = process.env.INTERNAL_WORKER_SECRET;
  if (!secret || !request) return false;

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const headerSecret = request.headers.get("x-internal-worker-secret");
  return bearer === secret || headerSecret === secret;
}

export function canRunInternalWorkerRequest(request: Request) {
  const secret = process.env.INTERNAL_WORKER_SECRET;
  if (!secret) return !hasAnySupabaseAuthConfig();
  return isTrustedInternalWorkerRequest(request);
}

export function shouldRunInlineGeneration(request?: Request) {
  if (process.env.GENERATION_WORKER_MODE === "external") return false;
  if (process.env.AI_MOCK_MODE === "true" && request?.headers.get("x-learnbyai-worker-mode") === "external") {
    return false;
  }
  return true;
}

function readNumber(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function trimSlash(value: string) {
  return value.replace(/\/$/, "");
}
