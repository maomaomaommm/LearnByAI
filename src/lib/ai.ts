import "server-only";

import { headers } from "next/headers";
import { chatCompletionsUrl } from "./aiEndpoint";
import { getAgentConfig, getBaseAIConfig } from "./config";
import { getAdminAppSettings, mergeModelOverrides } from "./adminSettings";
import { ModelOverrides, parseModelOverridesFromHeaders } from "./modelOverrides";
import { safeErrorMessage } from "./safeError";
import { AgentName } from "./types";

export const MODEL = getBaseAIConfig().model;

export function hasAI() {
  return Boolean(getBaseAIConfig().apiKey);
}

export async function generateText(
  prompt: string,
  options?: {
    agent?: AgentName;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    maxAttempts?: number;
    stream?: boolean;
    responseFormat?: "json_object";
    overrides?: ModelOverrides;
  },
) {
  const overrides = await getEffectiveModelOverrides(options?.overrides);
  const config = options?.agent ? getAgentConfig(options.agent, overrides) : getBaseAIConfig(overrides);
  if (!config.apiKey) throw new Error("AI_API_KEY is not configured");

  const maxAttempts = normalizeMaxAttempts(options?.maxAttempts);
  let lastError = "";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const requestTimeoutMs = options?.timeoutMs ?? config.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    const endpoint = chatCompletionsUrl(config.baseUrl);
    const stream = completionStream(config.model, options?.stream);
    const canRetry = attempt < maxAttempts - 1;
    try {
      logModelRequest({
        agent: options?.agent ?? "default",
        model: config.model,
        endpoint,
        stream,
        attempt: attempt + 1,
        mode: "primary",
      });
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: stream ? "application/json, text/event-stream" : "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(completionBody(prompt, options, config, stream)),
        signal: controller.signal,
      });

      if (response.ok) {
        if (response.headers.get("content-type")?.includes("text/event-stream")) {
          let fullText = "";
          try {
            fullText = await readStreamingCompletion(response, controller.signal);
          } catch (error) {
            lastError = safeErrorMessage(error, `${config.model} stream interrupted`);
            const fallbackText = await requestNonStreamingCompletion(prompt, options, config, requestTimeoutMs).catch((fallbackError) => {
              lastError = safeErrorMessage(fallbackError, lastError);
              return "";
            });
            if (fallbackText) return fallbackText;
            if (canRetry && isTransientAIError(error)) {
              await waitForRetry(attempt);
              continue;
            }
            throw new Error(lastError);
          }
          if (!fullText) {
            lastError = `${config.model} returned an empty stream response`;
            const fallbackText = await requestNonStreamingCompletion(prompt, options, config, requestTimeoutMs).catch((error) => {
              lastError = safeErrorMessage(error, lastError);
              return "";
            });
            if (fallbackText) return fallbackText;
            if (canRetry) {
              await waitForRetry(attempt);
              continue;
            }
            throw new Error(lastError);
          }
          return fullText;
        }

        const data = await response.json();
        const text = extractCompletionText(data);
        if (!text) {
          lastError = `${config.model} returned an empty response`;
          if (canRetry) {
            await waitForRetry(attempt);
            continue;
          }
          throw new Error(lastError);
        }
        return text as string;
      }

      const body = await response.text();
      if (options?.responseFormat && attempt === 0 && isResponseFormatUnsupported(response.status, body)) {
        return generateText(prompt, {
          ...options,
          responseFormat: undefined,
        });
      }
      lastError = `${response.status} ${safeErrorMessage(body, response.statusText || "provider error")}`;
      if (![429, 500, 502, 503, 504].includes(response.status) || !canRetry) break;
      await waitForRetry(attempt);
    } catch (error) {
      if (isAbortError(error)) {
        lastError = `request timed out after ${requestTimeoutMs}ms`;
        break;
      }
      lastError = safeErrorMessage(error, `${config.model} request interrupted`);
      if (canRetry && isTransientAIError(error)) {
        await waitForRetry(attempt);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`${config.model} request failed: ${lastError}`);
}

type AIConfig = ReturnType<typeof getBaseAIConfig>;

