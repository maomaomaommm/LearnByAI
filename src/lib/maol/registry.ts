import { getAgentConfig } from "../config";
import { ModelOverrides } from "../modelOverrides";
import { AgentName } from "../types";
import { AgentConfig } from "./types";

export function resolveAgent(agent: AgentName, overrides?: ModelOverrides): AgentConfig {
  return getAgentConfig(agent, overrides);
}

export function canCallAgent(agent: AgentName, overrides?: ModelOverrides) {
  return process.env.AI_MOCK_MODE !== "true" && Boolean(resolveAgent(agent, overrides).apiKey);
}
