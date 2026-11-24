"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button, Icon, IconButton, Toggle, cx } from "@/components/ui";
import { fingerToString } from "@/lib/layout/overrides";
import { FINGER_ORDER, type FingerId } from "@/lib/types";
import { KeyChip } from "./drafting";

export const fingerName = (f: FingerId) => `${f.hand === "L" ? "left" : "right"} ${f.finger}`;

export interface FingerPickerProps {
  /** Display text of the selected key ("B", "Shift", "Space"). */
  keyName: string;
  /** Finger / home role the key has right now (after overrides). */
  finger: FingerId | null;
  isHome: boolean;
  /** What the parser guessed, for the "automatic" hint. */
  autoFinger: FingerId | null;
  autoHome: boolean;
  /** The key has a manual override. */
  customised: boolean;
  onFinger: (finger: FingerId | null) => void;
  onHome: (home: boolean) => void;
  onReset: () => void;
  /** Escape pressed inside the picker. */
  onClose: () => void;
}

const LEFT = FINGER_ORDER.slice(0, 5);
const RIGHT = FINGER_ORDER.slice(5);

/** Five fingers of one hand as a ruled row of cells: a colour swatch plus the finger's name; the choice is filled solid. */
function HandRow({ label, fingers, current, onPick }: { label: string; fingers: FingerId[]; current: FingerId | null; onPick: (f: FingerId) => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[116px_minmax(0,1fr)]">
      <p className="ll-lettering-sm flex items-center border-b border-hairline px-3 py-2 whitespace-nowrap text-sub sm:border-r sm:border-b-0">{label}</p>
      <div className="grid grid-cols-5">
        {fingers.map((f) => {
          const i = FINGER_ORDER.findIndex((o) => o.hand === f.hand && o.finger === f.finger);
          const on = !!current && current.hand === f.hand && current.finger === f.finger;
          return (
            <button
              key={i}
              type="button"
              data-testid="finger-option"
              data-finger={fingerToString(f)}
              aria-pressed={on}
              aria-label={fingerName(f)}
              title={fingerName(f)}
              tabIndex={on || (!current && i === 3) ? 0 : -1}
              onClick={() => onPick(f)}
              style={on ? { background: `var(--finger-${i})` } : undefined}
              className={cx(
                "relative flex h-16 min-w-0 flex-col items-center justify-center gap-2 border-l border-hairline px-0.5 text-sm leading-none font-medium transition-colors duration-150 first:border-l-0 focus-visible:z-[1] focus-visible:outline-offset-[-3px]",
                on ? "text-finger-fg outline-2 -outline-offset-2 outline-line" : "text-text hover:bg-fill-strong",
              )}
            >
              {on ? (
                <Icon name="check" size={16} strokeWidth={2.25} />
              ) : (
                <span aria-hidden className="size-4 border border-line" style={{ background: `var(--finger-${i})` }} />
              )}
              <span className="max-w-full truncate">{f.finger}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Compact editor for one key: which of the ten fingers presses it, and whether it is a home key. */
export function FingerPicker({ keyName, finger, isHome, autoFinger, autoHome, customised, onFinger, onHome, onReset, onClose }: FingerPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Move focus into the picker when a different key is chosen, so Enter on a key leads straight to the choices.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>('[data-testid="finger-option"][aria-pressed="true"]') ?? el.querySelector<HTMLElement>('[data-testid="finger-option"]');
    target?.focus({ preventScroll: true });
    // On a phone the picker sits below the keyboard: scroll just enough to show it.
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyName]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? 5 : e.key === "ArrowUp" ? -5 : 0;
    if (!delta) return;
    const opts = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-testid="finger-option"]') ?? []);
    const i = opts.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const next = opts[i + delta];
    if (!next) return;
    e.preventDefault();
    opts.forEach((o) => (o.tabIndex = o === next ? 0 : -1));
    next.focus();
  };

  const auto = autoFinger ? `${fingerName(autoFinger)}${autoHome ? ", home key" : ""}` : "no finger";

  return (
    <div
      ref={ref}
      role="group"
      aria-label={`Finger for key ${keyName}`}
      data-testid="finger-picker"
      data-key-name={keyName}
      onKeyDown={onKeyDown}
      className="border border-line"
    >
      <div className="flex items-stretch border-b border-line">
        <div className="min-w-0 flex-1 px-3 py-2.5">
          <p className="ll-lettering flex items-center gap-2 text-text">
            Key
            <KeyChip data-testid="finger-picker-key">{keyName}</KeyChip>
          </p>
          <p className="mt-1.5 text-md leading-snug text-sub" data-testid="finger-picker-state">
            {finger ? `Pressed by the ${fingerName(finger)}${isHome ? ", resting here" : ""}.` : "Pressed by no finger."}
            {customised ? ` Automatic: ${auto}.` : " Automatic."}
          </p>
        </div>
        <IconButton
          icon="x"
          label="Close the finger picker"
          size="sm"
          className="h-auto w-11 self-stretch border-0 border-l border-line text-text hover:bg-text hover:text-bg"
          onClick={onClose}
        />
      </div>

      <div className="divide-y divide-border">
        <HandRow label="Left hand" fingers={LEFT} current={finger} onPick={onFinger} />
        <HandRow label="Right hand" fingers={RIGHT} current={finger} onPick={onFinger} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-t border-line px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Toggle
            size="sm"
            checked={isHome}
            disabled={!finger}
            onChange={onHome}
            label="Home key"
            data-testid="finger-home"
          />
          <Button
            size="sm"
            variant={finger ? "subtle" : "primary"}
            data-testid="finger-none"
            aria-pressed={!finger}
            onClick={() => onFinger(null)}
          >
            No finger
          </Button>
        </div>
        <Button size="sm" variant="ghost" icon="restart" disabled={!customised} data-testid="finger-reset" onClick={onReset}>
          Reset to automatic
        </Button>
      </div>
      <p className="border-t border-hairline px-3 py-2 text-md text-sub">A finger rests on one home key. Choosing a new one moves it.</p>
    </div>
  );
}
