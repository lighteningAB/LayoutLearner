"use client";
// Lesson progress (stars, best wpm / accuracy, completion) per layout, kept in localStorage under
// "ll:v1:lessons". The course map's unlock chain reads it. SSR-safe; corrupt or missing storage
// reads as empty, and if storage is unavailable (private mode, quota) it lives in memory.
import { useSyncExternalStore } from "react";
import { DATA_CLEARED_EVENT } from "@/lib/settings";
import type { TestResult } from "@/lib/typing/engine";
import { gradeLesson, type Lesson, type LessonGrade } from "./curriculum";

export const LESSONS_KEY = "ll:v1:lessons";

export interface LessonProgressEntry {
  stars: 0 | 1 | 2 | 3;
  bestWpm: number;
  bestAccuracy: number;
  /** Epoch ms of the first passing run, null if never passed. */
  completedAt: number | null;
  attempts: number;
  lastAt: number;
}

/** Keyed by lesson id. */
export type LessonProgress = Record<string, LessonProgressEntry>;
type AllProgress = Record<string, LessonProgress>;

const EMPTY_ALL: AllProgress = {};
const EMPTY_PROGRESS: LessonProgress = {};

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: AllProgress } | null = null;
let memoryOnly = false;
let attached = false;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function emit() {
  listeners.forEach((l) => l());
}

function reset() {
  cache = null;
  memoryOnly = false;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!attached && typeof window !== "undefined") {
    attached = true;
    // Other tabs (and devtools edits) change storage behind our back.
    window.addEventListener("storage", (e) => {
      if (e.key === null || e.key === LESSONS_KEY) emit();
    });
    window.addEventListener(DATA_CLEARED_EVENT, reset);
  }
  return () => {
    listeners.delete(listener);
  };
}

function sanitize(parsed: unknown): AllProgress | null {
  if (!isObject(parsed)) return null;
  const out: AllProgress = {};
  for (const [layoutId, lessons] of Object.entries(parsed)) {
    if (!isObject(lessons)) continue;
    const inner: LessonProgress = {};
    for (const [id, entry] of Object.entries(lessons)) if (isObject(entry)) inner[id] = entry as unknown as LessonProgressEntry;
    out[layoutId] = inner;
  }
  return out;
}

function readAll(): AllProgress {
  if (typeof window === "undefined") return EMPTY_ALL;
  if (memoryOnly && cache) return cache.value;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LESSONS_KEY);
  } catch {
    return cache ? cache.value : EMPTY_ALL;
  }
  if (cache && cache.raw === raw) return cache.value;
  let value = EMPTY_ALL;
  if (raw != null) {
    try {
      value = sanitize(JSON.parse(raw)) ?? EMPTY_ALL;
    } catch {
      value = EMPTY_ALL;
    }
  }
  cache = { raw, value };
  return value;
}

function writeAll(value: AllProgress): void {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(value);
  try {
    window.localStorage.setItem(LESSONS_KEY, raw);
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
  cache = { raw, value };
  emit();
}

/**
 * Save one finished lesson run: grades it and keeps the best stars / wpm / accuracy for the lesson.
 * Nothing else about the run is stored.
 */
export function recordLessonResult(
  layoutId: string,
  lesson: Pick<Lesson, "id" | "goal">,
  result: TestResult,
  at: number = Date.now(),
): { grade: LessonGrade; progress: LessonProgressEntry; improved: boolean } {
  const grade = gradeLesson(result, lesson);
  const all = readAll();
  const forLayout = all[layoutId] ?? {};
  const prev = forLayout[lesson.id];
  const progress: LessonProgressEntry = {
    stars: Math.max(num(prev?.stars), grade.stars) as 0 | 1 | 2 | 3,
    bestWpm: Math.max(num(prev?.bestWpm), result.wpm),
    bestAccuracy: Math.max(num(prev?.bestAccuracy), result.accuracy),
    completedAt: prev?.completedAt ?? (grade.passed ? at : null),
    attempts: num(prev?.attempts) + 1,
    lastAt: at,
  };
  writeAll({ ...all, [layoutId]: { ...forLayout, [lesson.id]: progress } });
  return { grade, progress, improved: grade.stars > num(prev?.stars) };
}

/** Forget all lesson progress (every layout). */
export function clearLessonProgress(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LESSONS_KEY);
  } catch {
    // storage unavailable: nothing persisted to remove
  }
  reset();
  window.dispatchEvent(new CustomEvent("ll:lessons-reset"));
}

/** Client only (empty during SSR). */
export function getLessonProgress(layoutId: string): LessonProgress {
  return readAll()[layoutId] ?? EMPTY_PROGRESS;
}

/** Live progress of one layout. Empty on the server / first paint. */
export function useLessonProgress(layoutId: string): LessonProgress {
  const all = useSyncExternalStore(subscribe, readAll, () => EMPTY_ALL);
  return all[layoutId] ?? EMPTY_PROGRESS;
}

// --- Sync adapter hooks (lib/sync/local.ts) ---------------------------------------------------
/** Fired on window by clearLessonProgress(): the user asked for a reset (not: storage was lost). */
export const LESSONS_RESET_EVENT = "ll:lessons-reset";
export const subscribeLessonProgress = subscribe;
/** Progress of every layout. Client only (empty during SSR). */
export const getAllLessonProgress = (): Record<string, LessonProgress> => readAll();
/** Replace the progress of every layout (also refreshes the in-memory cache and notifies). */
export const replaceAllLessonProgress = (value: Record<string, LessonProgress>): void => writeAll(value);
