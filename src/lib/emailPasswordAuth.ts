import { publicSafeErrorMessage } from "./publicSafeError";

export type EmailPasswordAuthMode = "login" | "signup";

export type EmailPasswordCredentials = {
  email: string;
  password: string;
};

type EmailPasswordAuthResponse = {
  data?: {
    session?: unknown | null;
  } | null;
  error?: unknown | null;
};

export type EmailPasswordAuthClient = {
  auth: {
    signInWithPassword: (credentials: EmailPasswordCredentials) => Promise<EmailPasswordAuthResponse>;
    signUp: (credentials: EmailPasswordCredentials) => Promise<EmailPasswordAuthResponse>;
  };
};

export const AUTH_MESSAGES = {
  serviceUnavailable: "\u767b\u5f55\u670d\u52a1\u672a\u914d\u7f6e\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u3002",
  invalidCredentials: "\u90ae\u7bb1\u6216\u5bc6\u7801\u4e0d\u6b63\u786e\uff0c\u8bf7\u68c0\u67e5\u540e\u91cd\u8bd5\u3002",
  loginFailed: "\u767b\u5f55\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
  signupFailed: "\u6ce8\u518c\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
  signupNeedsLogin:
    "\u6ce8\u518c\u6210\u529f\uff0c\u4f46\u5f53\u524d\u670d\u52a1\u672a\u80fd\u81ea\u52a8\u767b\u5f55\uff0c\u8bf7\u76f4\u63a5\u4f7f\u7528\u8be5\u90ae\u7bb1\u548c\u5bc6\u7801\u767b\u5f55\u3002",
  signedOut: "\u5df2\u9000\u51fa\u767b\u5f55\u3002",
} as const;

export const AUTH_UI_TEXT = {
  loginTitle: "\u767b\u5f55 LearnByAI",
  signupTitle: "\u6ce8\u518c LearnByAI",
  signIn: "\u767b\u5f55",
  createAccount: "\u6ce8\u518c\u5e76\u767b\u5f55",
  email: "\u90ae\u7bb1",
  password: "\u5bc6\u7801",
  working: "\u5904\u7406\u4e2d...",
  signOut: "\u9000\u51fa\u767b\u5f55",
} as const;

export async function authenticateWithEmailPassword(
  client: EmailPasswordAuthClient,
  mode: EmailPasswordAuthMode,
  credentials: EmailPasswordCredentials,
): Promise<{ ok: true } | { ok: false; message: string; nextMode?: EmailPasswordAuthMode }> {
  if (mode === "login") {
    const { data, error } = await client.auth.signInWithPassword(credentials);
    if (error || !data?.session) return { ok: false, message: AUTH_MESSAGES.invalidCredentials };
    return { ok: true };
  }

  const { data, error } = await client.auth.signUp(credentials);
  if (error) {
    return { ok: false, message: publicSafeErrorMessage(error, AUTH_MESSAGES.signupFailed) };
  }

  if (data?.session) return { ok: true };

  const signIn = await client.auth.signInWithPassword(credentials);
  if (signIn.error || !signIn.data?.session) {
    return { ok: false, message: AUTH_MESSAGES.signupNeedsLogin, nextMode: "login" };
  }

  return { ok: true };
}
