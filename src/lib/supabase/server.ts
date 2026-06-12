import "server-only";

import { createClient } from "@supabase/supabase-js";
import { AuthRequiredError, resolveFallbackUserId } from "../authCore";
import { hasSupabaseServerConfig, isTrustedInternalWorkerRequest } from "../config";

export { AuthRequiredError };

export function createSupabaseServiceClient() {
  if (!hasSupabaseServerConfig()) return undefined;

  const serviceUrl = process.env.SUPABASE_SERVICE_URL || process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;

  return createClient(
    serviceUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export async function resolveUserId(request?: Request) {
  const token = request?.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const supabase = createSupabaseServiceClient();

  if (supabase && token && !isTrustedInternalWorkerRequest(request)) {
    const { data } = await supabase.auth.getUser(token);
    if (data.user?.id) return data.user.id;
  }

  return resolveFallbackUserId(request);
}
