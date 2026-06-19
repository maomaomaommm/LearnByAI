"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { normalizeModelOverrides } from "@/lib/modelOverrides";

export function ModelConfigWarning() {
  const [dismissed, setDismissed] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const supabase = createSupabaseBrowserClient();
        const {
          data: { session },
        } = await supabase?.auth.getSession() ?? { data: { session: null } };
        if (!session) {
          if (!cancelled) setConfigured(true);
          return;
        }
        const res = await fetch("/api/user/model-config", {
          headers: { authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          if (!cancelled) setConfigured(true);
          return;
        }
        const { modelConfig } = (await res.json()) as { modelConfig: unknown };
        const overrides = normalizeModelOverrides(modelConfig);
        const hasKey = Boolean(
          overrides?.default?.apiKey ||
            Object.values(overrides?.agents ?? {}).some((agent) => agent?.apiKey),
        );
        if (!cancelled) setConfigured(hasKey);
      } catch {
        if (!cancelled) setConfigured(true);
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  if (configured === null || configured || dismissed) return null;

  return (
    <div className="border-b border-amber-500/20 bg-amber-50 px-4 py-2.5 dark:bg-amber-950/30">
      <div className="mx-auto flex max-w-7xl items-start gap-3 text-xs">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1">
          <p className="font-medium text-amber-800 dark:text-amber-200">
            当前暂未识别到可用 API，请在模型设置里填入可用 API，否则课程生成将走 mock 模式。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
          aria-label="关闭警告"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
