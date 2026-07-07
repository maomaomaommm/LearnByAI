import "server-only";

import { generateText, parseJson } from "./ai";
import { ModelOverrides } from "./modelOverrides";
import { buildCourseResearchPrompt, CourseResearchInput } from "./prompts/courseResearch";
import { safeErrorMessage } from "./safeError";

const RESEARCH_TIMEOUT_MS = 45_000;
const ARXIV_TIMEOUT_MS = 30_000;

export async function researchLatestCourseKnowledge(
  input: CourseResearchInput,
  overrides?: ModelOverrides,
) {
  const keywordText = await generateText(buildCourseResearchPrompt(input), {
    agent: "ARCHITECT",
    maxTokens: 128,
    temperature: 0,
    timeoutMs: RESEARCH_TIMEOUT_MS,
    maxAttempts: 1,
    stream: false,
    responseFormat: "json_object",
    overrides,
  });
  const query = parseJson<{ query?: string }>(keywordText).query?.trim();
  if (!query) throw new Error("联网检索失败：Kimi 未生成有效英文检索词。");

  return searchArxiv(query);
}

async function searchArxiv(query: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ARXIV_TIMEOUT_MS);
  try {
    const terms = query
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 10)
      .join(" ");
    const params = new URLSearchParams({
      search_query: `all:"${terms}"`,
      start: "0",
      max_results: "5",
      sortBy: "submittedDate",
      sortOrder: "descending",
    });
    const response = await fetch(`https://export.arxiv.org/api/query?${params}`, {
      headers: {
        Accept: "application/atom+xml",
        "User-Agent": "LearnByAI/0.1",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText || "arXiv error"}`);
    }
    const entries = parseArxivEntries(await response.text());
    if (!entries.length) throw new Error("arXiv 未返回相关论文。");

    return [
      `检索词：${terms}`,
      ...entries.map((entry, index) =>
        `${index + 1}. ${entry.title}；首次公开：${entry.published.slice(0, 10)}；摘要：${entry.summary.slice(0, 180)}；来源：${entry.url}`,
      ),
    ].join("\n");
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? `request timed out after ${ARXIV_TIMEOUT_MS}ms`
      : safeErrorMessage(error, "arXiv request failed");
    throw new Error(`联网检索失败：${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function parseArxivEntries(xml: string) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gu)]
    .map((match) => {
      const entry = match[1];
      return {
        title: readXmlTag(entry, "title"),
        summary: readXmlTag(entry, "summary"),
        published: readXmlTag(entry, "published"),
        url: readXmlTag(entry, "id").replace("export.arxiv.org", "arxiv.org"),
      };
    })
    .filter((entry) => entry.title && entry.published && entry.url);
}

function readXmlTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "u"));
  return decodeXml(match?.[1] ?? "").replace(/\s+/gu, " ").trim();
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;/gu, "'");
}
