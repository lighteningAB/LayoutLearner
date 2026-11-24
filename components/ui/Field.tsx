import type { ReactNode } from "react";
import { cx } from "./cx";

export interface SettingRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** id of the control, makes the label clickable. */
  htmlFor?: string;
  /** id given to the label element, for aria-labelledby on the control. */
  labelId?: string;
  /** The control (Toggle, Select, SegmentedControl…). */
  children: ReactNode;
  /** Put the control under the label instead of beside it. */
  stacked?: boolean;
  className?: string;
  "data-testid"?: string;
}

/** Label + description on the left, control on the right. Wraps on narrow screens. */
export function SettingRow({ label, description, htmlFor, labelId, children, stacked, className, ...rest }: SettingRowProps) {
  return (
    <div
      className={cx(
        "flex gap-x-8 gap-y-3 py-4",
        stacked ? "flex-col" : "flex-wrap items-center justify-between",
        className,
      )}
      {...rest}
    >
      <div className="min-w-0 flex-1 basis-56">
        <label id={labelId} htmlFor={htmlFor} className="block text-[16px] font-medium text-text">
          {label}
        </label>
        {description && <p className="mt-0.5 max-w-[62ch] text-[14px] leading-snug text-sub">{description}</p>}
      </div>
      <div className={cx("flex shrink-0 items-center gap-3", stacked && "w-full")}>{children}</div>
    </div>
  );
}
