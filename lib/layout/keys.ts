// Character / keystroke lookups over a ParsedLayout, used by the typing test.
import type { LayoutKey, ParsedLayout } from "../types";
import { keyAction } from "./parse";

export interface CharKey {
  key: LayoutKey;
  needsShift: boolean;
  /** The Shift key on the opposite hand from `key` (only when needsShift). */
  shiftKey?: LayoutKey;
}

export type KeyAction = "backspace" | "enter" | "tab" | "escape";

export interface ResolvedKeystroke {
  /** Character typed, or null for non-character keys. */
  char: string | null;
  /** Layout key that was (conceptually) pressed, or null if the layout has none. */
  keyId: string | null;
  action?: KeyAction;
}

interface Index {
  byChar: Map<string, { key: LayoutKey; needsShift: boolean }>;
  byCode: Map<string, LayoutKey>;
  shifts: LayoutKey[];
  centre: number;
}

const cache = new WeakMap<ParsedLayout, Index>();

const isNumpad = (k: LayoutKey) => !!k.code && k.code.startsWith("Numpad");

function indexOf(layout: ParsedLayout): Index {
  let idx = cache.get(layout);
  if (idx) return idx;
  const byChar = new Map<string, { key: LayoutKey; needsShift: boolean }>();
  const byCode = new Map<string, LayoutKey>();
  // Main-block keys win over numpad duplicates; unshifted wins over shifted.
  const ordered = [...layout.keys.filter((k) => !isNumpad(k)), ...layout.keys.filter(isNumpad)];
  for (const k of ordered) if (k.base && !byChar.has(k.base)) byChar.set(k.base, { key: k, needsShift: false });
  for (const k of ordered) if (k.shifted && !byChar.has(k.shifted)) byChar.set(k.shifted, { key: k, needsShift: true });
  for (const k of layout.keys) if (k.code && !byCode.has(k.code)) byCode.set(k.code, k);
  const shifts = layout.keys.filter((k) => k.code === "ShiftLeft" || k.code === "ShiftRight");
  idx = { byChar, byCode, shifts, centre: layout.width / 2 };
  cache.set(layout, idx);
  return idx;
}

/** The key (and Shift, if needed) that types `ch` on this layout. */
export function keyForChar(layout: ParsedLayout, ch: string): CharKey | undefined {
  const idx = indexOf(layout);
  const hit = idx.byChar.get(ch);
  if (!hit) return undefined;
  if (!hit.needsShift) return { key: hit.key, needsShift: false };
  const hand = hit.key.finger?.hand ?? (hit.key.x + hit.key.w / 2 < idx.centre ? "L" : "R");
  const want = hand === "L" ? "ShiftRight" : "ShiftLeft";
  const shiftKey = idx.shifts.find((k) => k.code === want) ?? idx.shifts[0];
  return { key: hit.key, needsShift: true, shiftKey };
}

/** Layout key at a physical position (KeyboardEvent.code). */
export function keyForCode(layout: ParsedLayout, code: string): LayoutKey | undefined {
  return indexOf(layout).byCode.get(code);
}

const ACTION_BY_EVENT_KEY: Record<string, { action: KeyAction; code: string }> = {
  Backspace: { action: "backspace", code: "Backspace" },
  Enter: { action: "enter", code: "Enter" },
  Tab: { action: "tab", code: "Tab" },
  Escape: { action: "escape", code: "Escape" },
};

/**
 * Translates a browser key event into a character + layout key.
 *  - emulate: true  → the OS is on QWERTY; translate by physical position (ev.code).
 *  - emulate: false → the OS already produces the layout; trust ev.key.
 */
export function resolveKeystroke(
  layout: ParsedLayout,
  ev: { key: string; code: string; shiftKey: boolean },
  opts: { emulate: boolean },
): ResolvedKeystroke {
  const idx = indexOf(layout);
  const evAction = ACTION_BY_EVENT_KEY[ev.key];

  if (opts.emulate) {
    const key = idx.byCode.get(ev.code);
    if (!key) return evAction ? { char: null, keyId: null, action: evAction.action } : { char: null, keyId: null };
    const char = (ev.shiftKey ? key.shifted || key.base : key.base) || null;
    const action = char ? undefined : keyAction(key);
    return action ? { char: null, keyId: key.id, action } : { char, keyId: key.id };
  }

  if (evAction) {
    const key = idx.byCode.get(evAction.code) ?? layout.keys.find((k) => keyAction(k) === evAction.action);
    return { char: null, keyId: key?.id ?? null, action: evAction.action };
  }
  if (Array.from(ev.key).length === 1) {
    const hit = idx.byChar.get(ev.key);
    return { char: ev.key, keyId: hit?.key.id ?? null };
  }
  // Modifiers, arrows, F-keys…: no character, but still light up the key if we can place it.
  return { char: null, keyId: idx.byCode.get(ev.code)?.id ?? null };
}

/** Every character this layout can type (unshifted first, then shifted), without duplicates. */
export function typableChars(layout: ParsedLayout): string[] {
  const out = new Set<string>();
  for (const k of layout.keys) if (k.base) out.add(k.base);
  for (const k of layout.keys) if (k.shifted) out.add(k.shifted);
  return [...out];
}
