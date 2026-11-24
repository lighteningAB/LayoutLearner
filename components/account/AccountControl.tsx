"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon, cx, useOutsidePointer, type IconName } from "@/components/ui";
import { signOutAccount, useAccount } from "@/lib/auth/client";
import { syncNow, useSyncStatus } from "@/lib/sync/engine";
import { Avatar } from "./Avatar";
import { openSignIn } from "./signin-store";
import { describeSync, dotFor, useNow, type SyncTone } from "./sync-text";

// The nav slot is a fixed box so nothing around it moves between loading / signed-out / signed-in:
// 32px (icon-sized) below sm, 72px from sm up (room for the "Sign in" text). Content is right-aligned.
const SLOT = "relative flex h-8 w-8 shrink-0 items-center justify-end sm:w-[72px]";

const DOT_TONE: Record<SyncTone, string> = {
  ok: "bg-success",
  busy: "bg-main motion-safe:animate-pulse",
  muted: "bg-sub",
  warn: "bg-sub",
  error: "bg-error",
};

export const TONE_TEXT: Record<SyncTone, string> = {
  ok: "text-sub",
  busy: "text-main",
  muted: "text-sub",
  warn: "text-sub",
  error: "text-error",
};

const ITEM =
  "flex h-9 w-full items-center gap-2.5 px-2.5 text-left text-base whitespace-nowrap text-text outline-none " +
  "transition-colors duration-100 hover:bg-text hover:text-bg focus:bg-text focus:text-bg " +
  "aria-disabled:cursor-default aria-disabled:bg-transparent aria-disabled:text-sub aria-disabled:line-through aria-disabled:decoration-1";

/** The account control in the nav. Renders nothing while the feature is off. */
export function AccountControl() {
  const account = useAccount();
  const phase = useSyncStatus().phase;
  if (!account.enabled) return null;
  if (account.status === "signed-in" && account.user) {
    return <SignedIn name={account.user.name} image={account.user.image} />;
  }
  if (account.status === "loading") {
    return (
      <div className={SLOT} data-testid="account-control" data-state="loading" data-sync={phase} aria-busy="true">
        <span aria-hidden className="ll-hatch size-8 border border-dashed border-border motion-safe:animate-shimmer" />
      </div>
    );
  }
  return (
    <div className={SLOT} data-testid="account-control" data-state="signed-out" data-sync={phase}>
      <button
        type="button"
        data-testid="account-signin"
        aria-label="Sign in"
        title="Sign in"
        onClick={() => openSignIn()}
        className="ll-lettering-sm inline-flex h-8 w-8 items-center justify-center gap-1.5 border border-line whitespace-nowrap text-text transition-colors duration-150 hover:bg-text hover:text-bg sm:w-[72px]"
      >
        <Icon name="log-in" size={16} className="sm:hidden" />
        <span className="ll-trim hidden sm:inline">Sign in</span>
      </button>
    </div>
  );
}

function SignedIn({ name, image }: { name: string; image: string | null }) {
  const sync = useSyncStatus();
  const now = useNow(sync.lastSyncedAt);
  const summary = describeSync(sync, now);
  const dot = dotFor(sync);

  const uid = useId();
  const menuId = `${uid}-menu`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);

  useOutsidePointer([rootRef], open, () => setOpen(false));

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);

  useEffect(() => {
    if (!open) return;
    const els = items();
    (focusLast.current ? els[els.length - 1] : els[0])?.focus({ preventScroll: true });
    focusLast.current = false;
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  };

  const onMenuKeyDown = (e: KeyboardEvent) => {
    const els = items();
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (el: HTMLElement | undefined) => {
      e.preventDefault();
      el?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        return go(els[(i + 1) % els.length]);
      case "ArrowUp":
        return go(els[(i - 1 + els.length) % els.length]);
      case "Home":
        return go(els[0]);
      case "End":
        return go(els[els.length - 1]);
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        return close();
      case "Tab":
        return close(false);
    }
  };

  const syncing = sync.phase === "syncing";
  const label = `Account: ${name}${dot ? `, ${dot.word}` : ""}`;

  return (
    <div
      ref={rootRef}
      className={SLOT}
      data-testid="account-control"
      data-state="signed-in"
      data-sync={sync.phase}
      data-open={open || undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        data-testid="account-avatar"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            focusLast.current = e.key === "ArrowUp";
            setOpen(true);
          }
        }}
        className="relative inline-flex size-8 items-center justify-center"
      >
        <Avatar name={name} image={image} />
        {dot && (
          <span
            aria-hidden
            data-testid="account-dot"
            data-tone={dot.tone}
            className={cx("absolute -right-1 -bottom-1 size-2.5 border border-bg", DOT_TONE[dot.tone])}
          />
        )}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          data-testid="account-menu"
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-40 mt-1.5 w-64 max-w-[calc(100vw-2rem)] animate-pop-in border border-line bg-bg p-1"
        >
          <div role="none" className="px-2.5 pt-2 pb-2.5">
            <div className="ll-lettering truncate text-text" data-testid="account-menu-name">
              {name}
            </div>
            <div
              aria-live="polite"
              data-testid="account-menu-status"
              className={cx("mt-1 text-sm leading-snug", TONE_TEXT[summary.tone])}
            >
              {summary.text}
            </div>
          </div>
          <div role="separator" className="mb-1 h-px bg-border" />
          <MenuButton
            icon="restart"
            testid="account-menu-sync"
            disabled={syncing || sync.phase === "mismatch"}
            onClick={() => void syncNow()}
          >
            Sync now
          </MenuButton>
          <Link
            href="/settings#account"
            role="menuitem"
            tabIndex={-1}
            data-testid="account-menu-settings"
            className={ITEM}
            onClick={() => close(false)}
          >
            <Icon name="sliders" size={16} />
            Account &amp; sync
          </Link>
          <div role="separator" className="my-1 h-px bg-border" />
          <MenuButton
            icon="log-out"
            testid="account-menu-signout"
            onClick={() => {
              close();
              void signOutAccount();
            }}
          >
            Sign out
          </MenuButton>
        </div>
      )}
    </div>
  );
}

function MenuButton({
  icon,
  testid,
  disabled,
  onClick,
  children,
}: {
  icon: IconName;
  testid: string;
  disabled?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      data-testid={testid}
      className={ITEM}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      <Icon name={icon} size={16} />
      {children}
    </button>
  );
}
