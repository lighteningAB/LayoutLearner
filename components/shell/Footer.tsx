"use client";

import Link from "next/link";
import { Icon, Kbd, cx } from "@/components/ui";
import { THEMES, getTheme, useSettings } from "@/lib/settings";
import { SHEET_COLUMN } from "./sheet";
import { openCommandPalette } from "./commands";

const LINK =
  "inline-flex h-8 items-center gap-2 px-1 text-sub underline-offset-4 transition-colors duration-150 hover:text-text hover:underline";

/** The sheet's bottom strip: key hints left, privacy and the two-state theme switch right. */
export function Footer() {
  const [settings, update] = useSettings();
  const current = getTheme(settings.theme);
  const other = THEMES.find((t) => t.id !== current.id) ?? THEMES[0];
  return (
    <footer className={cx(SHEET_COLUMN, "relative pt-8 pb-3 md:pb-4")} data-testid="footer">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border pt-3 text-sm text-sub">
        <div className="hidden flex-wrap items-center gap-x-6 gap-y-2 sm:flex">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>tab</Kbd>
            <span aria-hidden>+</span>
            <Kbd>enter</Kbd>
            <span className="ml-1">restart test</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>esc</Kbd>
            <span className="ml-1">command palette</span>
          </span>
        </div>
        <button type="button" className={cx(LINK, "sm:hidden")} onClick={() => openCommandPalette()}>
          <Icon name="command" size={14} />
          commands
        </button>
        <Link href="/privacy" data-testid="footer-privacy" className={cx(LINK, "sm:mr-2 sm:ml-auto")}>
          Privacy
        </Link>
        <button
          type="button"
          role="switch"
          aria-checked={current.scheme === "light"}
          data-testid="theme-switcher"
          data-theme-id={current.id}
          aria-label="Light theme"
          title={`Switch to ${other.name}`}
          onClick={() => update({ theme: other.id })}
          className="group inline-flex h-8 items-stretch border border-line text-text"
        >
          {THEMES.map((t) => {
            const on = t.id === current.id;
            return (
              <span
                key={t.id}
                data-state={on ? "on" : "off"}
                className={cx(
                  "ll-lettering-sm inline-flex items-center px-2.5 transition-colors duration-150",
                  on ? "bg-text text-bg" : "text-sub group-hover:bg-fill-strong group-hover:text-text",
                )}
              >
                <span className="ll-trim">{t.name}</span>
              </span>
            );
          })}
        </button>
      </div>
    </footer>
  );
}
