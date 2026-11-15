"use client";
// Small persisted preferences of the Learn area and the guide hands ("ll:v1:learn").
import { useSyncExternalStore } from "react";
import { DATA_CLEARED_EVENT } from "@/lib/settings";

export const LEARN_PREFS_KEY = "ll:v1:learn";

export interface LearnPrefs {
  /** Experienced users: every lesson can be started, regardless of what was passed. */
  unlockAll: boolean;
  /** Camera of the 3D hands panel. */
  camera: "angled" | "top";
  /** The guide view "both" was picked: show the 2D board under the 3D hands. */
  bothGuides: boolean;
}

export const DEFAULT_LEARN_PREFS: LearnPrefs = { unlockAll: false, camera: "angled", bothGuides: false };

const listeners = new Set<() => void>();
let state: LearnPrefs | null = null;
let attached = false;

function load(): LearnPrefs {
  try {
    const raw = window.localStorage.getItem(LEARN_PREFS_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<LearnPrefs> | null) : null;
    return {
      unlockAll: p?.unlockAll === true,
      camera: p?.camera === "top" ? "top" : "angled",
      bothGuides: p?.bothGuides === true,
    };
  } catch {
    return { ...DEFAULT_LEARN_PREFS };
  }
}

const emit = () => listeners.forEach((l) => l());

export function getLearnPrefs(): LearnPrefs {
  if (typeof window === "undefined") return DEFAULT_LEARN_PREFS;
  if (!state) state = load();
  return state;
}

export function updateLearnPrefs(patch: Partial<LearnPrefs>): void {
  if (typeof window === "undefined") return;
  state = { ...getLearnPrefs(), ...patch };
  try {
    window.localStorage.setItem(LEARN_PREFS_KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota: kept in memory for this tab */
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!attached && typeof window !== "undefined") {
    attached = true;
    const reload = () => {
      state = load();
      emit();
    };
    window.addEventListener("storage", (e) => {
      if (e.key === null || e.key === LEARN_PREFS_KEY) reload();
    });
    window.addEventListener(DATA_CLEARED_EVENT, reload);
  }
  return () => {
    listeners.delete(listener);
  };
}

const serverSnapshot = () => DEFAULT_LEARN_PREFS;

export function useLearnPrefs(): [LearnPrefs, (patch: Partial<LearnPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, getLearnPrefs, serverSnapshot);
  return [prefs, updateLearnPrefs];
}
