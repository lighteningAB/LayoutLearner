"use client";

import { useMemo } from "react";
import type { LayoutLayer, ParsedLayout } from "../types";
import { useSettings } from "../settings";
import { applyLayers, parsePreset } from "./layers";
import { applyFingerOverrides, type FingerOverrides } from "./overrides";
import { parseLayout } from "./parse";
import { DEFAULT_PRESET_ID, getPreset } from "./presets";

export interface ActiveLayout {
  /** Id used for settings and lesson progress (preset id or custom layout id). */
  id: string;
  name: string;
  layout: ParsedLayout;
  isCustom: boolean;
  /** Set when the selected layout failed to parse and we fell back to the default. */
  error?: string;
}

function fallback(error?: string): ActiveLayout {
  const preset = getPreset(DEFAULT_PRESET_ID)!;
  return {
    id: preset.id,
    name: preset.name,
    layout: parsePreset(preset),
    isCustom: false,
    error,
  };
}

/** Resolve `settings.layoutId` (preset or custom) into a parsed layout. Never throws. */
export function resolveLayout(
  layoutId: string,
  customLayouts: { id: string; name: string; source: string; fingers?: FingerOverrides; layers?: LayoutLayer[] }[],
): ActiveLayout {
  const preset = getPreset(layoutId);
  if (preset) {
    return { id: preset.id, name: preset.name, layout: parsePreset(preset), isCustom: false };
  }
  const custom = customLayouts.find((c) => c.id === layoutId);
  if (custom) {
    try {
      return { id: custom.id, name: custom.name, layout: applyLayers(applyFingerOverrides(parseLayout(custom.source, custom.name), custom.fingers), custom.layers), isCustom: true };
    } catch (e) {
      return fallback(e instanceof Error ? e.message : String(e));
    }
  }
  return fallback();
}

export function useActiveLayout(): ActiveLayout {
  const [settings] = useSettings();
  return useMemo(
    () => resolveLayout(settings.layoutId, settings.customLayouts),
    [settings.layoutId, settings.customLayouts],
  );
}
