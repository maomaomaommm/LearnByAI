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
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
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
      }),
    });

    if (response.ok) {
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

export function parseJson<T>(text: string): T {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const object = text.match(/\{[\s\S]*\}/);
  const cleaned = fenced?.[1] ?? object?.[0] ?? text;
  return JSON.parse(cleaned) as T;
}
