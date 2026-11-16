"use client";
// "Looks like your keyboard is still set to QWERTY": a quiet, dismissible nudge towards the
// emulation toggle. Emulation is off by default, so a beginner who has not changed the OS layout
// types QWERTY characters while the app expects the layout they picked.
//
//   const hint = useEmulationHint({ layout, emulate });
//   useKeyboardInput({ …, onKeystroke: hint.note });
//   <EmulationHint hint={hint} layoutName={active.name} />
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui";
import { keyForChar } from "@/lib/layout/keys";
import { parseLayout } from "@/lib/layout/parse";
import { DEFAULT_PRESET_ID, getPreset } from "@/lib/layout/presets";
import { useSettings } from "@/lib/settings";
import type { ParsedLayout } from "@/lib/types";

const SEEN_KEY = "ll:hint:qwerty-os";
/** Only the first keystrokes decide: after this many informative ones the check stops. */
const WINDOW = 12;
const MIN_SAMPLES = 3;
const MIN_HITS = 3;
const MIN_RATIO = 0.6;

let qwerty: ParsedLayout | null = null;
function qwertyLayout(): ParsedLayout {
  if (!qwerty) {
    const p = getPreset(DEFAULT_PRESET_ID)!;
    qwerty = parseLayout(p.source, p.name);
  }
  return qwerty;
}

/** What a QWERTY keyboard types at the physical position of `code` (unshifted, shifted). */
function qwertyCharsAt(code: string): [string, string] | null {
  const k = qwertyLayout().keys.find((x) => x.code === code);
  return k ? [k.base, k.shifted] : null;
}

// Once per session (page lifetime, and per tab through sessionStorage).
let seenInMemory = false;
function wasSeen(): boolean {
  if (seenInMemory) return true;
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
function markSeen() {
  seenInMemory = true;
  try {
    window.sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

export interface EmulationHintState {
  visible: boolean;
  /** Feed every character keystroke (`useKeyboardInput({ onKeystroke })`). */
  note: (typed: string, expected: string | null) => void;
  dismiss: () => void;
  turnOn: () => void;
}

export function useEmulationHint({ layout, emulate }: { layout: ParsedLayout; emulate: boolean }): EmulationHintState {
  const [, update] = useSettings();
  const [visible, setVisible] = useState(false);
  const tally = useRef({ n: 0, hits: 0 });
  const layoutRef = useRef(layout);
  const emulateRef = useRef(emulate);
  layoutRef.current = layout;
  emulateRef.current = emulate;

  // A different layout or emulation state starts a fresh count.
  useEffect(() => {
    tally.current = { n: 0, hits: 0 };
    if (emulate) setVisible(false);
  }, [layout, emulate]);

  const note = useCallback((typed: string, expected: string | null) => {
    if (emulateRef.current || expected == null || tally.current.n >= WINDOW || wasSeen()) return;
    const hit = keyForChar(layoutRef.current, expected);
    const code = hit?.key.code;
    const q = code ? qwertyCharsAt(code) : null;
    if (!hit || !q) return;
    const qwertyChar = hit.needsShift ? q[1] : q[0];
    // The expected key types the same character on QWERTY: nothing to learn from this keystroke.
    if (!qwertyChar || qwertyChar === expected) return;
    const t = tally.current;
    t.n++;
    if (typed === qwertyChar) t.hits++;
    if (t.n >= MIN_SAMPLES && t.hits >= MIN_HITS && t.hits / t.n >= MIN_RATIO) {
      markSeen();
      setVisible(true);
    }
  }, []);

  const dismiss = useCallback(() => setVisible(false), []);
  const turnOn = useCallback(() => {
    setVisible(false);
    update({ emulateLayout: true });
  }, [update]);
  return useMemo(() => ({ visible, note, dismiss, turnOn }), [visible, note, dismiss, turnOn]);
}

export function EmulationHint({ hint, layoutName }: { hint: EmulationHintState; layoutName: string }) {
  if (!hint.visible) return null;
  return (
    <div
      role="status"
      data-testid="emulation-hint"
      className="animate-rise-in fixed inset-x-4 bottom-4 z-40 mx-auto flex w-fit max-w-[min(100%,46rem)] items-start gap-2.5 rounded-ui border border-border bg-bg-alt py-2 pr-1.5 pl-3 text-xs leading-snug text-sub shadow-lg"
    >
      <Icon name="alert" size={14} className="mt-px shrink-0 text-main" />
      <span className="min-w-0 py-px">
        Looks like your keyboard is still set to QWERTY — turn on emulation to practise {layoutName} without changing system settings
      </span>
      <button
        type="button"
        data-testid="emulation-hint-on"
        onClick={hint.turnOn}
        className="inline-flex h-6 shrink-0 items-center rounded-full bg-main/[0.14] px-2.5 text-xs font-medium text-main transition-colors duration-150 hover:bg-main/[0.22]"
      >
        Turn on
      </button>
      <button
        type="button"
        data-testid="emulation-hint-dismiss"
        aria-label="Dismiss"
        onClick={hint.dismiss}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sub transition-colors duration-150 hover:bg-text/[0.07] hover:text-text"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
