# LearnByAI Development Guide

This document is the current engineering guide for the LearnByAI Beta track.

## 1. Current Product State

LearnByAI is moving from a local-first MVP into a small-user Beta. The current implementation supports:

- Course shell creation through the API, with Course Bible and outline generation handled by a background ARCHITECT job.
- Chapter generation on demand through AUTHOR and POLISHER agents.
- REVIEWER-backed TQH quality reports for generated chapters.
- Background course-planning and first-chapter jobs scheduled through a local in-process runner, with course-page fallback triggering and job recovery from course snapshots in local fallback mode.
- Structured chapter sections, with old Markdown blobs migrated into a single legacy section.
- Anchored reader questions through the TUTOR workflow.
- Local browser persistence as the default fallback.
- Supabase-ready server persistence when Supabase environment variables are configured.
- Supabase magic-link callback handling plus local Beta login/logout fallback.
- PDF/TeX export jobs with metadata persisted separately from local fallback file bytes. PDF exports are valid PDF bytes; in configured Supabase mode, export bytes must write to Supabase Storage instead of silently falling back to local files.
- Per-user quota checks and success-only usage-event audit records for course creation, chapter generation, tutor answers, and export.
- Playwright E2E gates that run in mock AI mode by default.

Important current behavior:

- `POST /api/courses` creates a pending course shell and generation job, returns immediately, then schedules Course Bible, chapter outline, and first-chapter generation in the background.
- Opening a chapter triggers `POST /api/chapters/[id]/generate` if the chapter has no content or sections.
- In local fallback mode, API calls accept a course snapshot from the browser so E2E and offline development remain stable.
- Real AI smoke tests are opt-in and require `AI_API_KEY`.

## 2. Tech Stack

- Framework: Next.js App Router
- Language: TypeScript
- UI: Tailwind CSS and shadcn-style components
- Markdown rendering: `react-markdown`
- Math rendering: `remark-math` + `rehype-katex`
- AI provider: OpenAI-compatible chat completions endpoint
- Default model env: `AI_MODEL=gpt-5.5`
- Auth/database target: Supabase Auth + Supabase Postgres
- E2E: Playwright

## 3. Environment

Create `.env.local` from `.env.example`. `.env` and `.env*.local` are ignored to reduce
the chance of accidentally committing real secrets.

Required for real AI:

```env
AI_API_BASE_URL=https://api.yzccc.cloud/v1
AI_API_KEY=your_api_key
AI_MODEL=gpt-5.5
AI_MOCK_MODE=false
```

