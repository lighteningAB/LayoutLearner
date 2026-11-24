"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";
import { useOutsidePointer } from "./hooks";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /** Secondary text shown on the right of the option. */
  hint?: ReactNode;
  icon?: IconName;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  value: T;
  onChange: (value: NoInfer<T>) => void;
  options: readonly SelectOption<NoInfer<T>>[];
  placeholder?: string;
  size?: "sm" | "md";
  /** Which edge of the trigger the popup aligns to. */
  align?: "start" | "end";
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "data-testid"?: string;
}

/** Custom listbox select. Arrows/Home/End move, Enter/Space choose, Esc closes, typing jumps. */
export function Select<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = "Select…",
  size = "md",
  align = "start",
  disabled,
  id,
  className,
  ...rest
}: SelectProps<T>) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  useOutsidePointer([rootRef], open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const openList = () => {
    if (disabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : options.findIndex((o) => !o.disabled));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    close();
  };
  const move = (from: number, dir: 1 | -1) => {
    let i = from;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) return i;
    }
    return from;
  };

  const onButtonKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openList();
    }
  };

  const onListKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => move(a, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => move(a < 0 ? 0 : a, -1));
        break;
      case "Home":
        e.preventDefault();
        setActive(move(-1, 1));
        break;
      case "End":
        e.preventDefault();
        setActive(move(options.length, -1));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const now = Date.now();
          const t = typeahead.current;
          t.text = now - t.at > 600 ? e.key : t.text + e.key;
          t.at = now;
          const i = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(t.text.toLowerCase()));
          if (i >= 0) setActive(i);
        }
    }
  };

  return (
    <div ref={rootRef} className={cx("relative inline-block text-left", className)} data-state={open ? "open" : "closed"}>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onButtonKeyDown}
        className={cx(
          "inline-flex w-full min-w-36 items-center justify-between gap-3 border border-border bg-fill text-text",
          "transition-colors duration-150 hover:border-line aria-expanded:border-line",
          "disabled:cursor-not-allowed disabled:border-dashed disabled:bg-transparent disabled:text-sub disabled:hover:border-border",
          size === "sm" ? "h-8 pr-2 pl-2.5 text-[14px]" : "h-10 pr-2.5 pl-3 text-[15px]",
        )}
        {...rest}
      >
        <span className={cx("flex min-w-0 items-center gap-2 truncate", !selected && "text-sub")}>
          {selected?.icon && <Icon name={selected.icon} size={16} className="text-sub" />}
          <span className="truncate">{selected ? selected.label : placeholder}</span>
        </span>
        <Icon
          name="chevron-down"
          size={16}
          className={cx("text-sub transition-transform duration-150", open && "rotate-180")}
        />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={active >= 0 ? `${uid}-opt-${active}` : undefined}
          aria-label={rest["aria-label"]}
          aria-labelledby={rest["aria-labelledby"]}
          onKeyDown={onListKeyDown}
          className={cx(
            "absolute z-40 mt-1 max-h-72 min-w-full overflow-auto border border-line bg-bg p-1",
            "animate-pop-in outline-none",
            align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
          )}
        >
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={o.disabled || undefined}
                data-active={i === active || undefined}
                data-value={o.value}
                onPointerMove={() => !o.disabled && active !== i && setActive(i)}
                onClick={() => choose(i)}
                className={cx(
                  "flex items-center gap-2.5 px-2.5 text-[15px] whitespace-nowrap",
                  size === "sm" ? "h-8" : "h-9",
                  o.disabled ? "cursor-not-allowed text-sub line-through decoration-1" : i === active ? "bg-text text-bg" : "text-text",
                )}
              >
                {o.icon && <Icon name={o.icon} size={16} />}
                <span className="flex-1">{o.label}</span>
                {o.hint && <span className="ll-note pl-4 opacity-80">{o.hint}</span>}
                <Icon name="check" size={15} className={cx(!isSelected && "invisible")} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
