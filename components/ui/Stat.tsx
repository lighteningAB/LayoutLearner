import type { ReactNode } from "react";
import { cx } from "./cx";

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** Small suffix next to the value ("wpm", "%"). */
  unit?: ReactNode;
  /** Quiet line under the value ("best 92", "+4 vs last week"). */
  hint?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Colour of the number. */
  tone?: "main" | "text" | "sub" | "error" | "success";
  align?: "start" | "center" | "end";
  className?: string;
  "data-testid"?: string;
}

const VALUE = { sm: "text-2xl", md: "text-4xl", lg: "text-5xl" };
const TONE = { main: "text-main", text: "text-text", sub: "text-sub", error: "text-error", success: "text-success" };
const ALIGN = { start: "items-start text-left", center: "items-center text-center", end: "items-end text-right" };

/** Big number + label. */
export function Stat({ label, value, unit, hint, size = "md", tone = "main", align = "start", className, ...rest }: StatProps) {
  return (
    <div className={cx("flex flex-col", ALIGN[align], className)} {...rest}>
      <div className={cx("text-sub", size === "sm" ? "ll-lettering-sm" : "ll-lettering")}>{label}</div>
      <div className={cx("ll-readout flex items-baseline leading-none font-medium", size === "lg" ? "mt-3" : "mt-2", VALUE[size], TONE[tone])}>
        {value}
        {unit && <span className={cx("ml-1 font-normal text-sub", size === "lg" ? "text-xl" : size === "md" ? "text-base" : "text-sm")}>{unit}</span>}
      </div>
      {hint && <div className="ll-note mt-2 text-sub">{hint}</div>}
    </div>
  );
}