Required for Supabase mode:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_EXPORTS_BUCKET=learnbyai-exports
APP_BASE_URL=
GENERATION_WORKER_MODE=inline
INTERNAL_WORKER_SECRET=
GENERATION_WORKER_JOB_ID=
GENERATION_WORKER_LIMIT=
QUOTA_CREATE_COURSE=
QUOTA_GENERATE_CHAPTER=
QUOTA_ASK_TUTOR=
QUOTA_EXPORT=
BETA_READINESS_STRICT=
SUPABASE_SMOKE_RLS=
SUPABASE_SMOKE_REQUIRED=
SUPABASE_SMOKE_USER_ID=
WORKER_HANDOFF_REQUIRED=
AI_SMOKE=
AI_SMOKE_REQUIRED=
```

In Supabase mode, user API calls must include a valid Supabase bearer token. The `x-learnbyai-user-id` header is accepted only in local fallback mode. For production background workers, set `APP_BASE_URL` and `INTERNAL_WORKER_SECRET`; without the secret, `/api/internal/generation-worker` is intentionally unavailable when Supabase is configured. Worker calls may authenticate with either `Authorization: Bearer <INTERNAL_WORKER_SECRET>` or `x-internal-worker-secret`; exact `jobId` recovery does not require a user session because the worker resolves the job owner from the service-role job record before running.

`npm run worker:once` is the cron/queue-friendly external worker entrypoint. It loads `.env` and `.env.local`, posts to `${APP_BASE_URL}/api/internal/generation-worker`, sends the worker secret as a bearer token, and prints only processed/result counts. Set `GENERATION_WORKER_JOB_ID` to retry one exact job, or `GENERATION_WORKER_LIMIT` to cap the number of queued jobs claimed in one invocation.

Daily quota defaults are `create_course=20`, `generate_chapter=100`, `ask_tutor=300`, and `export=30`. Override them with the `QUOTA_*` variables above for Beta cohorts; Playwright still uses `E2E_QUOTA_LIMIT=2` as a test-only override. APIs run quota-controlled work through a per-user/per-action serialized gate. In local fallback mode this is an in-process lock; in configured Supabase mode it first creates an atomic `quota_reservations` row through the `reserve_usage_quota` RPC, commits it to `usage_events` only after the requested course/job/output is successfully persisted, and releases the reservation on failure. Failed AI, Storage, or ownership checks do not consume quota, and concurrent requests cannot bypass quota in local fallback or through a migrated Supabase database.

Optional per-agent overrides are supported for:

```text
ARCHITECT_*
AUTHOR_*
POLISHER_*
REVIEWER_*
TUTOR_*
```

`npm run test:beta-ready` validates optional per-agent override formats without printing values:
`*_API_BASE_URL` must be an absolute `http(s)` URL, `*_TEMPERATURE` must be numeric, and
`*_MAX_TOKENS` must be a positive integer.

Never commit `.env.local` or API keys. A real API key was shared during planning and must be rotated before any Beta launch.
The Beta readiness preflight rejects obvious placeholder secrets, identical Supabase anon/service-role keys, and in strict mode requires `INTERNAL_WORKER_SECRET` to be at least 32 characters. It reports variable names and problem types, not secret values.
It also validates `SUPABASE_EXPORTS_BUCKET`. The current strict Beta contract expects
`learnbyai-exports`, because `supabase/schema.sql` creates that private bucket and its read policy.
Using a custom bucket requires updating the schema, Storage policies, and health/smoke expectations
before running the final gate.
Local Node scripts load `.env` and `.env.local` through `scripts/load-env.mjs`; variables already
present in the shell keep priority. The loader is used by `test:e2e`, `test:ai-smoke`, and
`test:supabase-smoke`, and it never prints secret values.

## 4. Commands

```bash
npm install
npm run dev
npm run lint
npm run test:unit
npm run test:schema
npm run test:beta-ready
npm run worker:once
npm run test:phase-gate
npm run test:beta-gate
npm run test:beta-health
npm run test:worker-handoff
npm run build
npm run test:e2e
```

Real provider smoke test:

```bash
AI_SMOKE=true
npm run test:ai-smoke
```

On PowerShell, set `$env:AI_SMOKE="true"` in the same terminal before running the command. `AI_API_KEY` must also be present in the environment. This path starts the Playwright dev server with `AI_MOCK_MODE=false`. In Supabase mode it creates temporary confirmed auth users, signs in with the anon key, and uses real bearer tokens. The smoke covers course planning, first-chapter generation through AUTHOR/POLISHER/REVIEWER, API-level course/export isolation between users, worker-secret rejection for unauthenticated internal worker calls, persisted anchored TUTOR Q&A, PDF export, TeX export, export download bytes, usage totals for create/generate/tutor/export, and cleanup of generated Storage objects.

Live Supabase smoke test after applying `supabase/schema.sql` to a real project:

```bash
npm run test:supabase-smoke
```

The live project must expose `public.learnbyai_schema_version()` returning
`learnbyai-beta-2026-06-07-03`; this function is created by `supabase/schema.sql`. The smoke test
calls it before deeper checks, so an older or partially applied migration fails fast.

Set `SUPABASE_SMOKE_USER_ID` to an existing auth user id when you want the script to verify Storage upload/download round trips. Set `SUPABASE_SMOKE_RLS=true` when you want it to create two temporary confirmed auth users and verify the auth profile trigger, profile RLS, course RLS, and Storage export-object RLS. The RLS smoke also attempts direct authenticated insert, update, and delete operations against every API-owned application table and fails if any table allows client-side mutations that could bypass ownership, quota, or audit checks. It also inserts a pending generation job and verifies the `claim_generation_job` RPC blocks duplicate worker claims until the lease expires. Internal worker/quota RPCs are granted only to `service_role`; the smoke fails if an authenticated user can call them directly. The smoke checks every application table declared in `supabase/schema.sql`, not only the tables touched by the happy path. It also verifies the export Storage bucket is private, keeps the expected 10 MiB limit, and allows the PDF/TeX/plain export MIME types.

Beta readiness preflight:

```bash
npm run test:beta-ready
```

This checks that real Supabase, real AI, export Storage bucket, worker-secret, quota, and live-smoke flags are ready
without printing secret values. It is expected to fail in local fallback mode until the real
Beta environment is configured. Set `BETA_READINESS_STRICT=true` for final Beta checks; strict
mode turns production worker mode, explicit quota values, and live-smoke flags from warnings into
failures. Final readiness requires both smoke suites to be marked required with
`SUPABASE_SMOKE_REQUIRED=true` and `AI_SMOKE_REQUIRED=true`, so missing credentials cannot silently
turn a live check into a skip. Readiness also fails if required secrets look like placeholders,
if Supabase anon and service-role keys are identical, or if the strict worker secret is too short.

Local phase gate:

```bash
npm run test:phase-gate
```

This runs lint, unit tests, schema verification, build, and mock E2E sequentially. It intentionally
clears Supabase and real AI credentials in child processes so local phase validation stays on the
deterministic mock/local fallback path even when `.env.local` contains production credentials.

Deployed Beta health check:

```bash
npm run test:beta-health
```

This calls `${APP_BASE_URL}/api/health/beta` with no-store/no-cache semantics and verifies the deployed app expects and can read the same Supabase schema contract version as the local gate. It also checks non-secret runtime flags from the deployed app: Supabase server config must be active, AI provider config must be present, AI mock mode must be off, worker mode must be `external`, the internal worker secret must be configured, and the deployed export bucket must match local `SUPABASE_EXPORTS_BUCKET` (default `learnbyai-exports`). The deployed app also checks the export Storage bucket through Supabase: it must exist, be private, keep the 10 MiB file size limit from `supabase/schema.sql`, and allow the PDF/TeX/plain export MIME types. It is part of the final Beta gate so a live database smoke cannot pass while the deployed app is still running an older build, connected to an unmigrated project, deployed with local/mock runtime settings, or pointed at a different export bucket than the smoke tests. In strict readiness mode, `APP_BASE_URL` must point to the deployed Beta app rather than `localhost` or a loopback address.

External worker handoff smoke:

```bash
npm run test:worker-handoff
```

This creates a temporary confirmed Supabase user, signs in through the anon key, creates a course
through the deployed API, verifies the returned course job is queued, invokes the external worker
with `INTERNAL_WORKER_SECRET` for that exact job, waits for the job to succeed, verifies planned
chapters and the first chapter job were persisted, then deletes the temporary auth user. By default
it skips when live env is missing; final Beta gate sets `WORKER_HANDOFF_REQUIRED=true`.

Final Beta gate after live environment configuration:

```bash
npm run test:beta-gate
```

This runs strict readiness, the local phase gate, live Supabase smoke with RLS enabled, deployed app health, the external
worker handoff smoke, and the real AI smoke. It requires a real Supabase project with `supabase/schema.sql` applied, explicit quota env
values, `APP_BASE_URL`, `GENERATION_WORKER_MODE=external`, `INTERNAL_WORKER_SECRET`, and real AI provider env vars.
Strict readiness requires enough quota for the smoke path: at least one course, one chapter, one
TUTOR question, and two exports. It also sets `SUPABASE_SMOKE_REQUIRED=true` and
`WORKER_HANDOFF_REQUIRED=true` and `AI_SMOKE_REQUIRED=true` before invoking the live smoke suites.

The default E2E run uses `AI_MOCK_MODE=true` and starts a dev server on `localhost:3100`.
`npm run test:e2e` is routed through `scripts/run-e2e.mjs`, which cleans transient `.next`
build artifacts, starts the Next dev server, waits for the TCP port to open, runs Playwright
with `PLAYWRIGHT_EXTERNAL_SERVER=true`, and then kills the server process tree. The default
Playwright config uses one worker for deterministic local fallback persistence. Use `E2E_PORT`
or `PLAYWRIGHT_BASE_URL` only when another process already owns port `3100`.

## 5. Key Architecture

### MAOL

Files under `src/lib/maol` provide:

- Agent registry from environment variables.
- Dispatcher for agent text calls and mock fallback. Mock fallback is allowed only when
  `AI_MOCK_MODE=true` or no `AI_API_KEY` is configured; real provider mode surfaces agent
  failures instead of silently replacing them with mock content.
- Job state events.
- Result integration from Markdown to structured sections.
- Client methods: `generateCourse`, `generateChapter`, `askTutor`.

Agent calls append `generation_jobs.payload.events` as they start, return mock output, complete, or fail. Course, chapter, reviewer, and tutor workflows persist these job updates immediately through the server store so job polling and audit views survive refreshes and process restarts.
User-facing API errors and job failure messages pass through `src/lib/safeError.ts`, which redacts
bearer tokens, API-key-shaped strings, and provider payloads before they are returned or persisted.
Client-side user-visible failures use `src/lib/publicSafeError.ts` before rendering messages in
login, auth callback, course creation, chapter generation, TUTOR, and export flows. Provider
payloads, Supabase internals, bearer tokens, API keys, access tokens, and long opaque values should
never be displayed in UI copy.

### TQH

Files under `src/lib/quality` provide:

- Structure validation.
- Markdown/LaTeX format validation.
- Chapter continuity validation.
- Lightweight overclaim/fact guard.
- A chapter quality pipeline that returns score, status, and issues.
- A deterministic self-repair pass for repairable format failures before failed content is exposed as ready.

### Persistence

`src/lib/serverStore.ts` is the server persistence adapter:

- Uses Supabase service role when Supabase env vars exist.
- Falls back to in-memory server state for local runs.
- Persists courses, chapters, sections, generation jobs, quality reports, annotations, exports, and usage events where possible.
- Treats Supabase read/write errors as hard failures in configured Supabase mode, so broken migrations, RLS assumptions, or missing tables are caught by smoke tests instead of being masked by local fallback state.

`supabase/schema.sql` provisions the application tables, profile RLS, read-only user policies for app data, the auth user profile trigger, quota reservation RPCs, a schema contract function named `public.learnbyai_schema_version()`, and a private `learnbyai-exports` Supabase Storage bucket. Client sessions can read their own rows and export objects; writes and internal RPC calls go through the Next.js API using the service-role server adapter so quota, ownership, worker claims, and audit checks cannot be bypassed by direct Supabase client writes or direct authenticated RPC calls. Export object policies require the authenticated user id to match the first path segment, so generated file paths must keep the shape `userId/courseId/exportId.format`. When Supabase is configured and the user id is a real UUID, export upload/download failures are treated as real failures rather than downgraded to local file storage.

Background workers claim generation jobs before running them. Local fallback uses an in-process lease; Supabase mode uses the `claim_generation_job` RPC plus `locked_by`, `locked_until`, and `attempts` columns so concurrent cron invocations do not process the same queued job twice.

`src/lib/storage.ts` remains the browser fallback and migration layer.

### API Surface

- `GET /api/courses`
- `POST /api/courses`
- `GET /api/courses/[id]`
- `GET /auth/callback`
- `POST /api/chapters`: disabled legacy endpoint, returns `410`; use the owned-course route below.
- `POST /api/chapters/[id]/generate`
- `GET /api/annotations?chapterId=...`
- `POST /api/annotations`
- `GET /api/generation-jobs/[id]`
- `POST /api/internal/generation-worker`
- `GET /api/exports?courseId=...`
- `POST /api/exports`
- `GET /api/exports/[id]`
- `GET /api/usage?action=create_course|generate_chapter|ask_tutor|export`

## 6. Beta Phase Status

- Phase 0, baseline and E2E gates: completed.
- Phase 1, Supabase auth/database: implemented as Supabase-ready adapter plus local fallback; needs testing against a real Supabase project.
- Phase 2, MAOL core: implemented.
- Phase 3, TQH quality harness plus REVIEWER stage: implemented.
- Phase 4, background course and first-chapter generation: implemented through queued course/chapter jobs, in-process scheduling from course creation, an internal worker endpoint for external cron/queue recovery, course-page fallback triggering, job polling, retry support, service-role exact job recovery, and E2E verification. A production deployment should call `/api/internal/generation-worker` from a durable queue/cron and set `INTERNAL_WORKER_SECRET`.
- Phase 5, structured sections: implemented for generated content and legacy migration.
- Phase 6, export/quota hardening: implemented as local/Supabase-ready adapter with metadata plus local file-store downloads, per-user usage-event audit records, a read-only current-user usage endpoint, local serialized quota consumption, and Supabase atomic quota reservations. Quota is consumed only after ownership/resource checks pass and requested resources are successfully persisted. Supabase Storage upload/download, quota reservation RPCs, and bucket/object policies are defined in `supabase/schema.sql`, and configured Supabase mode now fails hard on database or Storage persistence errors; a real project still needs migration execution and live RLS/RPC verification.

Persisted annotations require a current-user course anchor. `POST /api/annotations` accepts lightweight non-persisted TUTOR questions without `annotation`, but when `annotation` is provided the server verifies `courseId`, `chapterId`, and optional `sectionId` against the authenticated user's course before consuming `ask_tutor` quota or calling TUTOR.

## 7. Stage Gate

Before moving any phase forward:

```bash
npm run test:beta-ready
npm run test:phase-gate
```

`npm run test:beta-ready` is a production-readiness gate, not a local fallback gate. It may
fail locally when real Supabase/AI credentials are intentionally absent; do not treat the final
Beta as complete until `npm run test:beta-gate` passes in the configured Beta environment.
`npm run test:phase-gate` expands to `lint`, `test:unit`, `test:schema`, `build`, and mock `test:e2e`.

Run `npm run build` and `npm run test:e2e` sequentially. Both commands use `.next`, and running them in parallel can corrupt transient build artifacts.

Latest local gate evidence: `npm run test:unit`, `npm run test:schema`, `npm run lint`,
`npm run build`, `npm run test:e2e`, and `npm run test:phase-gate` pass in mock mode. The default E2E result is
`18 passed, 1 skipped`; the skipped test is the opt-in real AI smoke test. Unit coverage is
`50 passed`, including `.env` parser, readiness preflight, strict quota and secret hygiene checks, schema contract smoke coverage, worker CLI, gate env, smoke gating, fallback, quota, quality, legacy endpoint hardening, and
safe-error coverage. `npm run test:supabase-smoke` also exits cleanly
without external credentials by reporting that Supabase variables are missing.

Current E2E scenario:

- Open home page.
- Create a course in mock AI mode.
- Verify Course Bible and chapter list.
- Verify generation job status can be queried and retried.
- Verify generation job audit events include ARCHITECT, AUTHOR, POLISHER, REVIEWER, and TUTOR calls.
- Verify course creation returns before planning finishes, then schedules Course Bible, outline, and first chapter without opening the course page.
- Verify the internal generation worker can resume pending course and queued chapter jobs.
- Verify a trusted internal worker can resume an exact job by secret without user headers.
- Verify duplicate internal workers claim a queued job only once before processing.
- Open first chapter and generate content.
- Ask anchored TUTOR question.
- Verify annotation history includes persisted assistant messages.
- Verify persisted annotations cannot target another user's course/chapter.
- Verify persisted annotations cannot target a section outside the selected chapter.
- Export TeX.
- Verify export jobs can be listed with status metadata.
- Verify export creation responses do not inline file content; downloads use the export file endpoint.
- Verify export metadata includes a storage path/provider.
- Verify PDF export bytes begin with `%PDF-`.
- Verify local Beta user isolation through API headers.
- Verify local Beta login stores identity and logout clears it.
- Verify user-owned course snapshots cannot bypass server ownership checks.
- Verify quota exhaustion returns `429`.
- Verify concurrent same-user course creation cannot bypass the local Beta quota gate.
- Verify usage events are recorded only for successful actions and isolated per user.
- Verify the legacy `POST /api/chapters` endpoint returns `410` and does not consume `generate_chapter` quota.
- Verify invalid export resource requests do not consume export quota.
- Verify background chapter job retries also respect `generate_chapter` quota.
- Verify another local Beta user cannot download someone else's export.

Do not advance a phase if any gate fails.
