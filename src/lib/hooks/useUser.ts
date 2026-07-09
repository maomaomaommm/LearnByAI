"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase/browser";

/**
 * Client-side auth state.
 * Returns `undefined` while resolving, `null` when signed out, the `User` when signed in.
 * Keeps in sync via Supabase's onAuthStateChange so the nav/create gate react to login/logout.
 */
/**
 * Whether Supabase auth is configured in this deployment. In local fallback
 * mode (no Supabase env) there is no login system at all — pages must not
 * bounce visitors to a /login that cannot work; the server resolves the
 * implicit local-beta user from headers instead.
 */
export function isSupabaseAuthEnabled() {
  return isSupabaseBrowserConfigured();
}

export function useUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setUser(null);
      return;
    }

    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setUser(data.user ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return user;
}
