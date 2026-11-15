import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  size?: "sm" | "md";
}

/** Keycap-styled key hint: <Kbd>esc</Kbd> */
export function Kbd({ size = "md", className, ...rest }: KbdProps) {
  return (
    <kbd
      className={cx(
        "inline-flex items-center justify-center rounded-[5px] border border-b-2 border-key-border bg-key-bg font-mono font-medium text-key-text",
        size === "sm" ? "h-[18px] min-w-[18px] px-1 text-[10px]" : "h-[22px] min-w-[22px] px-1.5 text-[11px]",
        className,
      )}
      {...rest}
    />
  );
}
