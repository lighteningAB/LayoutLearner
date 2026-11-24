"use client";

import { useRef, type KeyboardEvent } from "react";
import { Icon, cx } from "@/components/ui";
import { THEMES, type ThemeId } from "@/lib/settings";

export interface ThemePickerProps {
  value: ThemeId;
  onChange: (theme: ThemeId) => void;
  className?: string;
}

/** Grid of theme swatches. Each swatch scopes its own tokens with data-theme, so it previews itself. */
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
      className={cx("grid w-full grid-cols-2 gap-3", className)}
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
              "border bg-bg p-3.5 text-left outline-offset-2 transition-[border-color] duration-150",
              selected ? "border-line outline-2 outline-main" : "border-border hover:border-line",
            )}
          >
            <div className="font-mono text-[13px] leading-none whitespace-nowrap">
              <span className="text-text">home r</span>
              <span className="mx-px inline-block h-[1.15em] w-[2px] bg-caret align-[-0.2em]" />
              <span className="text-sub">ow </span>
              <span className="text-error">k</span>
              <span className="text-sub">eys</span>
            </div>
            <div className="mt-3.5 flex gap-[3px]">
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i} className="h-2.5 flex-1 border border-line" style={{ backgroundColor: `var(--finger-${i})` }} />
              ))}
            </div>
            <div className="mt-3.5 flex items-center justify-between gap-2">
              <span className="ll-lettering text-text">{t.name}</span>
              {selected ? (
                <span className="inline-flex size-[18px] items-center justify-center bg-main text-main-fg">
                  <Icon name="check" size={12} strokeWidth={2.5} />
                </span>
              ) : (
                <span className="ll-note text-sub">{t.scheme}</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
