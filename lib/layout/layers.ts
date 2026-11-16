// Layers (QMK "Lower" / "Raise" style) for split boards. A layer is momentary: while one of its
// activator keys is held, other keys type different characters. The browser never sees layer keys
// (the firmware resolves them), so layers only drive guidance and lessons; typed characters are
// matched exactly as before.
//
// Like finger overrides, a custom layout's layers are stored beside the KLE source (never inside
// it) and applied on top of the parsed layout. Presets get generated defaults (see defaultLayersFor).
import { MAX_LAYERS, type LayerKeyChars, type LayoutLayer, type ParsedLayout } from "../types";
import { typableChars } from "./keys";
import { displayLegends, parseLayout } from "./parse";
import type { LayoutPreset } from "./presets";

export const MAX_LAYER_KEYS = 300;
export const MAX_LAYER_NAME = 24;
const LAYER_ID = /^[a-z0-9-]{1,16}$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

/** One Unicode code point that is not a control character. Returns it, or undefined. */
export function cleanLayerChar(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const cps = Array.from(v);
  if (cps.length !== 1) return undefined;
  if (/[\p{Cc}\p{Cs}\p{Cn}]/u.test(cps[0])) return undefined;
  return cps[0];
}

const cleanName = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const n = v.replace(/\s+/g, " ").trim();
  return n.length >= 1 && n.length <= MAX_LAYER_NAME ? n : undefined;
};

