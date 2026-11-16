// Progressive lesson plan generated from ANY parsed layout (uses finger / isHome / row only).
// Order: index-finger home keys -> rest of the home row finger by finger -> home review ->
// top row -> bottom row -> reviews -> capitals (Shift) -> numbers -> punctuation -> final review.
import type { Finger, LayoutKey, ParsedLayout } from "@/lib/types";
import { keyForChar } from "@/lib/layout/keys";
import { ENGLISH_1K } from "@/lib/typing/data/english";
import { createRng, hashString, isLetter, isTypable, pick, pseudoWord, type Rng } from "@/lib/typing/words";

export type LessonStage = "home" | "top" | "bottom" | "extra" | "capitals" | "numbers" | "punctuation" | "layer";

export interface Lesson {
  /** Stable for a given layout, e.g. "home-fj", "top-review", "capitals-left", "numbers-4756". */
  id: string;
  /** Position in the curriculum, 0-based. */
  index: number;
  title: string;
  description: string;
  stage: LessonStage;
  /** "new" introduces keys, "review" only practises known ones (newChars is empty). */
  kind: "new" | "review";
  /** Characters introduced by this lesson. */
  newChars: string[];
  /** Every character known after this lesson (cumulative, space is implicit). */
  chars: string[];
  /** Keys to highlight: the new keys (plus Shift keys where needed); for reviews, the keys of the stage. */
  focusKeyIds: string[];
  /** Each drill is the word list of one short words-mode test, easiest first. */
  drills: string[][];
  goal: { accuracy: number; wpm: number };
}

export interface LessonGrade {
  passed: boolean;
  stars: 0 | 1 | 2 | 3;
}

/**
 * Grade one lesson run. Pass = both goals met (1 star); 2 stars = accuracy >= 95 and
 * wpm >= 1.25x goal; 3 stars = accuracy >= 98 and wpm >= 1.5x goal.
 */
export function gradeLesson(result: { wpm: number; accuracy: number }, lesson: Pick<Lesson, "goal">): LessonGrade {
  const { accuracy, wpm } = lesson.goal;
  if (!(result.accuracy >= accuracy && result.wpm >= wpm)) return { passed: false, stars: 0 };
  if (result.accuracy >= 98 && result.wpm >= wpm * 1.5) return { passed: true, stars: 3 };
  if (result.accuracy >= 95 && result.wpm >= wpm * 1.25) return { passed: true, stars: 2 };
  return { passed: true, stars: 1 };
}

// ------------------------------------------------------------------ layout analysis

const FINGERS: Finger[] = ["index", "middle", "ring", "pinky", "thumb"];
const isDigit = (c: string) => c.length === 1 && c >= "0" && c <= "9";
const isCharKey = (k: LayoutKey) => !k.isModifier && typeof k.base === "string" && k.base.length === 1 && k.base !== " ";

interface Entry {
  char: string;
  key: LayoutKey;
  /** True if the char is on the Shift layer of its key. */
  shifted: boolean;
}

function fingerLabel(k: LayoutKey): string {
  if (!k.finger) return "";
  return `${k.finger.hand === "L" ? "left" : "right"} ${k.finger.finger}`;
}

/** Row holding the resting keys (most isHome keys); falls back to the middle letter row. */
function findHomeRow(letterKeys: LayoutKey[]): number {
  const counts = new Map<number, number>();
  for (const k of letterKeys) if (k.isHome && k.finger?.finger !== "thumb") counts.set(k.row, (counts.get(k.row) ?? 0) + 1);
  if (counts.size > 0) return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const rows = Array.from(new Set(letterKeys.map((k) => k.row))).sort((a, b) => a - b);
  return rows[Math.floor(rows.length / 2)] ?? 0;
}

/**
 * Split keys into small groups to learn together: for each finger (index -> pinky -> thumb) the
 * key nearest its home column for the left and right hand; then the stretch keys. A group that
 * would hold a single key is merged into a neighbour.
 */
