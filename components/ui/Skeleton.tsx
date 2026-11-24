import type { CSSProperties } from "react";
import { cx } from "./cx";

export interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  /** Gentle pulse (off for static "coming soon" silhouettes). */
  animate?: boolean;
}

/** Placeholder block, drawn as section hatching: size it with className (`h-4 w-32`). */
export function Skeleton({ className, style, animate }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cx("ll-hatch bg-fill", animate && "animate-shimmer", className)}
      style={style}
    />
  );
}
