import "server-only";

const API_KEY = process.env.AI_API_KEY;
const API_BASE_URL = (process.env.AI_API_BASE_URL ?? "https://api.yzccc.cloud/v1").replace(
  /\/$/,
  "",
);

export const MODEL = "mimo-v2.5-pro";

export function hasAI() {
  return Boolean(API_KEY);
}

export async function generateText(
  prompt: string,
  options?: {
    maxTokens?: number;
    temperature?: number;
  },
) {
  if (!API_KEY) throw new Error("AI_API_KEY is not configured");

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: options?.temperature ?? 0.45,
        max_tokens: options?.maxTokens ?? 32768,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error(`${MODEL} returned an empty response`);
      return text as string;
    }

    lastError = `${response.status} ${await response.text()}`;
    if (![429, 500, 502, 503, 504].includes(response.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }

  throw new Error(`${MODEL} request failed: ${lastError}`);
}

export function parseJson<T>(text: string): T {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const object = text.match(/\{[\s\S]*\}/);
  const cleaned = fenced?.[1] ?? object?.[0] ?? text;
  return JSON.parse(cleaned) as T;
}
