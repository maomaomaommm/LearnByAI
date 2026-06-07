import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { generateChapter } from "@/lib/maol/client";
import { withQuotaConsumption } from "@/lib/quota";
import { safeErrorMessage } from "@/lib/safeError";
import { canUseCourseSnapshot, getServerCourse, saveServerGenerationJob, saveServerQualityReport, updateServerChapter } from "@/lib/serverStore";
import { Course } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const input = (await request.json()) as { courseId: string; course?: Course };
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const persistedCourse = await getServerCourse(input.courseId, request);
  const course = persistedCourse ?? ((await canUseCourseSnapshot(input.course, request)) ? input.course : undefined);

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const chapter = course.chapters.find((item) => item.id === id);
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  const userId = auth.userId;
  try {
    const result = await withQuotaConsumption(userId, "generate_chapter", async () => {
      const response = await generateChapter(course, chapter, {
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
