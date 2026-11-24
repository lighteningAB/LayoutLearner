"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx, isText } from "./cx";
import { Icon, type IconName } from "./Icon";

export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
  /** Optional panel content; when any item has content the active panel is rendered below the tab list. */
  content?: ReactNode;
}

export interface TabsProps<T extends string = string> {
  items: readonly TabItem<NoInfer<T>>[];
  value: T;
  onChange: (value: NoInfer<T>) => void;
  className?: string;
  panelClassName?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}

/** Lettered tab list on a rule (role="tablist") with roving tabindex; Left/Right/Home/End move and activate. */
export function Tabs<T extends string = string>({ items, value, onChange, className, panelClassName, ...rest }: TabsProps<T>) {
  const uid = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const enabled = items.filter((t) => !t.disabled);
  const active = items.find((t) => t.value === value);
  const hasPanels = items.some((t) => t.content !== undefined);

  const onKeyDown = (e: KeyboardEvent) => {
    const i = enabled.findIndex((t) => t.value === value);
    let next: TabItem<T> | undefined;
    if (e.key === "ArrowRight") next = enabled[(i + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(i - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    listRef.current?.querySelector<HTMLElement>(`[data-value="${String(next.value)}"]`)?.focus();
  };

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-border"
        {...rest}
      >
        {items.map((t) => {
          const selected = t.value === value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              id={`${uid}-tab-${t.value}`}
              aria-selected={selected}
              aria-controls={hasPanels ? `${uid}-panel-${t.value}` : undefined}
              data-value={t.value}
              data-state={selected ? "active" : "inactive"}
              tabIndex={selected ? 0 : -1}
              disabled={t.disabled}
              onClick={() => onChange(t.value)}
              className={cx(
                "ll-lettering relative -mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 whitespace-nowrap",
                "transition-colors duration-150 disabled:cursor-not-allowed disabled:line-through disabled:decoration-1",
                "focus-visible:outline-offset-[-2px]",
                selected ? "border-main text-text" : "border-transparent text-sub hover:border-border hover:text-text",
              )}
            >
              {t.icon && <Icon name={t.icon} size={16} />}
              {isText(t.label) ? <span className="ll-trim">{t.label}</span> : t.label}
            </button>
          );
        })}
      </div>
      {hasPanels && active && (
        <div
          role="tabpanel"
          id={`${uid}-panel-${active.value}`}
          aria-labelledby={`${uid}-tab-${active.value}`}
          tabIndex={0}
          className={cx("pt-5", panelClassName)}
        >
          {active.content}
        </div>
      )}
    </div>
  );
}
