// Turns an imported firmware keymap into this app's layers for a given board. Pure, browser-safe.
import { MAX_LAYERS } from "../../types.ts";
import type { LayerKeyChars, LayoutKey, LayoutLayer, ParsedLayout } from "../../types.ts";
import { keyCenter } from "../geometry.ts";
import { MAX_LAYER_NAME, sanitizeLayers } from "../layers.ts";
import { KeymapImportError } from "./types.ts";
import type { ImportedKeymap } from "./types.ts";
import { flatten } from "./index.ts";

const KLE_ID = /^r(\d+)k\d+$/;
/** Without KLE row ids, centres closer than this in y share a row. */
const ROW_GAP = 0.5;

/**
 * The board's keys in firmware reading order: row by row, left to right inside a row. On a split
 * board that gives the left half then the right half for each row, and the thumb keys come last,
 * which is how QMK / ZMK list a Corne, Ferris or Atreus.
 *
 * Rows are the KLE rows of the layout source (ids "r<row>k<n>"), because staggered columns put
 * the top of one row above the bottom of the previous one in plain y terms (Ferris Sweep).
 * Trailing KLE rows of one or two keys are the thumb keys of a split board, drawn one row each,
 * so they are merged into a single last row. Layouts whose ids carry no row fall back to grouping
 * key centres (rotation applied) that are less than half a key apart in y. Within a row keys are
 * ordered by the x of their centre.
 */
export function orderKeysForImport(layout: ParsedLayout): LayoutKey[] {
  const keys = layout.keys;
  const centre = new Map<LayoutKey, { x: number; y: number }>(keys.map((k) => [k, keyCenter(k)]));
  const rows: LayoutKey[][] = [];
  if (keys.length > 0 && keys.every((k) => KLE_ID.test(k.id))) {
    const byRow = new Map<number, LayoutKey[]>();
    for (const k of keys) {
      const r = Number(KLE_ID.exec(k.id)![1]);
      (byRow.get(r) ?? byRow.set(r, []).get(r)!).push(k);
    }
    const nums = [...byRow.keys()].sort((a, b) => a - b);
    let lastFull = -1;
    nums.forEach((n, i) => {
      if (byRow.get(n)!.length > 2) lastFull = i;
    });
    if (lastFull < 0) lastFull = nums.length - 1;
    nums.forEach((n, i) => {
      const row = byRow.get(n)!;
      if (i > lastFull + 1) rows[rows.length - 1].push(...row);
      else rows.push([...row]);
    });
  } else {
    const sorted = [...keys].sort((a, b) => centre.get(a)!.y - centre.get(b)!.y);
    for (const k of sorted) {
      const last = rows[rows.length - 1];
      if (last && centre.get(k)!.y - centre.get(last[last.length - 1])!.y < ROW_GAP) last.push(k);
      else rows.push([k]);
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => centre.get(a)!.x - centre.get(b)!.x));
}

const layerId = (name: string, n: number, used: Set<string>): string => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || `layer-${n}`;
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base.slice(0, 12)}-${i}`;
  used.add(id);
  return id;
};

const layerName = (name: string, n: number): string => {
  const t = name.replace(/\s+/g, " ").trim().slice(0, MAX_LAYER_NAME).trim();
  return t || `Layer ${n}`;
};

export interface KeymapMapping {
  layers: LayoutLayer[];
  warnings: string[];
  /** How many of the keymap's base-layer characters equal this board's own at the same position. */
  baseMismatch: { matched: number; total: number };
}

/** Places the momentary layers of `km` on the keys of `layout` by position. Throws KeymapImportError on a key-count mismatch. */
export function mapKeymapToLayers(km: ImportedKeymap, layout: ParsedLayout): KeymapMapping {
  const order = orderKeysForImport(layout);
  const perLayer = km.layers[0]?.keys.length ?? 0;
  if (perLayer !== order.length)
    throw new KeymapImportError(
      `This keymap has ${perLayer} keys per layer, but this board has ${order.length}. Pick the matching board first.`,
    );
  const flat = flatten(km);
  const warnings: string[] = [...km.warnings];

  let matched = 0;
  let total = 0;
  flat.layers[0].keys.forEach((k, p) => {
    if (k.kind !== "char" || !k.base) return;
    total++;
    if (order[p].base && order[p].base.toLowerCase() === k.base.toLowerCase()) matched++;
  });

  const out: LayoutLayer[] = [];
  const used = new Set<string>();
  let dropped = 0;
  for (let n = 1; n < km.layers.length; n++) {
    const name = layerName(km.layers[n].name, n);
    const act: number[] = [];
    for (let m = 0; m < n; m++) flat.layers[m].keys.forEach((k, p) => k.holdLayer === n && !act.includes(p) && act.push(p));
    if (act.length === 0) {
      warnings.push(`Layer "${name}" has no hold key (it is switched on by a toggle or one-shot key), so it was skipped.`);
      continue;
    }
    const keys: Record<string, LayerKeyChars> = {};
    flat.layers[n].keys.forEach((k, p) => {
      if (act.includes(p) || k.kind !== "char" || !k.base) return;
      // A transparent key passes the lower layer's character through: nothing to add.
      if (km.layers[n].keys[p].kind === "transparent") return;
      keys[order[p].id] = k.shifted && k.shifted !== k.base ? { base: k.base, shifted: k.shifted } : { base: k.base };
    });
    if (Object.keys(keys).length === 0) {
      warnings.push(`Layer "${name}" has no letters, numbers or symbols to import, so it was skipped.`);
      continue;
    }
    if (out.length >= MAX_LAYERS) {
      dropped++;
      continue;
    }
    out.push({ id: layerId(name, n, used), name, activatorIds: act.slice(0, 4).map((p) => order[p].id), keys });
  }
  if (dropped > 0) warnings.push(`Only the first ${MAX_LAYERS} layers are kept; ${dropped} more ${dropped === 1 ? "was" : "were"} left out.`);
  const clean = sanitizeLayers(out) ?? [];
  return { layers: clean, warnings, baseMismatch: { matched, total } };
}
