// Adapters between the sync engine and the app's three localStorage stores (settings, learn prefs,
// lesson progress), plus the ViewConfig that says which fields sync and how.
//
// The view is read GENERICALLY: whatever keys the stores return are part of it, so a field added to
// a store later syncs without touching this file (unless it must stay device-local, see below).
import { DEFAULT_LEARN_PREFS, LEARN_PREFS_KEY, getLearnPrefs, subscribeLearnPrefs, updateLearnPrefs } from "@/components/learn/prefs";
import {
  LESSONS_KEY,
  getAllLessonProgress,
  replaceAllLessonProgress,
  subscribeLessonProgress,
} from "@/lib/lessons/progress";
import { DEFAULT_SETTINGS, SETTINGS_KEY, getSettings, subscribeSettings, updateSettings } from "@/lib/settings";
import { canonical, type Json } from "./doc";
import type { LocalView, ViewConfig } from "./view";

export { LESSONS_RESET_EVENT } from "@/lib/lessons/progress";
export { DATA_CLEARED_EVENT } from "@/lib/settings";

type Dict = { [k: string]: Json };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

let viewConfig: ViewConfig | null = null;

export function getViewConfig(): ViewConfig {
  if (viewConfig === null) {
    viewConfig = {
      // Never synced, each for a reason that is a property of the DEVICE:
      //   emulateLayout  depends on the keyboard layout configured in that device's OS
      //   showHands      the 3D hands depend on that device's GPU
      //   fontSize       px size depends on that device's screen
      deviceLocal: ["emulateLayout", "showHands", "fontSize"],
      // The amount is only meaningful together with its mode ("time / 30" vs "words / 50").
      groups: [["testMode", "testAmount"]],
      layoutsField: "customLayouts",
      settingsDefaults: clone(DEFAULT_SETTINGS) as unknown as Dict,
      learnDefaults: clone(DEFAULT_LEARN_PREFS) as unknown as Dict,
    };
  }
  return viewConfig;
}

// ---------------------------------------------------------------------------------------------
// Keeping the stores' in-memory state in step with localStorage
//
// The settings and learn-prefs stores keep their state in memory and learn about writes from other
// tabs through `storage` events, which arrive asynchronously. The sidecar, however, is read
// synchronously and may already contain the other tab's `seen`. Absorbing a STALE in-memory view
// against that newer `seen` would look like "the user changed everything back" and stamp the old
// values over the new ones. So before the view is read, a store whose localStorage text changed
// behind its back is told to reload, by handing it the `storage` event it has not received yet.
// ---------------------------------------------------------------------------------------------

const lastRaw: { [key: string]: string | null | undefined } = {};

function rawOf(key: string): string | null | undefined {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return undefined;
  }
}

function reloadStore(key: string, raw: string | null): void {
  try {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: raw, storageArea: window.localStorage }));
  } catch {
    /* no synthetic StorageEvent in this browser: the real event will arrive */
  }
}

function refreshIfStale(key: string, memory: () => unknown): void {
  const raw = rawOf(key);
  if (raw === undefined) return;
  const prev = lastRaw[key];
  lastRaw[key] = raw;
  // Unchanged since the last look: whatever differs in memory is this tab's own doing (for
  // example a write that could not be persisted) and must not be thrown away.
  if (prev === raw) return;
  // First look with nothing stored: memory holds defaults.
  if (prev === undefined && raw === null) return;
  let mine: string | undefined;
  try {
    mine = JSON.stringify(memory());
  } catch {
    mine = undefined;
  }
  if (mine === raw) return; // changed by this tab, or already reloaded
  reloadStore(key, raw);
}

function refreshStores(): void {
  refreshIfStale(SETTINGS_KEY, getSettings);
  refreshIfStale(LEARN_PREFS_KEY, getLearnPrefs);
  // Lesson progress re-reads localStorage on every access; nothing to refresh.
}

// ---------------------------------------------------------------------------------------------
// Reading and writing the view
// ---------------------------------------------------------------------------------------------

/** The stores' current content as a fresh, JSON-only value. */
export function readView(): LocalView {
  refreshStores();
  return {
    settings: clone(getSettings()) as unknown as Dict,
    learn: clone(getLearnPrefs()) as unknown as Dict,
    lessons: clone(getAllLessonProgress()) as unknown as LocalView["lessons"],
  };
}

const same = (a: Json, b: Json) => canonical(a) === canonical(b);

/**
 * Brings the stores to `target`. `current` is the view read just before (same synchronous block).
 * A store is only written when its value actually differs, so an unchanged projection causes no
 * store notification (no re-render, no theme transition).
 *
 * Only keys the store itself returned are written: a register for a field this app version does
 * not know stays in the document and is simply not shown here.
 */
export function writeView(target: LocalView, current: LocalView): void {
  const settingsPatch: Dict = {};
  let settingsChanged = false;
  for (const key of Object.keys(current.settings)) {
    const next = target.settings[key];
    if (next === undefined || same(next, current.settings[key])) continue;
    settingsPatch[key] = next;
    settingsChanged = true;
  }
  if (settingsChanged) updateSettings(settingsPatch as Parameters<typeof updateSettings>[0]);

  const learnPatch: Dict = {};
  let learnChanged = false;
  for (const key of Object.keys(current.learn)) {
    const next = target.learn[key];
    if (next === undefined || same(next, current.learn[key])) continue;
    // The learn-prefs store only validates on load. Keep values of an unexpected type out of it.
    if (typeof next !== typeof current.learn[key]) continue;
    learnPatch[key] = next;
    learnChanged = true;
  }
  if (learnChanged) {
    updateLearnPrefs(learnPatch as Parameters<typeof updateLearnPrefs>[0]);
    // Let the store run its own load-time validation over what was just written, so that `seen`
    // (read back afterwards) is what the store will also hold after a reload.
    reloadStore(LEARN_PREFS_KEY, rawOf(LEARN_PREFS_KEY) ?? null);
  }

  if (!same(target.lessons as unknown as Json, current.lessons as unknown as Json)) {
    replaceAllLessonProgress(target.lessons as unknown as Parameters<typeof replaceAllLessonProgress>[0]);
  }

  // These writes are this tab's own: do not mistake them for another tab's on the next read.
  for (const key of [SETTINGS_KEY, LEARN_PREFS_KEY]) {
    const raw = rawOf(key);
    if (raw !== undefined) lastRaw[key] = raw;
  }
}

/** Calls `listener` whenever one of the three stores changes (in this tab or another one). */
export function subscribeStores(listener: () => void): () => void {
  const unsubscribe = [subscribeSettings(listener), subscribeLearnPrefs(listener), subscribeLessonProgress(listener)];
  return () => unsubscribe.forEach((u) => u());
}

export { LESSONS_KEY };
