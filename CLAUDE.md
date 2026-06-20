# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## System prompt

@CLAUDE-CODE-FABLE-5.md

LearnByAI is a personalized-learning platform: users describe a topic, goal, background, and time budget, and the system plans a course, generates a Course Bible + chapter textbook, runs quality checks, and provides an anchored AI tutor and targeted textbook repair while reading. It is a Next.js (App Router) + TypeScript full-stack app, currently in a small-user Beta. The README and `docs/DEVELOPMENT.md` are authoritative and detailed; this file is the fast orientation.

## Commands

```bash
npm run dev               # dev server (localhost:3000)
npm run build             # production build (uses .next — never run in parallel with test:e2e)
npm run lint              # ESLint
npm run test:unit         # tsx --test over tests/unit/**
npm run test:schema       # verify supabase/schema.sql contract version
npm run test:e2e          # Playwright E2E in mock AI mode (own dev server on :3100)
npm run test:phase-gate   # lint + unit + schema + build + mock e2e, run sequentially
npm run worker:once       # external worker entrypoint (cron/queue-friendly)
npm run worker:loop       # long-running external worker (systemd-style)
```

Run one unit test file: `npx tsx --test tests/unit/<file>.test.ts`.
Run one E2E spec: `node scripts/run-e2e.mjs tests/e2e/<file>.spec.ts`.
Real-AI smoke (opt-in, needs `AI_API_KEY`): set `AI_SMOKE=true` (PowerShell: `$env:AI_SMOKE="true"`) then `npm run test:ai-smoke`.

`test:beta-ready`, `test:beta-gate`, `test:beta-health`, `test:supabase-smoke`, `test:worker-handoff` are **production-readiness gates** that require a real Supabase project + AI provider; they are *expected to fail locally* in mock/fallback mode. Do not treat Beta as complete until `test:beta-gate` passes in a configured environment. `test:phase-gate` deliberately clears Supabase/AI credentials in child processes so local validation stays on the deterministic mock path even when `.env.local` has real creds.

Path alias: `@/*` → `src/*`. Copy `.env.example` → `.env.local`; without `AI_API_KEY` the app runs on mock content.

## Architecture

The core pipeline turns a learning request into planned → authored → quality-checked → readable → repairable course material. Request flow:

`POST /api/courses` creates a *pending course shell + generation job and returns immediately*, then background jobs run ARCHITECT (Course Bible, outline, dependencies, glossary) → AUTHOR → POLISHER → REVIEWER+TQH for the first chapter. Later chapters generate on demand: opening a chapter triggers `POST /api/chapters/[id]/generate` if it has no content/sections.

### MAOL — multi-agent orchestration (`src/lib/maol/`)
Agents are configured from env (`registry.ts` / `src/lib/config.ts`), dispatched via `dispatcher.ts`, integrated from Markdown into structured sections (`integrator.ts`), with client methods `generateCourse`, `generateChapter`, `askTutor`. Agents: **ARCHITECT** (plan), **AUTHOR** (write), **POLISHER** (format fix), **REVIEWER** (review), **TUTOR** (anchored Q&A), **ASSISTANT** (fallback). Each agent can be overridden by env prefix (`ARCHITECT_*`, `AUTHOR_*`, `POLISHER_*`, `REVIEWER_*`, `TUTOR_*`) for fields like `API_BASE_URL`, `MODEL`, `TEMPERATURE`, `MAX_TOKENS`, `TIMEOUT_MS`, `THINKING`.

**Mock fallback is allowed only when `AI_MOCK_MODE=true` or no `AI_API_KEY` is set.** In real-provider mode, agent failures surface as errors — they are never silently replaced with mock content. Agent activity is appended to `generation_jobs.payload.events` (ARCHITECT/AUTHOR/POLISHER/REVIEWER/TUTOR) and persisted immediately so job polling/audit survive refresh and process restart.

