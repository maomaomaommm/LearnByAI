"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AUTH_MESSAGES, AUTH_UI_TEXT } from "@/lib/emailPasswordAuth";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function AuthCallbackPage() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("正在完成验证…");

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError(AUTH_MESSAGES.serviceUnavailable);
      return;
    }

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const search = new URLSearchParams(window.location.search);
    let done = false;

    const finish = (type: string | null) => {
      if (done) return;
      done = true;
      setMessage("验证成功，正在进入…");
      const target = type === "recovery" ? "/reset-password" : "/courses";
      window.setTimeout(() => window.location.assign(target), 700);
    };

    // 1) The link came back with an error in the hash (expired / already used / invalid).
    if (hash.get("error") || hash.get("error_code")) {
      setError(AUTH_MESSAGES.linkExpired);
      return;
    }

    // 2) PKCE code exchange (?code=...), e.g. OAuth providers.
    const code = search.get("code");
    if (code) {
      supabase.auth
        .exchangeCodeForSession(code)
        .then(({ error }) => {
          if (error) {
            setError(publicSafeErrorMessage(error, AUTH_MESSAGES.linkExpired));
            return;
          }
          finish(hash.get("type"));
        })
        .catch((e) => setError(publicSafeErrorMessage(e, AUTH_MESSAGES.linkExpired)));
      return;
    }

    // 3) Implicit flow: tokens arrive in the hash; detectSessionInUrl establishes the
    //    session asynchronously. Announce success once a session exists.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish(hash.get("type"));
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish(hash.get("type"));
    });
    const timeout = window.setTimeout(() => {
      if (!done) setError(AUTH_MESSAGES.linkExpired);
    }, 3000);

    return () => {
      window.clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center">
        {error ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">{error}</p>
            <Link
              href="/login"
              className="inline-block rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
            >
              {AUTH_UI_TEXT.backToLogin}
            </Link>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{message}</p>
        )}
      </div>
    </div>
  );
}
