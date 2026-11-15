"use client";
// localStorage-backed stats (keys prefixed "ll:v1:"), SSR-safe, exposed through
// useSyncExternalStore hooks. Corrupt or missing storage reads as empty; if storage is
// unavailable (private mode, quota) the data lives in memory for the session.
import { useMemo, useSyncExternalStore } from "react";
import type { CharCounts, HistoryPoint, TestMode, TestResult } from "@/lib/typing/engine";
import { gradeLesson, type Lesson, type LessonGrade } from "@/lib/lessons/curriculum";

export const STORAGE_PREFIX = "ll:v1:";
export const STORAGE_KEYS = {
  results: `${STORAGE_PREFIX}results`,
  keyStats: `${STORAGE_PREFIX}keystats`,
  lessons: `${STORAGE_PREFIX}lessons`,
  bests: `${STORAGE_PREFIX}bests`,
  activity: `${STORAGE_PREFIX}activity`,
} as const;

/** Newest results kept (older ones are dropped). */
export const MAX_RESULTS = 200;
const MAX_ACTIVITY_DAYS = 730;
const MAX_HISTORY_POINTS = 300;

// ------------------------------------------------------------------ types

export interface StoredResult {
  id: string;
  /** Epoch ms when the test finished. */
  at: number;
  layoutId: string;
  mode: TestMode;
  /** Word count (words mode) or seconds (time mode). */
  modeValue: number;
  wpm: number;
  raw: number;
  accuracy: number;
  consistency: number;
  chars: CharCounts;
  durationMs: number;
  history: HistoryPoint[];
}

export interface KeyStat {
  hits: number;
  misses: number;
  /** Sum of latencies over `samples` timed hits; average = totalMs / samples. */
  totalMs: number;
  samples: number;
  /** What was typed instead of this character -> how often. */
  mistypedAs: Record<string, number>;
}

/** Per expected character (" " = space). Map chars to keys with the layout (base / shifted). */
export type KeyStats = Record<string, KeyStat>;

export interface KeyStatSummary {
  char: string;
  hits: number;
  misses: number;
  /** 0-100. */
  accuracy: number;
  /** Average ms since the previous keystroke, null if never timed. */
  avgMs: number | null;
  /** Higher = weaker. Blend of error rate and slowness relative to the layout's average. */
  score: number;
  /** Most frequent wrong character typed instead, if any. */
  mostMistypedAs: string | null;
}

export interface LessonProgressEntry {
  stars: 0 | 1 | 2 | 3;
  bestWpm: number;
  bestAccuracy: number;
  /** Epoch ms of the first passing run, null if never passed. */
  completedAt: number | null;
  attempts: number;
  lastAt: number;
}

export type LessonProgress = Record<string, LessonProgressEntry>;

export interface PersonalBest {
  wpm: number;
  accuracy: number;
  at: number;
  resultId: string;
}

/** Keyed by `${mode}:${modeValue}`, e.g. "words:25", "time:30". */
export type PersonalBests = Record<string, PersonalBest>;

export interface Streak {
  /** Consecutive days practised up to today (or yesterday, if today has no practice yet). */
  current: number;
  longest: number;
  /** Local date "YYYY-MM-DD" of the latest practice, null if none. */
  lastDay: string | null;
  /** Number of distinct days practised. */
  totalDays: number;
  practicedToday: boolean;
}

// ------------------------------------------------------------------ storage core