async function requestNonStreamingCompletion(
  prompt: string,
  options: Parameters<typeof generateText>[1],
  config: AIConfig,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = chatCompletionsUrl(config.baseUrl);
  try {
    logModelRequest({
      agent: options?.agent ?? "default",
      model: config.model,
      endpoint,
      stream: false,
      attempt: 1,
      mode: "fallback",
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(completionBody(prompt, options, config, false)),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      if (options?.responseFormat && isResponseFormatUnsupported(response.status, body)) {
        return requestNonStreamingCompletion(prompt, {
          ...options,
          responseFormat: undefined,
        }, config, timeoutMs);
      }
      throw new Error(`${response.status} ${safeErrorMessage(body, response.statusText || "provider error")}`);
    }

    const data = await response.json();
    const text = extractCompletionText(data);
    if (!text) throw new Error(`${config.model} returned an empty non-stream response`);
    return text;
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function completionBody(
  prompt: string,
  options: Parameters<typeof generateText>[1],
  config: AIConfig,
  stream: boolean,
) {
  return {
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    temperature: compatibleTemperature(config.model, options?.temperature ?? config.temperature),
    max_tokens: options?.maxTokens ?? config.maxTokens,
    stream,
    ...(options?.responseFormat === "json_object" ? { response_format: { type: "json_object" } } : {}),
    ...thinkingPayload(config.thinking),
  };
}

function isResponseFormatUnsupported(status: number, body: string) {
  return [400, 422].includes(status) && /response_format|json_object|json\s*mode|unsupported|unknown/i.test(body);
}

function compatibleTemperature(model: string, temperature: number) {
  if (model.trim().toLowerCase() === "kimi-k2.6-full") return 1;
  return temperature;
}

function completionStream(_model: string, requested: boolean | undefined) {
  if (requested !== undefined) return requested;
  return true;
}

function waitForRetry(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
}

function normalizeMaxAttempts(value: number | undefined) {
  if (value === undefined) return 3;
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.floor(value)));
}

async function readStreamingCompletion(response: Response, signal: AbortSignal) {
  let fullText = "";
  const reader = response.body?.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ") || trimmed === "data: [DONE]") return;
    try {
      const parsed = JSON.parse(trimmed.slice(6));
      const content = extractCompletionText(parsed);
      if (content) fullText += content;
    } catch {
      // Ignore malformed provider keepalive chunks.
    }
  };

  if (reader) {
    const cancelReader = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", cancelReader, { once: true });
    try {
      while (true) {
        throwIfAborted(signal);
        const { done, value } = await reader.read();
        throwIfAborted(signal);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
      }
    } finally {
      signal.removeEventListener("abort", cancelReader);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeLine(buffer);
  }

  return fullText;
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted.", "AbortError");
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /abort|aborted/i.test(error.message));
}

function isTransientAIError(error: unknown) {
  const message = errorText(error);
  return /fetch failed|terminated|socket|network|econnreset|etimedout|eai_again|und_err|other side closed/i.test(message);
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error ?? "");
  const cause = (error as Error & { cause?: unknown }).cause;
  return `${error.name} ${error.message} ${cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause ?? "")}`;
}

function extractCompletionText(data: unknown) {
  const choice = (data as { choices?: Array<Record<string, unknown>> })?.choices?.[0];
  if (!choice) return "";
  const delta = choice.delta as { content?: unknown } | undefined;
  const message = choice.message as { content?: unknown } | undefined;
  const text = choice.text;
  if (typeof delta?.content === "string") return delta.content;
  if (typeof message?.content === "string") return message.content;
  if (typeof text === "string") return text;
  return "";
}

async function getRequestModelOverrides() {
  try {
    return parseModelOverridesFromHeaders(await headers());
  } catch {
    return undefined;
  }
}

async function getEffectiveModelOverrides(explicitOverrides: ModelOverrides | undefined) {
  const requestOverrides = explicitOverrides ?? await getRequestModelOverrides();
  const settings = await getAdminAppSettings();
  return mergeModelOverrides(requestOverrides, settings.modelOverrides);
}

function thinkingPayload(thinking: "disabled" | "enabled" | "auto") {
  if (thinking === "enabled") {
    return { thinking: { type: thinking } };
  }
  return {};
}

function logModelRequest(input: {
  agent: AgentName | "default";
  model: string;
  endpoint: string;
  stream: boolean;
  attempt: number;
  mode: "primary" | "fallback";
}) {
  if (process.env.AI_REQUEST_LOGS === "false") return;
  console.info(JSON.stringify({
    event: "learnbyai.ai_request",
    at: new Date().toISOString(),
    agent: input.agent,
    model: input.model,
    endpoint: publicEndpoint(input.endpoint),
    stream: input.stream,
    attempt: input.attempt,
    mode: input.mode,
  }));
}

function publicEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid-endpoint]";
  }
}

export function parseJson<T>(text: string): T {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const object = text.match(/\{[\s\S]*\}/);
  const cleaned = fenced?.[1] ?? object?.[0] ?? text;
  return JSON.parse(cleaned) as T;
}
