// "Practice weak keys": text weighted toward a handful of characters, and the helper that picks
// the weakest characters out of one finished test.
import type { TestResult } from "@/lib/typing/engine";
import { summarizeKeyStats, type KeyStats, type KeyStatSummary } from "@/lib/stats/store";
import { createRng, getWordList, isLetter, isTypable, pick, pseudoWord, type WordListName } from "@/lib/typing/words";

export interface PracticeConfig {
  /** Characters to drill (letters, capitals, digits or punctuation). */
  chars: readonly string[];
  count: number;
  wordList?: WordListName;
  /** Characters the layout can type (`typableChars(layout)`). Space is always allowed. */
  allowedChars?: readonly string[];
  seed?: number;
}

const TRAILING = new Set([".", ",", ";", ":", "?", "!"]);
const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">", '"': '"', "'": "'", "`": "`" };
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };

/**
 * `count` words in which every word exercises one of `chars` (each char gets an equal share):
 * real words containing the letter where the word list has them, pronounceable pseudo-words
 * otherwise; capitals start a word, digits come as short numbers, punctuation is attached to a word.
 */
export function generatePracticeWords(cfg: PracticeConfig): string[] {
  const rng = createRng(cfg.seed ?? Math.floor(Math.random() * 0xffffffff));
  const allowed = cfg.allowedChars ? new Set([...cfg.allowedChars, " "]) : null;
  const can = (s: string) => !allowed || isTypable(s, allowed);
  const targets = Array.from(new Set(cfg.chars)).filter((c) => c !== " " && c.length > 0 && can(c));
  const base = getWordList(cfg.wordList ?? "english1k").filter((w) => can(w) && /^[a-z]+$/.test(w));
  const lowerLetters = allowed
    ? Array.from(allowed).filter((c) => isLetter(c) && c === c.toLowerCase())
    : "abcdefghijklmnopqrstuvwxyz".split("");
  const drilledLetters = targets.filter((c) => isLetter(c)).map((c) => c.toLowerCase());

  const plainWord = (): string => {
    // Prefer words that touch another drilled letter too.
    const rich = base.filter((w) => drilledLetters.some((c) => w.includes(c)));
    const pool = rich.length >= 12 ? rich : base;
    if (pool.length > 0) return pick(rng, pool);
    return lowerLetters.length > 0 ? pseudoWord(rng, lowerLetters, { minLength: 3, maxLength: 5 }) : "";
  };

  const wordWith = (letter: string, atStart: boolean): string => {
    const pool = base.filter((w) => (atStart ? w[0] === letter : w.includes(letter)));
    // Favour words where the letter appears more than once or alongside other drilled letters.
    const strong = pool.filter((w) => w.split(letter).length > 2 || drilledLetters.some((c) => c !== letter && w.includes(c)));
    if (strong.length >= 6 && rng() < 0.6) return pick(rng, strong);
    if (pool.length >= 3 || (pool.length > 0 && rng() < 0.5)) return pick(rng, pool);
    if (lowerLetters.includes(letter)) {
      const w = pseudoWord(rng, lowerLetters, { minLength: 3, maxLength: 5, include: [letter], includeWeight: 3 });
      return atStart && w[0] !== letter ? letter + w.slice(1) : w;
    }
    return pool.length > 0 ? pick(rng, pool) : letter;
  };

  const forChar = (c: string): string => {
    if (isLetter(c)) {
      if (c === c.toLowerCase()) return wordWith(c, false);
      const lower = c.toLowerCase();
      const w = lowerLetters.includes(lower) ? wordWith(lower, true) : plainWord();
      return c + (w[0] === lower ? w.slice(1) : w);
    }
    if (/\d/.test(c)) {
      const digits = "0123456789".split("").filter(can);
      const len = 2 + Math.floor(rng() * 2);
      const out = Array.from({ length: len }, () => pick(rng, digits));
      out[Math.floor(rng() * len)] = c;
      return out.join("");
    }
    const w = plainWord();
    if (TRAILING.has(c)) return w + c;
    if (PAIRS[c] && can(PAIRS[c])) return c + w + PAIRS[c];
    if (CLOSERS[c] && can(CLOSERS[c])) return CLOSERS[c] + w + c;
    return rng() < 0.5 ? w + c : c + w;
  };

  const out: string[] = [];
  if (targets.length === 0) {
    for (let i = 0; i < cfg.count; i++) out.push(plainWord() || "a");
    return out;
  }
  // Shuffled round-robin so every char gets its share and neighbours differ.
  let bag: string[] = [];
  let prev = "";
  for (let i = 0; i < cfg.count; i++) {
    if (bag.length === 0) bag = targets.slice().sort(() => rng() - 0.5);
    const c = bag.pop() as string;
    let w = forChar(c);
    for (let tries = 0; tries < 5 && (w === prev || !w); tries++) w = forChar(c);
    out.push(w || c);
    prev = w;
  }
  return out;
}

/** Per-character summaries of one finished test (same scoring as the stats store), worst first. */
export function rankResultChars(result: Pick<TestResult, "charStats" | "mistypes">): KeyStatSummary[] {
  const stats: KeyStats = {};
  for (const [ch, s] of Object.entries(result.charStats ?? {})) {
    stats[ch] = { hits: s.hits, misses: s.misses, totalMs: s.totalMs, samples: s.samples, mistypedAs: { ...(result.mistypes?.[ch] ?? {}) } };
  }
  return summarizeKeyStats(stats)
    .filter((s) => s.char !== " ")
    .sort((a, b) => b.score - a.score || b.misses - a.misses || (b.avgMs ?? 0) - (a.avgMs ?? 0) || a.char.localeCompare(b.char));
}

/**
 * The characters of this test worth drilling: the ones that were mistyped, then (to fill up to
 * `n`) the clearly slow ones. Empty when the run was clean and even.
 */
export function weakCharsOfResult(result: Pick<TestResult, "charStats" | "mistypes">, n = 6): KeyStatSummary[] {
  let totalMs = 0;
  let samples = 0;
  for (const s of Object.values(result.charStats ?? {})) {
    totalMs += s.totalMs;
    samples += s.samples;
  }
  const overall = samples > 0 ? totalMs / samples : 0;
  return rankResultChars(result)
    .filter((s) => {
      if (s.misses > 0) return true;
      // Slow but never wrong: only when it is clearly, repeatedly slower than the rest.
      return s.hits >= 2 && s.avgMs != null && overall > 0 && s.avgMs >= overall * 1.5 && s.avgMs - overall >= 80;
    })
    .slice(0, n);
}