type Listener = () => void;
const listeners = new Set<Listener>();
const cache = new Map<string, { raw: string | null; value: unknown }>();
const memoryOnly = new Set<string>();
let storageListenerAttached = false;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!storageListenerAttached && typeof window !== "undefined") {
    storageListenerAttached = true;
    // Other tabs (and devtools edits) change storage behind our back.
    window.addEventListener("storage", (e) => {
      if (e.key === null || e.key.startsWith(STORAGE_PREFIX)) emit();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

function read<T>(key: string, fallback: T, sanitize: (parsed: unknown) => T | null): T {
  if (typeof window === "undefined") return fallback;
  const cached = cache.get(key);
  if (memoryOnly.has(key) && cached) return cached.value as T;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return cached ? (cached.value as T) : fallback;
  }
  if (cached && cached.raw === raw) return cached.value as T;
  let value = fallback;
  if (raw != null) {
    try {
      value = sanitize(JSON.parse(raw)) ?? fallback;
    } catch {
      value = fallback;
    }
  }
  cache.set(key, { raw, value });
  return value;
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(value);
  try {
    window.localStorage.setItem(key, raw);
    memoryOnly.delete(key);
  } catch {
    memoryOnly.add(key);
  }
  cache.set(key, { raw, value });
  emit();
}

// ------------------------------------------------------------------ sanitizers (stable empties)

const EMPTY_RESULTS: StoredResult[] = [];
const EMPTY_OBJECT: Record<string, never> = {};
const EMPTY_DAYS: string[] = [];
const EMPTY_SUMMARIES: KeyStatSummary[] = [];

function sanitizeResults(parsed: unknown): StoredResult[] | null {
  if (!Array.isArray(parsed)) return null;
  const out: StoredResult[] = [];
  for (const r of parsed) {
    if (!isObject(r) || typeof r.id !== "string" || typeof r.wpm !== "number" || typeof r.layoutId !== "string") continue;
    const chars = isObject(r.chars) ? r.chars : {};
    out.push({
      id: r.id,
      at: num(r.at),
      layoutId: r.layoutId,
      mode: r.mode === "time" ? "time" : "words",
      modeValue: num(r.modeValue),
      wpm: num(r.wpm),
      raw: num(r.raw),
      accuracy: num(r.accuracy),
      consistency: num(r.consistency),
      chars: { correct: num(chars.correct), incorrect: num(chars.incorrect), extra: num(chars.extra), missed: num(chars.missed), spaces: num(chars.spaces) },
      durationMs: num(r.durationMs),
      history: Array.isArray(r.history)
        ? r.history.filter(isObject).map((h) => ({ t: num(h.t), wpm: num(h.wpm), raw: num(h.raw), errors: num(h.errors) }))
        : [],
    });
  }
  return out;
}

function sanitizeNested<T>(parsed: unknown): Record<string, Record<string, T>> | null {
  if (!isObject(parsed)) return null;
  const out: Record<string, Record<string, T>> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!isObject(v)) continue;
    const inner: Record<string, T> = {};
    for (const [ik, iv] of Object.entries(v)) if (isObject(iv)) inner[ik] = iv as T;
    out[k] = inner;
  }
  return out;
}

function sanitizeDays(parsed: unknown): string[] | null {
  if (!Array.isArray(parsed)) return null;
  return Array.from(new Set(parsed.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))).sort();
}

const readResults = () => read<StoredResult[]>(STORAGE_KEYS.results, EMPTY_RESULTS, sanitizeResults);
const readAllKeyStats = () => read<Record<string, KeyStats>>(STORAGE_KEYS.keyStats, EMPTY_OBJECT, (p) => sanitizeNested<KeyStat>(p));
const readAllLessons = () => read<Record<string, LessonProgress>>(STORAGE_KEYS.lessons, EMPTY_OBJECT, (p) => sanitizeNested<LessonProgressEntry>(p));
const readAllBests = () => read<Record<string, PersonalBests>>(STORAGE_KEYS.bests, EMPTY_OBJECT, (p) => sanitizeNested<PersonalBest>(p));
const readDays = () => read<string[]>(STORAGE_KEYS.activity, EMPTY_DAYS, sanitizeDays);

// ------------------------------------------------------------------ helpers

