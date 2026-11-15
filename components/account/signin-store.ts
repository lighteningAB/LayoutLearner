"use client";

import { useSyncExternalStore } from "react";

// Tiny module-level store for "is the sign-in dialog open", like components/shell/commands.ts.
// Anything (nav, settings, palette) can open it; <SignInDialog /> (mounted once by AccountProvider)
// renders it.

let open = false;
const listeners = new Set<() => void>();
const set = (next: boolean) => {
  if (open === next) return;
  open = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function openSignIn(): void {
  set(true);
}

export function closeSignIn(): void {
  set(false);
}

export function useSignInOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}
