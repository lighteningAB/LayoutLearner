"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export type ToastVariant = "info" | "success" | "error";

export interface ToastOptions {
  variant?: ToastVariant;
  /** ms before auto-dismiss; 0 keeps it until dismissed. Default 3500. */
  duration?: number;
  description?: ReactNode;
}

interface ToastItem extends Required<Pick<ToastOptions, "variant" | "duration">> {
  id: number;
  message: ReactNode;
  description?: ReactNode;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const EMPTY: ToastItem[] = [];
const emit = () => listeners.forEach((l) => l());

/** Show a toast from anywhere on the client. Returns its id. */
export function toast(message: ReactNode, options: ToastOptions = {}): number {
  const item: ToastItem = {
    id: nextId++,
    message,
    description: options.description,
    variant: options.variant ?? "info",
    duration: options.duration ?? 3500,
  };
  items = [...items.slice(-3), item];
  emit();
  if (item.duration > 0 && typeof window !== "undefined") {
    window.setTimeout(() => dismissToast(item.id), item.duration);
  }
  return item.id;
}

export function dismissToast(id: number): void {
  const next = items.filter((t) => t.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const ICON: Record<ToastVariant, IconName> = { info: "info", success: "check", error: "alert" };
const TONE: Record<ToastVariant, string> = { info: "text-main", success: "text-success", error: "text-error" };

/** Mount once (the app shell already does). Renders the live toast stack. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      role="region"
      aria-label="Notifications"
      data-testid="toaster"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-6"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role={t.variant === "error" ? "alert" : "status"}
          data-variant={t.variant}
          data-testid="toast"
          className="pointer-events-auto flex w-full max-w-sm animate-rise-in items-start gap-3 rounded-ui border border-border bg-bg-alt py-3 pr-2 pl-3.5 shadow-pop"
        >
          <Icon name={ICON[t.variant]} size={18} className={cx("mt-px", TONE[t.variant])} />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium text-text">{t.message}</div>
            {t.description && <div className="mt-0.5 text-sub">{t.description}</div>}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
            className="inline-flex size-6 items-center justify-center rounded-ui-sm text-sub transition-colors hover:bg-text/[0.08] hover:text-text"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
