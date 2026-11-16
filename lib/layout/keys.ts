// Character / keystroke lookups over a ParsedLayout, used by the typing test.
import type { LayoutKey, LayoutLayer, ParsedLayout } from "../types";
import { keyAction } from "./parse";

export interface CharKey {
  key: LayoutKey;
  needsShift: boolean;
  /** The Shift key on the opposite hand from `key` (only when needsShift). */
  shiftKey?: LayoutKey;
  /** Set when the character lives on a layer: the layer and the activator key to hold. */
  layer?: LayoutLayer;
  /** Activator to hold for `layer`: on the opposite hand from `key` when the layer has one there, else any. */
  layerKey?: LayoutKey;
}

export type KeyAction = "backspace" | "enter" | "tab" | "escape";

export interface ResolvedKeystroke {
  /** Character typed, or null for non-character keys. */
  char: string | null;
  /** Layout key that was (conceptually) pressed, or null if the layout has none. */
  keyId: string | null;
  action?: KeyAction;
}

interface Hit {
  key: LayoutKey;
  needsShift: boolean;
  /** Set when the character lives on a layer rather than on the base / Shift layer. */
  layer?: LayoutLayer;
}

interface Index {
  byChar: Map<string, Hit>;
  /** layer id → its activator keys that exist in the layout (a layer with none can never be held). */
  activators: Map<string, LayoutKey[]>;
  byCode: Map<string, LayoutKey>;
  shifts: LayoutKey[];
  centre: number;
}

const cache = new WeakMap<ParsedLayout, Index>();

const isNumpad = (k: LayoutKey) => !!k.code && k.code.startsWith("Numpad");

function indexOf(layout: ParsedLayout): Index {
  let idx = cache.get(layout);
  if (idx) return idx;
  const byChar = new Map<string, Hit>();
  const byCode = new Map<string, LayoutKey>();
  // Main-block keys win over numpad duplicates; unshifted wins over shifted.
  const ordered = [...layout.keys.filter((k) => !isNumpad(k)), ...layout.keys.filter(isNumpad)];
  for (const k of ordered) if (k.base && !byChar.has(k.base)) byChar.set(k.base, { key: k, needsShift: false });
  for (const k of ordered) if (k.shifted && !byChar.has(k.shifted)) byChar.set(k.shifted, { key: k, needsShift: true });
  for (const k of layout.keys) if (k.code && !byCode.has(k.code)) byCode.set(k.code, k);
  const shifts = layout.keys.filter((k) => k.code === "ShiftLeft" || k.code === "ShiftRight");

  // Layers: a character already typable on base / Shift is never routed through a layer. Order is
  // layer, then layer + Shift; earlier layers win. Activators, unknown keys and bad strings are ignored.
  const byId = new Map(layout.keys.map((k) => [k.id, k]));
  const activators = new Map<string, LayoutKey[]>();
  const usable: LayoutLayer[] = [];
  const activatorIds = new Set<string>();
  for (const layer of layout.layers ?? []) {
    if (!layer || !Array.isArray(layer.activatorIds) || !layer.keys || typeof layer.keys !== "object" || activators.has(layer.id)) continue;
    const held = layer.activatorIds.map((id) => byId.get(id)).filter((k): k is LayoutKey => !!k);
    if (held.length === 0) continue;
    activators.set(layer.id, held);
    usable.push(layer);
    for (const k of held) activatorIds.add(k.id);
  }
  const single = (s: unknown): s is string => typeof s === "string" && s !== "" && Array.from(s).length === 1;
  for (const shifted of [false, true]) {
    for (const layer of usable) {
      for (const [id, chars] of Object.entries(layer.keys)) {
        const key = byId.get(id);
        if (!key || activatorIds.has(id) || !chars) continue;
        const ch = shifted ? chars.shifted : chars.base;
        if (single(ch) && !byChar.has(ch)) byChar.set(ch, { key, needsShift: shifted, layer });
      }
    }
  }
  idx = { byChar, activators, byCode, shifts, centre: layout.width / 2 };
  cache.set(layout, idx);
  return idx;
}

/** The key (and Shift, if needed) that types `ch` on this layout. */
export function keyForChar(layout: ParsedLayout, ch: string): CharKey | undefined {
  const idx = indexOf(layout);
  const hit = idx.byChar.get(ch);
  if (!hit) return undefined;
  const handOf = (k: LayoutKey) => k.finger?.hand ?? (k.x + k.w / 2 < idx.centre ? "L" : "R");
  const out: CharKey = { key: hit.key, needsShift: hit.needsShift };
  if (hit.layer) {
    // Hold the activator with the opposite hand when the layer has one there, else the first one.
    const held = idx.activators.get(hit.layer.id) ?? [];
    out.layer = hit.layer;
    out.layerKey = held.find((k) => handOf(k) !== handOf(hit.key)) ?? held[0];
  }
  if (hit.needsShift) {
    const want = handOf(hit.key) === "L" ? "ShiftRight" : "ShiftLeft";
    out.shiftKey = idx.shifts.find((k) => k.code === want) ?? idx.shifts[0];
  }
  return out;
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
  for (const [ch, hit] of indexOf(layout).byChar) if (hit.layer) out.add(ch);
  return [...out];
}
