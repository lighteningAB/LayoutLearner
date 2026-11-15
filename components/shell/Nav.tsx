"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountControl } from "@/components/account/AccountControl";
import { Icon, IconButton, cx } from "@/components/ui";
import { getPreset } from "@/lib/layout/presets";
import { useSettings } from "@/lib/settings";
import { openCommandPalette } from "./commands";
import { Logo, Wordmark } from "./Logo";
import { NAV_LINKS, isActivePath } from "./nav-links";

function layoutLabel(id: string, custom: { id: string; name: string }[]): string {
  return getPreset(id)?.name ?? custom.find((l) => l.id === id)?.name ?? id;
}

export function Nav() {
  const pathname = usePathname();
  const [settings] = useSettings();
  return (
    <header className="mx-auto w-full max-w-[1120px] px-4 sm:px-8" data-testid="nav">
      <div className="flex flex-wrap items-center gap-x-6 pt-4 md:h-20 md:flex-nowrap md:pt-0">
        <Link href="/" aria-label="LayoutLearner home" className="flex h-10 items-center gap-2.5 rounded-ui" data-testid="nav-home">
          <Logo />
          <Wordmark />
        </Link>
        <nav
          aria-label="Main"
          className="order-last -mx-1 mt-2 flex w-[calc(100%+0.5rem)] items-center justify-between gap-0.5 md:order-none md:mx-0 md:mt-0 md:w-auto md:justify-start md:gap-1"
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
                  "inline-flex h-9 items-center gap-2 rounded-ui px-2.5 text-sm font-medium transition-colors duration-150 sm:px-3",
                  active ? "text-main" : "text-sub hover:text-text",
                )}
              >
                <Icon name={l.icon} size={16} className="hidden sm:block" />
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/layouts"
            title="Current layout: change it"
            data-testid="layout-chip"
            data-layout={settings.layoutId}
            className="mr-1 inline-flex h-8 max-w-40 items-center gap-2 rounded-full border border-border px-3 font-mono text-xs text-sub transition-colors duration-150 hover:border-sub/60 hover:text-text"
          >
            <Icon name="keyboard" size={15} />
            <span className="truncate">{layoutLabel(settings.layoutId, settings.customLayouts)}</span>
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
