import { hasAnySupabaseAuthConfig, isTrustedInternalWorkerRequest } from "./config";

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

export function resolveFallbackUserId(request: Request | undefined, authenticatedUserId?: string) {
  if (authenticatedUserId) return authenticatedUserId;

  const fallbackUser = request?.headers.get("x-learnbyai-user-id");
  if (hasAnySupabaseAuthConfig()) {
    if (fallbackUser && isUuid(fallbackUser) && isTrustedInternalWorkerRequest(request)) {
      return fallbackUser;
    }
    throw new AuthRequiredError();
  }

  return fallbackUser || "local-beta-user";
}

function isUuid(value?: string) {
  return Boolean(
    value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  );
}
