import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** "solid": a ruled box, line-weight outline over a filled plate. "outline": hairline box, no fill. */
  variant?: "solid" | "outline";
  padding?: "none" | "sm" | "md" | "lg";
  as?: "div" | "section" | "article" | "aside" | "li";
  children?: ReactNode;
}

const PAD = { none: "", sm: "p-3", md: "p-5", lg: "p-6 sm:p-8" };

export function Card({ variant = "solid", padding = "md", as = "div", className, ...rest }: CardProps) {
  const Tag = as as "div";
  return (
    <Tag
      data-variant={variant}
      className={cx(
        "rounded-ui border",
        variant === "solid" ? "border-line bg-bg-alt" : "border-border",
        PAD[padding],
        className,
      )}
      {...rest}
    />
  );
}

/** Alias of Card. */
export const Panel = Card;

export function CardTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cx("ll-lettering-lg text-text", className)} {...rest} />;
}

export function CardDescription({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx("mt-1.5 text-base leading-snug text-sub", className)} {...rest} />;
}
