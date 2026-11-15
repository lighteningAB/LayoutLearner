"use client";
// Course model for the Learn area: the curriculum of the active layout joined with stored progress.
import { useMemo } from "react";
import { keyAction } from "@/lib/layout/parse";
import { useActiveLayout, type ActiveLayout } from "@/lib/layout/useActiveLayout";
import { buildCurriculum, type Lesson, type LessonStage } from "@/lib/lessons/curriculum";
import { useLessonProgress, type LessonProgress, type LessonProgressEntry } from "@/lib/stats/store";
import type { CharStat, HistoryPoint, TestResult } from "@/lib/typing/engine";
import type { ParsedLayout } from "@/lib/types";
import { useLearnPrefs } from "./prefs";
import { stableLayout } from "./stableLayout";

export type LessonState = "locked" | "available" | "current" | "completed";

export const STAGE_NAME: Record<LessonStage, string> = {
  home: "Home row",
  top: "Top row",
  bottom: "Bottom row",
  extra: "More keys",
  capitals: "Capitals",
  numbers: "Numbers",
  punctuation: "Punctuation",
};

export interface CourseLesson {
  lesson: Lesson;
  /** 1-based position in the course. */
  number: number;
  state: LessonState;
  /** Can be started (passed before, next in line, or everything is unlocked). */
  unlocked: boolean;
  passed: boolean;
  stars: 0 | 1 | 2 | 3;
  entry: LessonProgressEntry | null;
  /** Title without the stage prefix ("F and J", "Review"). */
  shortTitle: string;
}

export interface CourseStage {
  stage: LessonStage;
  name: string;
  items: CourseLesson[];
  completed: number;
}

export interface Course {
  lessons: CourseLesson[];
  stages: CourseStage[];
  total: number;
  completed: number;
  stars: number;
  maxStars: number;
  /** First lesson that is not passed yet; null when the course is finished (or empty). */
  next: CourseLesson | null;
  byId: Map<string, CourseLesson>;
}

const curriculumCache = new WeakMap<ParsedLayout, Lesson[]>();

/** buildCurriculum, cached per parsed layout; lessons that ended up without drills are left out. */
export function curriculumFor(layout: ParsedLayout): Lesson[] {
  let lessons = curriculumCache.get(layout);
  if (!lessons) {
    try {
      lessons = buildCurriculum(layout).filter((l) => l.drills.length > 0);
    } catch {
      lessons = [];
    }
    curriculumCache.set(layout, lessons);
  }
  return lessons;
}

export function shortLessonTitle(lesson: Pick<Lesson, "title" | "stage">): string {
  const stage = STAGE_NAME[lesson.stage];
  let t = lesson.title;
  if (t.startsWith(stage)) t = t.slice(stage.length).replace(/^[:\s]+/, "");
  if (!t) return lesson.title;
  return t[0].toUpperCase() + t.slice(1);
}

export function buildCourse(curriculum: Lesson[], progress: LessonProgress, unlockAll: boolean): Course {
  const lessons: CourseLesson[] = [];
  let next: CourseLesson | null = null;
  let previousPassed = true;
  for (const lesson of curriculum) {
    const entry = progress[lesson.id] ?? null;
    const passed = entry?.completedAt != null;
    const unlocked = unlockAll || passed || previousPassed;
    const item: CourseLesson = {
      lesson,
      number: lessons.length + 1,
      state: passed ? "completed" : "locked",
      unlocked,
      passed,
      stars: passed ? ((Math.min(3, Math.max(0, Math.round(entry?.stars ?? 0))) as 0 | 1 | 2 | 3)) : 0,
      entry,
      shortTitle: shortLessonTitle(lesson),
    };
    if (!passed) {
      if (!next) {
        next = item;
        item.state = unlocked ? "current" : "locked";
      } else if (unlocked) item.state = "available";
    }
    lessons.push(item);
    previousPassed = passed;
  }
  // The "current" lesson is the first unfinished one; it is always startable.
  if (next && !next.unlocked) {
    next.unlocked = true;
    next.state = "current";
  }

  const stages: CourseStage[] = [];
  for (const item of lessons) {
    const last = stages[stages.length - 1];
    if (last && last.stage === item.lesson.stage) last.items.push(item);
    else stages.push({ stage: item.lesson.stage, name: STAGE_NAME[item.lesson.stage], items: [item], completed: 0 });
  }
  for (const s of stages) s.completed = s.items.filter((i) => i.passed).length;

  return {
    lessons,
    stages,
    total: lessons.length,
    completed: lessons.filter((l) => l.passed).length,
    stars: lessons.reduce((n, l) => n + l.stars, 0),
    maxStars: lessons.length * 3,
    next,
    byId: new Map(lessons.map((l) => [l.lesson.id, l])),
  };
}

