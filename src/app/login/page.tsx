"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [localUser, setLocalUser] = useState("");

  useEffect(() => {
    setLocalUser(localStorage.getItem("learnbyai:local-user") ?? "");
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      localStorage.setItem("learnbyai:local-user", email);
      setLocalUser(email);
      setMessage("Supabase is not configured. You are signed in as a local Beta user.");
      setTimeout(() => router.push("/courses"), 500);
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    setMessage(error ? publicSafeErrorMessage(error, "Sign-in failed. Please try again.") : "Magic link sent. Check your inbox.");
  }

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    localStorage.removeItem("learnbyai:local-user");
    setLocalUser("");
    setMessage("Signed out.");
  }

  return (
    <div className="min-h-screen bg-background px-4 py-20">
      <form onSubmit={login} className="mx-auto max-w-sm rounded-lg border border-border bg-card p-6">
        <div className="mb-6 flex items-center gap-2">
          <LogIn size={18} className="text-primary" />
          <h1 className="font-mono text-lg font-semibold text-foreground">Sign in to LearnByAI</h1>
        </div>
        <label className="mb-2 block text-xs text-muted-foreground" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          defaultValue="beta@example.com"
          className="mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <button
          disabled={loading}
          className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {loading ? "Working..." : "Send magic link / local sign in"}
        </button>
        {message && <p className="mt-4 text-sm text-muted-foreground">{message}</p>}
        {localUser && (
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-4 w-full rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Sign out local beta user
          </button>
        )}
      </form>
    </div>
  );
}
