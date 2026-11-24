import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/Toast";
import { CommandPalette } from "./CommandPalette";
import { Footer } from "./Footer";
import { Nav } from "./Nav";
import { SHEET_COLUMN } from "./sheet";

/** Nav + content column + footer strip + global overlays. Used once, by app/layout.tsx. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col pt-1.5 pb-1.5 md:pt-3 md:pb-3">
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
