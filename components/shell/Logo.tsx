import { cx } from "@/components/ui/cx";

/** The LayoutLearner mark: a keycap carrying two L strokes. Follows the theme accent. */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden focusable="false" className={className}>
      <rect x="1" y="1" width="26" height="26" rx="7.5" fill="var(--main)" />
      <g fill="none" stroke="var(--main-fg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.75 8.25v11.5h3.75" />
        <path d="M15.75 8.25v11.5h3.75" opacity="0.5" />
      </g>
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("text-[17px] leading-none font-semibold tracking-tight", className)}>
      <span className="text-text">layout</span>
      <span className="text-sub">learner</span>
    </span>
  );
}
