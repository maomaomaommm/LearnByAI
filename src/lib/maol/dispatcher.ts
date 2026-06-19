import { generateText } from "../ai";
import { appendJobEvent } from "../jobs";
import { ModelOverrides } from "../modelOverrides";
import { safeErrorMessage } from "../safeError";
import { AgentName, GenerationJob } from "../types";
import { canCallAgent, resolveAgent } from "./registry";

export async function dispatchAgentText(input: {
  agent: AgentName;
  prompt: string;
  jobId?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  stream?: boolean;
  responseFormat?: "json_object";
  overrides?: ModelOverrides;
  mock?: () => string;
  onChunk?: (chunk: string) => void;
  onJobUpdate?: (job: GenerationJob) => Promise<void> | void;
}) {
  if (input.jobId) {
    await appendAndPersist(input.jobId, {
      agent: input.agent,
      status: "running",
      message: `${input.agent} started.`,
    }, input.onJobUpdate);
  }

  try {
    if (!canCallAgent(input.agent, input.overrides)) {
      const text = input.mock?.() ?? "";
      if (input.jobId) {
        await appendAndPersist(input.jobId, {
          agent: input.agent,
          status: "succeeded",
          message: `${input.agent} returned mock output.`,
        }, input.onJobUpdate);
      }
      return text;
    }

    const config = resolveAgent(input.agent, input.overrides);
    const text = await generateText(input.prompt, {
      agent: input.agent,
      temperature: input.temperature ?? config.temperature,
      maxTokens: input.maxTokens ?? config.maxTokens,
      timeoutMs: input.timeoutMs,
      maxAttempts: input.maxAttempts,
      stream: input.stream,
      responseFormat: input.responseFormat,
      overrides: input.overrides,
      onChunk: input.onChunk,
    });

    if (input.jobId) {
      await appendAndPersist(input.jobId, {
        agent: input.agent,
        status: "succeeded",
        message: `${input.agent} completed.`,
      }, input.onJobUpdate);
    }

    return text;
  } catch (error) {
    if (input.jobId) {
      await appendAndPersist(input.jobId, {
        agent: input.agent,
        status: "failed",
        message: safeErrorMessage(error, `${input.agent} failed.`),
      }, input.onJobUpdate);
    }
    throw error;
  }
}

async function appendAndPersist(
  jobId: string,
  event: Parameters<typeof appendJobEvent>[1],
  onJobUpdate?: (job: GenerationJob) => Promise<void> | void,
) {
  const job = appendJobEvent(jobId, event, { preserveJobStatus: true });
  if (job && onJobUpdate) {
    await onJobUpdate(job);
  }
  return job;
}
