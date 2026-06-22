import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createSseParser, encodeSseEvent, ParsedSseEvent } from "../../src/lib/sse";

test("SSE encoder and parser handle chunked events and multiline data", () => {
  const events: ParsedSseEvent[] = [];
  const parser = createSseParser((event) => events.push(event));
  const encoded =
    encodeSseEvent("snapshot", { ok: true }) +
    "event: job\ndata: first line\ndata: second line\n\n" +
    ": keepalive\n\n";

  parser.feed(encoded.slice(0, 17));
  parser.feed(encoded.slice(17));
  parser.flush();

  assert.equal(events.length, 3);
  assert.equal(events[0].event, "snapshot");
  assert.equal(events[0].data, '{"ok":true}');
  assert.equal(events[1].event, "job");
  assert.equal(events[1].data, "first line\nsecond line");
  assert.equal(events[2].event, "message");
  assert.equal(events[2].data, "");
});

test("course events route is configured for unbuffered abortable SSE", () => {
  const routeSource = readFileSync("src/app/api/courses/[id]/events/route.ts", "utf8");

  assert.match(routeSource, /export const dynamic = "force-dynamic"/u);
  assert.match(routeSource, /"Content-Type": "text\/event-stream"/u);
  assert.match(routeSource, /"Cache-Control": "no-cache, no-transform"/u);
  assert.match(routeSource, /Connection: "keep-alive"/u);
  assert.match(routeSource, /"X-Accel-Buffering": "no"/u);
  assert.match(routeSource, /request\.signal\.addEventListener\("abort"/u);
  assert.match(routeSource, /clearInterval\(heartbeat\)/u);
  assert.match(routeSource, /clearInterval\(reconcile\)/u);
  assert.match(routeSource, /unsubscribe\(\)/u);
});

test("course page uses SSE instead of generation job short polling", () => {
  const pageSource = readFileSync("src/app/courses/[id]/page.tsx", "utf8");

  assert.match(pageSource, /subscribeToSse\(`\/api\/courses\/\$\{id\}\/events`/u);
  assert.doesNotMatch(pageSource, /setInterval\(\(\) => void poll/u);
  assert.doesNotMatch(pageSource, /apiFetch\(`\/api\/generation-jobs\/\$\{jobId\}`/u);
});

test("reader page subscribes to course SSE snapshots", () => {
  const pageSource = readFileSync("src/app/courses/[id]/chapters/[chapterId]/page.tsx", "utf8");

  assert.match(pageSource, /subscribeToSse\(`\/api\/courses\/\$\{id\}\/events`/u);
  assert.match(pageSource, /message\.event === "snapshot"/u);
  assert.match(pageSource, /message\.event === "course"/u);
  assert.doesNotMatch(pageSource, /setInterval\(\(\) => void poll/u);
});

test("tutor hook uses authenticated abortable streaming requests", () => {
  const src = readFileSync("src/lib/hooks/useTutor.ts", "utf8");

  assert.match(src, /TUTOR_REQUEST_TIMEOUT_MS = 70_000/u);
  assert.match(src, /new AbortController\(\)/u);
  assert.match(src, /apiFetch\("\/api\/annotations"/u);
  assert.doesNotMatch(src, /fetch\("\/api\/annotations"/u);
  assert.match(src, /createSseParser/u);
  assert.match(src, /signal: input\.signal/u);
  assert.match(src, /stream: true/u);
  assert.doesNotMatch(src, /\.messages\.push/u);
  assert.match(src, /setError\("请先选择一段正文/u);
  assert.match(src, /void streamAnswer\(annotation, trimmed\)/u);
  assert.match(src, /return true/u);
});

test("tutor panel exposes an explicit send button and error feedback", () => {
  const src = readFileSync("src/components/reader/TutorPanel.tsx", "utf8");

  assert.match(src, /SendHorizontal/u);
  assert.match(src, /aria-label="发送问题"/u);
  assert.match(src, /void tutor\.ask\(question\)\.then/u);
  assert.match(src, /if \(sent\) input\.value = ""/u);
  assert.match(src, /text-destructive/u);
});

test("revise hook calls the authenticated revisions endpoints (not repairs)", () => {
  const src = readFileSync("src/lib/hooks/useRevise.ts", "utf8");

  assert.match(src, /REVISE_REQUEST_TIMEOUT_MS = 70_000/u);
  assert.match(src, /new AbortController\(\)/u);
  assert.match(src, /apiFetch\("\/api\/revisions"/u);
  assert.match(src, /apiFetch\("\/api\/revisions\/apply"/u);
  assert.match(src, /\/api\/revisions\/\$\{revisionId\}\/revert/u);
  assert.match(src, /\/api\/revisions\/\$\{revisionId\}\/reapply/u);
  assert.match(src, /apiFetch\(`\/api\/revisions\/\$\{revisionId\}`/u);
  assert.doesNotMatch(src, /\/api\/repairs/u);
});

test("revise panel keeps fix and rewrite preset intents", () => {
  const src = readFileSync("src/components/reader/RevisePanel.tsx", "utf8");

  assert.match(src, /请检查这段内容是否有公式、Markdown 或概念错误/u);
  assert.match(src, /请修复这段内容中的格式、公式或明显表述问题/u);
});

test("reader page keeps section anchoring and the selection chooser", () => {
  const pageSource = readFileSync("src/app/courses/[id]/chapters/[chapterId]/page.tsx", "utf8");

  assert.match(pageSource, /function closestSectionId/u);
  assert.match(pageSource, /openReviseFromChooser/u);
  assert.match(pageSource, /openTutorFromChooser/u);
  assert.doesNotMatch(pageSource, /setInterval\(\(\) => void poll/u);
});

test("annotations route bounds tutor streaming requests with friendly SSE errors", () => {
  const routeSource = readFileSync("src/app/api/annotations/route.ts", "utf8");

  assert.match(routeSource, /export const dynamic = "force-dynamic"/u);
  assert.match(routeSource, /TUTOR_ROUTE_TIMEOUT_MS = 65_000/u);
  assert.match(routeSource, /function withDeadline/u);
  assert.match(routeSource, /function tutorErrorMessage/u);
  assert.match(routeSource, /withDeadline\(withQuotaConsumption\(userId, "ask_tutor"/u);
  assert.match(routeSource, /enqueue\("error", JSON\.stringify\(\{\s+error: tutorErrorMessage\(error\),/u);
  assert.match(routeSource, /controller\.close\(\)/u);
  assert.match(routeSource, /"Cache-Control": "no-cache, no-transform"/u);
  assert.match(routeSource, /"X-Accel-Buffering": "no"/u);
  assert.match(routeSource, /stripClientOnlyMessages/u);
});
