import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/Toast";
import { CommandPalette } from "./CommandPalette";
import { Footer } from "./Footer";
import { Nav } from "./Nav";

/** Nav + centred content column + footer + global overlays. Used once, by app/layout.tsx. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-ui focus:bg-main focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-main-fg"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1120px] flex-1 px-4 pt-6 pb-4 outline-none sm:px-8 sm:pt-10">
        {children}
      </main>
      <Footer />
      <CommandPalette />
      <Toaster />
    </div>
  );
}
