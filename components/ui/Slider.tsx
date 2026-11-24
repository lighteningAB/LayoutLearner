"use client";

import type { CSSProperties } from "react";
import { cx } from "./cx";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Text announced for the current value, e.g. `${value}px`. */
  valueText?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "data-testid"?: string;
}

/** Native range input drawn as a dimension line with a marker (arrow keys, Home/End, PageUp/Down work natively). */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, className, valueText, ...rest }: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-valuetext={valueText}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cx("ll-slider w-40", className)}
      style={{ "--ll-pct": `${pct}%` } as CSSProperties}
      {...rest}
    />
  );
}
