"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { KeyRound, MailCheck } from "lucide-react";
import { AUTH_MESSAGES, AUTH_UI_TEXT } from "@/lib/emailPasswordAuth";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const email = String(new FormData(event.currentTarget).get("email")).trim();
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setMessage(AUTH_MESSAGES.serviceUnavailable);
      setLoading(false);
      return;
    }

    try {
      // The reset link lands on /reset-password, where the user sets a new password.
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Always show the same confirmation — never reveal whether the email exists.
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-20">
      <div className="mx-auto max-w-sm rounded-lg border border-border bg-card p-6">
        <div className="mb-6 flex items-center gap-2">
          <KeyRound size={18} className="text-primary" />
          <h1 className="font-mono text-lg font-semibold text-foreground">{AUTH_UI_TEXT.forgotTitle}</h1>
        </div>

        {sent ? (
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-xs text-emerald-700 dark:text-emerald-300">
            <MailCheck size={16} className="mt-0.5 shrink-0" />
            <span>{AUTH_MESSAGES.resetEmailSent}</span>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className="mb-5 text-xs text-muted-foreground">
              输入你注册时用的邮箱，我们会给你发一封重置密码的邮件。
            </p>
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
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? AUTH_UI_TEXT.working : AUTH_UI_TEXT.sendResetLink}
            </button>
            {message && <p className="mt-4 text-sm text-muted-foreground">{message}</p>}
          </form>
        )}

        <div className="mt-5 text-center">
          <Link href="/login" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            {AUTH_UI_TEXT.backToLogin}
          </Link>
        </div>
      </div>
    </div>
  );
}
