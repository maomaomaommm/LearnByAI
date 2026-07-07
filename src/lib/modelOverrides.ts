import type { AgentName } from "./types";

export const MODEL_CONFIG_HEADER = "x-learnbyai-models-config";
export const MODEL_CONFIG_STORAGE_KEY = "learnbyai-models-config";

export const MODEL_AGENT_NAMES = [
  "ASSISTANT",
  "ARCHITECT",
  "AUTHOR",
  "POLISHER",
  "REVIEWER",
  "TUTOR",
] as const satisfies readonly AgentName[];

export type ModelOverrideFields = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export type ModelOverrides = {
  version: 1;
  default?: ModelOverrideFields;
  agents?: Partial<Record<AgentName, ModelOverrideFields>>;
};

export function parseModelOverrides(value: string | null | undefined): ModelOverrides | undefined {
  if (!value) return undefined;

  try {
    return normalizeModelOverrides(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function parseModelOverridesFromHeaders(headers: Headers | undefined | null) {
  return parseModelOverrides(headers?.get(MODEL_CONFIG_HEADER));
}

export function normalizeModelOverrides(value: unknown): ModelOverrides | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;

  const defaultFields = normalizeFields(value.default);
  const agents = normalizeAgents(value.agents);

  if (!defaultFields && !agents) return undefined;

  return {
    version: 1,
    ...(defaultFields ? { default: defaultFields } : {}),
    ...(agents ? { agents } : {}),
  };
}

export function hasModelOverrides(value: ModelOverrides | undefined) {
  return Boolean(value?.default || value?.agents);
}

export function explicitAgentOverride(
  overrides: ModelOverrides | undefined,
  agent: AgentName,
): ModelOverrides | undefined {
  const fields = overrides?.agents?.[agent];
  if (!fields) return undefined;
  return {
    version: 1,
    agents: { [agent]: fields },
  };
}

function normalizeAgents(value: unknown): ModelOverrides["agents"] | undefined {
  if (!isRecord(value)) return undefined;

  const agents: Partial<Record<AgentName, ModelOverrideFields>> = {};
  for (const agent of MODEL_AGENT_NAMES) {
    const fields = normalizeFields(value[agent]);
    if (fields) agents[agent] = fields;
  }

  return Object.keys(agents).length > 0 ? agents : undefined;
}

function normalizeFields(value: unknown): ModelOverrideFields | undefined {
  if (!isRecord(value)) return undefined;

  const fields: ModelOverrideFields = {};
  const apiKey = readString(value.apiKey);
  const baseUrl = readString(value.baseUrl);
  const model = readString(value.model);

  if (apiKey) fields.apiKey = apiKey;
  if (baseUrl) fields.baseUrl = baseUrl;
  if (model) fields.model = model;

  return Object.keys(fields).length > 0 ? fields : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
