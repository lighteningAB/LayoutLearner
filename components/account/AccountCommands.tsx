"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useRegisterCommands, type Command } from "@/components/shell/commands";
import { signOutAccount, useAccount } from "@/lib/auth/client";
import { syncNow } from "@/lib/sync/engine";
import { openSignIn } from "./signin-store";

/** Command palette entries (group "Account"). Renders nothing. */
export function AccountCommands() {
  const router = useRouter();
  const status = useAccount().status;
  const commands = useMemo<Command[]>(() => {
    const group = "Account";
    if (status === "signed-in") {
      return [
        { id: "account-sync-now", group, label: "Sync now", icon: "restart", keywords: "account sync refresh", run: () => void syncNow() },
        {
          id: "account-settings",
          group,
          label: "Account & sync settings",
          icon: "user",
          keywords: "account sync export delete",
          run: () => router.push("/settings#account"),
        },
        { id: "account-sign-out", group, label: "Sign out", icon: "log-out", keywords: "account logout log out", run: () => void signOutAccount() },
      ];
    }
    if (status === "signed-out") {
      // Deferred a tick so the palette's focus restore cannot steal focus from the dialog.
      return [
        {
          id: "account-sign-in",
          group,
          label: "Sign in",
          icon: "log-in",
          keywords: "account login log in sync",
          run: () => void window.setTimeout(openSignIn, 60),
        },
      ];
    }
    return [];
  }, [status, router]);
  useRegisterCommands(commands);
  return null;
}
