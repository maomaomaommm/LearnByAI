"use client";

import { useEffect, useState } from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthCallbackShell message="Completing sign in..." />}>
      <AuthCallbackClient />
    </Suspense>
  );
}

function AuthCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Completing sign in...");

  useEffect(() => {
    const code = searchParams.get("code");
    const supabase = createSupabaseBrowserClient();

    if (!supabase || !code) {
      setMessage("Auth callback is unavailable.");
      return;
    }

    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) {
          setMessage(publicSafeErrorMessage(error, "Auth callback failed."));
          return;
        }
        router.replace("/courses");
      })
      .catch((error) => setMessage(publicSafeErrorMessage(error, "Auth callback failed.")));
  }, [router, searchParams]);

  return (
    <AuthCallbackShell message={message} />
  );
}

function AuthCallbackShell({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
      {message}
    </div>
  );
}
