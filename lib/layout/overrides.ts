// Per-key finger overrides for custom layouts. The parser guesses which finger presses each
// key and which keys are home keys; users can correct those guesses. Overrides are stored
// beside the KLE source (never inside it) as { keyId → { finger, isHome } }.
//
// Key ids are positional ("r2k5"), so every override also remembers the key's label when it
// was made: if the source is edited and that id now holds a different key, it is ignored.
import type { Finger, FingerId, Hand, LayoutKey, ParsedLayout } from "../types";

export interface FingerOverride {
  /** null = explicitly "no finger". */
  finger: FingerId | null;
  /** Home (resting) key for `finger`. Ignored when finger is null. Undefined = keep the automatic value. */
  isHome?: boolean;
  /** Raw KLE label of the key when the override was made; a mismatch makes the override stale. */
  label?: string;
}

export type FingerOverrides = Record<string, FingerOverride>;

export const MAX_OVERRIDES = 400;

const FINGERS: readonly Finger[] = ["pinky", "ring", "middle", "index", "thumb"];

const fingerKey = (f: FingerId) => `${f.hand}-${f.finger}`;

/** "L-index" ⇄ FingerId (the form used in data-finger attributes). */
export function fingerToString(f: FingerId): string {
  return fingerKey(f);
}
export function fingerFromString(s: string): FingerId | undefined {
  const [h, f] = s.split("-");
  return (h === "L" || h === "R") && FINGERS.includes(f as Finger) ? { hand: h as Hand, finger: f as Finger } : undefined;
}

function sanitizeFinger(v: unknown): FingerId | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== "object") return undefined;
  const { hand, finger } = v as Record<string, unknown>;
  if ((hand !== "L" && hand !== "R") || !FINGERS.includes(finger as Finger)) return undefined;
  return { hand, finger: finger as Finger };
}

/** Drops entries with bad shapes. Returns undefined when nothing valid is left. Never throws. */
export function sanitizeFingerOverrides(raw: unknown): FingerOverrides | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: FingerOverrides = {};
  let n = 0;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_OVERRIDES) break;
    if (!v || typeof v !== "object" || id.length > 32) continue;
    const e = v as Record<string, unknown>;
    const finger = sanitizeFinger(e.finger);
    if (finger === undefined) continue;
    const o: FingerOverride = { finger };
    if (finger && typeof e.isHome === "boolean") o.isHome = e.isHome;
    if (typeof e.label === "string" && e.label.length <= 200) o.label = e.label;
    out[id] = o;
    n++;
  }
  return n > 0 ? out : undefined;
}

/** True when `o` still describes `key` (same id is not enough: the label must not have changed). */
function matches(o: FingerOverride, key: LayoutKey): boolean {
  return o.label === undefined || o.label === key.label;
}

const sameFinger = (a: FingerId | undefined, b: FingerId | undefined) =>
  a === b || (!!a && !!b && a.hand === b.hand && a.finger === b.finger);

/**
 * Number of overrides that no longer match a key of `layout` (id gone, or the key at that id
 * has a different label). `layout` may be the raw or the overridden parse; ids and labels agree.
 */
export function countStaleOverrides(layout: ParsedLayout, overrides: FingerOverrides | undefined): number {
  if (!overrides) return 0;
  const byId = new Map(layout.keys.map((k) => [k.id, k]));
  let n = 0;
  for (const [id, o] of Object.entries(overrides)) {
    const k = byId.get(id);
    if (!k || !matches(o, k)) n++;
  }
  return n;
}

/** Overrides that still match `layout`, plus how many were dropped. Same object when none dropped. */
export function pruneOverrides(
  layout: ParsedLayout,
  overrides: FingerOverrides | undefined,
): { overrides: FingerOverrides | undefined; dropped: number } {
  if (!overrides) return { overrides, dropped: 0 };
  const byId = new Map(layout.keys.map((k) => [k.id, k]));
  const kept: FingerOverrides = {};
  let dropped = 0;
  for (const [id, o] of Object.entries(overrides)) {
    const k = byId.get(id);
    if (k && matches(o, k)) kept[id] = o;
    else dropped++;
  }
  if (dropped === 0) return { overrides, dropped };
  return { overrides: Object.keys(kept).length ? kept : undefined, dropped };
}

/**
 * Applies overrides to a parsed layout. Returns `layout` itself when nothing changes.
 *
 * Invariants (enforced softly): a home key has a finger; a finger has at most one home key.
 * An override that moves a key to another finger without saying anything about isHome makes it
 * a non-home key. A key given a home role takes it from any other key of that finger.
 */
export function applyFingerOverrides(layout: ParsedLayout, overrides: FingerOverrides | undefined): ParsedLayout {
  if (!overrides) return layout;
  const ids = Object.keys(overrides);
  if (ids.length === 0) return layout;

  const keys = layout.keys;
  const patch = new Map<number, { finger: FingerId | undefined; home: boolean }>();
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const o = overrides[k.id];
    if (!o || !Object.prototype.hasOwnProperty.call(overrides, k.id) || !matches(o, k)) continue;
    const finger = o.finger ?? undefined;
    const home = !finger ? false : o.isHome !== undefined ? o.isHome : sameFinger(k.finger, finger) ? !!k.isHome : false;
    patch.set(i, { finger, home });
  }
  if (patch.size === 0) return layout;

  // Home claims: the last overriding key (in key order) wins a finger.
  const claimed = new Map<string, number>();
  for (const [i, p] of patch) if (p.finger && p.home) claimed.set(fingerKey(p.finger), i);

  let changed = false;
  const next = keys.map((k, i) => {
    const p = patch.get(i);
    let finger = k.finger;
    let home = !!k.isHome;
    if (p) {
      finger = p.finger;
      home = p.home && claimed.get(fingerKey(p.finger!)) === i;
    } else if (home && finger && claimed.has(fingerKey(finger))) {
      home = false;
    }
    if (sameFinger(finger, k.finger) && home === !!k.isHome) return k;
    changed = true;
    const copy: LayoutKey = { ...k };
    if (finger) copy.finger = finger;
    else delete copy.finger;
    if (home) copy.isHome = true;
    else delete copy.isHome;
    return copy;
  });
  return changed ? { ...layout, keys: next } : layout;
}

/**
 * The override map after the user picks `choice` for `keyId`.
 * `choice === "auto"` removes the key's override. Setting a home key also demotes any other
 * overridden key that was the home of the same finger (automatic ones are handled on apply).
 */
export function setKeyOverride(
  layout: ParsedLayout,
  overrides: FingerOverrides | undefined,
  keyId: string,
  choice: "auto" | { finger: FingerId | null; isHome?: boolean },
): FingerOverrides | undefined {
  const key = layout.keys.find((k) => k.id === keyId);
  if (!key) return overrides;
  const next: FingerOverrides = { ...overrides };
  if (choice === "auto") {
    delete next[keyId];
  } else {
    const o: FingerOverride = { finger: choice.finger, label: key.label };
    if (choice.finger && choice.isHome !== undefined) o.isHome = choice.isHome;
    next[keyId] = o;
    if (choice.finger && choice.isHome) {
      const fk = fingerKey(choice.finger);
      for (const [id, other] of Object.entries(next)) {
        if (id !== keyId && other.isHome && other.finger && fingerKey(other.finger) === fk) next[id] = { ...other, isHome: false };
      }
    }
  }
  return Object.keys(next).length ? next : undefined;
}

/** Overrides whose effect is the same as the automatic result are still "customised": count them as stored. */
export function overrideCount(overrides: FingerOverrides | undefined): number {
  return overrides ? Object.keys(overrides).length : 0;
}
