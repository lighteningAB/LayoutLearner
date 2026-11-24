import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  size?: "sm" | "md";
}

/** Key hint drawn as an outlined key cell: <Kbd>esc</Kbd> */
export function Kbd({ size = "md", className, ...rest }: KbdProps) {
  return (
    <kbd
      className={cx(
        "inline-flex items-center justify-center border border-key-border bg-key-bg font-mono leading-none font-medium text-key-text",
        size === "sm" ? "h-[20px] min-w-[20px] px-1 text-2xs" : "h-[24px] min-w-[24px] px-1.5 text-xs",
        className,
      )}
      {...rest}
    />
  );
}
