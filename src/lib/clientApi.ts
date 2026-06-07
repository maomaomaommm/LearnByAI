"use client";

import { createSupabaseBrowserClient } from "./supabase/browser";

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const supabase = createSupabaseBrowserClient();
  const { data } = supabase ? await supabase.auth.getSession() : { data: undefined };
  const token = data?.session?.access_token;
  const localUser = typeof window !== "undefined" ? localStorage.getItem("learnbyai:local-user") : "";

  if (token) headers.set("authorization", `Bearer ${token}`);
  else if (localUser) headers.set("x-learnbyai-user-id", localUser);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return fetch(input, { ...init, headers });
}
