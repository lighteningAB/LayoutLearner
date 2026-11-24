"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cx } from "./cx";

export interface TooltipProps {
  content: ReactNode;
  side?: "top" | "bottom";
  align?: "center" | "start" | "end";
  /** A single focusable element (button, link…). */
  children: ReactElement;
  className?: string;
}

/** Hover/focus annotation box. Pure CSS show/hide; wires aria-describedby onto the child. */
export function Tooltip({ content, side = "top", align = "center", children, className }: TooltipProps) {
  const id = useId();
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { "aria-describedby": id, title: undefined })
    : children;
  return (
    <span className={cx("group/tt relative inline-flex", className)}>
      {child}
      <span
        id={id}
        role="tooltip"
        className={cx(
          "pointer-events-none absolute z-50 border border-line bg-text px-2 py-1 text-[13px] leading-tight font-medium whitespace-nowrap text-bg",
          "opacity-0 transition-opacity duration-100 group-focus-within/tt:opacity-100 group-hover/tt:opacity-100 group-hover/tt:delay-300",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          align === "center" ? "left-1/2 -translate-x-1/2" : align === "start" ? "left-0" : "right-0",
        )}
      >
        {content}
      </span>
    </span>
  );
}
