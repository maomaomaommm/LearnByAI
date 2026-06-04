import "server-only";

const API_KEY = process.env.AI_API_KEY;
const API_BASE_URL = (process.env.AI_API_BASE_URL ?? "https://api.yzccc.cloud/v1").replace(
  /\/$/,
  "",
);

// Product policy: this application is intentionally restricted to Gemini 3.1 Pro.
export const MODEL = "gemini-3.1-pro-preview";

export function hasAI() {
  return Boolean(API_KEY);
}

export async function generateText(prompt: string) {
  if (!API_KEY) throw new Error("AI_API_KEY is not configured");

  const response = await fetch(`${API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.45,
      max_tokens: 16384,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Gemini 3.1 Pro request failed: ${response.status} ${details}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Gemini 3.1 Pro returned an empty response");
  return text as string;
}

export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned) as T;
}
