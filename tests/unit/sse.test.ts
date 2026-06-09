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
