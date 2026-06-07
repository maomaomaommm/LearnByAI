import { NextResponse } from "next/server";
import { canRunInternalWorkerRequest } from "@/lib/config";
import { runGenerationWorker } from "@/lib/generationWorker";

export async function POST(request: Request) {
  if (!canRunInternalWorkerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized worker request" }, { status: 401 });
  }

  const input = (await request.json().catch(() => ({}))) as { jobId?: string; limit?: number };
  const result = await runGenerationWorker({
    jobId: input.jobId,
    limit: input.limit,
    request,
  });

  return NextResponse.json(result);
}
