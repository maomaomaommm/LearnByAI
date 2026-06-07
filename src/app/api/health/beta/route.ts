import { NextResponse } from "next/server";
import { LEARNBYAI_SCHEMA_VERSION } from "@/lib/betaContract";
import { getSupabaseExportsBucket, hasSupabaseServerConfig, isMockMode } from "@/lib/config";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const requiredExportMimeTypes = ["application/pdf", "application/x-tex", "text/plain"];

export async function GET() {
  if (!hasSupabaseServerConfig()) {
    return NextResponse.json(
      {
        ok: false,
        expectedSchemaVersion: LEARNBYAI_SCHEMA_VERSION,
        actualSchemaVersion: null,
        runtime: runtimeHealth(),
        error: "Supabase server configuration is missing.",
      },
      responseInit(503),
    );
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        expectedSchemaVersion: LEARNBYAI_SCHEMA_VERSION,
        actualSchemaVersion: null,
        runtime: runtimeHealth(),
        error: "Supabase service client is unavailable.",
      },
      responseInit(503),
    );
  }

  const storage = await exportStorageHealth(supabase);
  const { data, error } = await supabase.rpc("learnbyai_schema_version");
  if (error) {
    return NextResponse.json(
      {
        ok: false,
        expectedSchemaVersion: LEARNBYAI_SCHEMA_VERSION,
        actualSchemaVersion: null,
        runtime: runtimeHealth(storage),
        error: "Supabase schema version check failed.",
      },
      responseInit(503),
    );
  }

  const actualSchemaVersion = typeof data === "string" ? data : null;
  const ok = actualSchemaVersion === LEARNBYAI_SCHEMA_VERSION;

  return NextResponse.json(
    {
      ok,
      expectedSchemaVersion: LEARNBYAI_SCHEMA_VERSION,
      actualSchemaVersion,
      runtime: runtimeHealth(storage),
    },
    responseInit(ok ? 200 : 503),
  );
}

function runtimeHealth(storage?: Awaited<ReturnType<typeof exportStorageHealth>>) {
  return {
    supabaseConfigured: hasSupabaseServerConfig(),
    aiProviderConfigured: Boolean(process.env.AI_API_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL),
    aiMockMode: isMockMode(),
    workerMode: process.env.GENERATION_WORKER_MODE || "inline",
    workerSecretConfigured: Boolean(process.env.INTERNAL_WORKER_SECRET),
    exportsBucket: getSupabaseExportsBucket(),
    exportStorage: storage ?? {
      bucketExists: false,
      private: false,
      fileSizeLimit: null,
      missingMimeTypes: requiredExportMimeTypes,
    },
  };
}

async function exportStorageHealth(supabase: NonNullable<ReturnType<typeof createSupabaseServiceClient>>) {
  const bucket = getSupabaseExportsBucket();
  const { data, error } = await supabase.storage.getBucket(bucket);
  if (error || !data) {
    return {
      bucketExists: false,
      private: false,
      fileSizeLimit: null,
      missingMimeTypes: requiredExportMimeTypes,
    };
  }

  const allowed = Array.isArray(data.allowed_mime_types) ? data.allowed_mime_types : [];
  return {
    bucketExists: true,
    private: data.public === false,
    fileSizeLimit: typeof data.file_size_limit === "number" ? data.file_size_limit : null,
    missingMimeTypes: requiredExportMimeTypes.filter((mime) => !allowed.includes(mime)),
  };
}

function responseInit(status: number) {
  return {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  };
}
