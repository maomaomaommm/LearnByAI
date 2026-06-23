"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { AUTH_MESSAGES, AUTH_UI_TEXT } from "@/lib/emailPasswordAuth";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Phase = "checking" | "ready" | "invalid";

export default function ResetPasswordPage() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setMessage(AUTH_MESSAGES.serviceUnavailable);
      setPhase("invalid");
      return;
    }

    // The recovery link carries the token in the URL hash; the client parses it
    // automatically (detectSessionInUrl) and fires PASSWORD_RECOVERY once ready.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setPhase("ready");
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setPhase("ready");
    });

    // If no recovery session materializes shortly, the link is invalid/expired.
    const timeout = window.setTimeout(() => {
      setPhase((current) => (current === "checking" ? "invalid" : current));
    }, 2500);

    return () => {
      window.clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const password = String(new FormData(event.currentTarget).get("password"));
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setMessage(AUTH_MESSAGES.serviceUnavailable);
      setLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMessage(publicSafeErrorMessage(error, "更新失败，请稍后重试。"));
        return;
      }
      toast.success("密码已更新", { description: "正在进入课程中心..." });
      setTimeout(() => window.location.assign("/courses"), 900);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-20">
      <div className="mx-auto max-w-sm rounded-lg border border-border bg-card p-6">
        <div className="mb-6 flex items-center gap-2">
          <LockKeyhole size={18} className="text-primary" />
          <h1 className="font-mono text-lg font-semibold text-foreground">{AUTH_UI_TEXT.resetTitle}</h1>
        </div>

        {phase === "checking" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> 正在校验重置链接…
          </div>
        )}

        {phase === "invalid" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{AUTH_MESSAGES.recoveryLinkInvalid}</p>
            <Link
              href="/forgot-password"
              className="inline-block rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {AUTH_UI_TEXT.forgotTitle}
            </Link>
          </div>
        )}

        {phase === "ready" && (
          <form onSubmit={submit}>
            <label className="mb-2 block text-xs text-muted-foreground" htmlFor="password">
              {AUTH_UI_TEXT.newPassword}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="至少 6 位"
              className="mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? AUTH_UI_TEXT.working : AUTH_UI_TEXT.updatePassword}
            </button>
            {message && <p className="mt-4 text-sm text-muted-foreground">{message}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
