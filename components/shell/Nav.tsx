"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountControl } from "@/components/account/AccountControl";
import { Icon, IconButton, cx } from "@/components/ui";
import { getPreset } from "@/lib/layout/presets";
import { useSettings } from "@/lib/settings";
import { SHEET_COLUMN } from "./sheet";
import { openCommandPalette } from "./commands";
import { Logo, Wordmark } from "./Logo";
import { NAV_LINKS, isActivePath } from "./nav-links";

function layoutLabel(id: string, custom: { id: string; name: string }[]): string {
  return getPreset(id)?.name ?? custom.find((l) => l.id === id)?.name ?? id;
}

/** The sheet's header strip: wordmark, lettered tabs, active-layout chip, palette and account. */
export function Nav() {
  const pathname = usePathname();
  const [settings] = useSettings();
  return (
    <header className={cx(SHEET_COLUMN, "relative")} data-testid="nav">
      <div className="flex flex-wrap items-center gap-x-6 border-b border-border pt-3 md:h-16 md:flex-nowrap md:gap-x-8 md:pt-0 lg:gap-x-11">
        <Link href="/" aria-label="LayoutLearner home" className="flex h-10 items-center gap-2.5" data-testid="nav-home">
          <Logo />
          <Wordmark className="max-[380px]:hidden" />
        </Link>
        <nav
          aria-label="Main"
          className="order-last mt-2 flex w-full items-stretch justify-between md:order-none md:mt-0 md:w-auto md:justify-start md:gap-1.5 md:self-stretch"
        >
          {NAV_LINKS.map((l) => {
            const active = isActivePath(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                data-active={active}
                data-testid={`nav-link-${l.label.toLowerCase()}`}
                className={cx(
                  "ll-lettering-lg relative -mb-px inline-flex h-11 items-center border-b-2 px-2 transition-colors duration-150 sm:px-3.5 md:h-auto",
                  "focus-visible:outline-offset-[-2px]",
                  active ? "border-main text-text" : "border-transparent text-sub hover:border-border hover:text-text",
                )}
              >
                <span className="ll-trim">{l.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Link
            href="/layouts"
            title="Current layout: change it"
            data-testid="layout-chip"
            data-layout={settings.layoutId}
            className="ll-lettering mr-1 inline-flex h-8 max-w-44 items-center gap-2 border border-line px-3 text-text transition-colors duration-150 hover:bg-text hover:text-bg"
          >
            <Icon name="keyboard" size={15} className="max-sm:hidden" />
            <span className="ll-trim truncate">{layoutLabel(settings.layoutId, settings.customLayouts)}</span>
          </Link>
          <IconButton
            icon="search"
            label="Command palette"
            size="sm"
            data-testid="nav-palette"
            onClick={() => openCommandPalette()}
          />
          <AccountControl />
        </div>
      </div>
    </header>
  );
}
