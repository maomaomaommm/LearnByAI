import "server-only";

import { generateText, parseJson } from "./ai";
import { ModelOverrides } from "./modelOverrides";
import { buildCourseResearchPrompt, CourseResearchInput } from "./prompts/courseResearch";
import { safeErrorMessage } from "./safeError";

const RESEARCH_TIMEOUT_MS = 120_000;
const EXA_TIMEOUT_MS = 15_000;
const STEP_TIMEOUT_MS = 15_000;
const KIMI_SEARCH_TIMEOUT_MS = 60_000;

const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

/**
 * 联网检索第三层（Kimi $web_search）专用配置——独立于主 agent 的 LLM 配置。
 * 它和 EXA / STEP 一样属于"服务器搜索基础设施"，用一个专用的 Moonshot/Kimi key，
 * 不复用、也不污染那 7 个内容 agent 的模型（作者/助手/润色/审稿/tutor 等只走用户自配模型）。
 * 未配置 KIMI_SEARCH_API_KEY 时本层直接跳过。
 */
type KimiSearchConfig = { apiKey: string; baseUrl: string; model: string };

function getKimiSearchConfig(): KimiSearchConfig | undefined {
  const apiKey = process.env.KIMI_SEARCH_API_KEY;
  if (!apiKey) return undefined;
  const baseUrl = (process.env.KIMI_SEARCH_BASE_URL || "https://api.moonshot.cn/v1").replace(/\/+$/, "");
  const model = process.env.KIMI_SEARCH_MODEL || "kimi-k2.6";
  return { apiKey, baseUrl, model };
}

type ExaResult = {
  url: string;
  title?: string;
  publishedDate?: string;
  highlights?: string[];
};

type StepResult = {
  url: string;
  title?: string;
  time?: string;
  snippet?: string;
  content?: string;
};

export async function researchLatestCourseKnowledge(
  input: CourseResearchInput,
  overrides?: ModelOverrides,
): Promise<string | undefined> {
  const query = await resolveResearchQuery(input, overrides);
  if (!query) {
    console.warn("[webResearch] 关键词提取失败，跳过联网检索");
    return undefined;
  }

  // 第一层：Exa
  if (process.env.EXA_API_KEY) {
    try {
      return await searchExa(query);
    } catch (error) {
      console.warn("[webResearch] Exa 失败，尝试 StepFun:", safeErrorMessage(error, "Exa error"));
    }
  } else {
    console.warn("[webResearch] EXA_API_KEY 未配置，跳过 Exa");
  }

  // 第二层：StepFun
  if (process.env.STEP_SEARCH_API_KEY) {
    try {
      return await searchStep(query);
    } catch (error) {
      console.warn("[webResearch] StepFun 失败，尝试 Kimi:", safeErrorMessage(error, "StepFun error"));
    }
  } else {
    console.warn("[webResearch] STEP_SEARCH_API_KEY 未配置，跳过 StepFun");
  }

  // 第三层：Kimi $web_search（专用 search key，独立于主 agent 模型）
  const kimiConfig = getKimiSearchConfig();
  if (kimiConfig) {
    try {
      return await searchKimi(query, kimiConfig);
    } catch (error) {
      console.warn("[webResearch] Kimi 搜索失败，跳过联网检索:", safeErrorMessage(error, "Kimi search error"));
    }
  } else {
    console.warn("[webResearch] KIMI_SEARCH_API_KEY 未配置，跳过 Kimi");
  }

  // 最终兜底：静默跳过
  return undefined;
}

async function resolveResearchQuery(
  input: CourseResearchInput,
  overrides?: ModelOverrides,
) {
  try {
    const keywordText = await generateText(buildCourseResearchPrompt(input), {
      agent: "ASSISTANT",
      maxTokens: 512,
      temperature: 0,
      timeoutMs: RESEARCH_TIMEOUT_MS,
      maxAttempts: 1,
      stream: false,
      responseFormat: "json_object",
      overrides,
    });
    const query = normalizeQuery(parseJson<{ query?: string }>(keywordText).query);
    if (query) return query;
  } catch (error) {
    console.warn(
      "[webResearch] 关键词提取失败，使用本地检索词继续:",
      safeErrorMessage(error, "query extraction failed"),
    );
  }

  return buildFallbackResearchQuery(input);
}

export function buildFallbackResearchQuery(input: CourseResearchInput) {
  const year = new Date().getUTCFullYear();
  return normalizeQuery([
    input.topic,
    input.goal,
    "recent research papers survey state of the art",
    String(year),
  ].join(" "));
}