function fingerGroups(keys: LayoutKey[], homeX: Map<string, number>): LayoutKey[][] {
  const dist = (k: LayoutKey) => {
    const hx = k.finger ? homeX.get(k.finger.hand + k.finger.finger) : undefined;
    return hx == null ? 0 : Math.abs(k.x - hx);
  };
  const byFinger = (hand: "L" | "R", finger: Finger) =>
    keys.filter((k) => k.finger?.hand === hand && k.finger.finger === finger).sort((a, b) => dist(a) - dist(b));
  const lists = FINGERS.map((f) => ({ L: byFinger("L", f), R: byFinger("R", f) }));
  const depth = Math.max(0, ...lists.map((l) => Math.max(l.L.length, l.R.length)));
  const groups: LayoutKey[][] = [];
  for (let d = 0; d < depth; d++) {
    for (const l of lists) {
      const g = [l.L[d], l.R[d]].filter(Boolean);
      if (g.length > 0) groups.push(g);
    }
  }
  const loose = keys.filter((k) => !k.finger);
  for (let i = 0; i < loose.length; i += 2) groups.push(loose.slice(i, i + 2));

  const merged: LayoutKey[][] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const prev = merged[merged.length - 1];
    if (g.length === 1 && prev && prev.length <= 2) prev.push(...g);
    else if (g.length === 1 && i + 1 < groups.length && groups[i + 1].length <= 2) groups[i + 1] = [...g, ...groups[i + 1]];
    else merged.push(g.slice());
  }
  return merged;
}

/** Combine consecutive groups until each holds up to `max` keys. */
function packGroups<T>(groups: T[][], max: number): T[][] {
  const out: T[][] = [];
  for (const g of groups) {
    const prev = out[out.length - 1];
    if (prev && prev.length + g.length <= max) prev.push(...g);
    else out.push(g.slice());
  }
  return out;
}

// ------------------------------------------------------------------ drill building

const DRILL_LENGTH = 20;

/** Remove immediate repeats (keeps drills from containing "fj fj"). */
function noRepeats(words: string[]): string[] {
  const out: string[] = [];
  for (const w of words) if (w && w !== out[out.length - 1]) out.push(w);
  return out;
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** "fff jjj fj jf fjf jfj …": the new keys on their own (with one known anchor if there is only one). */
function isolationDrill(rng: Rng, fresh: string[], known: string[]): string[] {
  const t: string[] = [];
  for (const c of fresh) t.push(c.repeat(3));
  const partners = fresh.length >= 2 ? fresh : [...fresh, ...known.slice(0, 1)];
  if (partners.length >= 2) {
    for (let i = 0; i < fresh.length; i++) {
      const a = fresh[i];
      const b = partners[(partners.indexOf(a) + 1) % partners.length];
      t.push(a + b, b + a, a + b + a, b + a + b);
      if (fresh.length === 2) break;
    }
    for (const c of fresh) t.push(c.repeat(2));
    for (let i = 0; i < 6; i++) {
      const len = 2 + Math.floor(rng() * 3);
      let w = "";
      for (let j = 0; j < len; j++) w += pick(rng, partners);
      if (fresh.some((c) => w.includes(c))) t.push(w);
    }
  } else {
    t.push(fresh[0].repeat(2), fresh[0], fresh[0].repeat(4), fresh[0].repeat(2));
  }
  return noRepeats(t);
}

/** Made-up words from everything known so far, weighted towards the new keys. */
function mixDrill(rng: Rng, fresh: string[], pool: string[], count = DRILL_LENGTH): string[] {
  const out: string[] = [];
  for (let guard = 0; out.length < count && guard < count * 10; guard++) {
    const w = pseudoWord(rng, pool, { minLength: 2, maxLength: 4, include: fresh, includeWeight: 3 });
    if (w && w !== out[out.length - 1]) out.push(w);
  }
  return out;
}

/** Real words typable with `letters`, preferring ones that use the new letters; pseudo-words if too few exist. */
function wordDrill(rng: Rng, fresh: string[], letters: string[], count = DRILL_LENGTH): string[] {
  const allowed = new Set(letters);
  const typable = ENGLISH_1K.filter((w) => w.length > 1 && isTypable(w, allowed));
  const withNew = fresh.length > 0 ? typable.filter((w) => fresh.some((c) => w.includes(c))) : typable;
  const out: string[] = [];
  for (let guard = 0; out.length < count && guard < count * 10; guard++) {
    let w: string;
    if (withNew.length >= 6 && rng() < 0.7) w = pick(rng, withNew);
    else if (typable.length >= 12 && (withNew.length >= 6 || fresh.length === 0)) w = pick(rng, typable);
    else if (withNew.length > 0 && rng() < 0.4) w = pick(rng, withNew);
    else w = pseudoWord(rng, letters, { minLength: 3, maxLength: 5, include: fresh, includeWeight: 2 });
    if (w && w !== out[out.length - 1]) out.push(w);
  }
  return out;
}

const SUFFIX = ".,;:?!";
const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };
const QUOTES = "\"'`";

