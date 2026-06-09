"use client";

import { createSseParser } from "./sse";
import { createSupabaseBrowserClient } from "./supabase/browser";
import { MODEL_CONFIG_HEADER, MODEL_CONFIG_STORAGE_KEY, parseModelOverrides } from "./modelOverrides";

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = await createApiHeaders(init);
  return fetch(input, { ...init, headers });
}

export type SseMessage = {
  event: string;
  data?: unknown;
};

export type SseSubscription = {
  close: () => void;
};

export function subscribeToSse(
  input: RequestInfo | URL,
  handlers: {
    onMessage: (message: SseMessage) => void;
    onError?: (error: unknown) => void;
  },
): SseSubscription {
  let closed = false;
  let retryMs = 500;
  let timeout: number | undefined;
  let controller: AbortController | undefined;

  const connect = async () => {
    if (closed) return;

    controller = new AbortController();
    try {
      const headers = await createApiHeaders();
      const response = await fetch(input, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE request failed with status ${response.status}`);
      }

      retryMs = 500;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser((event) => {
        if (closed) return;
        const data = parseSseJson(event.data);
        if (event.event === "done") {
          handlers.onMessage({ event: event.event, data });
          closed = true;
          controller?.abort();
          return;
        }
        handlers.onMessage({ event: event.event, data });
      });

      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      parser.feed(decoder.decode());
      parser.flush();
    } catch (error) {
      if (!closed) handlers.onError?.(error);
    }

    if (!closed) {
      timeout = window.setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 10_000);
    }
  };

  void connect();

  return {
    close() {
      closed = true;
      controller?.abort();
      if (timeout !== undefined) window.clearTimeout(timeout);
    },
  };
}

async function createApiHeaders(init: RequestInit = {}) {
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

  return headers;
}

function parseSseJson(data: string) {
  if (!data) return undefined;

  try {
    return JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
}

function readModelConfigHeader() {
  if (typeof window === "undefined") return "";

  const stored = localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
  if (!stored || !parseModelOverrides(stored)) return "";

  return stored;
}
