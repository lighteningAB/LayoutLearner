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

/** Accessible on/off switch (role="switch"). Space/Enter toggle. */
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
        "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-40",
        sm ? "h-5 w-8" : "h-6 w-10",
        checked ? "bg-main" : "bg-text/[0.16] hover:bg-text/[0.24]",
        !label && className,
      )}
      {...aria}
    >
      <span
        aria-hidden
        className={cx(
          "absolute left-[3px] rounded-full transition-transform duration-150 ease-out",
          sm ? "size-3.5" : "size-[18px]",
          checked ? "bg-main-fg" : "bg-text",
          checked && (sm ? "translate-x-3" : "translate-x-4"),
        )}
      />
    </button>
  );
  if (!label) return control;
  return (
    <label className={cx("inline-flex items-center gap-3 text-sm text-text", disabled && "opacity-60", className)}>
      {control}
      <span>{label}</span>
    </label>
  );
}

export const Switch = Toggle;
