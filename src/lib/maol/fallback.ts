import { isMockMode } from "../config";

export function assertMockFallbackAllowed(error: unknown) {
  if (isMockMode()) return;
  if (error instanceof Error) throw error;
  throw new Error("Agent fallback is disabled outside mock mode.");
}
