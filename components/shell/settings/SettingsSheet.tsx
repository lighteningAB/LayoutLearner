// The settings page as a specification sheet: each section is a lettered heading in the margin
// with its rows ruled into a table (label and note left, control right).
import type { ReactNode } from "react";
import { cx } from "@/components/ui";

export interface SheetSectionProps {
  /** DOM id of the section (anchor target), when it needs one. */
  anchor?: string;
  /** id of the heading element. */
  headingId: string;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  "data-testid"?: string;
}

export function SheetSection({ anchor, headingId, title, description, children, ...rest }: SheetSectionProps) {
  return (
    <section
      id={anchor}
      aria-labelledby={headingId}
      className="grid scroll-mt-6 gap-x-10 gap-y-5 border-t border-line pt-5 pb-12 md:grid-cols-[220px_minmax(0,1fr)] md:pb-14"
      {...rest}
    >
      <div>
        <h2 id={headingId} className="ll-heading text-text">
          {title}
        </h2>
        <p className="mt-2.5 max-w-[46ch] text-[15px] leading-snug text-sub">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** A ruled table of setting rows. */
export function SheetRows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("divide-y divide-hairline border border-border px-4 sm:px-5", className)}>{children}</div>;
}

/** Lettered tag for an action that deletes something for good. */
export function DestructiveTag({ children = "Cannot be undone" }: { children?: ReactNode }) {
  return <span className="ll-lettering-sm ml-2.5 inline-flex h-[20px] items-center border border-error px-1.5 align-[2px] text-error">{children}</span>;
}
