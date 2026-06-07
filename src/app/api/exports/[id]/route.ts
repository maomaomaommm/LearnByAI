import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { getExportJob, readExportContent } from "@/lib/exports";
import { getServerExport } from "@/lib/serverStore";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const userId = auth.userId;
  const memoryJob = getExportJob(id);
  const job =
    (await getServerExport(id, request)) ??
    (memoryJob?.userId === userId || userId === "local-beta-user" ? memoryJob : undefined);

  if (!job) {
    return NextResponse.json({ error: "Export not found" }, { status: 404 });
  }

  const body = await readExportContent(job);

  return new NextResponse(body, {
    headers: {
      "content-type": job.contentType ?? (job.format === "tex" ? "application/x-tex; charset=utf-8" : "application/pdf"),
      "content-disposition": contentDisposition(job.fileName ?? `export.${job.format}`),
    },
  });
}

function contentDisposition(fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
