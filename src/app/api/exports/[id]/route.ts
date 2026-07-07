import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { findExportAsset, getExportJob, readExportContent } from "@/lib/exports";
import { getServerExport } from "@/lib/serverStore";
import { ExportJob } from "@/lib/types";

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

  const requestedAsset = new URL(request.url).searchParams.get("asset") as ExportJob["format"] | null;
  const asset = requestedAsset ? findExportAsset(job, requestedAsset) : undefined;
  if (requestedAsset && requestedAsset !== job.format && !asset) {
    return NextResponse.json({ error: "Export asset not found" }, { status: 404 });
  }

  const body = await readExportContent(job, asset);
  const fileName = asset?.fileName ?? job.fileName ?? `export.${job.format}`;
  const contentType = asset?.contentType ?? job.contentType ?? (job.format === "tex" ? "application/x-tex; charset=utf-8" : "application/pdf");

  return new NextResponse(body, {
    headers: {
      "content-type": contentType,
      "content-disposition": contentDisposition(fileName),
    },
  });
}

function contentDisposition(fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
