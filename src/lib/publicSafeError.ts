const PUBLIC_SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu,
  /\b(?:sk|pk|sbp|eyJ)[A-Za-z0-9._~+/=-]{12,}/gu,
  /\b[A-Za-z0-9+/]{32,}={0,2}\b/gu,
];

export function redactPublicSecrets(value: unknown) {
  let text = value instanceof Error ? value.message : String(value ?? "");
  for (const pattern of PUBLIC_SECRET_PATTERNS) {
    text = text.replace(pattern, "[redacted]");
  }
  return text;
}

export function publicSafeErrorMessage(value: unknown, fallback = "Request failed.") {
  const redacted = redactPublicSecrets(value).trim();
  if (!redacted) return fallback;
  if (looksLikeInternalPayload(redacted) || redacted.length > 180) return fallback;
  return redacted;
}

function looksLikeInternalPayload(value: string) {
  const lower = value.toLowerCase();
  return (
    value.includes("{") ||
    value.includes("}") ||
    value.includes("<!DOCTYPE") ||
    lower.includes("authorization") ||
    lower.includes("api_key") ||
    lower.includes("access_token") ||
    lower.includes("service_role") ||
    lower.includes("stack trace") ||
    lower.includes("supabase")
  );
}
