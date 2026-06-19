import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { getCourseEventSnapshot, hasActiveGenerationJobs } from "@/lib/courseEventSnapshot";
import { subscribeCourseEvents } from "@/lib/courseEvents";
import { publicGenerationJob, publicGenerationJobs } from "@/lib/publicGenerationJob";
import { encodeSseEvent } from "@/lib/sse";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;
const RECONCILE_MS = 2_500;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const initialSnapshot = await getCourseEventSnapshot(id, request);
  if (!initialSnapshot.course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let refreshPending = false;
  let lastCourseUpdatedAt = "";
  let lastJobFingerprint = "";
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data?: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.close();
      };

      const refresh = async (reason: "initial" | "course" | "job" | "reconcile") => {
        if (closed || refreshPending) return;
        refreshPending = true;

        try {
          const snapshot = await getCourseEventSnapshot(id, request);
          if (!snapshot.course) {
            send("done", { reason: "course-not-found" });
            close();
            return;
          }

          const courseUpdatedAt = snapshot.course.updatedAt ?? snapshot.course.createdAt;
          const jobFingerprint = fingerprintJobs(snapshot.jobs);

          if (reason === "initial") {
            send("snapshot", { ...snapshot, jobs: publicGenerationJobs(snapshot.jobs) });
          } else {
            if (courseUpdatedAt !== lastCourseUpdatedAt || reason === "course") {
              send("course", { course: snapshot.course });
            }
            if (jobFingerprint !== lastJobFingerprint || reason === "job") {
              for (const job of snapshot.jobs) {
                send("job", { job: publicGenerationJob(job) });
              }
            }
          }

          lastCourseUpdatedAt = courseUpdatedAt;
          lastJobFingerprint = jobFingerprint;

          if (!hasActiveGenerationJobs(snapshot.jobs)) {
            send("done", { reason: "idle" });
            close();
          }
        } catch (error) {
          send("error", { error: error instanceof Error ? error.message : "Course event stream failed." });
          close();
        } finally {
          refreshPending = false;
        }
      };

      const heartbeat = setInterval(() => {
        send("heartbeat", { at: new Date().toISOString() });
      }, HEARTBEAT_MS);
      const reconcile = setInterval(() => {
        void refresh("reconcile");
      }, RECONCILE_MS);
      const unsubscribe = subscribeCourseEvents(id, (event) => {
        void refresh(event.type);
      });
      const abort = () => {
        close();
      };

      cleanup = () => {
        clearInterval(heartbeat);
        clearInterval(reconcile);
        unsubscribe();
        request.signal.removeEventListener("abort", abort);
      };
      request.signal.addEventListener("abort", abort, { once: true });

      void refresh("initial");
    },
    cancel() {
      closed = true;
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function fingerprintJobs(jobs: Awaited<ReturnType<typeof getCourseEventSnapshot>>["jobs"]) {
  return jobs
    .map((job) => `${job.id}:${job.status}:${job.updatedAt}:${job.events.length}:${job.error ?? ""}`)
    .join("|");
}
