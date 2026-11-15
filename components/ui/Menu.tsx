"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";
import { useOutsidePointer } from "./hooks";

export interface MenuItem {
  id?: string;
  label: string;
  icon?: IconName;
  hint?: ReactNode;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a divider above this item. */
  separator?: boolean;
}

export interface MenuProps {
  /** Receives props to spread on your trigger button. */
  trigger: (props: {
    ref: (el: HTMLElement | null) => void;
    onClick: () => void;
    onKeyDown: (e: KeyboardEvent) => void;
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    "aria-controls": string;
  }) => ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  /** Open above the trigger instead of below. */
  side?: "bottom" | "top";
  className?: string;
  "aria-label"?: string;
}

/** Action menu (role="menu"). Arrows/Home/End move, Enter activates, Esc closes and refocuses the trigger. */
export function Menu({ trigger, items, align = "start", side = "bottom", className, ...rest }: MenuProps) {
  const uid = useId();
  const menuId = `${uid}-menu`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);

  useOutsidePointer([rootRef], open, () => setOpen(false));

  const itemEls = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);

  useEffect(() => {
    if (!open) return;
    const els = itemEls();
    (focusLast.current ? els[els.length - 1] : els[0])?.focus({ preventScroll: true });
    focusLast.current = false;
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  };

  const onMenuKeyDown = (e: KeyboardEvent) => {
    const els = itemEls();
    const i = els.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        els[(i + 1) % els.length]?.focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        els[(i - 1 + els.length) % els.length]?.focus();
        break;
      case "Home":
        e.preventDefault();
        els[0]?.focus();
        break;
      case "End":
        e.preventDefault();
        els[els.length - 1]?.focus();
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className={cx("relative inline-flex", className)} data-state={open ? "open" : "closed"}>
      {trigger({
        ref: (el) => {
          triggerRef.current = el;
        },
        onClick: () => setOpen((o) => !o),
        onKeyDown: (e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            focusLast.current = e.key === "ArrowUp";
            setOpen(true);
          }
        },
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": menuId,
      })}
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={rest["aria-label"]}
          onKeyDown={onMenuKeyDown}
          className={cx(
            "absolute z-40 min-w-44 rounded-ui border border-border bg-bg-alt p-1 animate-pop-in shadow-pop",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, i) => {
            const cls = cx(
              "flex h-9 w-full items-center gap-2.5 rounded-ui-sm px-2.5 text-left text-sm whitespace-nowrap",
              "outline-none transition-colors duration-100",
              item.disabled
                ? "cursor-not-allowed text-sub/50"
                : item.danger
                  ? "text-error hover:bg-error/[0.12] focus:bg-error/[0.12]"
                  : "text-text hover:bg-text/[0.09] focus:bg-text/[0.09]",
            );
            const body = (
              <>
                {item.icon && <Icon name={item.icon} size={16} className={item.danger ? undefined : "text-sub"} />}
                <span className="flex-1">{item.label}</span>
                {item.hint && <span className="pl-4 text-xs text-sub">{item.hint}</span>}
              </>
            );
            const select = () => {
              if (item.disabled) return;
              close();
              item.onSelect?.();
            };
            return (
              <div key={item.id ?? i} role="none">
                {item.separator && <div role="separator" className="mx-1 my-1 h-px bg-border" />}
                {item.href && !item.disabled ? (
                  <Link href={item.href} role="menuitem" tabIndex={-1} className={cls} onClick={select}>
                    {body}
                  </Link>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    aria-disabled={item.disabled || undefined}
                    className={cls}
                    onClick={select}
                  >
                    {body}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
