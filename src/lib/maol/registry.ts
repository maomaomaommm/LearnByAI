import { getAgentConfig, isMockMode } from "../config";
import { AgentName } from "../types";
import { AgentConfig } from "./types";

export function resolveAgent(agent: AgentName): AgentConfig {
  return getAgentConfig(agent);
}

export function canCallAgent(agent: AgentName) {
  return !isMockMode() && Boolean(resolveAgent(agent).apiKey);
}
