/** Neutral keymap structure produced by the firmware importers. Pure TS, browser-safe. */

export type KeymapFormat = "qmk-json" | "qmk-c" | "zmk" | "vial";

export interface ImportedKey {
  /** Character produced when tapped / pressed, assuming a US host layout. "" if none. */
  base: string;
  /** With Shift. "" if none. */
  shifted: string;
  /** If holding this key activates a layer momentarily: that layer's index. */
  holdLayer?: number;
  /** "transparent" falls through to lower layers (resolve it in `flatten`). */
  kind: "char" | "modifier" | "layer" | "transparent" | "none" | "other";
  /** Short label for previews: "A", "Raise", "Ctrl", "LT1 Spc", "▽". */
  label: string;
  /** Original token, e.g. "LT(1,KC_SPC)", "&mo 2". */
  raw: string;
}

export interface ImportedLayer {
  name: string;
  keys: ImportedKey[];
}

export interface ImportedKeymap {
  format: KeymapFormat;
  /** e.g. "crkbd/rev1", or "" */
  keyboard: string;
  /** e.g. "LAYOUT_split_3x6_3", or "" */
  layoutName: string;
  /** Keys in the file's positional order. */
  layers: ImportedLayer[];
  /** Human-readable, plain words. */
  warnings: string[];
}

export class KeymapImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeymapImportError";
  }
}

export const LIMITS = {
  maxChars: 200 * 1024,
  maxLayers: 16,
  maxKeysPerLayer: 300,
  maxNesting: 64,
};
