import "server-only";

import { cache } from "react";
import { MODEL_AGENT_NAMES, ModelOverrides, normalizeModelOverrides } from "./modelOverrides";
import { createSupabaseServiceClient } from "./supabase/server";
import { AgentName, UsageEvent } from "./types";

export type AdminAppSettings = {
  modelOverrides?: ModelOverrides;
  quotas?: Partial<Record<UsageEvent["action"], number>>;
  worker?: {
    globalLimit?: number;
    courseChapterConcurrency?: number;
    userCourseConcurrency?: number;
  };
};

export const ADMIN_SETTINGS_KEY = "learnbyai_admin_settings";

export const DEFAULT_ADMIN_SETTINGS: AdminAppSettings = {
  quotas: {},
  worker: {},
};

export const getAdminAppSettings = cache(async (): Promise<AdminAppSettings> => {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return DEFAULT_ADMIN_SETTINGS;

  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", ADMIN_SETTINGS_KEY)
    .maybeSingle();

  if (error || !data?.value) return DEFAULT_ADMIN_SETTINGS;
  return normalizeAdminAppSettings(data.value);
});

export async function saveAdminAppSettings(input: AdminAppSettings, adminUsername: string) {
  const supabase = createSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase 服务未配置，无法保存系统设置。");

  const settings = normalizeAdminAppSettings(input);
  const now = new Date().toISOString();
  const { error } = await supabase.from("app_settings").upsert({
    key: ADMIN_SETTINGS_KEY,
    value: settings,
    updated_by: adminUsername,
    updated_at: now,
  });
  if (error) throw new Error(`保存系统设置失败：${error.message}`);
  return settings;
}

export function normalizeAdminAppSettings(value: unknown): AdminAppSettings {
  const record = isRecord(value) ? value : {};
  const settings: AdminAppSettings = {};

  const modelOverrides = normalizeModelOverrides(record.modelOverrides);
  if (modelOverrides) settings.modelOverrides = modelOverrides;

  const quotas = normalizeQuotas(record.quotas);
  if (Object.keys(quotas).length) settings.quotas = quotas;

  const worker = normalizeWorker(record.worker);
  if (Object.keys(worker).length) settings.worker = worker;

  return settings;
}

export function mergeModelOverrides(
  taskOverrides: ModelOverrides | undefined,
  adminOverrides: ModelOverrides | undefined,
) {
  if (!taskOverrides) return adminOverrides;
  if (!adminOverrides) return taskOverrides;

  return {
    version: 1 as const,
    default: {
      ...adminOverrides.default,
      ...taskOverrides.default,
    },
    agents: MODEL_AGENT_NAMES.reduce((agents, agent) => {
      const fields = {
        ...adminOverrides.agents?.[agent],
        ...taskOverrides.agents?.[agent],
      };
      if (Object.keys(fields).length) agents[agent] = fields;
      return agents;
    }, {} as Partial<Record<AgentName, NonNullable<ModelOverrides["agents"]>[AgentName]>>),
  };
}

function normalizeQuotas(value: unknown) {
  const record = isRecord(value) ? value : {};
  return (["create_course", "generate_chapter", "ask_tutor", "export"] as const).reduce(
    (quotas, action) => {
      const parsed = readPositiveInteger(record[action]);
      if (parsed !== undefined) quotas[action] = parsed;
      return quotas;
    },
    {} as Partial<Record<UsageEvent["action"], number>>,
  );
}

function normalizeWorker(value: unknown) {
  const record = isRecord(value) ? value : {};
  return {
    ...(readPositiveInteger(record.globalLimit) !== undefined ? { globalLimit: readPositiveInteger(record.globalLimit) } : {}),
    ...(readPositiveInteger(record.courseChapterConcurrency) !== undefined
      ? { courseChapterConcurrency: readPositiveInteger(record.courseChapterConcurrency) }
      : {}),
    ...(readPositiveInteger(record.userCourseConcurrency) !== undefined
      ? { userCourseConcurrency: readPositiveInteger(record.userCourseConcurrency) }
      : {}),
  };
}

function readPositiveInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
