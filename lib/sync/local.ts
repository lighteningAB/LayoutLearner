// Adapters between the sync engine and the app's three localStorage stores (settings, learn prefs,
// lesson progress), plus the ViewConfig that says which fields sync and how.
//
// The view is read GENERICALLY: whatever keys the stores return are part of it, so a field added to
// a store later syncs without touching this file (unless it must stay device-local, see below).
//
// RULE FOR STORE AUTHORS: A VALUE THE STORE MAKES UP MUST NOT LOOK LIKE AN EDIT.
//
// The engine finds local edits by comparing what a store answers with the snapshot it took last
// time (`seen`), and every difference is stamped "now" and wins on all devices. A store, however,
// also answers when it has nothing to say: it returns defaults when its key is missing, unreadable
// or holds something else, fills in the default of a field an older version did not write, and
// replaces values it does not accept (an unknown theme id, a negative amount, a malformed layout).
// None of that is something the user did. Taken for edits, a browser that evicted one localStorage
// key would reset the whole account and delete every custom layout on every device.
//
// So `readStores` below compares each store's answer with the RAW text in localStorage and only
// vouches for fields that are stored there with exactly the value the store returned ("known").
// Everything else is "no information": it is not absorbed, and the replica's value is written back
// into the store. Consequences when changing a store:
//   - persist the COMPLETE, sanitised object on every write (all three stores do). A field that is
//     not written cannot sync, and a value that is stored differently from how it is returned
//     (rounded, clamped, migrated on load) does not sync until the store writes it back;
//   - never persist from a load path. A store that "repairs" its key on startup turns made-up
//     defaults into stored values, which is exactly the edit this rule exists to prevent;
//   - a deliberate reset must be a WRITE of the defaults (resetSettings) or come with its own
//     event (lesson progress: LESSONS_RESET_EVENT; everything: DATA_CLEARED_EVENT). A key that
//     merely disappears is lost storage.
// A new field also arrives as "not in the snapshot" on devices that upgrade; absorbView handles
// that (legacy stamp), so a default never overrides what another device chose.
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

const same = (a: Json, b: Json) => canonical(a) === canonical(b);

/**
 * What the stores hold, and how much of it they can vouch for.
 *
 *   view    the stores' values, complete (defaults included). What projections are based on and
 *           what `seen` is taken from.
 *   known   `view` without everything the store made up: the part that may be absorbed.
 *   gaps    something was made up, or the lesson store's key is missing. The engine then puts the
 *           replica's values back into the stores (trackLocal in cycle.ts).
 */
export interface StoreRead {
  view: LocalView;
  known: LocalView;
  gaps: boolean;
}

// Raw text per key: as of the read in progress, and as of the last read the engine has dealt with.
let pendingRaw: { [key: string]: string | null | undefined } = {};
const ackedRaw: { [key: string]: string | null } = {};
const hasOwn = Object.prototype.hasOwnProperty;

/**
 * The fields of `value` (what the store answers) that are backed by what localStorage holds under
 * `key`: present there with the same value. `value` itself if that is all of them.
 *
 * Once the engine has dealt with a particular raw text (ackStores), the store's memory is trusted
 * for as long as that text does not change: any difference is then this tab's own write that could
 * not be persisted (quota), which is a real edit and must not be undone.
 */
function backed(key: string, value: Dict): Dict {
  const raw = rawOf(key);
  pendingRaw[key] = raw;
  if (raw === undefined || raw === null) return hasOwn.call(ackedRaw, key) && ackedRaw[key] === raw ? value : {};
  if (hasOwn.call(ackedRaw, key) && ackedRaw[key] === raw) return value;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  const out: Dict = {};
  let all = true;
  for (const k of Object.keys(value)) {
    let ok = false;
    try {
      ok = hasOwn.call(stored, k) && same((stored as Dict)[k], value[k]);
    } catch {
      ok = false;
    }
    if (ok) out[k] = value[k];
    else all = false;
  }
  return all ? value : out;
}

/** Whether the lesson store's key is there and readable (its content is not judged, see above). */
function lessonsBacked(): boolean {
  const raw = rawOf(LESSONS_KEY);
  pendingRaw[LESSONS_KEY] = raw;
  if (hasOwn.call(ackedRaw, LESSONS_KEY) && ackedRaw[LESSONS_KEY] === raw) return true;
  if (raw === undefined || raw === null) return false;
  try {
    const stored: unknown = JSON.parse(raw);
    return typeof stored === "object" && stored !== null && !Array.isArray(stored);
  } catch {
    return false;
  }
}

/** The stores' current content as fresh, JSON-only values. */
export function readStores(): StoreRead {
  refreshStores();
  pendingRaw = {};
  const view: LocalView = {
    settings: clone(getSettings()) as unknown as Dict,
    learn: clone(getLearnPrefs()) as unknown as Dict,
    lessons: clone(getAllLessonProgress()) as unknown as LocalView["lessons"],
  };
  const settings = backed(SETTINGS_KEY, view.settings);
  const learn = backed(LEARN_PREFS_KEY, view.learn);
  const lessonsOk = lessonsBacked();
  if (settings === view.settings && learn === view.learn) return { view, known: view, gaps: !lessonsOk };
  return { view, known: { settings, learn, lessons: view.lessons }, gaps: true };
}

/**
 * The engine has dealt with the last readStores() (absorbed what was known, restored what was
 * not, saved the sidecar): until the stored text changes again, the stores' memory is trusted.
 */
export function ackStores(): void {
  for (const key of Object.keys(pendingRaw)) {
    const raw = pendingRaw[key];
    if (raw !== undefined) ackedRaw[key] = raw;
  }
}

/** The stores' current content (everything, vouched for or not). */
export function readView(): LocalView {
  return readStores().view;
}

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
