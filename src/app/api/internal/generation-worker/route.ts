import { NextResponse } from "next/server";
import { canRunInternalWorkerRequest } from "@/lib/config";
import { runGenerationWorker } from "@/lib/generationWorker";
import { publicGenerationJobs } from "@/lib/publicGenerationJob";

export async function POST(request: Request) {
  if (!canRunInternalWorkerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized worker request" }, { status: 401 });
  }

  const input = (await request.json().catch(() => ({}))) as { jobId?: string; limit?: number; recover?: boolean };
  const result = await runGenerationWorker({
    jobId: input.jobId,
    limit: input.limit,
    recover: input.recover,
    request,
  });

  return NextResponse.json({
    ...result,
    jobs: publicGenerationJobs(result.jobs),
  });
}
