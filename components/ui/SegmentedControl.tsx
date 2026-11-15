"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string | number> {
  value: T;
  onChange: (value: NoInfer<T>) => void;
  options: readonly (SegmentOption<NoInfer<T>> | NoInfer<T>)[];
  /** "pill": options sit in a tinted track. "inline": bare text row, accent marks the choice. */
  variant?: "pill" | "inline";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "data-testid"?: string;
}

/** Single-choice option row (role="radiogroup"). Arrow keys move and select, Home/End jump. */
export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  variant = "pill",
  size = "md",
  disabled,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const opts = options.map((o) =>
    typeof o === "object" ? (o as SegmentOption<T>) : ({ value: o, label: String(o) } as SegmentOption<T>),
  );
  const enabled = opts.filter((o) => !o.disabled);
  const hasSelection = opts.some((o) => o.value === value);

  const onKeyDown = (e: KeyboardEvent) => {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    let next: SegmentOption<T> | undefined;
    if (dir) {
      const i = enabled.findIndex((o) => o.value === value);
      next = enabled[(i + dir + enabled.length) % enabled.length];
    } else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    const idx = opts.indexOf(next);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[idx]?.focus();
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      data-variant={variant}
      className={cx(
        "inline-flex max-w-full flex-wrap items-center",
        variant === "pill" ? "gap-0.5 rounded-ui bg-text/[0.06] p-1" : "gap-x-1 gap-y-0.5",
        disabled && "pointer-events-none opacity-40",
        className,
      )}
      {...rest}
    >
      {opts.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            data-state={selected ? "on" : "off"}
            data-value={String(o.value)}
            disabled={disabled || o.disabled}
            tabIndex={selected || (!hasSelection && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-colors duration-150",
              "disabled:cursor-not-allowed disabled:opacity-40",
              size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-8 px-3 text-sm",
              variant === "pill"
                ? cx(
                    "rounded-ui-sm",
                    selected ? "bg-bg text-main shadow-[0_1px_2px_rgb(0_0_0/0.18)]" : "text-sub hover:text-text",
                  )
                : cx("rounded-ui-sm", selected ? "text-main" : "text-sub hover:text-text"),
            )}
          >
            {o.icon && <Icon name={o.icon} size={size === "sm" ? 14 : 15} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
