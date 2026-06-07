import "server-only";

import { getAgentConfig, getBaseAIConfig } from "./config";
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
  },
) {
  const config = options?.agent ? getAgentConfig(options.agent) : getBaseAIConfig();
  if (!config.apiKey) throw new Error("AI_API_KEY is not configured");

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          temperature: options?.temperature ?? config.temperature,
          max_tokens: options?.maxTokens ?? config.maxTokens,
          stream: true,
          ...thinkingPayload(config.thinking),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === "AbortError") {
        lastError = `request timed out after ${config.timeoutMs}ms`;
        break;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        let fullText = "";
        const reader = response.body?.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
                try {
                  const parsed = JSON.parse(trimmed.slice(6));
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) fullText += content;
                } catch {
                  // ignore
                }
              }
            }
          }
        }
        if (!fullText) throw new Error(`${config.model} returned an empty stream response`);
        return fullText;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error(`${config.model} returned an empty response`);
      return text as string;
    }

    const body = await response.text();
    lastError = `${response.status} ${safeErrorMessage(body, response.statusText || "provider error")}`;
    if (![429, 500, 502, 503, 504].includes(response.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }

  throw new Error(`${config.model} request failed: ${lastError}`);
}

function thinkingPayload(thinking: "disabled" | "enabled" | "auto") {
  if (thinking === "auto") return {};
  return { thinking: { type: thinking } };
}

export function parseJson<T>(text: string): T {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const object = text.match(/\{[\s\S]*\}/);
  const cleaned = fenced?.[1] ?? object?.[0] ?? text;
  return JSON.parse(cleaned) as T;
}
