// Pure typing-test state machine (no React, no DOM, no timers). Every function returns a new
// state object and never mutates its input, so states can be stored in React state directly.
//
// Semantics (monkeytype-style):
// - Word based. Space commits the current word and moves on; letters not typed are "missed".
//   Space on an empty word is ignored.
// - Letters typed past the end of a word are "extra" (at most `maxExtraChars`, then ignored).
// - Backspace at the start of a word returns into the previous word only if it was incorrect.
// - The timer starts on the first character. Words mode ends when the last word is typed
//   correctly or committed with space; time mode ends when the time is up.
// - wpm  = (chars of fully correct words + the spaces after them) / 5 / minutes
//   raw  = (every typed char, right or wrong, + spaces) / 5 / minutes
//   accuracy = correct keystrokes / all keystrokes (corrected mistakes still count against you)

export type LetterState = "pending" | "correct" | "incorrect" | "extra" | "missed";
export type TestStatus = "idle" | "running" | "finished";
export type TestMode = "words" | "time";

export type TestConfig = ({ mode: "words" } | { mode: "time"; seconds: number }) & {
  /** Max letters accepted past the end of a word. Default 10. */
  maxExtraChars?: number;
};

export type TestInput =
  | { type: "char"; char: string; /** physical key (LayoutKey.id) that produced it, if known */ keyId?: string | null }
  | { type: "backspace"; /** delete the whole word (Ctrl/Alt+Backspace) */ word?: boolean };

export interface CharStat {
  /** Times this character was expected and typed correctly. */
  hits: number;
  /** Times this character was expected and something else was typed. */
  misses: number;
  /** Sum of latencies (ms since the previous keystroke) over `samples` correct hits. */
  totalMs: number;
  /** Number of hits that contributed to totalMs (first keystroke and long pauses are skipped). */
  samples: number;
}

export type CharStats = Record<string, CharStat>;
/** expected char -> typed char -> count. A space typed too early shows up as typed " ". */
export type Mistypes = Record<string, Record<string, number>>;

export interface HistoryPoint {
  /** Seconds since the start (1, 2, 3 … and possibly a fractional final point). */
  t: number;
  /** Cumulative wpm at that moment. */
  wpm: number;
  /** Raw wpm of that second alone. */
  raw: number;
  /** Incorrect keystrokes in that second. */
  errors: number;
}

export interface CharCounts {
  correct: number;
  incorrect: number;
  extra: number;
  missed: number;
  spaces: number;
}

export interface TestState {
  readonly config: TestConfig;
  readonly words: readonly string[];
  /** What was typed for each word reached so far (index = word index). */
  readonly typed: readonly string[];
  /** Index of the word being typed. Equals words.length once the last word is done. */
  readonly wordIndex: number;
  readonly status: TestStatus;
  readonly startMs: number | null;
  readonly endMs: number | null;
  /** Latest time the state has seen (input or tick). */
  readonly nowMs: number | null;
  readonly lastInputMs: number | null;
  readonly keystrokes: { readonly correct: number; readonly incorrect: number };
  readonly charStats: CharStats;
  readonly mistypes: Mistypes;
  /** Per physical key (when inputs carry keyId): presses and how many of them were wrong. */
  readonly keyPresses: Record<string, { presses: number; errors: number }>;
  readonly history: readonly HistoryPoint[];
  /** Internal: counters for the second currently in progress. */
  readonly bucket: { readonly second: number; readonly chars: number; readonly errors: number };
}

export interface LetterView {
  /** Character to display: the expected one, or the typed one for extras. */
  char: string;
  /** What the user typed at this position, if anything. */
  typed: string | null;
  state: LetterState;
}

export interface WordView {
  index: number;
  word: string;
  typed: string;
  /** pending = not reached, active = being typed, correct/incorrect = committed. */
  state: "pending" | "active" | "correct" | "incorrect";
  letters: LetterView[];
}

export interface Caret {
  wordIndex: number;
  /** Number of characters typed in that word (may exceed the word length with extras). */
  letterIndex: number;
}