/** Attach a symbol to a word the way it is usually typed: "word," "(word)" "'word'" "word-other". */
function applySymbol(word: string, other: string, s: string, known: ReadonlySet<string>): string {
  if (SUFFIX.includes(s)) return word + s;
  if (QUOTES.includes(s)) return s + word + s;
  if (PAIRS[s]) return known.has(PAIRS[s]) ? s + word + PAIRS[s] : s + word;
  if (CLOSERS[s]) return known.has(CLOSERS[s]) ? CLOSERS[s] + word + s : word + s;
  return word + s + other;
}

interface Known {
  letters: string[];
  capitals: string[];
  digits: string[];
  symbols: string[];
}

/** Words dressed up with whatever capitals / digits / symbols are already known. */
function richDrill(rng: Rng, known: Known, focus: { capitals?: string[]; digits?: string[]; symbols?: string[] }, count = DRILL_LENGTH): string[] {
  const base = wordDrill(rng, [], known.letters, count * 2);
  const all = new Set([...known.letters, ...known.capitals, ...known.digits, ...known.symbols]);
  const caps = new Set(known.capitals);
  const out: string[] = [];
  const hasFocus = Boolean(focus.capitals?.length || focus.digits?.length || focus.symbols?.length);
  for (let i = 0; out.length < count && i + 1 < base.length; i++) {
    let w = base[i];
    // Partner for infix symbols ("word-other"); never a neighbour, so it is not echoed right after.
    let other = pick(rng, base);
    for (let tries = 0; tries < 8 && (other === w || other === base[i + 1] || other === base[i - 1]); tries++) other = pick(rng, base);
    const r = rng();
    const focused = hasFocus && r < 0.6;
    if (focus.capitals?.length && focused) {
      // Prefer a word that starts with one of the capitals in focus.
      const lower = new Set(focus.capitals.map((c) => c.toLowerCase()));
      const cands = base.filter((b) => lower.has(b[0]));
      if (cands.length > 0) w = pick(rng, cands);
      const cap = w[0].toUpperCase();
      w = caps.has(cap) ? cap + w.slice(1) : pick(rng, focus.capitals) + w.slice(1);
    } else if (focus.digits?.length && focused) {
      const len = 1 + Math.floor(rng() * 3);
      const from = rng() < 0.7 ? focus.digits : known.digits;
      w = "";
      for (let j = 0; j < len; j++) w += pick(rng, from);
    } else if (focus.symbols?.length && focused) {
      w = applySymbol(w, other, pick(rng, focus.symbols), all);
    } else {
      // Light background noise from older stages.
      if (caps.has(w[0].toUpperCase()) && isLetter(w[0]) && rng() < 0.2) w = w[0].toUpperCase() + w.slice(1);
      if (known.symbols.length > 0 && rng() < 0.15) w = applySymbol(w, other, pick(rng, known.symbols), all);
      else if (known.digits.length > 0 && rng() < 0.1) w = pick(rng, known.digits) + pick(rng, known.digits);
    }
    if (w !== out[out.length - 1]) out.push(w);
  }
  return out;
}

// ------------------------------------------------------------------ curriculum

