"use client";
// Small shared pieces of the Learn area: stars, lock, mini keycaps.
import type { CSSProperties } from "react";
import { cx } from "@/components/ui";
import { guideForChar } from "@/components/typing/KeyboardGuide";
import type { ParsedLayout } from "@/lib/types";

const STAR = "m12 3.2 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.100l-5.400 2.900 1.100-6.100-4.500-4.300 6.100-.8L12 3.200z";

export function StarIcon({ filled, size = 16, className, style }: { filled?: boolean; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 1.2 : 1.6}
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={cx("shrink-0", className)}
      style={style}
    >
      <path d={STAR} />
    </svg>
  );
}

export function LockIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={cx("shrink-0", className)}
    >
      <rect x="5" y="10.500" width="14" height="9.500" rx="2" />
      <path d="M8 10.500V8a4 4 0 0 1 8 0v2.500" />
    </svg>
  );
}

export interface StarsProps {
  value: number;
  size?: number;
  /** Pop the earned stars in one after another. */
  animate?: boolean;
  className?: string;
  "data-testid"?: string;
}

/** Three stars, `value` of them filled. */
export function Stars({ value, size = 14, animate, className, ...rest }: StarsProps) {
  return (
    <span
      className={cx("inline-flex items-center", size >= 32 ? "gap-2" : "gap-0.5", className)}
      role="img"
      aria-label={`${value} of 3 stars`}
      data-stars={value}
      {...rest}
    >
      {[0, 1, 2].map((i) => {
        const on = i < value;
        return (
          <StarIcon
            key={i}
            size={size}
            filled={on}
            className={cx(on ? "text-main" : "text-sub/40", animate && on && "learn-star-pop")}
            style={animate && on ? ({ "--i": i } as CSSProperties) : undefined}
          />
        );
      })}
    </span>
  );
}

export const charLabel = (c: string) => (c === " " ? "space" : c.length === 1 && c.toLowerCase() !== c.toUpperCase() ? c.toUpperCase() : c);

export interface KeyChipProps {
  char: string;
  layout: ParsedLayout;
  fingerColors?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  muted?: boolean;
  className?: string;
}

const CHIP = {
  sm: "size-[22px] rounded-[5px] border-b-2 text-[11px]",
  md: "size-7 rounded-[6px] border-b-[3px] text-sm",
  lg: "size-10 rounded-[8px] border-b-4 text-lg",
  xl: "size-[72px] rounded-[14px] border-b-[6px] text-[34px]",
};

/** A keycap for one character, underlined in the colour of the finger that types it. */
export function KeyChip({ char, layout, fingerColors = true, size = "sm", muted, className }: KeyChipProps) {
  const g = guideForChar(layout, char);
  const fc = fingerColors && g && g.fingerIndex >= 0 ? `var(--finger-${g.fingerIndex})` : undefined;
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center border border-key-border bg-key-bg font-mono leading-none font-medium text-key-text",
        CHIP[size],
        muted && "opacity-45",
        className,
      )}
      style={fc ? { borderBottomColor: fc } : undefined}
      data-char={char}
    >
      {charLabel(char)}
    </span>
  );
}

/** Up to `max` keycaps, then "+n". */
export function KeyChips({ chars, layout, fingerColors, max = 6, size = "sm", muted, className }: { chars: string[]; max?: number; className?: string } & Omit<KeyChipProps, "char" | "className">) {
  const shown = chars.length > max ? chars.slice(0, max - 1) : chars;
  const rest = chars.length - shown.length;
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1", className)}>
      {shown.map((c) => (
        <KeyChip key={c} char={c} layout={layout} fingerColors={fingerColors} size={size} muted={muted} />
      ))}
      {rest > 0 && <span className={cx("pl-0.5 font-mono text-[11px] text-sub", muted && "opacity-60")}>+{rest}</span>}
    </span>
  );
}