export interface LiveStats {
  wpm: number;
  raw: number;
  /** 0-100. 100 before anything is typed. */
  accuracy: number;
  elapsedMs: number;
  /** Time mode only, else null. */
  remainingMs: number | null;
  chars: CharCounts;
}

export interface TestResult {
  mode: TestMode;
  /** Word count (words mode) or seconds (time mode). */
  modeValue: number;
  wpm: number;
  raw: number;
  accuracy: number;
  /** 0-100, how steady the per-second raw speed was. */
  consistency: number;
  chars: CharCounts;
  durationMs: number;
  history: HistoryPoint[];
  charStats: CharStats;
  mistypes: Mistypes;
  keystrokes: { correct: number; incorrect: number };
  /** Words committed or completed. */
  wordsTyped: number;
}

const DEFAULT_MAX_EXTRA = 10;
/** Latencies above this are treated as pauses and left out of the per-char averages. */
export const MAX_LATENCY_MS = 3000;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function createTest(words: readonly string[], config: TestConfig): TestState {
  return {
    config,
    words: words.filter((w) => w.length > 0),
    typed: [""],
    wordIndex: 0,
    status: "idle",
    startMs: null,
    endMs: null,
    nowMs: null,
    lastInputMs: null,
    keystrokes: { correct: 0, incorrect: 0 },
    charStats: {},
    mistypes: {},
    keyPresses: {},
    history: [],
    bucket: { second: 0, chars: 0, errors: 0 },
  };
}

/** Add words to the end (time mode running low). No-op on a finished test. */
export function appendWords(state: TestState, more: readonly string[]): TestState {
  if (state.status === "finished" || more.length === 0) return state;
  return { ...state, words: [...state.words, ...more.filter((w) => w.length > 0)] };
}

// ---------------------------------------------------------------- counting

interface Counted extends CharCounts {
  correctWordChars: number;
  correctSpaces: number;
}

function countChars(state: TestState): Counted {
  const { words, typed, wordIndex } = state;
  const c: Counted = { correct: 0, incorrect: 0, extra: 0, missed: 0, spaces: 0, correctWordChars: 0, correctSpaces: 0 };
  const inputCount = Math.min(wordIndex + 1, words.length);
  for (let i = 0; i < inputCount; i++) {
    const w = words[i];
    const t = typed[i] ?? "";
    const committed = i < wordIndex;
    const spaceAfter = i < inputCount - 1;
    if (spaceAfter) c.spaces++;
    if (t === w) {
      c.correct += w.length;
      c.correctWordChars += w.length;
      if (spaceAfter) c.correctSpaces++;
      continue;
    }
    let prefixOk = true;
    for (let j = 0; j < t.length; j++) {
      if (j >= w.length) c.extra++;
      else if (t[j] === w[j]) c.correct++;
      else {
        c.incorrect++;
        prefixOk = false;
      }
    }
    if (t.length < w.length) {
      if (committed) c.missed += w.length - t.length;
      // The word in progress counts towards wpm as long as it is right so far.
      else if (prefixOk) c.correctWordChars += t.length;
    }
  }
  return c;
}

function wpmFrom(c: Counted, elapsedMs: number): { wpm: number; raw: number } {
  const minutes = Math.max(elapsedMs, 1) / 60000;
  return {
    wpm: (c.correctWordChars + c.correctSpaces) / 5 / minutes,
    raw: (c.correct + c.incorrect + c.extra + c.spaces) / 5 / minutes,
  };
}

function timeLimitMs(state: TestState): number | null {
  return state.config.mode === "time" ? Math.max(0, state.config.seconds) * 1000 : null;
}

// ---------------------------------------------------------------- clock

