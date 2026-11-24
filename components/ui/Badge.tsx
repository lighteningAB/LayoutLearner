import type { HTMLAttributes } from "react";
import { cx, isText } from "./cx";
import { Icon, type IconName } from "./Icon";

export type BadgeTone = "neutral" | "main" | "success" | "error";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: IconName;
}

const TONES: Record<BadgeTone, string> = {
  neutral: "border-border text-sub",
  main: "border-main bg-main text-main-fg",
  success: "border-success text-success",
  error: "border-error text-error",
};

export function Badge({ tone = "neutral", icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={cx(
        "ll-lettering-sm inline-flex h-[22px] items-center gap-1 border px-1.5 whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={12} />}
      {isText(children) ? <span className="ll-trim">{children}</span> : children}
    </span>
  );
}
