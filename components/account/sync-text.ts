"use client";

import { useEffect, useState } from "react";
import type { SyncStatus } from "@/lib/sync/engine";

export type SyncTone = "ok" | "busy" | "muted" | "warn" | "error";

/** Current time for relative labels. null until mounted (so server and first client render agree). */
export function useNow(dep: unknown, intervalMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [dep, intervalMs]);
  return now;
}

export function formatAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** One line of words for the sync state. */
export function describeSync(sync: SyncStatus, now: number | null): { text: string; tone: SyncTone } {
  switch (sync.phase) {
    case "mismatch":
      return { text: "Waiting for your choice", tone: "warn" };
    case "syncing":
      return { text: "Syncing…", tone: "busy" };
    case "offline":
      return { text: "Offline — changes saved on this device", tone: "warn" };
    case "error":
      return { text: `Sync error: ${sync.error?.message ?? "something went wrong"}`, tone: "error" };
    default:
      if (sync.lastSyncedAt !== null) {
        return { text: now === null ? "Synced" : `Synced · ${formatAgo(sync.lastSyncedAt, now)}`, tone: "ok" };
      }
      return { text: "Not synced yet", tone: "muted" };
  }
}

/** Phases that deserve a (subtle) status dot on the avatar. */
export function dotFor(sync: SyncStatus): { tone: SyncTone; word: string } | null {
  switch (sync.phase) {
    case "syncing":
      return { tone: "busy", word: "syncing" };
    case "offline":
      return { tone: "warn", word: "offline" };
    case "error":
      return { tone: "error", word: "sync error" };
    case "mismatch":
      return { tone: "warn", word: "waiting for your choice" };
    default:
      return null;
  }
}
