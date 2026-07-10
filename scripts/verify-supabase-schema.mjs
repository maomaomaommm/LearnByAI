import { readFileSync } from "node:fs";
import { join } from "node:path";

const schemaPath = join(process.cwd(), "supabase", "schema.sql");
const rawSql = readFileSync(schemaPath, "utf8");
const compactSql = rawSql.toLowerCase().replace(/\s+/gu, " ");
const expectedSchemaVersion = "learnbyai-beta-2026-06-21-01";

const tables = [
  "profiles",
  "courses",
  "chapters",
  "sections",
  "annotations",
  "annotation_messages",
  "revisions",
  "generation_jobs",
  "quality_reports",
  "exports",
  "usage_events",
  "quota_reservations",
];

for (const table of tables) {
  assertPattern(`table ${table}`, new RegExp(`create table if not exists ${table}\\b`, "u"));
  assertPattern(`RLS ${table}`, new RegExp(`alter table ${table} enable row level security`, "u"));
}

const requiredSnippets = [
  'create policy "users can read own profile"',
  'create policy "users can insert own profile"',
  'create policy "users can update own profile"',
  'create policy "users can read own courses"',
  'create policy "users can read own chapters"',
  'create policy "users can read own sections"',
  'create policy "users can read own annotations"',
  'create policy "users can read own annotation messages"',
  'create policy "users can read own revisions"',
  "alter table annotations add column if not exists scope text",
  "alter table annotations add column if not exists title text",
  "alter table annotations add column if not exists summary text",
  "alter table annotations alter column selected_text drop not null",
  'create policy "users can read own jobs"',
  'create policy "users can read own quality reports"',
  'create policy "users can read own exports"',
  'create policy "users can read own usage"',
  'create policy "users can read own quota reservations"',
  "storage_path text",
  "storage_provider text",
  "locked_by text",
  "locked_until timestamptz",
  "attempts integer not null default 0",
  "create or replace function public.handle_new_user()",
  "create or replace function public.claim_generation_job(",
  "create or replace function public.reserve_usage_quota(",
  "create or replace function public.commit_usage_quota_reservation(",
  "create or replace function public.release_usage_quota_reservation(",
  "pg_advisory_xact_lock",
  "revoke execute on function public.claim_generation_job(uuid, text, integer, integer, integer) from public, anon, authenticated",
  "revoke execute on function public.reserve_usage_quota(uuid, text, integer, timestamptz, uuid, integer) from public, anon, authenticated",
  "revoke execute on function public.commit_usage_quota_reservation(uuid) from public, anon, authenticated",
  "revoke execute on function public.release_usage_quota_reservation(uuid) from public, anon, authenticated",
  "grant execute on function public.claim_generation_job(uuid, text, integer, integer, integer) to service_role",
  "grant execute on function public.reserve_usage_quota(uuid, text, integer, timestamptz, uuid, integer) to service_role",
  "grant execute on function public.commit_usage_quota_reservation(uuid) to service_role",
  "grant execute on function public.release_usage_quota_reservation(uuid) to service_role",
  "create or replace function public.learnbyai_schema_version()",
  `select '${expectedSchemaVersion}'::text`,
  "status in ('pending', 'queued', 'retrying')",
  "generation_jobs_runnable_idx",
  "courses_user_created_idx",
  "chapters_course_order_idx",
  "sections_chapter_order_idx",
  "annotations_user_chapter_created_idx",
  "annotation_messages_annotation_created_idx",
  "revisions_user_chapter_created_idx",
  "exports_user_course_created_idx",
  "usage_events_user_action_created_idx",
  "quota_reservations_user_action_expires_idx",
  "quality_reports_user_target_idx",
  "insert into storage.buckets",
  "'learnbyai-exports'",
  "public, file_size_limit, allowed_mime_types",
  "false, 52428800",
  "application/pdf",
  "application/x-tex",
  "text/plain",
  "application/octet-stream",
  "public = excluded.public",
  "file_size_limit = excluded.file_size_limit",
  "allowed_mime_types = excluded.allowed_mime_types",
  'create policy "users can read own export objects"',
  "auth.uid()::text = (storage.foldername(name))[1]",
];

for (const snippet of requiredSnippets) {
  assertIncludes(snippet);
}

const forbiddenSnippets = [
  'create policy "users can insert own courses"',
  'create policy "users can update own courses"',
  'create policy "users can delete own courses"',
  'create policy "users can insert own chapters"',
  'create policy "users can update own chapters"',
  'create policy "users can delete own chapters"',
  'create policy "users can insert own sections"',
  'create policy "users can update own sections"',
  'create policy "users can delete own sections"',
  'create policy "users can insert own annotations"',
  'create policy "users can update own annotations"',
  'create policy "users can delete own annotations"',
  'create policy "users can insert own annotation messages"',
  'create policy "users can update own annotation messages"',
  'create policy "users can delete own annotation messages"',
  'create policy "users can insert own revisions"',
  'create policy "users can update own revisions"',
  'create policy "users can delete own revisions"',
  'create policy "users can insert own jobs"',
  'create policy "users can update own jobs"',
  'create policy "users can delete own jobs"',
  'create policy "users can insert own quality reports"',
  'create policy "users can update own quality reports"',
  'create policy "users can delete own quality reports"',
  'create policy "users can insert own exports"',
  'create policy "users can update own exports"',
  'create policy "users can delete own exports"',
  'create policy "users can insert own usage"',
  'create policy "users can update own usage"',
  'create policy "users can delete own usage"',
  'create policy "users can insert own quota reservations"',
  'create policy "users can update own quota reservations"',
  'create policy "users can delete own quota reservations"',
  'create policy "users can insert own export objects"',
  'create policy "users can update own export objects"',
  'create policy "users can delete own export objects"',
];

for (const snippet of forbiddenSnippets) {
  assertMissing(snippet);
}

console.log("Supabase schema verification passed.");

function assertPattern(label, pattern) {
  if (!pattern.test(compactSql)) {
    fail(`Missing ${label}`);
  }
}

function assertIncludes(snippet) {
  if (!compactSql.includes(snippet)) {
    fail(`Missing SQL snippet: ${snippet}`);
  }
}

function assertMissing(snippet) {
  if (compactSql.includes(snippet)) {
    fail(`Forbidden SQL snippet present: ${snippet}`);
  }
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}
