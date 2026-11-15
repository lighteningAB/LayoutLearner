"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/components/ui";
import { onSyncEvent, useSyncStatus } from "@/lib/sync/engine";

/** The only toasts sync ever shows. Renders nothing. */
export function SyncToasts() {
  useEffect(
    () =>
      onSyncEvent((e) => {
        switch (e) {
          case "first-sync":
            toast("Progress synced", { variant: "success" });
            break;
          case "remote-deleted":
            toast("Your account data was deleted from another device", {
              variant: "info",
              duration: 8000,
              description: "You've been signed out; this device keeps its data.",
            });
            break;
          case "session-expired":
            toast("Session expired", {
              variant: "info",
              duration: 8000,
              description: "Sign in again to keep syncing.",
            });
            break;
          case "device-cleared":
            break; // "All local data cleared" already says it
        }
      }),
    [],
  );

  // One toast per hard error (retryAt === null), not per retry, never for offline.
  const sync = useSyncStatus();
  const shown = useRef(false);
  const hard = sync.phase === "error" && sync.error !== null && sync.error.retryAt === null;
  const message = hard ? sync.error!.message : null;
  useEffect(() => {
    if (message === null) {
      shown.current = false;
      return;
    }
    if (shown.current) return;
    shown.current = true;
    toast("Sync error", { variant: "error", description: message, duration: 6000 });
  }, [message]);

  return null;
}
