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

const H = { xs: "h-0.5", sm: "h-1", md: "h-2" };
const TONE = { main: "bg-main", success: "bg-success", error: "bg-error", sub: "bg-sub" };

export function ProgressBar({ value, max = 100, size = "sm", tone = "main", className, ...rest }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(max, Math.max(0, value))}
      data-value={Math.round(pct)}
      className={cx("w-full overflow-hidden rounded-full bg-text/[0.1]", H[size], className)}
      {...rest}
    >
      <div
        className={cx("h-full rounded-full transition-[width] duration-300 ease-out", TONE[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
