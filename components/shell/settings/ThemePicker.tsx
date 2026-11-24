"use client";

import { useRef, type KeyboardEvent } from "react";
import { Icon, cx } from "@/components/ui";
import { THEMES, type ThemeId } from "@/lib/settings";

export interface ThemePickerProps {
  value: ThemeId;
  onChange: (theme: ThemeId) => void;
  className?: string;
}

/** Finger of each key in the miniature's home row (index into --finger-N), and which one is "next". */
const MINI_KEYS = [0, 1, 2, 3, 3, 6, 6, 7, 8, 9];
const MINI_NEXT = 3;

/**
 * The two sheets, each drawn as a real miniature of itself: frame, grid, a line of typing text, a
 * row of keys in its finger colours with the next key filled, its action colour. Each button
 * scopes its own tokens with data-theme, so it previews itself whatever the page is showing.
 */
export function ThemePicker({ value, onChange, className }: ThemePickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = THEMES.findIndex((t) => t.id === value);
    const next = THEMES[(i + dir + THEMES.length) % THEMES.length];
    onChange(next.id);
    ref.current?.querySelector<HTMLElement>(`[data-theme="${next.id}"]`)?.focus();
  };
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={onKeyDown}
      data-testid="theme-picker"
      className={cx("grid w-full grid-cols-1 gap-4 sm:grid-cols-2", className)}
    >
      {THEMES.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${t.name}: ${t.description}`}
            tabIndex={selected ? 0 : -1}
            data-theme={t.id}
            data-testid={`theme-${t.id}`}
            data-state={selected ? "on" : "off"}
            onClick={() => onChange(t.id)}
            className={cx(
              "group flex flex-col border bg-bg text-left text-text outline-offset-2 transition-[border-color] duration-150",
              selected ? "border-line outline-2 outline-main" : "border-border hover:border-line",
            )}
          >
            {/* the miniature sheet */}
            <span aria-hidden className="ll-grid relative block px-4 pt-4 pb-5 sm:px-5">
              <span className="pointer-events-none absolute inset-1.5 border border-hairline" />
              <span className="relative flex items-center justify-between gap-3">
                <span className="flex items-baseline gap-1.5 font-display text-2xs leading-none tracking-[0.18em] uppercase">
                  <span className="font-semibold">Layout</span>
                  <span className="font-light text-sub">Learner</span>
                </span>
                <span className="h-px flex-1 bg-border" />
                <span className="ll-numeral text-xl">0:30</span>
              </span>
              <span className="relative mt-3.5 block font-mono text-md leading-none whitespace-nowrap">
                <span>home r</span>
                <span className="mx-px inline-block h-[1.15em] w-[2px] bg-caret align-[-0.2em]" />
                <span className="text-sub">ow </span>
                <span className="text-error underline decoration-1 underline-offset-2">k</span>
                <span className="text-sub">eys first</span>
              </span>
              <span className="relative mt-4 flex gap-1">
                {MINI_KEYS.map((f, i) => (
                  <span
                    key={i}
                    className={cx(
                      "flex h-6 min-w-0 flex-1 items-center justify-center border border-key-border font-mono text-2xs leading-none text-finger-fg",
                      i === MINI_NEXT && "outline-2 outline-offset-1 outline-main",
                    )}
                    style={{
                      background: i === MINI_NEXT ? `var(--finger-${f})` : `color-mix(in srgb, var(--finger-${f}) var(--finger-tint), var(--key-tint-base))`,
                    }}
                  >
                    {i === MINI_NEXT ? "f" : ""}
                  </span>
                ))}
              </span>
              <span className="relative mt-4 flex items-center gap-2">
                <span className="ll-lettering-sm inline-flex h-6 items-center border border-line bg-main px-2 text-main-fg">Start</span>
                <span className="ll-lettering-sm inline-flex h-6 items-center border border-line px-2">Layouts</span>
              </span>
            </span>
            {/* its title block */}
            <span className="flex min-h-11 items-center justify-between gap-3 border-t border-line px-4 py-2 sm:px-5">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                <span className="ll-lettering-lg">{t.name}</span>
                <span className="ll-note text-sub">{t.scheme} sheet</span>
              </span>
              {selected ? (
                <span className="ll-lettering-sm inline-flex h-[22px] shrink-0 items-center gap-1 border border-main bg-main px-1.5 text-main-fg">
                  <Icon name="check" size={12} strokeWidth={2.5} />
                  <span className="ll-trim">Current</span>
                </span>
              ) : (
                <span className="ll-lettering-sm shrink-0 text-sub underline-offset-4 group-hover:text-text group-hover:underline">Use</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
