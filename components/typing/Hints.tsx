"use client";
// Two small one-time hints, dismissal kept in localStorage under "ll:v1:hints" ({ mobile?, welcome? }).
// Both evaluate only after mount (no hydration mismatch) and render nothing until then, so desktop
// users never see a layout change. Drawn as drafted notes, like EmulationHint.
//
//   <MobileNotice />                      in-flow banner, touch-only devices
//   <WelcomeHint suppressed={…} />        in-flow note for a margin with room to spare, first visit only
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui";
import { getAllLessonProgress } from "@/lib/lessons/progress";
import { DATA_CLEARED_EVENT } from "@/lib/settings";

export const HINTS_KEY = "ll:v1:hints";
type HintId = "mobile" | "welcome";

function readHints(): Partial<Record<HintId, boolean>> {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(HINTS_KEY) ?? "null");
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Partial<Record<HintId, boolean>>) : {};
  } catch {
    return {};
  }
}

function writeHint(id: HintId) {
  try {
    window.localStorage.setItem(HINTS_KEY, JSON.stringify({ ...readHints(), [id]: true }));
  } catch {
    /* storage unavailable: dismissed for this page view only */
  }
}

/** null until mounted, then whether the hint was already dismissed. */
function useDismissed(id: HintId): [boolean | null, () => void] {
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    setDismissed(readHints()[id] === true);
    const onCleared = () => setDismissed(false);
    window.addEventListener(DATA_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(DATA_CLEARED_EVENT, onCleared);
  }, [id]);
  const dismiss = useCallback(() => {
    writeHint(id);
    setDismissed(true);
  }, [id]);
  return [dismissed, dismiss];
}

const dismissButton =
  "inline-flex size-7 shrink-0 items-center justify-center border border-transparent text-sub transition-colors duration-150 hover:border-line hover:text-text";

export function MobileNotice() {
  const [dismissed, dismiss] = useDismissed("mobile");
  const [touchOnly, setTouchOnly] = useState(false);
  useEffect(() => {
    try {
      const forced = new URLSearchParams(window.location.search).get("forceMobileNotice") === "1";
      setTouchOnly(forced || (window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches));
    } catch {
      setTouchOnly(false);
    }
  }, []);
  if (dismissed !== false || !touchOnly) return null;
  return (
    <div
      role="note"
      data-testid="mobile-notice"
      className="animate-rise-in mb-4 flex w-full items-center gap-2.5 border border-line bg-bg py-1 pr-1 pl-3 text-[14px] leading-snug text-text"
    >
      <Icon name="keyboard" size={16} className="shrink-0 text-main" />
      <span className="min-w-0 flex-1 py-1">Best with a physical keyboard. A Bluetooth keyboard works too.</span>
      <button type="button" data-testid="mobile-notice-dismiss" aria-label="Dismiss" onClick={dismiss} className={dismissButton}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

/** Shown on the typing test for a visitor with no lesson progress; `suppressed` while a test runs or another hint is up. */
export function WelcomeHint({ suppressed }: { suppressed: boolean }) {
  const [dismissed, dismiss] = useDismissed("welcome");
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    try {
      setFresh(Object.keys(getAllLessonProgress()).length === 0);
    } catch {
      setFresh(true);
    }
  }, []);
  if (dismissed !== false || !fresh || suppressed) return null;
  const link = "font-medium text-main underline underline-offset-[3px] hover:text-text";
  return (
    <div role="status" data-testid="welcome-hint" className="animate-rise-in border border-dashed border-border bg-bg text-[13px] leading-snug text-sub">
      <div className="flex items-center justify-between border-b border-dashed border-border pl-2.5">
        <span className="ll-lettering-sm text-text">New here</span>
        <button type="button" data-testid="welcome-hint-dismiss" aria-label="Dismiss" onClick={dismiss} className={dismissButton}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <p className="px-2.5 py-2">
        New to this layout? Start with the lessons in{" "}
        <Link href="/learn" className={link}>
          Learn
        </Link>
        , or pick your board in{" "}
        <Link href="/layouts" className={link}>
          Layouts
        </Link>
        .
      </p>
    </div>
  );
}