function finalize(state: TestState, endMs: number): TestState {
  if (state.status !== "running" || state.startMs == null) return state;
  const duration = Math.max(0, endMs - state.startMs);
  const partialMs = duration - state.bucket.second * 1000;
  let history = state.history;
  const finished: TestState = { ...state, status: "finished", endMs, nowMs: endMs };
  if (partialMs >= 500 || history.length === 0) {
    const part = Math.max(partialMs, 1);
    history = [
      ...history,
      {
        t: round2(duration / 1000),
        wpm: round2(wpmFrom(countChars(finished), duration).wpm),
        raw: round2(state.bucket.chars / 5 / (part / 60000)),
        errors: state.bucket.errors,
      },
    ];
  }
  return { ...finished, history, bucket: { second: state.bucket.second, chars: 0, errors: 0 } };
}

/** Roll the per-second history forward to `timeMs` and end a time-mode test whose time is up. */
function advanceClock(state: TestState, timeMs: number): TestState {
  if (state.status !== "running" || state.startMs == null) return state;
  const now = Math.max(state.nowMs ?? timeMs, timeMs);
  const limit = timeLimitMs(state);
  const end = limit == null ? null : state.startMs + limit;
  const effective = end == null ? now : Math.min(now, end);
  const wholeSeconds = Math.floor((effective - state.startMs) / 1000);
  let s = state;
  if (wholeSeconds > state.bucket.second) {
    const history = [...state.history];
    const counted = countChars(state);
    let bucket = state.bucket;
    for (let k = bucket.second + 1; k <= wholeSeconds; k++) {
      history.push({
        t: k,
        wpm: round2(wpmFrom(counted, k * 1000).wpm),
        raw: round2(bucket.chars * 12),
        errors: bucket.errors,
      });
      bucket = { second: k, chars: 0, errors: 0 };
    }
    s = { ...state, history, bucket };
  }
  if (end != null && now >= end) return finalize(s, end);
  return s.nowMs === now ? s : { ...s, nowMs: now };
}

/** Advance time without input: updates live stats / history and ends time mode on time. */
export function tick(state: TestState, timeMs: number): TestState {
  return advanceClock(state, timeMs);
}

/** End the test now (e.g. the user quits early). Idle tests stay idle. */
export function finish(state: TestState, timeMs?: number): TestState {
  if (state.status !== "running") return state;
  const at = timeMs ?? state.nowMs ?? state.startMs ?? 0;
  const s = advanceClock(state, at);
  return s.status === "finished" ? s : finalize(s, Math.max(at, s.nowMs ?? at));
}

// ---------------------------------------------------------------- input

function withHit(stats: CharStats, ch: string, latency: number | null): CharStats {
  const cur = stats[ch] ?? { hits: 0, misses: 0, totalMs: 0, samples: 0 };
  const timed = latency != null && latency >= 0 && latency <= MAX_LATENCY_MS;
  return {
    ...stats,
    [ch]: {
      hits: cur.hits + 1,
      misses: cur.misses,
      totalMs: cur.totalMs + (timed ? Math.round(latency) : 0),
      samples: cur.samples + (timed ? 1 : 0),
    },
  };
}

function withMiss(stats: CharStats, ch: string): CharStats {
  const cur = stats[ch] ?? { hits: 0, misses: 0, totalMs: 0, samples: 0 };
  return { ...stats, [ch]: { ...cur, misses: cur.misses + 1 } };
}

function withMistype(m: Mistypes, expected: string, typed: string): Mistypes {
  const row = m[expected] ?? {};
  return { ...m, [expected]: { ...row, [typed]: (row[typed] ?? 0) + 1 } };
}

function setTyped(typed: readonly string[], index: number, value: string): string[] {
  const next = typed.slice();
  while (next.length <= index) next.push("");
  next[index] = value;
  return next;
}

/**
 * Feed one keystroke. `timeMs` is any monotonic clock (performance.now()).
 * Inputs on a finished test, multi-character strings, tabs and newlines are ignored.
 */
