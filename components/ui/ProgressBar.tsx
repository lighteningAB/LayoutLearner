import { cx } from "./cx";

export interface ProgressBarProps {
  value: number;
  max?: number;
  size?: "xs" | "sm" | "md";
  tone?: "main" | "success" | "error" | "sub";
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "data-testid"?: string;
}

// Total height (end ticks) and the height of the bar itself.
const H = { xs: "h-2", sm: "h-2.5", md: "h-3.5" };
const BAR = { xs: "h-[3px]", sm: "h-[5px]", md: "h-[7px]" };
const TONE = { main: "bg-main", success: "bg-success", error: "bg-error", sub: "bg-sub" };

/** A drafted scale bar: outlined track between two end ticks, quarter ticks, the measured part filled. */
export function ProgressBar({ value, max = 100, size = "sm", tone = "main", className, ...rest }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(max, Math.max(0, value))}
      data-value={Math.round(pct)}
      className={cx("relative flex w-full items-center border-x border-line", H[size], className)}
      {...rest}
    >
      <div className={cx("relative w-full border-y border-line", BAR[size])}>
        <div
          className={cx("h-full transition-[width] duration-300 ease-out", TONE[tone])}
          style={{ width: `${pct}%` }}
        />
        {size !== "xs" &&
          [25, 50, 75].map((t) => (
            <span key={t} aria-hidden className="absolute inset-y-0 w-px bg-line opacity-60" style={{ left: `${t}%` }} />
          ))}
      </div>
    </div>
  );
}