/** Local calendar day "YYYY-MM-DD". */
export function dayKey(at: number | Date = Date.now()): string {
  const d = typeof at === "number" ? new Date(at) : at;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function computeStreak(days: readonly string[], today: string = dayKey()): Streak {
  if (days.length === 0) return { current: 0, longest: 0, lastDay: null, totalDays: 0, practicedToday: false };
  const nums = Array.from(new Set(days.map(dayNumber))).sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < nums.length; i++) {
    run = nums[i] === nums[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const t = dayNumber(today);
  const last = nums[nums.length - 1];
  let current = 0;
  if (last === t || last === t - 1) {
    current = 1;
    for (let i = nums.length - 1; i > 0 && nums[i - 1] === nums[i] - 1; i--) current++;
  }
  const sorted = days.slice().sort();
  return { current, longest, lastDay: sorted[sorted.length - 1], totalDays: nums.length, practicedToday: last === t };
}

function markPractice(at: number): void {
  const day = dayKey(at);
  const days = readDays();
  if (days.includes(day)) return;
  write(STORAGE_KEYS.activity, [...days, day].sort().slice(-MAX_ACTIVITY_DAYS));
}

function mergeKeyStats(layoutId: string, result: Pick<TestResult, "charStats" | "mistypes">): void {
  const all = readAllKeyStats();
  const current: KeyStats = { ...(all[layoutId] ?? {}) };
  const blank = (): KeyStat => ({ hits: 0, misses: 0, totalMs: 0, samples: 0, mistypedAs: {} });
  for (const [ch, s] of Object.entries(result.charStats ?? {})) {
    const cur = current[ch] ?? blank();
    current[ch] = {
      hits: num(cur.hits) + num(s.hits),
      misses: num(cur.misses) + num(s.misses),
      totalMs: num(cur.totalMs) + num(s.totalMs),
      samples: num(cur.samples) + num(s.samples),
      mistypedAs: isObject(cur.mistypedAs) ? (cur.mistypedAs as Record<string, number>) : {},
    };
  }
  for (const [expected, typed] of Object.entries(result.mistypes ?? {})) {
    const cur = current[expected] ?? blank();
    const mistypedAs = { ...cur.mistypedAs };
    for (const [t, n] of Object.entries(typed)) mistypedAs[t] = num(mistypedAs[t]) + num(n);
    current[expected] = { ...cur, mistypedAs };
  }
  write(STORAGE_KEYS.keyStats, { ...all, [layoutId]: current });
}

const pbKey = (mode: TestMode, modeValue: number) => `${mode}:${modeValue}`;
const newId = (at: number) => `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ------------------------------------------------------------------ writes

export interface RecordResultInput {
  layoutId: string;
  result: TestResult;
  /** Epoch ms, default now. */
  at?: number;
}

/**
 * Save a finished typing test: adds it to the history, merges per-key stats, updates the
 * personal best for its mode and marks today as practised.
 */
export function recordResult(input: RecordResultInput): { entry: StoredResult; isPersonalBest: boolean } {
  const { layoutId, result } = input;
  const at = input.at ?? Date.now();
  const entry: StoredResult = {
    id: newId(at),
    at,
    layoutId,
    mode: result.mode,
    modeValue: result.modeValue,
    wpm: result.wpm,
    raw: result.raw,
    accuracy: result.accuracy,
    consistency: result.consistency,
    chars: { ...result.chars },
    durationMs: result.durationMs,
    history: result.history.slice(-MAX_HISTORY_POINTS),
  };
  write(STORAGE_KEYS.results, [...readResults(), entry].slice(-MAX_RESULTS));
  mergeKeyStats(layoutId, result);

  const allBests = readAllBests();
  const bests = allBests[layoutId] ?? {};
  const key = pbKey(result.mode, result.modeValue);
  const isPersonalBest = !bests[key] || result.wpm > num(bests[key].wpm);
  if (isPersonalBest) {
    write(STORAGE_KEYS.bests, { ...allBests, [layoutId]: { ...bests, [key]: { wpm: result.wpm, accuracy: result.accuracy, at, resultId: entry.id } } });
  }
  markPractice(at);
  return { entry, isPersonalBest };
}

/**
 * Save one lesson drill/run: grades it, keeps the best stars / wpm / accuracy for the lesson,
 * merges per-key stats and marks today as practised. Lesson runs are not added to the test history.
 */
export function recordLessonResult(
  layoutId: string,
  lesson: Pick<Lesson, "id" | "goal">,
  result: TestResult,
  at: number = Date.now(),
): { grade: LessonGrade; progress: LessonProgressEntry; improved: boolean } {
  const grade = gradeLesson(result, lesson);
  const all = readAllLessons();
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
  write(STORAGE_KEYS.lessons, { ...all, [layoutId]: { ...forLayout, [lesson.id]: progress } });
  mergeKeyStats(layoutId, result);
  markPractice(at);
  return { grade, progress, improved: grade.stars > num(prev?.stars) };
}

/** Remove everything this app stored (all "ll:v1:" keys). */
export function clearAll(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // storage unavailable: nothing persisted to remove
  }
  cache.clear();
  memoryOnly.clear();
  emit();
}

// ------------------------------------------------------------------ reads (non-hook)

/** Oldest first. Client only (empty during SSR). */
export function getResults(layoutId?: string): StoredResult[] {
  const all = readResults();
  return layoutId == null ? all : all.filter((r) => r.layoutId === layoutId);
}

export function getKeyStats(layoutId: string): KeyStats {
  return readAllKeyStats()[layoutId] ?? EMPTY_OBJECT;
}

export function getLessonProgress(layoutId: string): LessonProgress {
  return readAllLessons()[layoutId] ?? EMPTY_OBJECT;
}

export function getPersonalBests(layoutId: string): PersonalBests {
  return readAllBests()[layoutId] ?? EMPTY_OBJECT;
}

export function getStreak(today?: string): Streak {
  return computeStreak(readDays(), today);
}

/** Per-character summaries, any order. */
export function summarizeKeyStats(stats: KeyStats): KeyStatSummary[] {
  const entries = Object.entries(stats).filter(([, s]) => isObject(s));
  let totalMs = 0;
  let samples = 0;
  for (const [, s] of entries) {
    totalMs += num(s.totalMs);
    samples += num(s.samples);
  }
  const overallMs = samples > 0 ? totalMs / samples : 0;
  return entries.map(([char, s]) => {
    const hits = num(s.hits);
    const misses = num(s.misses);
    const attempts = hits + misses;
    const avgMs = num(s.samples) > 0 ? num(s.totalMs) / num(s.samples) : null;
    // Smoothed error rate (one phantom correct attempt) so a single slip on a rare key does not dominate.
    const errorRate = attempts > 0 ? misses / (attempts + 1) : 0;
    const slowness = avgMs != null && overallMs > 0 ? Math.max(0, avgMs / overallMs - 1) : 0;
    const wrong = Object.entries(isObject(s.mistypedAs) ? (s.mistypedAs as Record<string, number>) : {}).sort((a, b) => num(b[1]) - num(a[1]));
    return {
      char,
      hits,
      misses,
      accuracy: attempts > 0 ? Math.round((hits / attempts) * 10000) / 100 : 100,
      avgMs: avgMs == null ? null : Math.round(avgMs),
      score: Math.round((errorRate + 0.25 * Math.min(slowness, 2)) * 1000) / 1000,
      mostMistypedAs: wrong.length > 0 ? wrong[0][0] : null,
    };
  });
}

/**
 * The `n` weakest characters of a layout (worst first), ignoring space and characters seen
 * fewer than `minAttempts` times (default 3) or with a zero score.
 */
export function weakestKeys(layoutId: string, n: number, minAttempts = 3): KeyStatSummary[] {
  return rankWeakest(getKeyStats(layoutId), n, minAttempts);
}

function rankWeakest(stats: KeyStats, n: number, minAttempts: number): KeyStatSummary[] {
  const ranked = summarizeKeyStats(stats)
    .filter((s) => s.char !== " " && s.hits + s.misses >= minAttempts && s.score > 0)
    .sort((a, b) => b.score - a.score || b.misses - a.misses || a.char.localeCompare(b.char))
    .slice(0, Math.max(0, n));
  return ranked.length === 0 ? EMPTY_SUMMARIES : ranked;
}

// ------------------------------------------------------------------ hooks

/** Test history, oldest first; all layouts when `layoutId` is omitted. Empty on the server / first paint. */
export function useResults(layoutId?: string): StoredResult[] {
  const all = useSyncExternalStore(subscribe, readResults, () => EMPTY_RESULTS);
  return useMemo(() => (layoutId == null ? all : all.filter((r) => r.layoutId === layoutId)), [all, layoutId]);
}

export function useKeyStats(layoutId: string): KeyStats {
  const all = useSyncExternalStore(subscribe, readAllKeyStats, () => EMPTY_OBJECT as Record<string, KeyStats>);
  return all[layoutId] ?? EMPTY_OBJECT;
}

export function useWeakestKeys(layoutId: string, n: number, minAttempts = 3): KeyStatSummary[] {
  const stats = useKeyStats(layoutId);
  return useMemo(() => rankWeakest(stats, n, minAttempts), [stats, n, minAttempts]);
}

export function useLessonProgress(layoutId: string): LessonProgress {
  const all = useSyncExternalStore(subscribe, readAllLessons, () => EMPTY_OBJECT as Record<string, LessonProgress>);
  return all[layoutId] ?? EMPTY_OBJECT;
}

export function usePersonalBests(layoutId: string): PersonalBests {
  const all = useSyncExternalStore(subscribe, readAllBests, () => EMPTY_OBJECT as Record<string, PersonalBests>);
  return all[layoutId] ?? EMPTY_OBJECT;
}

export function useStreak(): Streak {
  const days = useSyncExternalStore(subscribe, readDays, () => EMPTY_DAYS);
  return useMemo(() => computeStreak(days), [days]);
}