export interface UseCourse {
  active: ActiveLayout;
  course: Course;
  unlockAll: boolean;
  setUnlockAll: (on: boolean) => void;
}

/** The course of the active layout with live progress. */
export function useCourse(): UseCourse {
  const resolved = useActiveLayout();
  // Same layout content = same object, so lessons (and everything memoised on them) stay put
  // when an unrelated setting changes.
  const active = useMemo(() => ({ ...resolved, layout: stableLayout(resolved.layout) }), [resolved]);
  const progress = useLessonProgress(active.id);
  const [prefs, setPrefs] = useLearnPrefs();
  const curriculum = useMemo(() => curriculumFor(active.layout), [active.layout]);
  const course = useMemo(() => buildCourse(curriculum, progress, prefs.unlockAll), [curriculum, progress, prefs.unlockAll]);
  return { active, course, unlockAll: prefs.unlockAll, setUnlockAll: (on) => setPrefs({ unlockAll: on }) };
}

export const lessonHref = (lessonId: string) => `/learn/${encodeURIComponent(lessonId)}`;

/** Keys a lesson has not introduced yet (for Keyboard2D `dimUnused` / KeyboardGuide `dimKeyIds`). */
export function dimKeyIdsFor(layout: ParsedLayout, lesson: Pick<Lesson, "chars">): string[] {
  const known = new Set(lesson.chars);
  const one = (c: string) => typeof c === "string" && c.length === 1 && c !== " ";
  const shiftNeeded = layout.keys.some((k) => !k.isModifier && one(k.shifted) && k.shifted !== k.base && known.has(k.shifted));
  const dim: string[] = [];
  for (const k of layout.keys) {
    if (k.base === " ") continue;
    if (k.isModifier) {
      if (!(shiftNeeded && /shift/i.test(k.label))) dim.push(k.id);
      continue;
    }
    if (!one(k.base) && !one(k.shifted)) {
      if (keyAction(k) !== "backspace") dim.push(k.id);
      continue;
    }
    if (!(known.has(k.base) || known.has(k.shifted))) dim.push(k.id);
  }
  return dim;
}

/** One result for a whole lesson: the drills back to back (pauses between drills do not count). */
export function aggregateResults(results: readonly TestResult[]): TestResult {
  const total = results.reduce((n, r) => n + r.durationMs, 0);
  const weighted = (pick: (r: TestResult) => number) =>
    total > 0 ? results.reduce((n, r) => n + pick(r) * r.durationMs, 0) / total : 0;
  const correct = results.reduce((n, r) => n + r.keystrokes.correct, 0);
  const incorrect = results.reduce((n, r) => n + r.keystrokes.incorrect, 0);

  const charStats: Record<string, CharStat> = {};
  const mistypes: Record<string, Record<string, number>> = {};
  const history: HistoryPoint[] = [];
  const chars = { correct: 0, incorrect: 0, extra: 0, missed: 0, spaces: 0 };
  let offset = 0;
  for (const r of results) {
    for (const [c, s] of Object.entries(r.charStats)) {
      const t = (charStats[c] ??= { hits: 0, misses: 0, totalMs: 0, samples: 0 });
      t.hits += s.hits;
      t.misses += s.misses;
      t.totalMs += s.totalMs;
      t.samples += s.samples;
    }
    for (const [c, m] of Object.entries(r.mistypes)) {
      const t = (mistypes[c] ??= {});
      for (const [typed, n] of Object.entries(m)) t[typed] = (t[typed] ?? 0) + n;
    }
    for (const h of r.history) history.push({ ...h, t: Math.round((h.t + offset) * 100) / 100 });
    offset += r.durationMs / 1000;
    chars.correct += r.chars.correct;
    chars.incorrect += r.chars.incorrect;
    chars.extra += r.chars.extra;
    chars.missed += r.chars.missed;
    chars.spaces += r.chars.spaces;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    mode: "words",
    modeValue: results.reduce((n, r) => n + r.modeValue, 0),
    wpm: round(weighted((r) => r.wpm)),
    raw: round(weighted((r) => r.raw)),
    accuracy: correct + incorrect > 0 ? round((correct / (correct + incorrect)) * 100) : 100,
    consistency: round(weighted((r) => r.consistency)),
    chars,
    durationMs: total,
    history,
    charStats,
    mistypes,
    keystrokes: { correct, incorrect },
    wordsTyped: results.reduce((n, r) => n + r.wordsTyped, 0),
  };
}
