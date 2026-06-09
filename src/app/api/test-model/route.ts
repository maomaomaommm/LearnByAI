import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { apiKey } = body;
    let { baseUrl, model } = body;

    // Default fallbacks
    baseUrl = baseUrl?.trim() || "https://api.openai.com/v1";
    model = model?.trim() || "gpt-4o-mini";
    
    // Ensure baseUrl doesn't end with a slash
    baseUrl = baseUrl.replace(/\/$/, "");
    
    // Ensure baseUrl has /v1 if using common endpoints and not provided
    // but leave it alone if it's explicitly set by user.
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (apiKey?.trim()) {
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    }

    const start = Date.now();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
      }),
      // Short timeout for testing
      signal: AbortSignal.timeout(10000),
    });

    const elapsed = Date.now() - start;

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json({ ok: false, error: `HTTP ${res.status}: ${errorText}` }, { status: 400 });
    }

    const data = await res.json();
    return NextResponse.json({ ok: true, elapsed, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Model test failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
