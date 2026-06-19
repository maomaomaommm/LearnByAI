export type AdminSession = {
  username: string;
  expiresAt: number;
};

export async function createSignedAdminSession(username: string, secret: string, ttlSeconds: number) {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ username, expiresAt } satisfies AdminSession), "utf8").toString("base64url");
  const signature = await signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifySignedAdminSession(token: string | undefined, secret: string) {
  if (!token || !secret) return undefined;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return undefined;

  const expectedSignature = await signPayload(payload, secret);
  if (!timingSafeEqual(signature, expectedSignature)) return undefined;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AdminSession;
    if (!session.username || !session.expiresAt || session.expiresAt <= Math.floor(Date.now() / 1000)) return undefined;
    return session;
  } catch {
    return undefined;
  }
}

export function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function signPayload(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Buffer.from(signature).toString("base64url");
}
