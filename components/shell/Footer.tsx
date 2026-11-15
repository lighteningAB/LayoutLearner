"use client";

import Link from "next/link";
import { Icon, Kbd } from "@/components/ui";
import { getTheme, useSettings } from "@/lib/settings";
import { openCommandPalette } from "./commands";

export function Footer() {
  const [settings] = useSettings();
  return (
    <footer className="mx-auto w-full max-w-[1120px] px-4 pt-10 pb-6 sm:px-8" data-testid="footer">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-xs text-sub">
        <div className="hidden flex-wrap items-center gap-x-6 gap-y-2 sm:flex">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>tab</Kbd>
            <span>+</span>
            <Kbd>enter</Kbd>
            <span className="ml-1">restart test</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>esc</Kbd>
            <span className="ml-1">command palette</span>
          </span>
        </div>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-2 rounded-ui-sm px-1.5 transition-colors duration-150 hover:text-text sm:hidden"
          onClick={() => openCommandPalette()}
        >
          <Icon name="command" size={14} />
          commands
        </button>
        <Link href="/privacy" data-testid="footer-privacy" className="inline-flex h-7 items-center rounded-ui-sm px-1.5 transition-colors duration-150 hover:text-text sm:ml-auto sm:mr-3">
          Privacy
        </Link>
        <button
          type="button"
          data-testid="theme-switcher"
          aria-label={`Theme: ${getTheme(settings.theme).name}. Change theme`}
          onClick={() => openCommandPalette("theme ")}
          className="inline-flex h-7 items-center gap-2 rounded-ui-sm px-1.5 transition-colors duration-150 hover:text-text"
        >
          <Icon name="palette" size={14} />
          <span className="lowercase">{getTheme(settings.theme).name}</span>
        </button>
      </div>
    </footer>
  );
}
