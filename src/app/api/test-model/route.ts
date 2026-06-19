import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { chatCompletionsUrl } from "@/lib/aiEndpoint";
import { getAgentConfig, getBaseAIConfig } from "@/lib/config";
import {
  MODEL_AGENT_NAMES,
  normalizeModelOverrides,
} from "@/lib/modelOverrides";
import { redactSecrets } from "@/lib/safeError";
import { resolveModelOverrides } from "@/lib/userModelConfig";
import type { ModelOverrideFields, ModelOverrides } from "@/lib/modelOverrides";
import type { AgentName } from "@/lib/types";

const MODEL_TEST_TIMEOUT_MS = readPositiveInteger(process.env.MODEL_TEST_TIMEOUT_MS, 30_000);

export async function POST(request: Request) {
  try {
    const auth = await requireApiUser(request);
    if ("response" in auth) return auth.response;

    const body = await request.json().catch(() => ({}));
    const resolved = await resolveTestConfig(body, auth.userId);

    if ("error" in resolved) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: 400 });
    }

    const { config } = resolved;
    if (!config.apiKey) {
      return NextResponse.json({ ok: false, error: "AI API key is not configured." }, { status: 400 });
    }
    if (!config.model) {
      return NextResponse.json({ ok: false, error: "AI model is not configured." }, { status: 400 });
    }

    const endpoint = chatCompletionsUrl(config.baseUrl);
    const start = Date.now();
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "LearnByAI/0.1 model-test",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
        stream: false,
      }),
      signal: AbortSignal.timeout(MODEL_TEST_TIMEOUT_MS),
    });

    const elapsed = Date.now() - start;
    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        error: providerErrorMessage(res.status, res.statusText, contentType, text),
        providerStatus: res.status,
        endpoint: publicEndpoint(endpoint),
        elapsed,
        bodyPreview: responsePreview(text),
      });
    }

    const parsed = parseProviderJson(text);
    if (!parsed.ok) {
      return NextResponse.json({
        ok: false,
        error: providerErrorMessage(res.status, res.statusText, contentType, text),
        providerStatus: res.status,
        endpoint: publicEndpoint(endpoint),
        elapsed,
        bodyPreview: responsePreview(text),
      });
    }

    return NextResponse.json({ ok: true, elapsed, endpoint: publicEndpoint(endpoint), data: parsed.data });
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return NextResponse.json(
        { ok: false, error: `Model test timed out after ${MODEL_TEST_TIMEOUT_MS}ms.` }
      );
    }
    const message = error instanceof Error ? error.message : "Model test failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

type TestConfig = ReturnType<typeof getBaseAIConfig>;

async function resolveTestConfig(body: unknown, userId: string): Promise<{ config: TestConfig } | { error: string }> {
  const record = isRecord(body) ? body : {};
  const agent = readAgent(record.agent);
  if (record.agent && record.agent !== "default" && !agent) {
    return { error: "Unknown model agent." };
  }

  const overrides = normalizeModelOverrides(record.overrides);
  const fields = readFields(record.fields) ?? readFields(record);
  const taskOverrides = overrides ?? fieldsToOverrides(agent, fields);
  const effectiveOverrides = await resolveModelOverrides(userId, taskOverrides);

  return {
    config: agent ? getAgentConfig(agent, effectiveOverrides) : getBaseAIConfig(effectiveOverrides),
  };
}

function readAgent(value: unknown): AgentName | undefined {
  return typeof value === "string" && MODEL_AGENT_NAMES.includes(value as AgentName)
    ? (value as AgentName)
    : undefined;
}

function readFields(value: unknown): ModelOverrideFields | undefined {
  if (!isRecord(value)) return undefined;

  const fields: ModelOverrideFields = {};
  const apiKey = readString(value.apiKey);
  const baseUrl = readString(value.baseUrl);
  const model = readString(value.model);

  if (apiKey) fields.apiKey = apiKey;
  if (baseUrl) fields.baseUrl = baseUrl;
  if (model) fields.model = model;

  return Object.keys(fields).length > 0 ? fields : undefined;
}

function fieldsToOverrides(agent: AgentName | undefined, fields: ModelOverrideFields | undefined): ModelOverrides | undefined {
  if (!fields) return undefined;
  if (!agent) return { version: 1, default: fields };
  return { version: 1, agents: { [agent]: fields } };
}

function providerErrorMessage(status: number, statusText: string, contentType: string, text: string) {
  const preview = responsePreview(text);
  if (looksLikeHtml(contentType, text)) {
    return `Provider returned HTTP ${status} HTML instead of JSON. Check the base URL endpoint or whether the provider blocks this server IP.`;
  }
  if (preview) return `Provider returned HTTP ${status}: ${preview}`;
  return `Provider returned HTTP ${status}${statusText ? ` ${statusText}` : ""}.`;
}

function parseProviderJson(text: string): { ok: true; data: unknown } | { ok: false } {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function responsePreview(text: string) {
  return redactSecrets(text).replace(/\s+/gu, " ").trim().slice(0, 240);
}

function publicEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return endpoint;
  }
}

function looksLikeHtml(contentType: string, text: string) {
  return /html/i.test(contentType) || /^\s*</u.test(text);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
