import { notFound } from "next/navigation";
import PrintableCourse from "@/components/print/PrintableCourse";
import { getServerCourseForRender } from "@/lib/serverStore";

export const dynamic = "force-dynamic";

/**
 * Internal-only print view a headless Chromium navigates to for PDF export.
 * Gated by INTERNAL_WORKER_SECRET (when configured). Not linked anywhere and
 * marked noindex; the export API validates ownership + quota before this runs.
 */
export default async function PrintCoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ k?: string; chapter?: string }>;
}) {
  const { courseId } = await params;
  const { k, chapter } = await searchParams;

  const secret = process.env.INTERNAL_WORKER_SECRET;
  if (secret && k !== secret) notFound();

  const course = await getServerCourseForRender(courseId);
  if (!course) notFound();

  return (
    <PrintableCourse
      course={{
        topic: course.topic,
        goal: course.goal,
        profile: course.profile,
        chapters: course.chapters.map((chapterItem) => ({
          id: chapterItem.id,
          title: chapterItem.title,
          content: chapterItem.content,
        })),
      }}
      chapterId={chapter}
    />
  );
}
