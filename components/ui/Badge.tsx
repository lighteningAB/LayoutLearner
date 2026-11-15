import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export type BadgeTone = "neutral" | "main" | "success" | "error";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: IconName;
}

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-text/[0.08] text-sub",
  main: "bg-main/[0.14] text-main",
  success: "bg-success/[0.14] text-success",
  error: "bg-error/[0.14] text-error",
};

export function Badge({ tone = "neutral", icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={cx(
        "inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}
