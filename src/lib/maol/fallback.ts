import { getAgentConfig, isMockMode } from "../config";
import { ModelOverrides } from "../modelOverrides";
import { AgentName } from "../types";

export function assertMockFallbackAllowed(error: unknown, overrides?: ModelOverrides, agent?: AgentName) {
  if (process.env.AI_MOCK_MODE === "true") return;
  if (agent) {
    if (!getAgentConfig(agent, overrides).apiKey) return;
  } else if (isMockMode(overrides)) {
    return;
  }
  if (error instanceof Error) throw error;
  throw new Error("Agent fallback is disabled outside mock mode.");
}