const GOALS: Record<LessonStage, { accuracy: number; wpm: number }> = {
  home: { accuracy: 90, wpm: 10 },
  top: { accuracy: 90, wpm: 12 },
  bottom: { accuracy: 90, wpm: 14 },
  extra: { accuracy: 90, wpm: 14 },
  capitals: { accuracy: 92, wpm: 15 },
  numbers: { accuracy: 90, wpm: 10 },
  punctuation: { accuracy: 92, wpm: 12 },
  layer: { accuracy: 90, wpm: 10 },
};

const STAGE_NAME: Record<LessonStage, string> = {
  home: "Home row",
  top: "Top row",
  bottom: "Bottom row",
  extra: "More keys",
  capitals: "Capitals",
  numbers: "Numbers",
  punctuation: "Punctuation",
  layer: "Layers",
};

const SYMBOL_PRIORITY = ".,';?!-:\"/()";

function listChars(chars: string[]): string {
  const shown = chars.map((c) => (isLetter(c) ? c.toUpperCase() : c));
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

function describeFingers(keys: LayoutKey[]): string {
  const labels = Array.from(new Set(keys.map(fingerLabel).filter(Boolean)));
  if (labels.length === 0) return "";
  return labels.length === 1 ? `${labels[0]} finger` : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]} fingers`;
}

/** Build the full lesson plan for a layout. Deterministic for a given layout. */
export function buildCurriculum(layout: ParsedLayout): Lesson[] {
  const keys = layout.keys.filter(isCharKey);
  const signature = hashString(layout.keys.map((k) => `${k.base}${k.shifted}`).join("|"));

  // Unique lowercase letters, first key wins.
  const seen = new Set<string>();
  const letterKeys: LayoutKey[] = [];
  const letterOf = new Map<LayoutKey, string>();
  for (const k of keys) {
    if (!isLetter(k.base)) continue;
    const c = k.base.toLowerCase();
    if (seen.has(c)) continue;
    seen.add(c);
    letterKeys.push(k);
    letterOf.set(k, c);
  }

  const homeRow = findHomeRow(letterKeys);
  const homeX = new Map<string, number>();
  for (const k of layout.keys) {
    if (k.isHome && k.finger && !homeX.has(k.finger.hand + k.finger.finger)) homeX.set(k.finger.hand + k.finger.finger, k.x);
  }
  const shiftKeys = layout.keys.filter((k) => k.isModifier && /shift/i.test(k.label));

  const lessons: Lesson[] = [];
  const known: Known = { letters: [], capitals: [], digits: [], symbols: [] };
  const cumulative: string[] = [];
  const ids = new Set<string>();

  const add = (l: {
    id: string;
    title: string;
    description: string;
    stage: LessonStage;
    newChars: string[];
    focusKeyIds: string[];
    drills: (rng: Rng) => string[][];
  }) => {
    let id = l.id;
    for (let n = 2; ids.has(id); n++) id = `${l.id}-${n}`;
    ids.add(id);
    cumulative.push(...l.newChars);
    const allowed = new Set(cumulative);
    const rng = createRng(hashString(`${signature}:${id}`));
    const drills = l
      .drills(rng)
      .map((d) => noRepeats(d.filter((w) => w.length > 0 && isTypable(w, allowed))))
      .filter((d) => d.length >= 4);
    lessons.push({
      id,
      index: lessons.length,
      title: l.title,
      description: l.description,
      stage: l.stage,
      kind: l.newChars.length > 0 ? "new" : "review",
      newChars: l.newChars.slice(),
      chars: cumulative.slice(),
      focusKeyIds: Array.from(new Set(l.focusKeyIds)),
      drills,
      goal: { ...GOALS[l.stage] },
    });
  };

  // ---- letters, row by row
  const rowOf = (k: LayoutKey) => (k.finger?.finger === "thumb" && k.row !== homeRow ? "thumb" : k.row);
  const rowStages: { stage: LessonStage; keys: LayoutKey[] }[] = [
    { stage: "home", keys: letterKeys.filter((k) => rowOf(k) === homeRow) },
    { stage: "top", keys: letterKeys.filter((k) => rowOf(k) === homeRow - 1) },
    { stage: "bottom", keys: letterKeys.filter((k) => rowOf(k) === homeRow + 1) },
    { stage: "extra", keys: letterKeys.filter((k) => ![homeRow, homeRow - 1, homeRow + 1].includes(rowOf(k) as number)) },
  ];

  let letterStagesDone = 0;
  for (const { stage, keys: stageKeys } of rowStages) {
    if (stageKeys.length === 0) continue;
    for (const group of fingerGroups(stageKeys, homeX)) {
      const fresh = group.map((k) => letterOf.get(k)!);
      const before = known.letters.slice();
      known.letters.push(...fresh);
      const letters = known.letters.slice();
      const fingers = describeFingers(group);
      add({
        id: `${stage}-${fresh.join("")}`,
        title: `${STAGE_NAME[stage]}: ${listChars(fresh)}`,
        description:
          (fingers ? `Reach ${listChars(fresh)} with your ${fingers}` : `Learn ${listChars(fresh)}`) +
          (stage === "home" && group.every((k) => k.isHome) ? ", the keys those fingers rest on." : ", then return to the home row."),
        stage,
        newChars: fresh,
        focusKeyIds: group.map((k) => k.id),
        drills: (rng) => [
          isolationDrill(rng, fresh, before),
          mixDrill(rng, fresh, letters),
          wordDrill(rng, fresh, letters),
          ...(letters.length >= 8 ? [wordDrill(rng, fresh, letters, DRILL_LENGTH + 5)] : []),
        ],
      });
    }
    letterStagesDone++;
    const letters = known.letters.slice();
    const stageLetters = stageKeys.map((k) => letterOf.get(k)!);
    add({
      id: `${stage}-review`,
      title: letterStagesDone === 1 ? `${STAGE_NAME[stage]} review` : `${STAGE_NAME[stage]} review: all keys so far`,
      description:
        letterStagesDone === 1
          ? `Every ${STAGE_NAME[stage].toLowerCase()} key together. Keep your eyes on the screen.`
          : `Mix the ${STAGE_NAME[stage].toLowerCase()} with everything you already know.`,
      stage,
      newChars: [],
      focusKeyIds: stageKeys.map((k) => k.id),
      drills: (rng) => [
        mixDrill(rng, stageLetters, letters),
        wordDrill(rng, stageLetters, letters, DRILL_LENGTH + 5),
        wordDrill(rng, [], letters, DRILL_LENGTH + 10),
      ],
    });
  }

  // ---- capitals
  const capOf = (k: LayoutKey) => (k.shifted.length === 1 && isLetter(k.shifted) ? k.shifted : letterOf.get(k)!.toUpperCase());
  const capKeys = letterKeys.filter((k) => capOf(k) !== letterOf.get(k));
  if (capKeys.length > 0) {
    const left = capKeys.filter((k) => k.finger?.hand === "L");
    const right = capKeys.filter((k) => k.finger?.hand === "R");
    const rest = capKeys.filter((k) => !k.finger);
    const shiftFor = (hand: "L" | "R") => {
      const opposite = shiftKeys.filter((s) => s.finger && s.finger.hand !== hand);
      return (opposite.length > 0 ? opposite : shiftKeys).map((s) => s.id);
    };
    const groups: { id: string; title: string; description: string; keys: LayoutKey[]; shift: string[] }[] = [];
    if (left.length > 0)
      groups.push({ id: "capitals-left", title: "Capitals: left-hand letters", description: "Hold Shift with your right pinky, tap the letter with your left hand, release both.", keys: left, shift: shiftFor("L") });
    if (right.length > 0)
      groups.push({ id: "capitals-right", title: "Capitals: right-hand letters", description: "Hold Shift with your left pinky, tap the letter with your right hand, release both.", keys: right, shift: shiftFor("R") });
    if (rest.length > 0)
      groups.push({ id: "capitals-more", title: "Capitals: remaining letters", description: "Hold Shift with the opposite hand and tap the letter.", keys: rest, shift: shiftKeys.map((s) => s.id) });
    for (const g of groups) {
      const fresh = g.keys.map(capOf);
      known.capitals.push(...fresh);
      const snapshot: Known = { ...known, capitals: known.capitals.slice() };
      add({
        id: g.id,
        title: g.title,
        description: g.description,
        stage: "capitals",
        newChars: fresh,
        focusKeyIds: [...g.shift, ...g.keys.map((k) => k.id)],
        drills: (rng) => [
          noRepeats(shuffled(rng, fresh).slice(0, 14).map((c) => c + c.toLowerCase())),
          richDrill(rng, snapshot, { capitals: fresh }),
          richDrill(rng, snapshot, { capitals: fresh }, DRILL_LENGTH + 5),
        ],
      });
    }
    const snapshot: Known = { ...known, capitals: known.capitals.slice() };
    add({
      id: "capitals-review",
      title: "Capitals review",
      description: "Names and sentence starts: alternate Shift hands without looking down.",
      stage: "capitals",
      newChars: [],
      focusKeyIds: shiftKeys.map((s) => s.id),
      drills: (rng) => [richDrill(rng, snapshot, { capitals: snapshot.capitals }), richDrill(rng, snapshot, { capitals: snapshot.capitals }, DRILL_LENGTH + 10)],
    });
  }

  // ---- numbers
  const introduced = new Set<string>(cumulative);
  const digitKeys: LayoutKey[] = [];
  for (const k of keys) {
    if (isDigit(k.base) && !introduced.has(k.base)) {
      introduced.add(k.base);
      digitKeys.push(k);
    }
  }
  if (digitKeys.length > 0) {
    for (const group of packGroups(fingerGroups(digitKeys, homeX), 4)) {
      const fresh = group.map((k) => k.base);
      const before = known.digits.slice();
      known.digits.push(...fresh);
      const snapshot: Known = { ...known, digits: known.digits.slice() };
      const fingers = describeFingers(group);
      add({
        id: `numbers-${fresh.join("")}`,
        title: `Numbers: ${listChars(fresh)}`,
        description: fingers ? `Stretch up to the number row with your ${fingers}, then come back home.` : `Learn ${listChars(fresh)}.`,
        stage: "numbers",
        newChars: fresh,
        focusKeyIds: group.map((k) => k.id),
        drills: (rng) => [
          isolationDrill(rng, fresh, before),
          mixDrill(rng, fresh, snapshot.digits, 16),
          richDrill(rng, snapshot, { digits: fresh }),
        ],
      });
    }
    const snapshot: Known = { ...known, digits: known.digits.slice() };
    add({
      id: "numbers-review",
      title: "Numbers review",
      description: "All the digits mixed into words.",
      stage: "numbers",
      newChars: [],
      focusKeyIds: digitKeys.map((k) => k.id),
      drills: (rng) => [mixDrill(rng, [], snapshot.digits, 16), richDrill(rng, snapshot, { digits: snapshot.digits }, DRILL_LENGTH + 5)],
    });
  }

  // ---- punctuation (unshifted symbols first, then the Shift layer), common ones first
  const symbolEntries: Entry[] = [];
  const consider = (char: string, key: LayoutKey, shifted: boolean) => {
    if (char.length !== 1 || char === " " || isLetter(char) || introduced.has(char)) return;
    introduced.add(char);
    symbolEntries.push({ char, key, shifted });
  };
  for (const k of keys) consider(k.base, k, false);
  for (const k of keys) if (typeof k.shifted === "string") consider(k.shifted, k, true);
  const prio = (c: string) => {
    const i = SYMBOL_PRIORITY.indexOf(c);
    return i === -1 ? SYMBOL_PRIORITY.length : i;
  };
  const ordered = symbolEntries.map((e, i) => ({ e, i })).sort((a, b) => prio(a.e.char) - prio(b.e.char) || a.i - b.i).map((x) => x.e);
  if (ordered.length > 0) {
    const chunks: Entry[][] = [];
    for (let i = 0; i < ordered.length; ) {
      const size = i === 0 ? 2 : 3;
      chunks.push(ordered.slice(i, i + size));
      i += size;
    }
    // Do not leave a lone straggler as its own lesson.
    if (chunks.length > 1 && chunks[chunks.length - 1].length === 1) chunks[chunks.length - 2].push(...chunks.pop()!);
    chunks.forEach((chunk, n) => {
      const fresh = chunk.map((e) => e.char);
      const before = known.symbols.slice();
      known.symbols.push(...fresh);
      const snapshot: Known = { ...known, symbols: known.symbols.slice() };
      const needsShift = chunk.some((e) => e.shifted);
      add({
        id: `punctuation-${n + 1}`,
        title: `Punctuation: ${fresh.join(" ")}`,
        description: needsShift ? "Some of these need Shift: hold it with the opposite hand." : "Small reaches from the home row. Keep the rhythm steady.",
        stage: "punctuation",
        newChars: fresh,
        focusKeyIds: [...chunk.map((e) => e.key.id), ...(needsShift ? shiftKeys.map((s) => s.id) : [])],
        drills: (rng) => [
          isolationDrill(rng, fresh, before),
          richDrill(rng, snapshot, { symbols: fresh }),
          richDrill(rng, snapshot, { symbols: fresh }, DRILL_LENGTH + 5),
        ],
      });
    });
  }

  // ---- layers: characters only reachable while holding a layer key (Lower / Raise …)
  for (const layer of layout.layers ?? []) {
    const entries: Entry[] = [];
    const layerKeyOf = new Map<string, LayoutKey>();
    for (const k of layout.keys) {
      const c = layer.keys[k.id];
      if (!c) continue;
      for (const [ch, shifted] of [[c.base, false], [c.shifted ?? "", true]] as const) {
        if (ch.length !== 1 || ch === " " || introduced.has(ch)) continue;
        // Only characters this very key types through this layer (never one the board types elsewhere).
        const hit = keyForChar(layout, ch);
        if (!hit?.layer || hit.layer.id !== layer.id || hit.key.id !== k.id || !hit.layerKey) continue;
        introduced.add(ch);
        entries.push({ char: ch, key: k, shifted });
        layerKeyOf.set(ch, hit.layerKey);
      }
    }
    if (entries.length < 2) {
      // Too few to teach on their own: leave them untaught here, but they stay typable.
      for (const e of entries) introduced.delete(e.char);
      continue;
    }
    const digits = entries.filter((e) => isDigit(e.char));
    const others = entries.filter((e) => !isDigit(e.char));
    const prio = (c: string) => {
      const i = SYMBOL_PRIORITY.indexOf(c);
      return i === -1 ? SYMBOL_PRIORITY.length : i;
    };
    const chunks: { kind: "numbers" | "symbols"; items: Entry[] }[] = [];
    if (digits.length > 0) {
      const keysOf = Array.from(new Set(digits.map((e) => e.key)));
      for (const group of packGroups(fingerGroups(keysOf, homeX), 4)) {
        const ids = new Set(group.map((k) => k.id));
        chunks.push({ kind: "numbers", items: digits.filter((e) => ids.has(e.key.id)) });
      }
    }
    const ordered = others.map((e, i) => ({ e, i })).sort((a, b) => prio(a.e.char) - prio(b.e.char) || a.i - b.i).map((x) => x.e);
    const sym: Entry[][] = [];
    for (let i = 0; i < ordered.length; i += 3) sym.push(ordered.slice(i, i + 3));
    if (sym.length > 1 && sym[sym.length - 1].length === 1) sym[sym.length - 2].push(...sym.pop()!);
    for (const items of sym) chunks.push({ kind: "symbols", items });

    const counters = { numbers: 0, symbols: 0 };
    for (const chunk of chunks) {
      const n = ++counters[chunk.kind];
      const fresh = chunk.items.map((e) => e.char);
      const holds = Array.from(new Set(chunk.items.map((e) => layerKeyOf.get(e.char)!)));
      const holdText = Array.from(new Set(holds.map(fingerLabel).filter(Boolean))).join(" or ");
      const needsShift = chunk.items.some((e) => e.shifted);
      const before = chunk.kind === "numbers" ? known.digits.slice() : known.symbols.slice();
      if (chunk.kind === "numbers") known.digits.push(...fresh);
      else known.symbols.push(...fresh);
      const snapshot: Known = { ...known, digits: known.digits.slice(), symbols: known.symbols.slice() };
      add({
        id: `layer-${layer.id}-${chunk.kind}-${n}`,
        title: `${layer.name} layer: ${chunk.kind} ${fresh.join(" ")}`,
        description:
          `Hold ${layer.name}${holdText ? ` with your ${holdText.replace(/ (pinky|ring|middle|index)$/, " $1 finger")}` : ""} and tap the key.` +
          (needsShift ? " Some of these also need Shift." : ""),
        stage: "layer",
        newChars: fresh,
        focusKeyIds: [...holds.map((k) => k.id), ...chunk.items.map((e) => e.key.id), ...(needsShift ? shiftKeys.map((s) => s.id) : [])],
        drills: (rng) => [
          isolationDrill(rng, fresh, before),
          chunk.kind === "numbers" ? mixDrill(rng, fresh, snapshot.digits, 16) : richDrill(rng, snapshot, { symbols: fresh }),
          richDrill(rng, snapshot, chunk.kind === "numbers" ? { digits: fresh } : { symbols: fresh }, DRILL_LENGTH + 5),
        ],
      });
    }
  }

  if (known.capitals.length + known.digits.length + known.symbols.length > 0) {
    const snapshot: Known = { letters: known.letters.slice(), capitals: known.capitals.slice(), digits: known.digits.slice(), symbols: known.symbols.slice() };
    const last = lessons[lessons.length - 1].stage;
    add({
      id: "final-review",
      title: "Final review: everything",
      description: "Letters, capitals, numbers and punctuation together. You know the whole layout.",
      stage: last,
      newChars: [],
      focusKeyIds: [],
      drills: (rng) => [richDrill(rng, snapshot, {}, DRILL_LENGTH + 5), richDrill(rng, snapshot, { symbols: snapshot.symbols }, DRILL_LENGTH + 10)],
    });
  }

  return lessons;
}

/** Problems found in a curriculum (empty = fine). Used by the dev harness; cheap enough for asserts. */
export function validateCurriculum(layout: ParsedLayout, lessons: Lesson[]): string[] {
  const problems: string[] = [];
  const introduced = new Map<string, number>();
  for (const l of lessons) {
    for (const c of l.newChars) {
      if (introduced.has(c)) problems.push(`"${c}" introduced twice (lessons ${introduced.get(c)} and ${l.index})`);
      introduced.set(c, l.index);
    }
    const allowed = new Set(l.chars);
    if (l.drills.length === 0) problems.push(`lesson ${l.id} has no drills`);
    l.drills.forEach((d, i) => {
      for (const w of d) if (!isTypable(w, allowed)) problems.push(`lesson ${l.id} drill ${i}: "${w}" uses unknown chars`);
      for (let j = 1; j < d.length; j++) if (d[j] === d[j - 1]) problems.push(`lesson ${l.id} drill ${i}: repeated "${d[j]}"`);
      if (l.newChars.length > 0 && i === 0 && !d.every((w) => l.newChars.some((c) => w.includes(c)))) problems.push(`lesson ${l.id} drill 0 has words without new keys`);
    });
  }
  for (const k of layout.keys) {
    if (k.isModifier) continue;
    for (const c of [k.base, k.shifted]) {
      if (typeof c === "string" && c.length === 1 && c !== " " && !introduced.has(c)) problems.push(`"${c}" (key ${k.id}) never introduced`);
    }
  }
  for (const layer of layout.layers ?? []) {
    for (const [id, c] of Object.entries(layer.keys)) {
      for (const ch of [c.base, c.shifted ?? ""]) {
        if (ch.length !== 1 || ch === " ") continue;
        const hit = keyForChar(layout, ch);
        // A layer character that is taught must be introduced once; layers with fewer than two typable characters are not taught.
        if (hit?.layer?.id === layer.id && hit.key.id === id && !introduced.has(ch) && lessons.some((l) => l.stage === "layer" && l.id.startsWith(`layer-${layer.id}-`)))
          problems.push(`"${ch}" (layer ${layer.id}, key ${id}) never introduced`);
      }
    }
  }
  return problems;
}
