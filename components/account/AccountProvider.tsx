"use client";

import { useEffect, type ReactNode } from "react";
import { initAccount, primeAccount } from "@/lib/auth/client";
import type { PublicAuthConfig } from "@/lib/auth/types";
import { initSync, primeSync } from "@/lib/sync/engine";

/**
 * Boots the account session store and the sync engine with the server's feature configuration.
 * Renders nothing of its own.
 *
 * Feature off (`config.enabled === false`): the effect returns immediately, so there are no
 * listeners, no localStorage access and no requests; the stores report "off" / "disabled".
 */
export function AccountProvider({ config, children }: { config: PublicAuthConfig; children: ReactNode }) {
  // Configuration only (no side effects): makes useAccount() / useSyncStatus() agree between the
  // server render, hydration and the first client render.
  primeAccount(config);
  primeSync(config);

  useEffect(() => {
    if (!config.enabled) return;
    initAccount(config);
    initSync(config);
    // Both are idempotent and live for the lifetime of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
