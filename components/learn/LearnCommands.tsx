"use client";
// Command palette entries of the Learn area. Renders nothing; mount it wherever the commands
// should exist (the Learn pages do; the shell may mount it globally).
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useRegisterCommands, type Command } from "@/components/shell";
import { lessonHref, useCourse } from "./course";
import { useHydrated } from "./useHydrated";

export function LearnCommands() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { course } = useCourse();
  const commands = useMemo<Command[]>(() => {
    if (!hydrated || course.total === 0) return [];
    const next = course.next;
    return [
      {
        id: "learn-continue",
        group: "Learn",
        label: "Continue learning",
        icon: "graduation",
        keywords: "lesson next resume course tutor",
        hint: next ? `lesson ${next.number}` : "course complete",
        run: () => router.push(next ? lessonHref(next.lesson.id) : "/learn"),
      },
      ...course.lessons
        .filter((l) => l.unlocked)
        .map(
          (l): Command => ({
            id: `learn-lesson-${l.lesson.id}`,
            group: "Learn",
            label: `Lesson: ${l.lesson.title}`,
            icon: l.passed ? "check" : "play",
            keywords: `learn ${l.number} ${l.lesson.stage} ${l.lesson.newChars.join(" ")}`,
            hint: l.passed ? "★".repeat(l.stars) || "passed" : l.state === "current" ? "next up" : undefined,
            run: () => router.push(lessonHref(l.lesson.id)),
          }),
        ),
    ];
  }, [hydrated, course, router]);
  useRegisterCommands(commands);
  return null;
}

export default LearnCommands;
