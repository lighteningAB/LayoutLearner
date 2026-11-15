"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { IconName } from "@/components/ui/Icon";
import type { ThemeId } from "@/lib/settings";

export interface Command {
  id: string;
  label: string;
  /** Section heading / tag, e.g. "Go to", "Theme", "Settings". */
  group?: string;
  /** Extra search terms. */
  keywords?: string;
  icon?: IconName;
  /** Right-aligned hint (current value, shortcut…). */
  hint?: ReactNode;
  run: () => void;
  /** Keep the palette open after running (toggles). */
  keepOpen?: boolean;
  /** Theme to preview live while this command is highlighted. */
  themePreview?: ThemeId;
}

interface PaletteState {
  open: boolean;
  /** Query the palette opens with. */
  initialQuery: string;
  /** Commands registered by pages/features, in addition to the built-in ones. */
  extra: Command[];
}

let state: PaletteState = { open: false, initialQuery: "", extra: [] };
const SERVER_STATE = state;
const listeners = new Set<() => void>();
const set = (patch: Partial<PaletteState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Open the command palette, optionally pre-filled (e.g. "theme "). */
export function openCommandPalette(initialQuery = ""): void {
  set({ open: true, initialQuery });
}

export function closeCommandPalette(): void {
  if (state.open) set({ open: false });
}

export function isCommandPaletteOpen(): boolean {
  return state.open;
}

/** Add commands to the palette; returns an unregister function. */
export function registerCommands(commands: Command[]): () => void {
  set({ extra: [...state.extra, ...commands] });
  return () => set({ extra: state.extra.filter((c) => !commands.includes(c)) });
}

/** Register commands for as long as the calling component is mounted. Memoise `commands`. */
export function useRegisterCommands(commands: Command[]): void {
  useEffect(() => registerCommands(commands), [commands]);
}

export function usePaletteState(): PaletteState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

/**
 * Fuzzy score of `query` against `text`; -1 when it does not match. Higher is better.
 * Every whitespace-separated token must match as a substring, or (optionally) as a subsequence.
 */
export function fuzzyScore(query: string, text: string, allowSubsequence = true): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let total = 0;
  for (const token of q.split(/\s+/)) {
    const at = t.indexOf(token);
    if (at >= 0) {
      total += 100 - Math.min(at, 40) + (at === 0 || /[\s:/-]/.test(t[at - 1]) ? 30 : 0);
      continue;
    }
    if (!allowSubsequence) return -1;
    // subsequence fallback
    let ti = 0;
    let gaps = 0;
    for (const ch of token) {
      const found = t.indexOf(ch, ti);
      if (found < 0) return -1;
      gaps += found - ti;
      ti = found + 1;
    }
    total += Math.max(5, 50 - gaps * 2);
  }
  return total;
}
