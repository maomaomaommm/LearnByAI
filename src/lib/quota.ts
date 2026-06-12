import { UsageEvent } from "./types";
import { readEffectiveQuotaLimit } from "./quotaConfig";
import {
  commitServerUsageQuotaReservation,
  countServerUsageEvents,
  releaseServerUsageQuotaReservation,
  reserveServerUsageQuota,
  saveServerUsageEvent,
} from "./serverStore";

export type QuotaResult =
  | { ok: true; actor: string; limit: number; remaining: number }
  | { ok: false; actor: string; limit: number; remaining: 0; message: string };

export type QuotaConsumptionResult<T> =
  | { ok: true; quota: Extract<QuotaResult, { ok: true }>; value: T }
  | { ok: false; quota: Extract<QuotaResult, { ok: false }> };

const quotaLocks = new Map<string, Promise<void>>();

export async function checkQuota(
  userId: string | undefined,
  action: UsageEvent["action"],
): Promise<QuotaResult> {
  const actor = userId ?? "local-beta-user";
  const limit = await readEffectiveQuotaLimit(action);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const count = await countServerUsageEvents(actor, action, since);
  const remaining = Math.max(0, limit - count);

  if (remaining <= 0) {
    return {
      ok: false,
      actor,
      limit,
      remaining: 0,
      message: `Daily quota for ${action} is exhausted. Please try again later.`,
    };
  }

  return { ok: true, actor, limit, remaining };
}

export async function withQuotaConsumption<T>(
  userId: string | undefined,
  action: UsageEvent["action"],
  operation: (quota: Extract<QuotaResult, { ok: true }>) => Promise<T>,
): Promise<QuotaConsumptionResult<T>> {
  const actor = userId ?? "local-beta-user";

  return withQuotaLock(actor, action, async () => {
    const quota = await checkQuota(actor, action);
    if (!quota.ok) {
      return { ok: false, quota };
    }

    const event = createUsageEvent(actor, action);
    const reservation = await reserveServerUsageQuota(event, quota.limit, sinceIso());
    if (!reservation.ok) {
      return {
        ok: false,
        quota: exhaustedQuota(actor, action, quota.limit),
      };
    }

    try {
      const reservedQuota = reservation.usedCount === undefined
        ? quota
        : {
            ...quota,
            remaining: Math.max(1, quota.limit - (reservation.usedCount - 1)),
          };
      const value = await operation(reservedQuota);
      const usageEvent = await commitServerUsageQuotaReservation(event);
      const consumed = quotaAfterConsumption(reservedQuota);
      return {
        ok: true,
        quota: {
          ...consumed,
          actor: usageEvent.userId ?? consumed.actor,
        },
        value,
      };
    } catch (error) {
      await releaseServerUsageQuotaReservation(event).catch(() => undefined);
      throw error;
    }
  });
}

export async function consumeQuota(
  userId: string | undefined,
  action: UsageEvent["action"],
  quota?: Extract<QuotaResult, { ok: true }>,
) {
  const checkedQuota = quota ?? await checkQuota(userId, action);
  if (!checkedQuota.ok) return checkedQuota;

  await saveServerUsageEvent(createUsageEvent(checkedQuota.actor, action));
  return quotaAfterConsumption(checkedQuota);
}

export const assertQuota = checkQuota;

function sinceIso() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function createUsageEvent(userId: string, action: UsageEvent["action"]): UsageEvent {
  return {
    id: crypto.randomUUID(),
    userId,
    action,
    createdAt: new Date().toISOString(),
  };
}

function quotaAfterConsumption(quota: Extract<QuotaResult, { ok: true }>) {
  return { ...quota, remaining: Math.max(0, quota.remaining - 1) };
}

function exhaustedQuota(
  actor: string,
  action: UsageEvent["action"],
  limit: number,
): Extract<QuotaResult, { ok: false }> {
  return {
    ok: false,
    actor,
    limit,
    remaining: 0,
    message: `Daily quota for ${action} is exhausted. Please try again later.`,
  };
}

async function withQuotaLock<T>(
  actor: string,
  action: UsageEvent["action"],
  operation: () => Promise<T>,
) {
  const lockKey = `${actor}:${action}`;
  const previous = quotaLocks.get(lockKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  quotaLocks.set(lockKey, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (quotaLocks.get(lockKey) === tail) {
      quotaLocks.delete(lockKey);
    }
  }
}
