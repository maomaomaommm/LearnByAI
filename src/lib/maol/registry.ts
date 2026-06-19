import { getAgentConfig } from "../config";
import { ModelOverrides } from "../modelOverrides";
import { AgentName } from "../types";
import { AgentConfig } from "./types";

export function resolveAgent(agent: AgentName, overrides?: ModelOverrides): AgentConfig {
  return getAgentConfig(agent, overrides);
}

export function canCallAgent(agent: AgentName, overrides?: ModelOverrides) {
  if (process.env.AI_MOCK_MODE === "true") return false;
  const config = resolveAgent(agent, overrides);
  return Boolean(config.apiKey && config.baseUrl && config.model);
}
