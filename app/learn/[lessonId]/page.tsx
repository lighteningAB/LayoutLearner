import type { Metadata } from "next";
import { LessonPlayer } from "@/components/learn/LessonPlayer";

export const metadata: Metadata = { title: "Lesson" };

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  let id = lessonId;
  try {
    id = decodeURIComponent(lessonId);
  } catch {
    /* keep the raw segment */
  }
  return <LessonPlayer lessonId={id} />;
}