export function applyInput(state: TestState, input: TestInput, timeMs: number): TestState {
  if (state.status === "finished" || state.words.length === 0) return state;

  if (input.type === "backspace") {
    if (state.status !== "running") return state;
    const s = advanceClock(state, timeMs);
    if (s.status !== "running") return s;
    const wi = s.wordIndex;
    const t = s.typed[wi] ?? "";
    const canGoBack = wi > 0 && (s.typed[wi - 1] ?? "") !== s.words[wi - 1];
    if (t.length > 0) {
      return { ...s, typed: setTyped(s.typed, wi, input.word ? "" : t.slice(0, -1)), lastInputMs: timeMs };
    }
    if (canGoBack) {
      const typed = input.word ? setTyped(s.typed, wi - 1, "") : s.typed;
      return { ...s, typed, wordIndex: wi - 1, lastInputMs: timeMs };
    }
    return s;
  }

  const ch = input.char;
  if (typeof ch !== "string" || Array.from(ch).length !== 1 || ch === "\n" || ch === "\r" || ch === "\t") return state;

  let s: TestState;
  if (state.status === "idle") {
    if (ch === " ") return state;
    s = { ...state, status: "running", startMs: timeMs, nowMs: timeMs };
  } else {
    s = advanceClock(state, timeMs);
    if (s.status !== "running") return s;
  }

  const wi = s.wordIndex;
  const word = s.words[wi];
  const t = s.typed[wi] ?? "";
  const latency = s.lastInputMs == null ? null : timeMs - s.lastInputMs;
  const max = s.config.maxExtraChars ?? DEFAULT_MAX_EXTRA;

  let expected: string;
  if (ch === " ") {
    if (t.length === 0) return s;
    expected = t.length < word.length ? word[t.length] : " ";
  } else {
    if (t.length >= word.length + max) return s;
    expected = t.length < word.length ? word[t.length] : " ";
  }
  const ok = ch === expected;

  let charStats = s.charStats;
  let mistypes = s.mistypes;
  if (ok) charStats = withHit(charStats, expected, latency);
  else {
    charStats = withMiss(charStats, expected);
    mistypes = withMistype(mistypes, expected, ch);
  }
  let keyPresses = s.keyPresses;
  if (input.keyId) {
    const cur = keyPresses[input.keyId] ?? { presses: 0, errors: 0 };
    keyPresses = { ...keyPresses, [input.keyId]: { presses: cur.presses + 1, errors: cur.errors + (ok ? 0 : 1) } };
  }

  let next: TestState = {
    ...s,
    charStats,
    mistypes,
    keyPresses,
    lastInputMs: timeMs,
    keystrokes: { correct: s.keystrokes.correct + (ok ? 1 : 0), incorrect: s.keystrokes.incorrect + (ok ? 0 : 1) },
    bucket: { second: s.bucket.second, chars: s.bucket.chars + 1, errors: s.bucket.errors + (ok ? 0 : 1) },
  };

  if (ch === " ") {
    const nextIndex = wi + 1;
    next = { ...next, wordIndex: nextIndex, typed: nextIndex < s.words.length ? setTyped(s.typed, nextIndex, s.typed[nextIndex] ?? "") : s.typed };
    if (nextIndex >= s.words.length) return finalize(next, timeMs);
    return next;
  }

  const typedWord = t + ch;
  next = { ...next, typed: setTyped(s.typed, wi, typedWord) };
  if (s.config.mode === "words" && wi === s.words.length - 1 && typedWord === word) {
    return finalize({ ...next, wordIndex: s.words.length }, timeMs);
  }
  return next;
}

// ---------------------------------------------------------------- selectors

/** Per-word / per-letter render state for the whole text. */
export function getWords(state: TestState): WordView[] {
  const { words, typed, wordIndex } = state;
  const finished = state.status === "finished";
  return words.map((word, index) => {
    const reached = index <= wordIndex;
    const t = reached ? typed[index] ?? "" : "";
    const committed = index < wordIndex;
    const letters: LetterView[] = [];
    for (let j = 0; j < word.length; j++) {
      if (j < t.length) letters.push({ char: word[j], typed: t[j], state: t[j] === word[j] ? "correct" : "incorrect" });
      else letters.push({ char: word[j], typed: null, state: committed ? "missed" : "pending" });
    }
    for (let j = word.length; j < t.length; j++) letters.push({ char: t[j], typed: t[j], state: "extra" });
    const wordState: WordView["state"] = committed
      ? t === word
        ? "correct"
        : "incorrect"
      : index === wordIndex && !finished
        ? "active"
        : "pending";
    return { index, word, typed: t, state: wordState, letters };
  });
}

