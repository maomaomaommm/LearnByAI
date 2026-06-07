export type { AgentEvent, AgentName, GenerationJob, JobStatus } from "../types";

export type AgentConfig = {
  agent: import("../types").AgentName;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
};
