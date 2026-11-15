// Word sources and the text generator for tests and lessons. Pure, no React.
import { ENGLISH_1K, ENGLISH_200 } from "./data/english";
import { CODE_TOKENS } from "./data/code";

export type WordListName = "english200" | "english1k" | "code";

export type GenerateMode = { mode: "words"; count: number } | { mode: "time"; seconds: number };

export interface GenerateConfig {
  wordList: WordListName;
  /** Capitalise sentence starts and sprinkle . , ? ! ; : quotes and parentheses. Ignored for "code". */
  punctuation: boolean;
  /** Replace roughly one word in ten with a 1-4 digit number. */
  numbers: boolean;
  /**
   * Restrict output to these characters (space is always allowed). Words that need any other
   * character are dropped; punctuation/capitals/digits are only added when they are allowed.
   * If too few real words remain, pronounceable pseudo-words fill in.
   */
  allowedChars?: string[];
  /** Same seed + same config => same text. Omit for a random text. */
  seed?: number;
}

export type Rng = () => number;

export const WORD_LISTS: Record<WordListName, readonly string[]> = {
  english200: ENGLISH_200,
  english1k: ENGLISH_1K,
  code: CODE_TOKENS,
};

export function getWordList(name: WordListName): readonly string[] {
  return WORD_LISTS[name] ?? ENGLISH_200;
}

/** Small fast seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit string hash (FNV-1a), handy for deriving seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

export function isLetter(ch: string): boolean {
  return ch.length > 0 && ch.toLowerCase() !== ch.toUpperCase();
}

/** True if every character of `word` is in `allowed`. */
export function isTypable(word: string, allowed: ReadonlySet<string>): boolean {
  for (let i = 0; i < word.length; i++) if (!allowed.has(word[i])) return false;
  return true;
}

/** Words of `words` typable using only `allowedChars`. */
export function filterTypable(words: readonly string[], allowedChars: Iterable<string>): string[] {
  const allowed = allowedChars instanceof Set ? (allowedChars as Set<string>) : new Set(allowedChars);
  return words.filter((w) => isTypable(w, allowed));
}

const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);

export interface PseudoWordOptions {
  minLength?: number;
  maxLength?: number;
  /** The word is guaranteed to contain at least one of these (when given and non-empty). */
  include?: readonly string[];
  /** How much more likely an `include` char is than any other (default 1 = no bias). */
  includeWeight?: number;
}

/**
 * A pronounceable-ish made-up word from `chars` (alternates consonants and vowels when both
 * exist among `chars`, never three identical characters in a row).
 */
export function pseudoWord(rng: Rng, chars: readonly string[], opts: PseudoWordOptions = {}): string {
  const min = opts.minLength ?? 2;
  const max = Math.max(min, opts.maxLength ?? 5);
  const include = (opts.include ?? []).filter((c) => chars.includes(c));
  const weight = Math.max(1, Math.round(opts.includeWeight ?? 1));
  if (chars.length === 0) return "";
  const weighted: string[] = [];
  for (const c of chars) {
    const n = include.includes(c) ? weight : 1;
    for (let i = 0; i < n; i++) weighted.push(c);
  }
  const vowels = weighted.filter((c) => VOWELS.has(c.toLowerCase()));
  const consonants = weighted.filter((c) => !VOWELS.has(c.toLowerCase()));
  const alternate = vowels.length > 0 && consonants.length > 0;
  const len = min + Math.floor(rng() * (max - min + 1));
  let wantVowel = rng() < 0.4;
  const out: string[] = [];
  for (let i = 0; i < len; i++) {
    const pool = alternate ? (wantVowel ? vowels : consonants) : weighted;
    let c = pick(rng, pool);
    for (let tries = 0; tries < 6 && i >= 2 && out[i - 1] === c && out[i - 2] === c; tries++) c = pick(rng, pool);
    out.push(c);
    // Occasionally allow a consonant cluster so the words are not all CVCV.
    wantVowel = alternate ? (wantVowel ? false : rng() < 0.8) : wantVowel;
  }
  if (include.length > 0 && !out.some((c) => include.includes(c))) {
    const inc = pick(rng, include);
    // Prefer replacing a character of the same class to keep it pronounceable.
    const same = out.map((c, i) => (VOWELS.has(c.toLowerCase()) === VOWELS.has(inc.toLowerCase()) ? i : -1)).filter((i) => i >= 0);
    const at = same.length > 0 ? pick(rng, same) : Math.floor(rng() * out.length);
    out[at] = inc;
  }
  return out.join("");
}

const DIGITS = "0123456789".split("");

export interface WordStream {
  /** The next `count` words of the (endless) text. */
  next(count: number): string[];
}

