import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Small line above the title. */
  eyebrow?: ReactNode;
  /** Right-aligned controls. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <div className={cx("mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 sm:mb-10", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 font-mono text-xs text-main">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-text sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-xl text-[15px] text-sub">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
