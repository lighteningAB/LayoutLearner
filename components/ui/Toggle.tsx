"use client";

import type { ReactNode } from "react";
import { cx } from "./cx";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label rendered next to the switch (optional; otherwise pass aria-label / aria-labelledby). */
  label?: ReactNode;
  disabled?: boolean;
  size?: "sm" | "md";
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
}

/** Accessible on/off switch (role="switch"), drawn square: an outlined slot with a block that slides. Space/Enter toggle. */
export function Toggle({ checked, onChange, label, disabled, size = "md", id, className, ...aria }: ToggleProps) {
  const sm = size === "sm";
  const control = (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      data-state={checked ? "on" : "off"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "group/tg relative inline-flex shrink-0 items-center border transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:border-dashed disabled:border-border disabled:bg-transparent",
        sm ? "h-5 w-9" : "h-6 w-11",
        checked ? "border-line bg-main" : "border-line bg-transparent hover:bg-fill-strong",
        !label && className,
      )}
      {...aria}
    >
      <span
        aria-hidden
        className={cx(
          "absolute left-[2px] transition-transform duration-200 ease-out group-disabled/tg:bg-border",
          sm ? "size-3.5" : "size-[18px]",
          checked ? "bg-main-fg" : "bg-text",
          checked && (sm ? "translate-x-4" : "translate-x-5"),
        )}
      />
    </button>
  );
  if (!label) return control;
  return (
    <label className={cx("inline-flex items-center gap-3 text-[15px] text-text", disabled && "text-sub", className)}>
      {control}
      <span>{label}</span>
    </label>
  );
}

export const Switch = Toggle;
