"use client";

import { memo, useEffect, useRef, useState } from "react";
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

/** One cell of the ruled spec row under a plate. */
function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-hairline px-3 py-2.5 max-sm:[&:nth-child(even)]:border-l max-sm:[&:nth-child(n+3)]:border-t sm:border-l sm:first:border-l-0">
      <dt className="ll-lettering-sm truncate text-sub">{label}</dt>
      <dd className="ll-readout mt-1.5 truncate text-md leading-none text-text">{value}</dd>
    </div>
  );
}

/** Height of the plate window in a gallery cell (px). */
const PLATE_H = 152;

/**
 * True once the element has come within `margin` of the viewport; stays true
 * after that. Falls back to true where IntersectionObserver is missing.
 */
function useNearViewport(margin = "300px") {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);
  return [ref, near] as const;
}

/** One plate of the sheet index: title strip, the board drawn as the content, a note, a ruled spec row. */
export const LayoutCard = memo(function LayoutCard({ entry, selected, inspected, onSelect, onInspect, menuItems }: LayoutCardProps) {
  const { layout, analysis, diff } = entry;
  const broken = !layout;
  const [previewRef, nearViewport] = useNearViewport();
  const moved = diff ? diff.movedLetters.length : null;
  // Boards differ a lot in aspect (a 60% is 15u x 5u, an ErgoDox far taller): fit the unit to the window's height too.
  const unit = layout ? Math.max(9, Math.min(23, Math.floor((PLATE_H - 28) / layout.height))) : 0;

  return (
    <li
      data-testid="layout-card"
      data-layout-id={entry.id}
      data-selected={selected}
      data-inspected={inspected}
      data-broken={broken || undefined}
      className={cx(
        "group relative flex min-w-0 flex-col border-r border-b border-border transition-colors duration-150 hover:bg-fill",
        // The plate in use: a line-weight outline in the action colour, over the shared hairline grid.
        selected && "z-[1] outline-2 -outline-offset-2 outline-main",
        !selected && broken && "outline-1 -outline-offset-4 outline-error outline-dashed",
        !selected && !broken && inspected && "outline-1 -outline-offset-4 outline-line outline-dashed",
      )}
    >
      {/* Whole-cell click target; the menu sits above it. */}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={broken ? `${entry.name}: needs fixing, show details` : selected ? `${entry.name}, current layout` : `Use ${entry.name}`}
        data-testid="layout-card-select"
        onClick={() => (broken ? onInspect(entry) : onSelect(entry))}
        className="absolute inset-0 z-[1] cursor-pointer focus-visible:outline-offset-[-6px]"
      />

      {/* Title strip: name in sheet lettering, state tag, overflow menu. */}
      <div
        className={cx(
          "flex h-11 items-center gap-2 border-b pr-1.5 pl-3 sm:pl-4",
          selected ? "border-main text-text" : "border-hairline text-text",
        )}
      >
        <h3 className="ll-lettering-lg ll-trim min-w-0 truncate">{entry.name}</h3>
        {selected && (
          <span
            className="ll-lettering-sm inline-flex h-[22px] shrink-0 items-center gap-1 rounded-ui border border-main bg-main px-1.5 text-main-fg"
            data-testid="layout-card-active"
          >
            <Icon name="check" size={12} strokeWidth={2.25} />
            <span className="ll-trim">Active</span>
          </span>
        )}
        {broken && (
          <Badge tone="error" icon="alert" className="shrink-0" data-testid="layout-card-error">
            Error
          </Badge>
        )}
        {!selected && !broken && inspected && <Badge className="shrink-0">Shown below</Badge>}
        <Menu
          aria-label={`${entry.name} actions`}
          align="end"
          className="relative z-[2] ml-auto"
          items={menuItems}
          trigger={(props) => (
            <IconButton
              icon="more"
              label={`${entry.name} actions`}
              size="sm"
              data-testid="layout-card-menu"
              className="!text-text"
              {...props}
            />
          )}
        />
      </div>

      {/* Fixed height, so the lazily mounted keyboard never moves the cell. */}
      <div ref={previewRef} className={cx("flex items-center justify-center px-3", broken && "ll-hatch")} style={{ height: PLATE_H }}>
        {layout ? (
          nearViewport && <Keyboard2D layout={layout} fingerColors maxUnit={unit} className="pointer-events-none" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-error">
            <Icon name="alert" size={22} />
            <span className="ll-lettering-sm">Can&apos;t be read</span>
          </div>
        )}
      </div>

      <p className="line-clamp-2 min-h-[52px] px-3 pb-3 text-md leading-[20px] text-sub sm:px-4">
        {broken ? entry.error : entry.description}
      </p>

      <dl className="mt-auto grid grid-cols-2 border-t sm:grid-cols-[1.2fr_0.65fr_1.1fr_1.15fr] border-hairline">
        <Spec label="Board" value={FAMILY_LABEL[entry.family]} />
        <Spec label="Keys" value={layout ? String(layout.keys.length) : "-"} />
        <Spec label="Home row" value={analysis?.rows ? pct(analysis.rows.home) : "-"} />
        <Spec label="vs QWERTY" value={moved === null || !diff?.comparable ? "-" : moved === 0 ? "same" : `${moved} moved`} />
      </dl>
    </li>
  );
});
