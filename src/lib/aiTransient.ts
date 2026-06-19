export function isTransientAIErrorMessage(message: string) {
  return /504|gateway timeout|timeout|timed out|fetch failed|terminated|socket|network|econnreset|etimedout|eai_again|und_err|other side closed/i.test(message);
}

export function transientAIErrorMessage(value: unknown, fallback = "模型网关暂时超时，系统会自动重试。") {
  const message = errorText(value);
  if (!message.trim()) return fallback;
  if (isTransientAIErrorMessage(message)) return fallback;
  return message;
}

export function isTransientAIError(value: unknown) {
  return isTransientAIErrorMessage(errorText(value));
}

export function publicTransientAIMessage(value: unknown) {
  const message = errorText(value);
  if (/504|gateway timeout/i.test(message)) return "模型网关 504 超时，系统稍后会自动重试。";
  if (/timeout|timed out/i.test(message)) return "模型请求超时，系统稍后会自动重试。";
  if (/network|fetch failed|socket|econnreset|etimedout|terminated|other side closed/i.test(message)) return "模型网络连接暂时中断，系统稍后会自动重试。";
  return "模型服务暂时不可用，系统稍后会自动重试。";
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error ?? "");
  const cause = (error as Error & { cause?: unknown }).cause;
  return `${error.name} ${error.message} ${cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause ?? "")}`;
}
