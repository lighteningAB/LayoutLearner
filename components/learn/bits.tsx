"use client";
// Small shared pieces of the Learn area: stars, key cells, circled detail numbers.
import type { CSSProperties, ReactNode } from "react";
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
      strokeWidth={size >= 32 ? 1 : filled ? 1.2 : 1.5}
      strokeLinejoin="miter"
      aria-hidden
      focusable="false"
      className={cx("shrink-0", className)}
      style={style}
    >
      <path d={STAR} />
    </svg>
  );
}

export interface StarsProps {
  value: number;
  size?: number;
  /** Draw the earned stars in one after another. */
  animate?: boolean;
  className?: string;
  "data-testid"?: string;
}

/** Three stars, `value` of them filled; the rest stay as outlines. */
export function Stars({ value, size = 14, animate, className, ...rest }: StarsProps) {
  return (
    <span
      className={cx("inline-flex items-center", size >= 32 ? "gap-3" : "gap-0.5", className)}
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
            className={cx(on ? "text-main" : "text-border", animate && on && "learn-star-in")}
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
  sm: "h-[22px] min-w-[22px] px-1 text-[12px]",
  md: "h-7 min-w-7 px-1.5 text-sm",
  lg: "h-10 min-w-10 px-2 text-lg",
  xl: "h-[120px] min-w-[120px] px-4 text-[60px]",
};

/** Solid fill of finger `index` with its legend colour, or nothing when the finger is unknown / colours are off. */
export function fingerFill(index: number, on = true): CSSProperties | undefined {
  return on && index >= 0 ? { backgroundColor: `var(--finger-${index})`, color: "var(--finger-fg)" } : undefined;
}

/** An outlined key cell for one character, filled with the colour of the finger that types it. */
export function KeyChip({ char, layout, fingerColors = true, size = "sm", muted, className }: KeyChipProps) {
  const g = guideForChar(layout, char);
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center border border-line bg-key-bg font-mono leading-none font-medium text-key-text",
        CHIP[size],
        muted && "border-dashed",
        className,
      )}
      style={fingerFill(g?.fingerIndex ?? -1, fingerColors)}
      data-char={char}
    >
      {charLabel(char)}
    </span>
  );
}

/** Up to `max` key cells, then "+n". */
export function KeyChips({ chars, layout, fingerColors, max = 6, size = "sm", muted, className }: { chars: string[]; max?: number; className?: string } & Omit<KeyChipProps, "char" | "className">) {
  const shown = chars.length > max ? chars.slice(0, max - 1) : chars;
  const rest = chars.length - shown.length;
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1", className)}>
      {shown.map((c) => (
        <KeyChip key={c} char={c} layout={layout} fingerColors={fingerColors} size={size} muted={muted} />
      ))}
      {rest > 0 && <span className="ll-readout pl-0.5 text-[12px] text-sub">+{rest}</span>}
    </span>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export interface DetailNumberProps {
  n: number;
  /** "line": drawn (done / plain), "main": the action colour, "quiet": not reached yet. */
  tone?: "line" | "main" | "quiet";
  dashed?: boolean;
  size?: "md" | "lg";
  className?: string;
}

/** The circled detail number of a drawing: here, the lesson's number in the course. */
export function DetailNumber({ n, tone = "line", dashed, size = "md", className }: DetailNumberProps) {
  return (
    <span
      aria-hidden
      className={cx(
        "ll-readout inline-flex shrink-0 items-center justify-center rounded-full border leading-none font-medium",
        size === "lg" ? "size-11 text-[15px]" : "size-9 text-[13px]",
        tone === "main" ? "border-main text-main" : tone === "quiet" ? "border-border text-sub" : "border-line text-text",
        dashed && "border-dashed",
        className,
      )}
    >
      {pad2(n)}
    </span>
  );
}

/** One cell of a ruled readout table: lettered head over a mono value. */
export function ReadoutCell({ label, children, className, ...rest }: { label: ReactNode; children: ReactNode; className?: string; "data-testid"?: string }) {
  return (
    <div className={cx("min-w-0 px-2.5 py-2.5", className)}>
      <dt className="ll-lettering-sm text-sub">{label}</dt>
      <dd className="ll-readout mt-1.5 text-[14px] leading-tight whitespace-nowrap text-text" {...rest}>
        {children}
      </dd>
    </div>
  );
}
