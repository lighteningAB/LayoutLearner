// Helpers for user-defined layouts (settings.customLayouts): ids, names, validation,
// non-blocking warnings, and import / export of keyboard-layout-editor.com data.
import JSON5 from "json5";
import type { ParsedLayout } from "../types";
import { LETTERS } from "./analysis";
import { LayoutParseError, parseLayout } from "./parse";
import { PRESETS, getPreset } from "./presets";

export interface CustomLayoutRecord {
  id: string;
  name: string;
  source: string;
}

export const CUSTOM_ID_PREFIX = "custom-";
export const MAX_CUSTOM_KEYS = 300;
export const MAX_SOURCE_BYTES = 50_000;
export const MAX_NAME_LENGTH = 40;

export function isCustomId(id: string): boolean {
  return id.startsWith(CUSTOM_ID_PREFIX);
}

/** A fresh `custom-<6 chars>` id that is not in `existingIds`. */
export function newCustomId(existingIds: Iterable<string> = []): string {
  const taken = new Set(existingIds);
  for (;;) {
    const id = CUSTOM_ID_PREFIX + Math.random().toString(36).slice(2, 8).padEnd(6, "0");
    if (!taken.has(id) && !getPreset(id)) return id;
  }
}

/** Display name for a layout id (preset name, custom name, or the id itself as a last resort). */
export function layoutDisplayName(id: string, customLayouts: readonly { id: string; name: string }[]): string {
  return getPreset(id)?.name ?? customLayouts.find((l) => l.id === id)?.name ?? id;
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/** `base`, or `base 2`, `base 3`… so it does not collide with an existing layout name. */
export function uniqueName(base: string, customLayouts: readonly { name: string }[]): string {
  const taken = new Set([...PRESETS.map((p) => p.name), ...customLayouts.map((l) => l.name)].map((n) => n.toLowerCase()));
  const root = cleanName(base) || "Custom layout";
  if (!taken.has(root.toLowerCase())) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root.slice(0, MAX_NAME_LENGTH - 4)} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export interface SourceIssue {
  message: string;
  /** 1-based position in the source, when known. */
  line?: number;
  column?: number;
}

export interface SourceCheck {
  layout?: ParsedLayout;
  error?: SourceIssue;
  /** Non-blocking problems with a layout that did parse. */
  warnings: string[];
}

export function byteLength(text: string): number {
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(text).length : text.length;
}

/**
 * parseLayout() read the source after trimming it, so its line numbers are relative to the
 * first non-blank line. Shift them back to lines of the text the user sees.
 */
function leadingBlankLines(source: string): number {
  const lead = source.slice(0, source.length - source.trimStart().length);
  return lead.split("\n").length - 1;
}

/** Size guards + parse + warnings. Never throws. */
export function checkSource(source: string, name?: string): SourceCheck {
  const bytes = byteLength(source);
  if (bytes > MAX_SOURCE_BYTES) {
    return {
      error: {
        message: `This is ${Math.round(bytes / 1000)} KB of data; layouts are limited to ${MAX_SOURCE_BYTES / 1000} KB. Is this really a keyboard layout?`,
      },
      warnings: [],
    };
  }
  let layout: ParsedLayout;
  try {
    layout = parseLayout(source, name);
  } catch (e) {
    if (e instanceof LayoutParseError) {
      const line = e.line != null ? e.line + leadingBlankLines(source) : undefined;
      const message = line != null && line !== e.line ? e.message.replace(/line \d+/, `line ${line}`) : e.message;
      return { error: { message, line, column: e.column }, warnings: [] };
    }
    return { error: { message: e instanceof Error ? e.message : String(e) }, warnings: [] };
  }
  if (layout.keys.length > MAX_CUSTOM_KEYS) {
    return {
      error: { message: `This layout has ${layout.keys.length} keys; the limit is ${MAX_CUSTOM_KEYS}.` },
      warnings: [],
    };
  }
  return { layout, warnings: layoutWarnings(layout) };
}

const quote = (ch: string) => (ch === " " ? "space" : ch);

/** Things worth telling the author about a layout that parses but may not be practical. */
export function layoutWarnings(layout: ParsedLayout): string[] {
  const out: string[] = [];
  const main = layout.keys.filter((k) => !(k.code && k.code.startsWith("Numpad")));

  const have = new Set(layout.keys.map((k) => k.base).filter(Boolean));
  const missing = Array.from(LETTERS).filter((l) => !have.has(l));
  if (missing.length === 26) out.push("No letter keys found. Lessons and tests need letters to type.");
  else if (missing.length > 8) out.push(`Missing ${missing.length} of 26 letters. Words that use them will be skipped.`);
  else if (missing.length > 0)
    out.push(
      `Missing ${missing.length === 1 ? "the letter" : "letters"} ${missing.map((l) => l.toUpperCase()).join(" ")}. Words that use ${missing.length === 1 ? "it" : "them"} will be skipped.`,
    );

  const seen = new Map<string, number>();
  for (const k of main) if (k.base && k.base !== " ") seen.set(k.base, (seen.get(k.base) ?? 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([ch]) => ch);
  if (dupes.length > 0)
    out.push(
      `${dupes.length === 1 ? "Character" : "Characters"} ${dupes.slice(0, 8).map((d) => quote(d).toUpperCase()).join(" ")}${dupes.length > 8 ? " …" : ""} ${dupes.length === 1 ? "appears" : "appear"} on more than one key; only the first is used.`,
    );

  if (!layout.keys.some((k) => k.finger))
    out.push("Could not work out which finger presses which key, so finger colours and the hands view will be blank. Row-staggered ANSI boards, ortholinear grids and split boards with a clear gap between the halves are recognised.");
  else if (!layout.keys.some((k) => k.isHome && k.base !== " "))
    out.push("No home-row keys were recognised, so home-row lessons and row statistics are unavailable.");

  return out;
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

type Item = unknown;

function serialiseRow(row: Item[]): string {
  return (
    "[" +
    row
      .map((i) => (typeof i === "string" ? JSON.stringify(i) : JSON.stringify(i).replace(/"([A-Za-z_]\w*)":/g, "$1:")))
      .join(",") +
    "]"
  );
}

interface Decoded {
  rows: Item[][];
  name?: string;
}

/** Reads KLE data in any accepted shape (raw data, downloaded JSON, with/without a meta object). */
function decode(text: string): Decoded | undefined {
  const trimmed = text.trim().replace(/[,;\s]+$/, "");
  if (!trimmed) return undefined;
  let data: unknown;
  try {
    data = JSON5.parse(trimmed);
  } catch {
    try {
      data = JSON5.parse("[" + trimmed + "]");
    } catch {
      return undefined;
    }
  }
  // Our own export wrapper: { name, source }.
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (typeof obj.source === "string") {
      const inner = decode(obj.source);
      return inner ? { ...inner, name: typeof obj.name === "string" ? obj.name : inner.name } : undefined;
    }
    return undefined;
  }
  if (!Array.isArray(data)) return undefined;
  let items = data as Item[];
  if (items.length > 0 && items.some((i) => typeof i === "string") && !items.some(Array.isArray)) items = [items];
  let name: string | undefined;
  const rows: Item[][] = [];
  for (const item of items) {
    if (Array.isArray(item)) rows.push(item);
    else if (item && typeof item === "object" && rows.length === 0) {
      const n = (item as Record<string, unknown>).name;
      if (typeof n === "string" && n.trim()) name = n;
    } else return undefined;
  }
  return rows.length > 0 ? { rows, name } : undefined;
}

/**
 * Turns the text of an imported file into editor source (KLE raw data, one row per line) plus
 * the layout name if the file carries one. Text that cannot be decoded is returned unchanged so
 * the editor can show the syntax error in place.
 */
export function importLayoutText(text: string): { source: string; name?: string } {
  const decoded = decode(text);
  if (!decoded) return { source: text.replace(/\r\n?/g, "\n").trim() };
  return { source: decoded.rows.map(serialiseRow).join(",\n"), name: decoded.name ? cleanName(decoded.name) : undefined };
}

/**
 * Strict JSON in the shape keyboard-layout-editor.com downloads and uploads
 * (`[{name}, [row], [row]]`). Falls back to the raw text when the source does not parse.
 */
export function exportLayoutJson(name: string, source: string): string {
  const decoded = decode(source);
  if (!decoded) return source;
  const lines = [JSON.stringify({ name }), ...decoded.rows.map((r) => JSON.stringify(r))];
  return "[\n" + lines.map((l) => "  " + l).join(",\n") + "\n]\n";
}

export function exportFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "layout"}.kle.json`;
}
