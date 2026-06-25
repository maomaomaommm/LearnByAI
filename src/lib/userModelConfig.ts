import "server-only";

import { getAdminAppSettings, mergeModelOverrides } from "./adminSettings";
import { ModelOverrides, normalizeModelOverrides } from "./modelOverrides";
import { createSupabaseServiceClient } from "./supabase/server";

export async function getUserModelOverrides(userId: string): Promise<ModelOverrides | undefined> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return undefined;

  const { data, error } = await supabase
    .from("profiles")
    .select("model_config")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Failed to load user model overrides:", error.message);
    return undefined;
  }

  return normalizeModelOverrides(data?.model_config);
}

export async function resolveModelOverrides(
  userId: string | undefined,
  requestOverrides?: ModelOverrides,
): Promise<ModelOverrides | undefined> {
  const [userOverrides, adminSettings] = await Promise.all([
    userId ? getUserModelOverrides(userId) : undefined,
    getAdminAppSettings(),
  ]);

  // mergeModelOverrides(winner, base): the FIRST argument wins.
  // Precedence: request overrides > user profile > admin defaults.
  return mergeModelOverrides(
    mergeModelOverrides(requestOverrides, userOverrides),
    adminSettings.modelOverrides,
  );
}
