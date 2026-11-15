"use client";

import { IconButton, Menu } from "@/components/ui";
import { signInWith, signOutAccount, useAccount } from "@/lib/auth/client";

/**
 * Placeholder nav item on top of the account store (lib/auth/client.ts); the account UI replaces
 * it. Renders nothing when accounts are not configured.
 */
export default function AuthStatus() {
  const account = useAccount();
  if (!account.enabled) return null;

  if (account.status === "signed-in" && account.user) {
    const name = account.user.name;
    return (
      <Menu
        align="end"
        aria-label="Account"
        items={[
          { label: name, icon: "user", disabled: true },
          { label: "Sign out", icon: "log-out", separator: true, onSelect: () => void signOutAccount() },
        ]}
        trigger={(props) => (
          <button
            type="button"
            {...props}
            aria-label={`Account: ${name}`}
            data-testid="auth-status"
            data-auth="authenticated"
            className="inline-flex size-8 items-center justify-center rounded-full bg-main/[0.16] text-xs font-semibold text-main uppercase transition-colors hover:bg-main/[0.26]"
          >
            {name.slice(0, 1)}
          </button>
        )}
      />
    );
  }

  const provider = account.providers[0];
  return (
    <IconButton
      icon="user"
      label="Sign in"
      size="sm"
      data-testid="auth-status"
      data-auth={account.status === "loading" ? "loading" : "unauthenticated"}
      disabled={account.status === "loading" || !provider}
      className="disabled:opacity-100"
      onClick={() => {
        if (!provider) return;
        if (provider.kind === "dev") {
          const username = window.prompt("Dev login: username");
          if (username) void signInWith(provider.id, { username });
        } else {
          void signInWith(provider.id);
        }
      }}
    />
  );
}
