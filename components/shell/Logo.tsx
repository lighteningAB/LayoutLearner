import { cx } from "@/components/ui/cx";

/**
 * The LayoutLearner mark: a key drawn in plan, its diagonal run out past two corners as a
 * construction line, and the point where the finger lands filled in the action colour.
 */
export function Logo({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 30 30"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      fill="none"
      stroke="var(--line)"
      className={cx("shrink-0", className)}
    >
      <rect x="5.5" y="5.5" width="19" height="19" strokeWidth="1.5" />
      <path d="M0.5 29.5 29.5 0.5" strokeWidth="1" />
      <circle cx="15" cy="15" r="3.25" fill="var(--main)" stroke="none" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("ll-trim font-display text-lg leading-none tracking-[0.2em] whitespace-nowrap uppercase", className)}>
      <span className="font-bold text-text">Layout</span>
      <span className="ml-[0.45em] font-light text-sub">Learner</span>
    </span>
  );
}
