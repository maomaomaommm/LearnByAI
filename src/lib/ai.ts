import "server-only";

import { chatCompletionsUrl } from "./aiEndpoint";
import { getAgentConfig, getBaseAIConfig } from "./config";
import { extractJsonObjectText, repairInvalidJsonEscapes } from "./jsonRepair";
import { ModelOverrides } from "./modelOverrides";
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
    onChunk?: (chunk: string) => void;
  },
) {
  if (process.env.AI_MOCK_MODE === "true") {
    throw new Error("AI_MOCK_MODE enabled; provider calls are disabled");
  }

  const overrides = options?.overrides;
  const config = options?.agent ? getAgentConfig(options.agent, overrides) : getBaseAIConfig(overrides);
  if (!config.apiKey) throw new Error("模型 API Key 未配置，请先在「模型设置」中填写并保存。");

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
          let completion: CompletionExtraction = emptyCompletionExtraction();
          try {
            completion = await readStreamingCompletion(response, controller.signal, options?.onChunk);
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
          if (!completion.text) {
            lastError = emptyCompletionError(config.model, "stream", completion);
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
          if (completion.finishReason === "length") {
            lastError = `${config.model} response truncated by token limit (finish_reason=length)`;
            if (canRetry) {
              await waitForRetry(attempt);
              continue;
            }
            throw new Error(lastError);
          }
          return completion.text;
        }

        const data = await response.json();
        const completion = extractCompletion(data);
        if (!completion.text) {
          lastError = emptyCompletionError(config.model, "response", completion);
          if (canRetry) {
            await waitForRetry(attempt);
            continue;
          }
          throw new Error(lastError);
        }
        if (completion.finishReason === "length") {
          lastError = `${config.model} response truncated by token limit (finish_reason=length)`;
          if (canRetry) {
            await waitForRetry(attempt);
            continue;
          }
          throw new Error(lastError);
        }
        return completion.text;
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
    const completion = extractCompletion(data);
    if (!completion.text) throw new Error(emptyCompletionError(config.model, "non-stream", completion));
    return completion.text;
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
  const responseFormat = options?.responseFormat === "json_object" ? "json_object" : undefined;
  const messages: { role: "system" | "user"; content: string }[] = [{ role: "user", content: prompt }];
  if (responseFormat) {
    messages.unshift({
      role: "system",
      content: "You are a JSON-only API. Return exactly one valid JSON object. Do not include markdown fences, explanations, or any text outside the JSON.",
    });
  }
  return {
    model: config.model,
    messages,
    temperature: compatibleTemperature(config.model, options?.temperature ?? config.temperature, config.thinking),
    max_tokens: options?.maxTokens ?? config.maxTokens,
    stream,
    ...(responseFormat ? { response_format: { type: responseFormat } } : {}),
    ...thinkingPayload(config.model, config.thinking),
  };
}

function isResponseFormatUnsupported(status: number, body: string) {
  return [400, 422].includes(status) && /response_format|json_object|json\s*mode|unsupported|unknown/i.test(body);
}

function compatibleTemperature(
  model: string,
  temperature: number,
  thinking: "disabled" | "enabled" | "auto",
) {
  if (isKimiK27CodeModel(model)) return 1;
  if (isKimiThinkingModel(model) && thinking !== "auto") return 0.6;
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

type CompletionExtraction = {
  text: string;
  reasoningLength: number;
  finishReason?: string;
};

function emptyCompletionExtraction(): CompletionExtraction {
  return { text: "", reasoningLength: 0 };
}

async function readStreamingCompletion(response: Response, signal: AbortSignal, onChunk?: (chunk: string) => void) {
  const completion = emptyCompletionExtraction();
  const reader = response.body?.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") return;
    try {
      const parsed = JSON.parse(data);
      const extracted = extractCompletion(parsed);
      if (extracted.text) {
        completion.text += extracted.text;
        onChunk?.(extracted.text);
      }
      completion.reasoningLength += extracted.reasoningLength;
      if (extracted.finishReason) completion.finishReason = extracted.finishReason;
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

  return completion;
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

function extractCompletion(data: unknown): CompletionExtraction {
  const choice = (data as { choices?: Array<Record<string, unknown>> })?.choices?.[0];
  if (!choice) return emptyCompletionExtraction();
  const delta = choice.delta as { content?: unknown; reasoning_content?: unknown } | undefined;
  const message = choice.message as { content?: unknown; reasoning_content?: unknown } | undefined;
  const text = choice.text;
  const content = typeof delta?.content === "string"
    ? delta.content
    : typeof message?.content === "string"
      ? message.content
      : typeof text === "string"
        ? text
        : "";
  const reasoning = typeof delta?.reasoning_content === "string"
    ? delta.reasoning_content
    : typeof message?.reasoning_content === "string"
      ? message.reasoning_content
      : "";
  const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
  return {
    text: content,
    reasoningLength: reasoning.length,
    finishReason,
  };
}

function emptyCompletionError(model: string, kind: "stream" | "response" | "non-stream", completion: CompletionExtraction) {
  let message = `${model} returned an empty ${kind} response`;
  if (completion.reasoningLength > 0) {
    message += "; provider returned reasoning_content but no content, so thinking mode likely consumed the output tokens. Set thinking to disabled for Kimi thinking models.";
  }
  if (completion.finishReason) {
    message += ` finish_reason=${completion.finishReason}.`;
  }
  return message;
}

function thinkingPayload(model: string, thinking: "disabled" | "enabled" | "auto") {
  if (thinking !== "enabled") return {};
  return { thinking: { type: "enabled" } };
}

function isKimiK27CodeModel(model: string) {
  return /^kimi-k2\.7-code$/i.test(model.trim().toLowerCase());
}

function isKimiThinkingModel(model: string) {
  return /^kimi-k/i.test(model.trim().toLowerCase());
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


function escapeControlCharsInJsonStrings(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? "";
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }
    if (inString) {
      if (char === "\n") {
        result += "\\n";
      } else if (char === "\r") {
        result += "\\r";
      } else if (char === "\t") {
        result += "\\t";
      } else {
        result += char;
      }
    } else {
      result += char;
    }
  }
  return result;
}

export function parseJson<T>(text: string): T {
  const extracted = extractJsonObjectText(text);
  const repaired = repairInvalidJsonEscapes(extracted);
  const cleaned = escapeControlCharsInJsonStrings(repaired)
    .replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/gu, "");
  return JSON.parse(cleaned) as T;
}
