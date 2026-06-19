"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { MODEL_CONFIG_STORAGE_KEY, normalizeModelOverrides, parseModelOverrides } from "@/lib/modelOverrides";

export function UserModelConfigSync() {
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const { data: subscription } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== "SIGNED_IN" || !session?.access_token) return;

      const token = session.access_token;
      const localRaw = localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
      const localConfig = parseModelOverrides(localRaw);

      try {
        const res = await fetch("/api/user/model-config", {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const { modelConfig } = (await res.json()) as { modelConfig: unknown };
        const serverConfig = normalizeModelOverrides(modelConfig);

        if (serverConfig) {
          // Server has config; pull down to localStorage so subsequent requests use it immediately
          localStorage.setItem(MODEL_CONFIG_STORAGE_KEY, JSON.stringify(serverConfig));
        } else if (localConfig) {
          // Local has config but server is empty; push up so other devices can use it
          await fetch("/api/user/model-config", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(localConfig),
          });
        }
      } catch {
        // silent — non-critical
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return null;
}
