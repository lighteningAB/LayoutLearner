import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/Toast";
import { CommandPalette } from "./CommandPalette";
import { Footer } from "./Footer";
import { Nav } from "./Nav";
import { SHEET_COLUMN } from "./sheet";

/** One registration mark (crosshair in a circle), centred on a corner of the sheet frame. */
function RegMark({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 22 22" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1" className={className}>
      <circle cx="11" cy="11" r="5" />
      <path d="M11 0v22M0 11h22" />
    </svg>
  );
}

const ZONES = ["A", "B", "C"] as const;

/**
 * The drawing sheet's furniture: outer frame, inner hairline, registration marks and zone
 * letters. Pure decoration: hidden from assistive tech, never takes pointer events, and sits in
 * the page margin so it cannot collide with content. Below `md` only the frame line remains.
 */
function SheetFrame() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden text-line" data-testid="sheet-frame">
      <div className="absolute inset-1.5 border border-line md:inset-3" />
      <div className="absolute inset-[17px] hidden border border-hairline md:block" />
      <RegMark className="absolute top-px left-px hidden md:block" />
      <RegMark className="absolute top-px right-px hidden md:block" />
      <RegMark className="absolute bottom-px left-px hidden md:block" />
      <RegMark className="absolute right-px bottom-px hidden md:block" />
      {ZONES.map((z, i) => (
        <span key={z} className="hidden md:contents">
          <span className="absolute top-3 h-[5px] w-px bg-line" style={{ left: `${(i + 1) * 25}%` }} />
          <span className="absolute bottom-3 h-[5px] w-px bg-line" style={{ left: `${(i + 1) * 25}%` }} />
          <span className="ll-lettering-sm absolute top-[19px] -translate-x-1/2 text-2xs text-sub" style={{ left: `${(i + 1) * 25}%` }}>
            {z}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Sheet frame + nav + content column + footer strip + global overlays. Used once, by app/layout.tsx. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col pt-1.5 pb-1.5 md:pt-[30px] md:pb-[22px]">
      <SheetFrame />
      <a
        href="#main"
        className="ll-lettering sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:border focus:border-line focus:bg-main focus:px-3 focus:py-2 focus:text-main-fg"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className={`${SHEET_COLUMN} relative flex-1 pt-6 pb-4 outline-none sm:pt-9`}>
        {children}
      </main>
      <Footer />
      <CommandPalette />
      <Toaster />
    </div>
  );
}
