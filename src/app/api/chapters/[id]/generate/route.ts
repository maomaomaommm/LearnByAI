import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { generateChapter } from "@/lib/maol/client";
import { parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { withQuotaConsumption } from "@/lib/quota";
import { safeErrorMessage } from "@/lib/safeError";
import { getServerCourse, saveServerGenerationJob, saveServerQualityReport, updateServerChapter } from "@/lib/serverStore";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const input = (await request.json()) as { courseId: string };
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const course = await getServerCourse(input.courseId, request);

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const chapter = course.chapters.find((item) => item.id === id);
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  const userId = auth.userId;
  const overrides = parseModelOverridesFromHeaders(request.headers);
  try {
    const result = await withQuotaConsumption(userId, "generate_chapter", async () => {
      const response = await generateChapter(course, chapter, {
        overrides,
        onJobUpdate: async (updatedJob) => {
          await saveServerGenerationJob(updatedJob, request);
        },
      });
      if (response.job) {
        await saveServerGenerationJob(response.job, request);
      }
      await saveServerQualityReport(response.qualityReport, request);
      await updateServerChapter(
        course,
        id,
        {
          content: response.content,
          sections: response.sections,
          review: response.review,
          qualityReport: response.qualityReport,
          status: response.qualityReport.status === "failed" ? "failed" : "ready",
          generationJobId: response.job?.id,
        },
        request,
      );
      return response;
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.quota.message }, { status: 429 });
    }

    return NextResponse.json(result.value);
  } catch (error) {
    await updateServerChapter(
      course,
      id,
      {
        status: "failed",
        generationJobId: chapter.generationJobId,
      },
      request,
    );
    return NextResponse.json(
      { error: safeErrorMessage(error, "Chapter generation failed.") },
      { status: 500 },
    );
  }
}
