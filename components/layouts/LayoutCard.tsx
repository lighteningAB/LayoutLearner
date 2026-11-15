"use client";

import { memo } from "react";
import { Keyboard2D } from "@/components/keyboard/Keyboard2D";
import { Badge, Icon, IconButton, Menu, cx, type MenuItem } from "@/components/ui";
import { FAMILY_LABEL, pct, type LayoutEntry } from "./catalog";

export interface LayoutCardProps {
  entry: LayoutEntry;
  /** This is the layout being learned (settings.layoutId). */
  selected: boolean;
  /** This is the layout shown in the detail panel. */
  inspected: boolean;
  onSelect: (entry: LayoutEntry) => void;
  onInspect: (entry: LayoutEntry) => void;
  menuItems: MenuItem[];
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-sub">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-[13px] text-text tabular-nums">{value}</dd>
    </div>
  );
}

export const LayoutCard = memo(function LayoutCard({ entry, selected, inspected, onSelect, onInspect, menuItems }: LayoutCardProps) {
  const { layout, analysis, diff } = entry;
  const broken = !layout;
  const moved = diff ? diff.movedLetters.length : null;

  return (
    <li
      data-testid="layout-card"
      data-layout-id={entry.id}
      data-selected={selected}
      data-inspected={inspected}
      data-broken={broken || undefined}
      className={cx(
        "group relative flex min-w-0 flex-col rounded-ui-lg border bg-bg-alt p-3.5 transition-[border-color,box-shadow] duration-150",
        selected
          ? "border-main shadow-[0_0_0_1px_var(--main)]"
          : broken
            ? "border-error/40"
            : inspected
              ? "border-sub/70"
              : "border-transparent hover:border-sub/40",
      )}
    >
      {/* Whole-card click target; the menu sits above it. */}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={broken ? `${entry.name}: needs fixing, show details` : selected ? `${entry.name}, current layout` : `Use ${entry.name}`}
        data-testid="layout-card-select"
        onClick={() => (broken ? onInspect(entry) : onSelect(entry))}
        className="absolute inset-0 z-[1] cursor-pointer rounded-ui-lg"
      />

      <div className="flex h-[118px] items-center justify-center rounded-ui bg-bg px-3">
        {layout ? (
          <Keyboard2D layout={layout} fingerColors maxUnit={21} className="pointer-events-none" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-error">
            <Icon name="alert" size={22} />
            <span className="text-xs font-medium">Can't be read</span>
          </div>
        )}
      </div>

      <div className="mt-3.5 flex items-center gap-2 pl-1">
        <h3 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-text">{entry.name}</h3>
        {selected && (
          <Badge tone="main" icon="check" data-testid="layout-card-active">
            Active
          </Badge>
        )}
        {broken && (
          <Badge tone="error" icon="alert" data-testid="layout-card-error">
            Error
          </Badge>
        )}
        <Menu
          aria-label={`${entry.name} actions`}
          align="end"
          className="relative z-[2] -my-1 ml-auto"
          items={menuItems}
          trigger={(props) => (
            <IconButton icon="more" label={`${entry.name} actions`} size="sm" data-testid="layout-card-menu" {...props} />
          )}
        />
      </div>

      <p className="mt-1 line-clamp-2 min-h-[36px] pl-1 text-[13px] leading-[18px] text-sub">
        {broken ? entry.error : entry.description}
      </p>

      <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-border/70 pt-3 pl-1">
        <Fact label={FAMILY_LABEL[entry.family]} value={layout ? `${layout.keys.length} keys` : "-"} />
        <Fact label="Home row" value={analysis?.rows ? pct(analysis.rows.home) : "-"} />
        <Fact
          label="vs QWERTY"
          value={moved === null || !diff?.comparable ? "-" : moved === 0 ? "same" : `${moved} moved`}
        />
      </dl>
    </li>
  );
});
