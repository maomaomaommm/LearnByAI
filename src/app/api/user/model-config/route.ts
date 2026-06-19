import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { normalizeModelOverrides } from "@/lib/modelOverrides";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ modelConfig: null });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("model_config")
    .eq("id", auth.userId)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: "Failed to load model config" }, { status: 500 });
  }

  return NextResponse.json({ modelConfig: data?.model_config ?? null });
}

export async function PUT(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const normalized = normalizeModelOverrides(body);

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: auth.userId, model_config: normalized ?? null }, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ error: "Failed to save model config" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ model_config: null })
    .eq("id", auth.userId);

  if (error) {
    return NextResponse.json({ error: "Failed to clear model config" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