### TQH — Textbook Quality Harness (`src/lib/quality/`)
`pipeline.ts` returns score/status/issues from structure, format (Markdown/LaTeX/code/headings), continuity, and a lightweight overclaim/fact guard, plus a **deterministic self-repair pass** for repairable format failures before content is exposed as `ready`. Format/LaTeX correctness is deterministic (KaTeX-based, see `katexValidate.ts`), not LLM-judged. Chapter statuses: `draft_ready`, `quality_failed`, `ready`, `failed` — failing content keeps the best draft + report rather than discarding it.

### Targeted repair (`src/lib/maol/targetedRepair.ts`, `src/lib/repairAnchor.ts`)
`POST /api/repairs` diagnoses selected source text and proposes a minimal fix; `POST /api/repairs/apply` requires the original text to match **exactly once** within the target chapter/section or it refuses, to avoid clobbering other content. Applying clears the old quality report and marks the chapter for re-check. Repairs are user-confirmed; the model never silently overwrites the textbook.

### Persistence (`src/lib/serverStore.ts` + `supabase/schema.sql`)
Single server adapter: Supabase service role when Supabase env vars exist, else in-memory fallback for local runs. **In configured Supabase mode, read/write errors are hard failures** (broken migrations/RLS surface in smoke tests instead of being masked by fallback). Browser UI state is non-authoritative — courses/annotations are reloaded from the API after navigation, never from localStorage; clients do not POST full course snapshots back.

Schema provisions app tables, profile RLS + read-only user policies, the auth-profile trigger, quota-reservation RPCs, `public.learnbyai_schema_version()` (contract version checked by smoke/health), and a **private** `learnbyai-exports` Storage bucket. All writes and internal RPCs go through the Next.js API via the service-role adapter so quota/ownership/worker-claim/audit checks can't be bypassed by direct client writes. Export object paths must be `userId/courseId/exportId.format` (RLS keys on the first path segment).

### Background workers
Jobs in `generation_jobs` are claimed before running. Local fallback uses an in-process lease; Supabase mode uses the `claim_generation_job` RPC + `locked_by`/`locked_until`/`attempts` so concurrent cron invocations don't double-process. Local dev defaults to **inline** generation (`shouldRunInlineGeneration` in `config.ts`); production sets `GENERATION_WORKER_MODE=external` and drives `/api/internal/generation-worker` from a queue/cron or `worker:loop`, authenticated by `INTERNAL_WORKER_SECRET` (Bearer or `x-internal-worker-secret`). With Supabase configured and no secret set, the internal worker endpoint is intentionally unavailable.

### Auth & quota
Supabase mode requires a Supabase bearer token on user API calls; the `x-learnbyai-user-id` header is accepted *only* in local fallback. Daily quotas (`create_course`/`generate_chapter`/`ask_tutor`/`export`, overridable via `QUOTA_*`) are consumed only after the action succeeds and persists: local fallback uses a per-user/per-action in-process lock; Supabase uses an atomic `reserve_usage_quota` RPC committed to `usage_events` on success and released on failure. Failed AI/Storage/ownership checks consume no quota.

### Error redaction
User-facing errors and job-failure messages pass through `src/lib/safeError.ts` (redacts bearer tokens, API-key-shaped strings, provider payloads); client UI uses `src/lib/publicSafeError.ts`. Never surface provider payloads, Supabase internals, tokens, or keys in UI copy or persisted errors.

## Conventions & gotchas

- `npm run build` and `npm run test:e2e` both use `.next` — run them **sequentially**, never in parallel (corrupts build artifacts).
- Default E2E uses `AI_MOCK_MODE=true`, one Playwright worker (deterministic fallback persistence), server on `:3100`; override with `E2E_PORT`/`PLAYWRIGHT_BASE_URL` only on port conflicts.
- Schema changes must bump the version returned by `public.learnbyai_schema_version()` and update health/smoke expectations; the export bucket name is contractually `learnbyai-exports`.
- Never commit `.env.local` or secrets. `INTERNAL_WORKER_SECRET` ≥ 32 chars; Supabase anon and service-role keys must differ; the export bucket stays private.
- Admin backend is at `/admin` (`src/lib/admin*.ts`), gated by `LEARNBYAI_ADMIN_*` env vars — separate from Supabase user auth.
