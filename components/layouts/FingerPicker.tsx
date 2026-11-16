"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button, Icon, Toggle, cx } from "@/components/ui";
import { fingerToString } from "@/lib/layout/overrides";
import { FINGER_ORDER, type FingerId } from "@/lib/types";

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

function HandRow({ label, fingers, current, onPick }: { label: string; fingers: FingerId[]; current: FingerId | null; onPick: (f: FingerId) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium tracking-wide text-sub uppercase">{label}</p>
      <div className="grid grid-cols-5 gap-1.5">
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
              style={{
                borderColor: on ? `var(--finger-${i})` : undefined,
                background: `color-mix(in srgb, var(--finger-${i}) ${on ? 38 : 14}%, var(--bg-alt, transparent))`,
              }}
              className={cx(
                "relative flex h-[52px] min-w-0 flex-col items-center justify-end gap-0.5 overflow-hidden rounded-ui-sm border px-0.5 pb-1.5 text-[11px] leading-none font-medium text-text transition-colors",
                on ? "border-2" : "border-border hover:border-sub",
              )}
            >
              {on && <Icon name="check" size={13} className="absolute top-1.5" />}
              <span className="max-w-full truncate">{f.finger}</span>
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: `var(--finger-${i})` }} />
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
      className="rounded-ui-lg border border-border bg-bg-alt p-3.5 sm:p-4"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text">
            Key{" "}
            <span className="ml-0.5 inline-flex min-w-6 items-center justify-center rounded-ui-sm bg-text/[0.09] px-1.5 py-0.5 font-mono text-xs text-main" data-testid="finger-picker-key">
              {keyName}
            </span>
          </p>
          <p className="mt-1 text-xs text-sub" data-testid="finger-picker-state">
            {finger ? `Pressed by the ${fingerName(finger)}${isHome ? ", resting here" : ""}.` : "Pressed by no finger."}
            {customised ? ` Automatic: ${auto}.` : " Automatic."}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the finger picker"
          className="-mt-1 -mr-1 shrink-0 rounded-ui-sm p-1.5 text-sub transition-colors hover:text-text"
        >
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <HandRow label="Left hand" fingers={LEFT} current={finger} onPick={onFinger} />
        <HandRow label="Right hand" fingers={RIGHT} current={finger} onPick={onFinger} />
      </div>

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-t border-border pt-3.5">
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
      <p className="mt-2 text-xs text-sub">A finger rests on one home key. Choosing a new one moves it.</p>
    </div>
  );
}
