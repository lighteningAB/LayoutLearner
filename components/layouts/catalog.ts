// The list of layouts the Layouts page shows: presets + the user's custom layouts,
// each parsed and analysed once (results are cached by source text).
import { useMemo } from "react";
import type { ParsedLayout } from "@/lib/types";
import { analyzeLayout, diffFromQwerty, type LayoutAnalysis, type QwertyDiff } from "@/lib/layout/analysis";
import { checkSource } from "@/lib/layout/custom";
import { PRESETS, type LayoutFamily } from "@/lib/layout/presets";

export type Family = LayoutFamily | "custom";

export const FAMILY_LABEL: Record<Family, string> = {
  "ansi-60": "ANSI 60%",
  "ansi-100": "Full size",
  ortho: "Ortholinear",
  split: "Split",
  custom: "Custom",
};

export interface LayoutEntry {
  id: string;
  name: string;
  description: string;
  family: Family;
  source: string;
  isCustom: boolean;
  /** null when the stored source no longer parses. */
  layout: ParsedLayout | null;
  /** Parse error message when `layout` is null. */
  error?: string;
  warnings: string[];
  analysis: LayoutAnalysis | null;
  diff: QwertyDiff | null;
}

interface Computed {
  layout: ParsedLayout | null;
  error?: string;
  warnings: string[];
  analysis: LayoutAnalysis | null;
  diff: QwertyDiff | null;
}

const cache = new Map<string, Computed>();
const CACHE_LIMIT = 64;

function compute(source: string): Computed {
  const hit = cache.get(source);
  if (hit) return hit;
  const check = checkSource(source);
  const out: Computed = check.layout
    ? {
        layout: check.layout,
        warnings: check.warnings,
        analysis: analyzeLayout(check.layout),
        diff: diffFromQwerty(check.layout),
      }
    : { layout: null, error: check.error?.message ?? "This layout could not be read.", warnings: [], analysis: null, diff: null };
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(source, out);
  return out;
}

/** parseLayout names layouts after their source; give each entry its own display name. */
function named(c: Computed, name: string): Computed {
  return c.layout && c.layout.name !== name ? { ...c, layout: { ...c.layout, name } } : c;
}

let presetEntries: LayoutEntry[] | undefined;
function getPresetEntries(): LayoutEntry[] {
  return (presetEntries ??= PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    family: p.family,
    source: p.source,
    isCustom: false,
    ...named(compute(p.source), p.name),
  })));
}

const customEntryCache = new Map<string, LayoutEntry>();

function customEntry(c: { id: string; name: string; source: string }): LayoutEntry {
  const cacheKey = `${c.id}\u0000${c.name}\u0000${c.source}`;
  const hit = customEntryCache.get(cacheKey);
  if (hit) return hit;
  const computed = named(compute(c.source), c.name);
  const entry: LayoutEntry = {
    id: c.id,
    name: c.name,
    description: computed.layout
      ? `Your own layout, ${computed.layout.keys.length} keys.`
      : "This layout's data can no longer be read.",
    family: "custom",
    source: c.source,
    isCustom: true,
    ...computed,
  };
  if (customEntryCache.size >= CACHE_LIMIT) customEntryCache.delete(customEntryCache.keys().next().value as string);
  customEntryCache.set(cacheKey, entry);
  return entry;
}

export function buildCatalog(customLayouts: readonly { id: string; name: string; source: string }[]): LayoutEntry[] {
  const presets = getPresetEntries();
  const ids = new Set(presets.map((p) => p.id));
  return [...presets, ...customLayouts.filter((c) => !ids.has(c.id)).map(customEntry)];
}

export function useLayoutCatalog(customLayouts: readonly { id: string; name: string; source: string }[]): LayoutEntry[] {
  return useMemo(() => buildCatalog(customLayouts), [customLayouts]);
}

export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
