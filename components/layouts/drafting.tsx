// Drafting-sheet atoms shared by the Layouts surfaces: ruled panes with a lettered heading
// strip, note blocks for validation messages, and small key / finger chips.
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Icon, cx, type IconName } from "@/components/ui";

export interface PaneProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Lettered heading of the region. */
  title: ReactNode;
  /** Quiet readout on the heading strip (counts, dimensions). */
  meta?: ReactNode;
  /** Controls on the right of the heading strip. */
  tools?: ReactNode;
  as?: "section" | "div";
  /** Heading element of the title (default h3). */
  heading?: "h2" | "h3" | "div";
  bodyClassName?: string;
  children?: ReactNode;
}

/** A ruled region of the sheet: a lettered heading strip, ruled off from its body. */
export function Pane({ title, meta, tools, as = "section", heading = "h3", className, bodyClassName, children, ...rest }: PaneProps) {
  const Tag = as as "section";
  const H = heading as "h3";
  return (
    <Tag className={cx("flex min-w-0 flex-col", className)} {...rest}>
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1 sm:px-4">
        <H className="ll-lettering text-text">{title}</H>
        {meta && <span className="ll-note text-sub">{meta}</span>}
        {tools && <div className="ml-auto flex flex-wrap items-center">{tools}</div>}
      </div>
      <div className={cx("min-w-0 flex-1", bodyClassName)}>{children}</div>
    </Tag>
  );
}

const NOTE_TONE = {
  error: { box: "border-error", icon: "alert" as IconName, ink: "text-error" },
  warn: { box: "border-border", icon: "info" as IconName, ink: "text-main" },
  ok: { box: "border-border", icon: "check" as IconName, ink: "text-success" },
  info: { box: "border-dashed border-border", icon: "info" as IconName, ink: "text-sub" },
};

export interface NoteProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: keyof typeof NOTE_TONE;
  icon?: IconName;
  /** Lettered first line: what the note is about ("Line 3, column 5"). */
  title?: ReactNode;
  children?: ReactNode;
}

/** A drafted note: full hairline box (dashed for plain guidance), an icon, an optional lettered lead. */
export function Note({ tone = "info", icon, title, className, children, ...rest }: NoteProps) {
  const t = NOTE_TONE[tone];
  return (
    <div className={cx("flex items-start gap-3 border px-3.5 py-3", t.box, className)} {...rest}>
      <Icon name={icon ?? t.icon} size={17} className={cx("mt-0.5 shrink-0", t.ink)} />
      <div className="min-w-0 flex-1">
        {title && <p className={cx("ll-lettering-sm mb-1", t.ink)}>{title}</p>}
        <div className="text-md leading-snug break-words text-text">{children}</div>
      </div>
    </div>
  );
}

/** A key drawn as a small outlined cell, for naming a key inside running text. */
export function KeyChip({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cx(
        "inline-flex h-6 min-w-6 items-center justify-center border border-key-border bg-key-bg px-1.5 align-middle font-mono text-xs leading-none font-medium text-key-text",
        className,
      )}
      {...rest}
    />
  );
}

/** Solid swatch of one finger colour; always paired with the finger's name by the caller. */
export function FingerSwatch({ index, className, style }: { index: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block size-3 shrink-0 border border-line", className)}
      style={{ background: `var(--finger-${index})`, ...style }}
    />
  );
}