function normalizeQuery(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

async function searchExa(query: string): Promise<string> {
  const apiKey = process.env.EXA_API_KEY!;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXA_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query,
        numResults: 5,
        type: "neural",
        useAutoprompt: true,
        contents: {
          highlights: { numSentences: 3, highlightsPerUrl: 1, query },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Exa ${response.status}: ${response.statusText || body}`);
    }

    const data = (await response.json()) as { results?: ExaResult[] };
    const results = data.results ?? [];
    if (!results.length) throw new Error("Exa 未返回任何结果");

    return formatResults(
      query,
      results.map((r) => ({
        title: r.title ?? r.url,
        date: r.publishedDate?.slice(0, 10),
        snippet: r.highlights?.[0] ?? "",
        url: r.url,
      })),
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function searchStep(query: string): Promise<string> {
  const apiKey = process.env.STEP_SEARCH_API_KEY!;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.stepfun.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, n: 5 }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`StepFun ${response.status}: ${response.statusText || body}`);
    }

    const data = (await response.json()) as { results?: StepResult[] };
    const results = data.results ?? [];
    if (!results.length) throw new Error("StepFun 未返回任何结果");

    return formatResults(
      query,
      results.map((r) => ({
        title: r.title ?? r.url,
        date: r.time?.slice(0, 10) || undefined,
        snippet: (r.snippet || r.content || "").slice(0, 200),
        url: r.url,
      })),
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function searchKimi(query: string, config: KimiSearchConfig): Promise<string> {
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    // Required to pass Cloudflare protection on the proxy
    "User-Agent": BROWSER_UA,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KIMI_SEARCH_TIMEOUT_MS);

  try {
    // Round 1: ask model to search
    const round1Body = JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: `搜索最新资料：${query}` }],
      tools: [{ type: "builtin_function", function: { name: "$web_search" } }],
      max_tokens: 512,
      stream: false,
    });

    const resp1 = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: round1Body,
      signal: controller.signal,
    });

    if (!resp1.ok) {
      const body = await resp1.text().catch(() => "");
      throw new Error(`Kimi round1 ${resp1.status}: ${body.slice(0, 200)}`);
    }

    const data1 = (await resp1.json()) as {
      choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason: string }[];
    };

    const choice1 = data1.choices[0];
    const toolCalls = choice1?.message?.tool_calls;

    if (!toolCalls?.length || choice1.finish_reason !== "tool_calls") {
      // Model answered directly without searching
      const directContent = choice1?.message?.content?.trim();
      if (directContent) return `检索词：${query}\n${directContent.slice(0, 800)}`;
      throw new Error("Kimi 未触发搜索工具");
    }

    const toolCall = toolCalls[0];
    // Round 2: return tool arguments as-is (Kimi executes search internally)
    const round2Body = JSON.stringify({
      model: config.model,
      messages: [
        { role: "user", content: `搜索最新资料：${query}` },
        { role: "assistant", content: null, tool_calls: toolCalls },
        {
          role: "tool",
          tool_call_id: toolCall.id,
          // Moonshot's official $web_search requires the tool name on the result
          // message; without it the builtin search round can be rejected.
          name: "$web_search",
          content: toolCall.function.arguments,
        },
      ],
      tools: [{ type: "builtin_function", function: { name: "$web_search" } }],
      max_tokens: 1024,
      stream: false,
    });

    const resp2 = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: round2Body,
      signal: controller.signal,
    });

    if (!resp2.ok) {
      const body = await resp2.text().catch(() => "");
      throw new Error(`Kimi round2 ${resp2.status}: ${body.slice(0, 200)}`);
    }

    const data2 = (await resp2.json()) as {
      choices: { message: { content: string | null } }[];
    };

    const content = data2.choices[0]?.message?.content?.trim();
    if (!content) throw new Error("Kimi 搜索后未返回内容");

    return `检索词：${query}\n${content.slice(0, 1000)}`;
  } finally {
    clearTimeout(timeout);
  }
}

function formatResults(
  query: string,
  results: { title: string; date?: string; snippet: string; url: string }[],
): string {
  return [
    `检索词：${query}`,
    ...results.map((r, i) =>
      `${i + 1}. ${r.title}（${r.date ?? "日期未知"}）摘要：${r.snippet}…来源：${r.url}`,
    ),
  ].join("\n");
}