/** Strict validation of stored / imported layers. Drops anything malformed. Never throws. */
export function sanitizeLayers(raw: unknown): LayoutLayer[] | undefined {
  try {
    if (!Array.isArray(raw)) return undefined;
    const out: LayoutLayer[] = [];
    const ids = new Set<string>();
    for (const item of raw) {
      if (out.length >= MAX_LAYERS) break;
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      if (typeof o.id !== "string" || !LAYER_ID.test(o.id) || ids.has(o.id)) continue;
      const name = cleanName(o.name);
      if (!name) continue;
      const act = o.activatorIds;
      if (!Array.isArray(act) || act.length < 1 || act.length > 4) continue;
      if (!act.every((a) => typeof a === "string" && KEY_ID.test(a))) continue;
      const activatorIds = Array.from(new Set(act as string[]));
      const keys: Record<string, LayerKeyChars> = {};
      let n = 0;
      if (o.keys && typeof o.keys === "object" && !Array.isArray(o.keys)) {
        for (const [id, v] of Object.entries(o.keys as Record<string, unknown>)) {
          if (n >= MAX_LAYER_KEYS) break;
          if (id === "__proto__" || !KEY_ID.test(id) || !v || typeof v !== "object") continue;
          const base = cleanLayerChar((v as Record<string, unknown>).base);
          if (!base) continue;
          const shifted = cleanLayerChar((v as Record<string, unknown>).shifted);
          keys[id] = shifted ? { base, shifted } : { base };
          n++;
        }
      }
      ids.add(o.id);
      out.push({ id: o.id, name, activatorIds, keys });
    }
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Attaches layers to a parsed layout. Activators and key entries whose ids are not in the layout
 * are dropped (and a layer left without an activator is dropped). Returns `layout` itself when
 * nothing valid remains.
 */
export function applyLayers(layout: ParsedLayout, layers: readonly LayoutLayer[] | undefined): ParsedLayout {
  if (!layers || layers.length === 0) return layout;
  const ids = new Set(layout.keys.map((k) => k.id));
  const valid: LayoutLayer[] = [];
  for (const l of layers) {
    const activatorIds = l.activatorIds.filter((id) => ids.has(id));
    if (activatorIds.length === 0) continue;
    const keys: Record<string, LayerKeyChars> = {};
    for (const [id, c] of Object.entries(l.keys)) if (ids.has(id) && !activatorIds.includes(id)) keys[id] = c;
    valid.push({ id: l.id, name: l.name, activatorIds, keys });
  }
  return valid.length > 0 ? { ...layout, layers: valid } : layout;
}

// ---------------------------------------------------------------------------
// Editor helpers (pure: every function returns new data)
// ---------------------------------------------------------------------------

export type Layers = LayoutLayer[] | undefined;

const nonEmpty = (layers: LayoutLayer[]): Layers => (layers.length > 0 ? layers : undefined);

/** Adds an empty layer. Returns the new list and the id of the new layer (undefined at the limit). */
export function addLayer(layers: Layers, name?: string): { layers: Layers; id?: string } {
  const list = layers ?? [];
  if (list.length >= MAX_LAYERS) return { layers };
  const taken = new Set(list.map((l) => l.id));
  let n = 1;
  while (taken.has(`layer-${n}`)) n++;
  const id = `layer-${n}`;
  const used = new Set(list.map((l) => l.name.toLowerCase()));
  let label = cleanName(name) ?? "";
  if (!label) {
    for (let i = list.length + 1; ; i++) {
      label = `Layer ${i}`;
      if (!used.has(label.toLowerCase())) break;
    }
  }
  return { layers: [...list, { id, name: label, activatorIds: [], keys: {} }], id };
}

export function removeLayer(layers: Layers, id: string): Layers {
  return nonEmpty((layers ?? []).filter((l) => l.id !== id));
}

export function renameLayer(layers: Layers, id: string, name: string): Layers {
  const n = cleanName(name);
  if (!n) return layers;
  return layers?.map((l) => (l.id === id ? { ...l, name: n } : l));
}

export function setActivators(layers: Layers, id: string, activatorIds: string[]): Layers {
  const ids = Array.from(new Set(activatorIds)).slice(0, 4);
  return layers?.map((l) => {
    if (l.id !== id) return l;
    const keys = { ...l.keys };
    for (const a of ids) delete keys[a];
    return { ...l, activatorIds: ids, keys };
  });
}

/** Sets what a key types on a layer. An empty / invalid base clears the key. */
export function setKeyChars(layers: Layers, layerId: string, keyId: string, base: string, shifted?: string): Layers {
  return layers?.map((l) => {
    if (l.id !== layerId) return l;
    const keys = { ...l.keys };
    const b = cleanLayerChar(base);
    if (!b) {
      delete keys[keyId];
    } else {
      if (!(keyId in keys) && Object.keys(keys).length >= MAX_LAYER_KEYS) return l;
      const s = cleanLayerChar(shifted);
      keys[keyId] = s ? { base: b, shifted: s } : { base: b };
    }
    return { ...l, keys };
  });
}

export function layersEqual(a: Layers, b: Layers): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Layers whose key ids / activators no longer exist in `layout` (counted per layer) after the source changed. */
export function countStaleLayerEntries(layout: ParsedLayout, layers: Layers): number {
  if (!layers) return 0;
  const ids = new Set(layout.keys.map((k) => k.id));
  let n = 0;
  for (const l of layers) {
    n += l.activatorIds.filter((id) => !ids.has(id)).length;
    n += Object.keys(l.keys).filter((id) => !ids.has(id)).length;
  }
  return n;
}

/** Layers with entries for keys that no longer exist removed (the saved form). */
export function pruneLayers(layout: ParsedLayout, layers: Layers): Layers {
  const applied = applyLayers(layout, layers);
  return applied.layers;
}

// ---------------------------------------------------------------------------
// Preset defaults
// ---------------------------------------------------------------------------

const WANTED = "0123456789`~!@#$%^&*()-_=+[]{}\\|;:'\",<.>/?";

type Pair = [string, string];
const TOP = "QWERTYUIOP".split("").map((c) => `Key${c}`);
const HOME = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon"];
const BOTTOM = ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash"];
const SLOT_ORDER = [...TOP, ...HOME, ...BOTTOM];

/**
 * The default symbol map, by physical position (KeyboardEvent.code of the QWERTY position, which the
 * parser resolves on every split preset, Colemak-DH included): top letter row = 1234567890 with
 * !@#$%^&*(), home row = ` - = [ ] \ ' , . ; with their Shift partners.
 */
const SYMBOL_MAP: Record<string, Pair> = {
  KeyA: ["`", "~"],
  KeyS: ["-", "_"],
  KeyD: ["=", "+"],
  KeyF: ["[", "{"],
  KeyG: ["]", "}"],
  KeyH: ["\\", "|"],
  KeyJ: ["'", '"'],
  KeyK: [",", "<"],
  KeyL: [".", ">"],
  Semicolon: [";", ":"],
  KeyZ: ["/", "?"],
};
TOP.forEach((code, i) => (SYMBOL_MAP[code] = ["1234567890"[i], "!@#$%^&*()"[i]]));

const labelOf = (k: { label: string }) => displayLegends(k.label).join("").toLowerCase();

/**
 * Opinionated default layers for a split board, generated from key positions (not any firmware's
 * truth: edit them to match yours). The layer key is whichever of Raise / Lower / Fn the board has.
 *  - Raise (or Fn when that is all there is): numbers on the top letter row with their Shift
 *    symbols, and brackets, - =, `, \ and quotes on the home row, for every character the board
 *    cannot already type on base / Shift.
 *  - Lower, when the board also has it: only characters still untypable after the first layer.
 * Returns undefined when the board already types everything or has no layer key.
 */
export function defaultLayersFor(layout: ParsedLayout): LayoutLayer[] | undefined {
  const typable = new Set(typableChars(layout));
  const keysNamed = (name: string) => layout.keys.filter((k) => k.isModifier && !k.base && labelOf(k) === name);
  const raise = keysNamed("raise");
  const lower = keysNamed("lower");
  const fn = keysNamed("fn");
  const sources: { id: string; name: string; keys: typeof raise }[] = [];
  if (raise.length) sources.push({ id: "raise", name: "Raise", keys: raise });
  if (lower.length) sources.push({ id: "lower", name: "Lower", keys: lower });
  if (sources.length === 0 && fn.length) sources.push({ id: "fn", name: "Fn", keys: fn });
  if (sources.length === 0) return undefined;

  const slot = new Map<string, string>();
  for (const k of layout.keys) if (k.code && k.base && !k.isModifier && !slot.has(k.code)) slot.set(k.code, k.id);

  const placed = new Set<string>();
  const need = (c: string) => !typable.has(c) && !placed.has(c);
  const layers: LayoutLayer[] = [];

  // First layer: the symbol map, keeping only what the board cannot type.
  const first = sources[0];
  const keys: Record<string, LayerKeyChars> = {};
  for (const [code, [b, s]] of Object.entries(SYMBOL_MAP)) {
    const id = slot.get(code);
    if (!id) continue;
    const nb = need(b);
    const ns = need(s);
    if (nb && ns) keys[id] = { base: b, shifted: s };
    else if (nb) keys[id] = { base: b };
    else if (ns) keys[id] = { base: s };
    else continue;
    for (const c of [b, s]) if (need(c)) placed.add(c);
  }
  if (Object.keys(keys).length > 0) layers.push({ id: first.id, name: first.name, activatorIds: first.keys.slice(0, 4).map((k) => k.id), keys });

  // Second layer: whatever is still missing, one character per key in reading order.
  if (sources.length > 1) {
    const left = Array.from(WANTED).filter(need);
    const lk: Record<string, LayerKeyChars> = {};
    const slots = SLOT_ORDER.map((c) => slot.get(c)).filter((id): id is string => !!id);
    left.slice(0, slots.length).forEach((c, i) => (lk[slots[i]] = { base: c }));
    if (Object.keys(lk).length > 0) {
      const second = sources[1];
      layers.push({ id: second.id, name: second.name, activatorIds: second.keys.slice(0, 4).map((k) => k.id), keys: lk });
    }
  }
  return layers.length > 0 ? layers : undefined;
}

/** Parses a built-in preset. Split boards come with the default layers (see defaultLayersFor). */
export function parsePreset(preset: Pick<LayoutPreset, "source" | "name" | "family">): ParsedLayout {
  const layout = parseLayout(preset.source, preset.name);
  if (preset.family !== "split") return layout;
  return applyLayers(layout, defaultLayersFor(layout));
}
