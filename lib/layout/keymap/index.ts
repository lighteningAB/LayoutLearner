import { KeymapImportError, LIMITS } from "./types.ts";
import type { ImportedKey, ImportedKeymap, KeymapFormat } from "./types.ts";
import { parseJsonLoose } from "./json.ts";
import { parseQmkC, parseQmkJson, parseVial } from "./qmk.ts";
import { parseZmk } from "./zmk.ts";
import { NONE_LABEL } from "./util.ts";

export { KeymapImportError } from "./types.ts";
export type { ImportedKey, ImportedKeymap, ImportedLayer, KeymapFormat } from "./types.ts";
export { lookupQmkKey, lookupZmkKey } from "./keycodes.ts";
export type { KeyDef } from "./keycodes.ts";

export function detectFormat(text: string): KeymapFormat | null {
  if (typeof text !== "string" || text.length > LIMITS.maxChars) return null;
  const t = text.trimStart();
  if (t.startsWith("{")) {
    const obj = parseJsonLoose(t) as { layers?: unknown; layout?: unknown } | undefined;
    if (obj && typeof obj === "object") {
      if (Array.isArray(obj.layers)) return "qmk-json";
      if (Array.isArray(obj.layout)) return "vial";
    }
    return null;
  }
  if (t.includes("zmk,keymap")) return "zmk";
  if (/\bkeymaps\b/.test(t) && (t.includes("LAYOUT") || t.includes("PROGMEM") || t.includes("[0]"))) return "qmk-c";
  return null;
}

export function parseKeymap(text: string, format?: KeymapFormat): ImportedKeymap {
  if (typeof text !== "string" || text.trim() === "")
    throw new KeymapImportError("This file is empty.");
  if (text.length > LIMITS.maxChars)
    throw new KeymapImportError(`This file is too large (over ${LIMITS.maxChars / 1024} KB) to be a keymap.`);
  const fmt = format ?? detectFormat(text);
  if (!fmt)
    throw new KeymapImportError(
      "We could not tell what kind of keymap this is. Supported files: QMK keymap.c or JSON, ZMK .keymap, and Vial .vil.",
    );
  try {
    switch (fmt) {
      case "qmk-json": return parseQmkJson(text);
      case "qmk-c": return parseQmkC(text);
      case "zmk": return parseZmk(text);
      case "vial": return parseVial(text);
      default: throw new KeymapImportError("Unknown keymap format.");
    }
  } catch (e) {
    if (e instanceof KeymapImportError) throw e;
    throw new KeymapImportError("This file could not be read as a keymap; it may be damaged or in an unexpected shape.");
  }
}

/**
 * Resolves transparent keys. A momentary layer sits on top of the layer that
 * holds its activator (layer 0 when none is found), so a transparent key shows
 * that parent layer's key, and so on down to layer 0. Anything still
 * transparent on layer 0 becomes "none".
 */
export function flatten(km: ImportedKeymap): ImportedKeymap {
  const n = km.layers.length;
  const parent: number[] = new Array(n).fill(0);
  for (let m = n - 1; m >= 0; m--) {
    for (const k of km.layers[m].keys) {
      if (k.holdLayer !== undefined && k.holdLayer > m && k.holdLayer < n) parent[k.holdLayer] = m;
    }
  }
  const out: ImportedKeymap["layers"] = [];
  for (let li = 0; li < n; li++) {
    const keys: ImportedKey[] = km.layers[li].keys.map((k, pos) => {
      if (k.kind !== "transparent") return { ...k };
      let from = li;
      for (let hops = 0; hops < n && from !== 0; hops++) {
        from = parent[from];
        const below = from === li ? k : out[from].keys[pos];
        if (below && below.kind !== "transparent") return { ...below };
      }
      return { base: "", shifted: "", kind: "none", label: NONE_LABEL, raw: k.raw };
    });
    out.push({ name: km.layers[li].name, keys });
  }
  return { ...km, layers: out, warnings: [...km.warnings] };
}
