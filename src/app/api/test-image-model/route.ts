import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { normalizeModelOverrides } from "@/lib/modelOverrides";
import { redactSecrets } from "@/lib/safeError";
import { resolveModelOverrides } from "@/lib/userModelConfig";
import type { ModelOverrideFields, ModelOverrides } from "@/lib/modelOverrides";

const IMAGE_MODEL_TEST_TIMEOUT_MS = readPositiveInteger(process.env.IMAGE_MODEL_TEST_TIMEOUT_MS, 60_000);

export async function POST(request: Request) {
  try {
    const auth = await requireApiUser(request);
    if ("response" in auth) return auth.response;

    const body = await request.json().catch(() => ({}));
    const resolved = await resolveImageTestConfig(body, auth.userId);
    if ("error" in resolved) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: 400 });
    }

    const { config } = resolved;
    if (!config.apiKey || !config.baseUrl || !config.model) {
      return NextResponse.json(
        { ok: false, error: "Image API key, base URL and model are required." },
        { status: 400 },
      );
    }

    const endpoint = imagesGenerationsUrl(config.baseUrl);
    const start = Date.now();
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "LearnByAI/0.1 image-model-test",
      },
      body: JSON.stringify({
        model: config.model,
        prompt: "A tiny clean textbook-style diagram of a single concept node, white background, no watermark.",
        n: 1,
        response_format: "url",
      }),
      signal: AbortSignal.timeout(IMAGE_MODEL_TEST_TIMEOUT_MS),
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

    const parsed = parseImageResponse(text);
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

    return NextResponse.json({ ok: true, elapsed, endpoint: publicEndpoint(endpoint) });
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return NextResponse.json({
        ok: false,
        error: `Image model test timed out after ${IMAGE_MODEL_TEST_TIMEOUT_MS}ms.`,
      });
    }
    const message = error instanceof Error ? error.message : "Image model test failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

type ImageConfig = Required<Pick<ModelOverrideFields, "apiKey" | "baseUrl" | "model">>;

async function resolveImageTestConfig(
  body: unknown,
  userId: string,
): Promise<{ config: Partial<ImageConfig> } | { error: string }> {
  const record = isRecord(body) ? body : {};
  const overrides = normalizeModelOverrides(record.overrides);
  const fields = readFields(record.fields) ?? readFields(record);
  const taskOverrides: ModelOverrides | undefined = fields
    ? { version: 1, image: fields }
    : overrides;
  const effective = await resolveModelOverrides(userId, taskOverrides);
  return { config: effective?.image ?? {} };
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

function imagesGenerationsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/u, "");
  if (/\/v1\/images\/generations$/u.test(normalized)) return normalized;
  if (/\/v1$/u.test(normalized)) return `${normalized}/images/generations`;
  return `${normalized}/v1/images/generations`;
}

function parseImageResponse(text: string): { ok: true } | { ok: false } {
  try {
    const parsed = JSON.parse(text) as { data?: { url?: string; b64_json?: string }[] };
    const item = parsed.data?.[0];
    return item?.url || item?.b64_json ? { ok: true } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function providerErrorMessage(status: number, statusText: string, contentType: string, text: string) {
  const preview = responsePreview(text);
  if (/html/i.test(contentType) || /^\s*</u.test(text)) {
    return `Provider returned HTTP ${status} HTML instead of JSON. Check the image base URL.`;
  }
  if (preview) return `Provider returned HTTP ${status}: ${preview}`;
  return `Provider returned HTTP ${status}${statusText ? ` ${statusText}` : ""}.`;
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
