"use client";

import { FormEvent, useEffect, useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import {
  AUTH_MESSAGES,
  AUTH_UI_TEXT,
  EmailPasswordAuthMode,
  authenticateWithEmailPassword,
} from "@/lib/emailPasswordAuth";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [mode, setMode] = useState<EmailPasswordAuthMode>("login");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

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
      const result = await authenticateWithEmailPassword(supabase, mode, { email, password });
      if (!result.ok) {
        setMessage(result.message);
        if (result.nextMode) setMode(result.nextMode);
        return;
      }

      window.location.assign("/courses");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setMessage(AUTH_MESSAGES.signedOut);
  }

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

        <div className="mb-5 grid grid-cols-2 rounded-md border border-border bg-background p-1">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setMessage("");
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
