"use client";
// Two small one-time hints, dismissal kept in localStorage under "ll:v1:hints" ({ mobile?, welcome? }).
// Both evaluate only after mount (no hydration mismatch) and render nothing until then, so desktop
// users never see a layout change. Same look as EmulationHint.
//
//   <MobileNotice />                      in-flow banner, touch-only devices
//   <WelcomeHint suppressed={…} />        fixed overlay (no layout shift), first visit only
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
  "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sub transition-colors duration-150 hover:bg-text/[0.07] hover:text-text";

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
      className="animate-rise-in mb-3 flex w-full items-start gap-2.5 rounded-ui border border-border bg-bg-alt py-2 pr-1.5 pl-3 text-xs leading-snug text-sub"
    >
      <Icon name="alert" size={14} className="mt-px shrink-0 text-main" />
      <span className="min-w-0 flex-1 py-px">Best with a physical keyboard. A Bluetooth keyboard works too.</span>
      <button type="button" data-testid="mobile-notice-dismiss" aria-label="Dismiss" onClick={dismiss} className={dismissButton}>
        <Icon name="x" size={13} />
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
  const link = "font-medium text-main underline-offset-2 hover:underline";
  return (
    <div
      role="status"
      data-testid="welcome-hint"
      className="animate-rise-in fixed inset-x-4 bottom-4 z-30 mx-auto flex w-fit max-w-[min(100%,46rem)] items-start gap-2.5 rounded-ui border border-border bg-bg-alt py-2 pr-1.5 pl-3 text-xs leading-snug text-sub shadow-lg"
    >
      <span className="min-w-0 py-px">
        New to this layout? Start with the lessons in{" "}
        <Link href="/learn" className={link}>
          Learn
        </Link>
        , or pick your board in{" "}
        <Link href="/layouts" className={link}>
          Layouts
        </Link>
        .
      </span>
      <button type="button" data-testid="welcome-hint-dismiss" aria-label="Dismiss" onClick={dismiss} className={dismissButton}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
