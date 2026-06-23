"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { LogIn, MailCheck, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  AUTH_MESSAGES,
  AUTH_UI_TEXT,
  EmailPasswordAuthMode,
  authenticateWithEmailPassword,
} from "@/lib/emailPasswordAuth";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [mode, setMode] = useState<EmailPasswordAuthMode>("login");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [nextPath, setNextPath] = useState("/courses");
  const [gated, setGated] = useState(false);

  // When verification is required we switch into a "enter the 6-digit code" step.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [codeMsg, setCodeMsg] = useState("");

  useEffect(() => {
    setReady(true);
    // Read the return path without useSearchParams so the page needs no Suspense boundary.
    const raw = new URLSearchParams(window.location.search).get("next");
    if (raw && raw.startsWith("/") && !raw.startsWith("//")) {
      setNextPath(raw);
      setGated(true);
    }
  }, []);

  function redirectAfterAuth() {
    toast.success("验证成功", {
      description: gated ? "正在返回上一步..." : "正在进入课程中心...",
    });
    setTimeout(() => window.location.assign(nextPath), 900);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setNotice("");

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setMessage(AUTH_MESSAGES.serviceUnavailable);
      setLoading(false);
      return;
    }

    try {
      const result = await authenticateWithEmailPassword(supabase, mode, { email, password }, {
        // Clicking the email link instead of typing the code lands here with a clear result.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      });
      if (result.ok) {
        toast.success(mode === "login" ? "登录成功" : "注册并登录成功", {
          description: gated ? "正在返回上一步..." : "正在进入课程中心...",
        });
        setTimeout(() => {
          window.location.assign(nextPath);
        }, 900);
        return;
      }

      // Email verification required — move to the code step (also works if the user
      // would rather click the link in the email).
      if (result.needsConfirmation) {
        setPendingEmail(email);
        setPendingNote(result.message);
        setCodeMsg("");
        return;
      }

      setMessage(result.message);
      if (result.nextMode) setMode(result.nextMode);
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVerifying(true);
    setCodeMsg("");

    const token = String(new FormData(event.currentTarget).get("code")).trim();
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !pendingEmail) {
      setCodeMsg(AUTH_MESSAGES.serviceUnavailable);
      setVerifying(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: pendingEmail,
        token,
        type: "signup",
      });
      if (error || !data?.session) {
        setCodeMsg(AUTH_MESSAGES.codeVerifyFailed);
        return;
      }
      redirectAfterAuth();
    } finally {
      setVerifying(false);
    }
  }

  async function resendCode() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !pendingEmail) return;
    setCodeMsg("");
    const { error } = await supabase.auth.resend({ type: "signup", email: pendingEmail });
    if (error) {
      setCodeMsg(publicSafeErrorMessage(error, "发送失败，请稍后再试。"));
      return;
    }
    toast.success(AUTH_MESSAGES.codeResent);
  }

  function backToForm() {
    setPendingEmail(null);
    setPendingNote("");
    setCodeMsg("");
  }

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setMessage(AUTH_MESSAGES.signedOut);
  }

  // ---- Code-entry step ----------------------------------------------------
  if (pendingEmail) {
    return (
      <div className="min-h-screen bg-background px-4 py-20">
        <div className="mx-auto max-w-sm rounded-lg border border-border bg-card p-6">
          <div className="mb-6 flex items-center gap-2">
            <ShieldCheck size={18} className="text-primary" />
            <h1 className="font-mono text-lg font-semibold text-foreground">{AUTH_UI_TEXT.verifyTitle}</h1>
          </div>

          <p className="mb-5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-xs text-emerald-700 dark:text-emerald-300">
            {pendingNote}
            <br />
            验证码已发到 <span className="font-medium">{pendingEmail}</span>。在下面输入 6 位码，或直接点开邮件里的链接完成验证。
          </p>

          <form onSubmit={verifyCode}>
            <label className="mb-2 block text-xs text-muted-foreground" htmlFor="code">
              {AUTH_UI_TEXT.codeLabel}
            </label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              placeholder="6 位数字"
              className="mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.4em] text-foreground outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={verifying}
              className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verifying ? AUTH_UI_TEXT.working : AUTH_UI_TEXT.verifyButton}
            </button>
            {codeMsg && <p className="mt-4 text-sm text-muted-foreground">{codeMsg}</p>}
          </form>

          <div className="mt-5 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => void resendCode()}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {AUTH_UI_TEXT.resendCode}
            </button>
            <button
              type="button"
              onClick={backToForm}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {AUTH_UI_TEXT.useAnotherEmail}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Login / sign-up form ----------------------------------------------
  return (
    <div className="min-h-screen bg-background px-4 py-20">
      <form
        onSubmit={submit}
        data-auth-ready={ready ? "true" : "false"}
        className="mx-auto max-w-sm rounded-lg border border-border bg-card p-6"
      >
        <div className="mb-6 flex items-center gap-2">
          {mode === "login" ? (
            <LogIn size={18} className="text-primary" />
          ) : (
            <UserPlus size={18} className="text-primary" />
          )}
          <h1 className="font-mono text-lg font-semibold text-foreground">
            {mode === "login" ? AUTH_UI_TEXT.loginTitle : AUTH_UI_TEXT.signupTitle}
          </h1>
        </div>

        {gated && (
          <p className="mb-5 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            登录或注册后即可继续创建课程，你刚才的填写会保留。
          </p>
        )}

        {notice && (
          <div className="mb-5 flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-xs text-emerald-700 dark:text-emerald-300">
            <MailCheck size={16} className="mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        <div className="mb-5 grid grid-cols-2 rounded-md border border-border bg-background p-1">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setMessage("");
              setNotice("");
            }}
            className={`rounded px-3 py-2 text-sm transition-colors ${
              mode === "login" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {AUTH_UI_TEXT.signIn}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setMessage("");
              setNotice("");
            }}
            className={`rounded px-3 py-2 text-sm transition-colors ${
              mode === "signup" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {AUTH_UI_TEXT.createAccount}
          </button>
        </div>

        <label className="mb-2 block text-xs text-muted-foreground" htmlFor="email">
          {AUTH_UI_TEXT.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <label className="mb-2 block text-xs text-muted-foreground" htmlFor="password">
          {AUTH_UI_TEXT.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className="mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        {mode === "login" && (
          <div className="-mt-2 mb-4 text-right">
            <Link href="/forgot-password" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
              {AUTH_UI_TEXT.forgotPassword}
            </Link>
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? AUTH_UI_TEXT.working : mode === "login" ? AUTH_UI_TEXT.signIn : AUTH_UI_TEXT.createAccount}
        </button>
        {message && <p className="mt-4 text-sm text-muted-foreground">{message}</p>}
        <button
          type="button"
          onClick={() => void logout()}
          className="mt-4 w-full rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          {AUTH_UI_TEXT.signOut}
        </button>
      </form>
    </div>
  );
}
