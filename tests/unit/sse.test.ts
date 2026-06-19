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

test("reader page uses authenticated abortable tutor and repair requests", () => {
  const pageSource = readFileSync("src/app/courses/[id]/chapters/[chapterId]/page.tsx", "utf8");

  assert.match(pageSource, /TUTOR_REQUEST_TIMEOUT_MS = 70_000/u);
  assert.match(pageSource, /REPAIR_REQUEST_TIMEOUT_MS = 70_000/u);
  assert.match(pageSource, /new AbortController\(\)/u);
  assert.match(pageSource, /apiFetch\("\/api\/annotations"/u);
  assert.doesNotMatch(pageSource, /fetch\("\/api\/annotations"/u);
  assert.match(pageSource, /signal: input\.signal/u);
  assert.match(pageSource, /function closestSectionId/u);
  assert.match(pageSource, /requestRepair\("请检查这段内容是否有公式、Markdown 或概念错误/u);
  assert.match(pageSource, /requestRepair\("请修复这段内容中的格式、公式或明显表述问题/u);
  assert.match(pageSource, /apiFetch\("\/api\/repairs"/u);
  assert.match(pageSource, /apiFetch\("\/api\/repairs\/apply"/u);
});

test("annotations route bounds tutor streaming requests with friendly SSE errors", () => {
  const routeSource = readFileSync("src/app/api/annotations/route.ts", "utf8");

  assert.match(routeSource, /TUTOR_ROUTE_TIMEOUT_MS = 65_000/u);
  assert.match(routeSource, /function withDeadline/u);
  assert.match(routeSource, /function tutorErrorMessage/u);
  assert.match(routeSource, /withDeadline\(withQuotaConsumption\(userId, "ask_tutor"/u);
  assert.match(routeSource, /enqueue\("error", JSON\.stringify\(\{\s+error: tutorErrorMessage\(error\),/u);
  assert.match(routeSource, /controller\.close\(\)/u);
});
