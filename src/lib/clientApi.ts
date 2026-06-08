"use client";

import { createSupabaseBrowserClient } from "./supabase/browser";
import { MODEL_CONFIG_HEADER, MODEL_CONFIG_STORAGE_KEY, parseModelOverrides } from "./modelOverrides";

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const supabase = createSupabaseBrowserClient();
  const { data } = supabase ? await supabase.auth.getSession() : { data: undefined };
  const token = data?.session?.access_token;
  const localUser = typeof window !== "undefined" ? localStorage.getItem("learnbyai:local-user") : "";
  const modelConfig = readModelConfigHeader();

  if (token) headers.set("authorization", `Bearer ${token}`);
  else if (localUser) headers.set("x-learnbyai-user-id", localUser);
  if (modelConfig) headers.set(MODEL_CONFIG_HEADER, modelConfig);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return fetch(input, { ...init, headers });
}

function readModelConfigHeader() {
  if (typeof window === "undefined") return "";

  const stored = localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
  if (!stored || !parseModelOverrides(stored)) return "";

  return stored;
}
