import { UsageEvent } from "./types";

const LIMITS: Record<UsageEvent["action"], number> = {
  create_course: 20,
  generate_chapter: 100,
  ask_tutor: 300,
  export: 30,
};

const LIMIT_ENV: Record<UsageEvent["action"], string> = {
  create_course: "QUOTA_CREATE_COURSE",
  generate_chapter: "QUOTA_GENERATE_CHAPTER",
  ask_tutor: "QUOTA_ASK_TUTOR",
  export: "QUOTA_EXPORT",
};

export function readQuotaLimit(action: UsageEvent["action"]) {
  const configured = process.env[LIMIT_ENV[action]] ?? process.env.E2E_QUOTA_LIMIT;
  if (!configured) return LIMITS[action];

  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) return LIMITS[action];
  return Math.floor(parsed);
}