/**
 * Endless seeded word source. `generateText` is a thin wrapper; time-mode pages keep the stream
 * around and call `next(n)` when the typist is about to run out of words.
 */
export function createWordStream(cfg: GenerateConfig): WordStream {
  const rng = createRng(cfg.seed ?? Math.floor(Math.random() * 0xffffffff));
  const allowed = cfg.allowedChars ? new Set(cfg.allowedChars) : null;
  const can = (chars: string) => !allowed || isTypable(chars, allowed);

  let pool: readonly string[] = getWordList(cfg.wordList);
  if (allowed) pool = pool.filter((w) => isTypable(w, allowed));
  const pseudoChars = allowed
    ? (() => {
        const letters = Array.from(allowed).filter((c) => c !== " " && isLetter(c) && c === c.toLowerCase());
        return letters.length > 0 ? letters : Array.from(allowed).filter((c) => c !== " ");
      })()
    : [];
  // With fewer than ~10 real words the text gets repetitive: blend in pseudo-words.
  const pseudoShare = !allowed ? 0 : pool.length === 0 ? 1 : pool.length < 4 ? 0.8 : pool.length < 10 ? 0.5 : 0;
  const digits = DIGITS.filter((d) => can(d));
  const punctuate = cfg.punctuation && cfg.wordList !== "code";

  let prevBase = "";
  let sentenceStart = true;

  const baseWord = (): string => {
    for (let tries = 0; tries < 30; tries++) {
      let w: string;
      if (cfg.numbers && digits.length > 0 && rng() < 0.1) {
        const len = 1 + Math.floor(rng() * 4);
        w = "";
        for (let i = 0; i < len; i++) w += pick(rng, digits);
      } else if (pool.length > 0 && rng() >= pseudoShare) {
        w = pick(rng, pool);
      } else if (pseudoChars.length > 0) {
        w = pseudoWord(rng, pseudoChars, { minLength: 2, maxLength: 5 });
      } else {
        w = pool.length > 0 ? pick(rng, pool) : "";
      }
      if (w && w !== prevBase) return w;
    }
    // Only reachable with a single possible word (e.g. one allowed char): vary the length instead.
    const c = pseudoChars[0] ?? pool[0] ?? "a";
    const w = c.length === 1 ? c.repeat(prevBase.length === 3 ? 2 : 3) : c;
    return w;
  };

  const decorate = (w: string): string => {
    if (!punctuate) return w;
    let out = w;
    if (sentenceStart && isLetter(out[0])) {
      const cap = out[0].toUpperCase() + out.slice(1);
      if (can(cap[0])) out = cap;
    }
    sentenceStart = false;
    const r = rng();
    if (r < 0.1) {
      const end = rng() < 0.75 ? "." : rng() < 0.5 ? "?" : "!";
      if (can(end)) {
        out += end;
        sentenceStart = true;
      }
    } else if (r < 0.2) {
      if (can(",")) out += ",";
    } else if (r < 0.23) {
      if (can('"')) out = `"${out}"`;
    } else if (r < 0.25) {
      if (can("'")) out = `'${out}'`;
    } else if (r < 0.27) {
      if (can("()")) out = `(${out})`;
    } else if (r < 0.29) {
      if (can(":")) out += ":";
    } else if (r < 0.31) {
      if (can(";")) out += ";";
    }
    return out;
  };

  return {
    next(count: number): string[] {
      const out: string[] = [];
      for (let i = 0; i < count; i++) {
        const base = baseWord();
        prevBase = base;
        out.push(decorate(base));
      }
      return out;
    },
  };
}

/** How many words `generateText` returns up front for a time-mode test (≈ 240 wpm worth). */
export function wordsForSeconds(seconds: number): number {
  return Math.max(60, Math.ceil(seconds * 4));
}

/**
 * Generate the words of a test.
 * - words mode: exactly `count` words.
 * - time mode: `wordsForSeconds(seconds)` words; for more, use `createWordStream(cfg).next(n)`
 *   (a stream created with the same seed starts with the same words `generateText` returned).
 */
export function generateText(opts: GenerateMode, cfg: GenerateConfig): string[] {
  const stream = createWordStream(cfg);
  if (opts.mode === "time") return stream.next(wordsForSeconds(opts.seconds));
  const words = stream.next(Math.max(0, Math.floor(opts.count)));
  if (cfg.punctuation && cfg.wordList !== "code" && words.length > 0) {
    // A finite text ends like a sentence.
    const allowed = cfg.allowedChars ? new Set(cfg.allowedChars) : null;
    const last = words[words.length - 1];
    if ((!allowed || allowed.has(".")) && (isLetter(last[last.length - 1]) || /\d$/.test(last))) words[words.length - 1] = last + ".";
  }
  return words;
}
