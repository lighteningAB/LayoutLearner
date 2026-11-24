import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /**
   * Short qualifier of the title (the active layout, a section id). Drawn on the title's own
   * line as a trailing annotation, never as a label above the heading.
   */
  eyebrow?: ReactNode;
  /** Right-aligned controls. */
  actions?: ReactNode;
  className?: string;
}

/** The sheet's heading line: lettered title, its qualifier, a rule run out to the actions. */
export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <div className={cx("mb-8 sm:mb-10", className)}>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <h1 className="ll-title min-w-0 text-text">{title}</h1>
        {eyebrow && <div className="ll-lettering min-w-0 pb-1.5 text-sub sm:pb-2.5">{eyebrow}</div>}
        <span aria-hidden className="mb-2 hidden h-px min-w-8 flex-1 bg-border sm:mb-3 sm:block" />
        {actions && <div className="flex items-center gap-2 max-sm:w-full">{actions}</div>}
      </div>
      {description && <p className="mt-4 max-w-[62ch] text-[17px] leading-[1.45] text-sub">{description}</p>}
    </div>
  );
}
