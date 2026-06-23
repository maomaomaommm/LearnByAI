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

export type EmailPasswordSignUpOptions = {
  emailRedirectTo?: string;
};

export type EmailPasswordAuthClient = {
  auth: {
    signInWithPassword: (credentials: EmailPasswordCredentials) => Promise<EmailPasswordAuthResponse>;
    signUp: (
      credentials: EmailPasswordCredentials & { options?: EmailPasswordSignUpOptions },
    ) => Promise<EmailPasswordAuthResponse>;
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
  confirmEmailSent:
    "\u6ce8\u518c\u6210\u529f\uff01\u6211\u4eec\u5df2\u5411\u4f60\u7684\u90ae\u7bb1\u53d1\u9001\u4e86\u4e00\u5c01\u786e\u8ba4\u90ae\u4ef6\uff0c\u8bf7\u70b9\u5f00\u5176\u4e2d\u7684\u94fe\u63a5\u5b8c\u6210\u9a8c\u8bc1\uff0c\u7136\u540e\u56de\u6765\u767b\u5f55\u3002",
  emailNotConfirmed:
    "\u8fd9\u4e2a\u90ae\u7bb1\u8fd8\u6ca1\u5b8c\u6210\u9a8c\u8bc1\u3002\u8bf7\u70b9\u5f00\u6ce8\u518c\u65f6\u53d1\u5230\u90ae\u7bb1\u7684\u786e\u8ba4\u94fe\u63a5\uff1b\u6ca1\u6536\u5230\u7684\u8bdd\uff0c\u91cd\u65b0\u6ce8\u518c\u4e00\u6b21\u4f1a\u518d\u53d1\u4e00\u5c01\u3002",
  resetEmailSent:
    "\u5982\u679c\u8be5\u90ae\u7bb1\u5df2\u6ce8\u518c\uff0c\u6211\u4eec\u5df2\u53d1\u9001\u5bc6\u7801\u91cd\u7f6e\u90ae\u4ef6\uff0c\u8bf7\u67e5\u6536\u5e76\u70b9\u5f00\u94fe\u63a5\u8bbe\u7f6e\u65b0\u5bc6\u7801\uff08\u6ce8\u610f\u68c0\u67e5\u5783\u573e\u90ae\u4ef6\uff09\u3002",
  passwordUpdated: "\u5bc6\u7801\u5df2\u66f4\u65b0\uff0c\u6b63\u5728\u5e26\u4f60\u8fdb\u5165\u8bfe\u7a0b\u4e2d\u5fc3\u2026",
  recoveryLinkInvalid: "\u91cd\u7f6e\u94fe\u63a5\u65e0\u6548\u6216\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u53d1\u8d77\u201c\u5fd8\u8bb0\u5bc6\u7801\u201d\u3002",
  emailAlreadyRegistered: "\u8be5\u90ae\u7bb1\u5df2\u6ce8\u518c\u3002\u8bf7\u5207\u5230\u201c\u767b\u5f55\u201d\u7528\u539f\u5bc6\u7801\u767b\u5f55\uff1b\u5fd8\u4e86\u5bc6\u7801\u5c31\u70b9\u4e0b\u65b9\u201c\u5fd8\u8bb0\u5bc6\u7801\uff1f\u201d\u3002",
  codeVerifyFailed: "\u9a8c\u8bc1\u7801\u4e0d\u6b63\u786e\u6216\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u8f93\u5165\uff0c\u6216\u70b9\u201c\u91cd\u65b0\u53d1\u9001\u201d\u3002",
  codeResent: "\u9a8c\u8bc1\u7801\u5df2\u91cd\u65b0\u53d1\u9001\uff0c\u8bf7\u67e5\u6536\u90ae\u7bb1\uff08\u542b\u5783\u573e\u7bb1\uff09\u3002",
  linkExpired: "\u90ae\u4ef6\u94fe\u63a5\u5df2\u5931\u6548\uff08\u53ef\u80fd\u88ab\u90ae\u7bb1\u5b89\u5168\u626b\u63cf\u63d0\u524d\u6253\u5f00\uff0c\u6216\u5df2\u8fc7\u671f\uff09\u3002\u8bf7\u56de\u767b\u5f55\u9875\u7528\u9a8c\u8bc1\u7801\u5b8c\u6210\u9a8c\u8bc1\uff0c\u6216\u91cd\u65b0\u53d1\u9001\u3002",
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
  forgotPassword: "\u5fd8\u8bb0\u5bc6\u7801\uff1f",
  resetTitle: "\u91cd\u7f6e\u5bc6\u7801",
  forgotTitle: "\u627e\u56de\u5bc6\u7801",
  sendResetLink: "\u53d1\u9001\u91cd\u7f6e\u90ae\u4ef6",
  newPassword: "\u8bbe\u7f6e\u65b0\u5bc6\u7801",
  updatePassword: "\u66f4\u65b0\u5bc6\u7801",
  backToLogin: "\u8fd4\u56de\u767b\u5f55",
  verifyTitle: "\u8f93\u5165\u9a8c\u8bc1\u7801",
  codeLabel: "6 \u4f4d\u9a8c\u8bc1\u7801",
  verifyButton: "\u9a8c\u8bc1\u5e76\u767b\u5f55",
  resendCode: "\u91cd\u65b0\u53d1\u9001",
  useAnotherEmail: "\u6362\u4e2a\u90ae\u7bb1",
} as const;

export type EmailPasswordAuthResult =
  | { ok: true }
  | { ok: false; message: string; nextMode?: EmailPasswordAuthMode; needsConfirmation?: boolean };

function isEmailNotConfirmed(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? "");
  return /not confirmed|email not confirmed/i.test(message);
}

function isAlreadyRegistered(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? "");
  return /already[\s\S]*regist/i.test(message);
}

export async function authenticateWithEmailPassword(
  client: EmailPasswordAuthClient,
  mode: EmailPasswordAuthMode,
  credentials: EmailPasswordCredentials,
  options?: EmailPasswordSignUpOptions,
): Promise<EmailPasswordAuthResult> {
  if (mode === "login") {
    const { data, error } = await client.auth.signInWithPassword(credentials);
    if (!error && data?.session) return { ok: true };
    // A registered-but-unverified account fails login with "Email not confirmed";
    // tell them to check their inbox instead of the generic wrong-password message.
    if (isEmailNotConfirmed(error)) {
      return { ok: false, needsConfirmation: true, message: AUTH_MESSAGES.emailNotConfirmed };
    }
    return { ok: false, message: AUTH_MESSAGES.invalidCredentials };
  }

  const { data, error } = await client.auth.signUp({ ...credentials, options });
  if (error) {
    // Map the raw "User already registered" to a clear next step instead of leaking it.
    if (isAlreadyRegistered(error)) {
      return { ok: false, message: AUTH_MESSAGES.emailAlreadyRegistered, nextMode: "login" };
    }
    return { ok: false, message: publicSafeErrorMessage(error, AUTH_MESSAGES.signupFailed) };
  }

  // With email auto-confirm on, Supabase returns a session and the user is logged in.
  if (data?.session) return { ok: true };

  // No session and no error means email verification is required. A 6-digit code +
  // confirmation link were sent; surface a "enter the code (or click the link)" state
  // rather than treating it as a failure or trying to auto-login.
  return { ok: false, needsConfirmation: true, message: AUTH_MESSAGES.confirmEmailSent };
}
