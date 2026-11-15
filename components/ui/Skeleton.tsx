import type { CSSProperties } from "react";
import { cx } from "./cx";

export interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  /** Gentle pulse (off for static "coming soon" silhouettes). */
  animate?: boolean;
}

/** Placeholder block: size it with className (`h-4 w-32`). */
export function Skeleton({ className, style, animate }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cx("rounded-ui-sm bg-text/[0.07]", animate && "animate-shimmer", className)}
      style={style}
    />
  );
}