export function getCaret(state: TestState): Caret {
  const wordIndex = Math.max(0, Math.min(state.wordIndex, state.words.length - 1));
  return { wordIndex, letterIndex: (state.typed[wordIndex] ?? "").length };
}

/**
 * The character the user must type next (" " when the word is complete or over-typed),
 * or null when the test is finished. Drives the key / finger highlight.
 */
export function getNextChar(state: TestState): string | null {
  if (state.status === "finished" || state.wordIndex >= state.words.length) return null;
  const word = state.words[state.wordIndex];
  const t = state.typed[state.wordIndex] ?? "";
  return t.length < word.length ? word[t.length] : " ";
}

export function getElapsedMs(state: TestState, timeMs?: number): number {
  if (state.startMs == null) return 0;
  if (state.endMs != null) return Math.max(0, state.endMs - state.startMs);
  const now = Math.max(state.nowMs ?? state.startMs, timeMs ?? 0);
  const limit = timeLimitMs(state);
  const elapsed = Math.max(0, now - state.startMs);
  return limit == null ? elapsed : Math.min(elapsed, limit);
}

export function getCharCounts(state: TestState): CharCounts {
  const { correct, incorrect, extra, missed, spaces } = countChars(state);
  return { correct, incorrect, extra, missed, spaces };
}

export function getAccuracy(state: TestState): number {
  const total = state.keystrokes.correct + state.keystrokes.incorrect;
  return total === 0 ? 100 : round2((state.keystrokes.correct / total) * 100);
}

/** Live numbers for the HUD. Pass the current time for a smooth clock between ticks. */
export function getLiveStats(state: TestState, timeMs?: number): LiveStats {
  const counted = countChars(state);
  const elapsedMs = getElapsedMs(state, timeMs);
  const limit = timeLimitMs(state);
  const speeds = state.startMs == null || elapsedMs < 1 ? { wpm: 0, raw: 0 } : wpmFrom(counted, elapsedMs);
  const { correct, incorrect, extra, missed, spaces } = counted;
  return {
    wpm: round2(speeds.wpm),
    raw: round2(speeds.raw),
    accuracy: getAccuracy(state),
    elapsedMs,
    remainingMs: limit == null ? null : Math.max(0, limit - elapsedMs),
    chars: { correct, incorrect, extra, missed, spaces },
  };
}

/** 0-100 steadiness score from the per-second raw speeds (100 = perfectly even). */
export function getConsistency(history: readonly HistoryPoint[]): number {
  const xs = history.map((h) => h.raw);
  if (xs.length === 0) return 0;
  if (xs.length === 1) return 100;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean <= 0) return 0;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  const cov = sd / mean;
  return round2(100 * (1 - Math.tanh(cov + cov ** 3 / 3 + cov ** 5 / 5)));
}

/** The final result, or null while the test is not finished. */
export function getResult(state: TestState): TestResult | null {
  if (state.status !== "finished" || state.startMs == null || state.endMs == null) return null;
  const durationMs = Math.max(0, state.endMs - state.startMs);
  const counted = countChars(state);
  const { wpm, raw } = wpmFrom(counted, durationMs);
  const { correct, incorrect, extra, missed, spaces } = counted;
  return {
    mode: state.config.mode,
    modeValue: state.config.mode === "time" ? state.config.seconds : state.words.length,
    wpm: round2(wpm),
    raw: round2(raw),
    accuracy: getAccuracy(state),
    consistency: getConsistency(state.history),
    chars: { correct, incorrect, extra, missed, spaces },
    durationMs: Math.round(durationMs),
    history: state.history.slice(),
    charStats: state.charStats,
    mistypes: state.mistypes,
    keystrokes: { ...state.keystrokes },
    wordsTyped: Math.min(state.wordIndex, state.words.length),
  };
}
