"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { IconButton, Menu } from "@/components/ui";

/**
 * Small nav item. Always occupies one 32px slot, so there is no layout shift
 * while the session loads; with no providers configured it simply stays a quiet
 * "sign in" affordance.
 */
export default function AuthStatus() {
  const { data: session, status } = useSession();
  const user = session?.user;

  if (status === "authenticated" && user) {
    const name = user.name ?? user.email ?? "Account";
    return (
      <Menu
        align="end"
        aria-label="Account"
        items={[
          { label: name, icon: "user", disabled: true },
          { label: "Sign out", icon: "log-out", separator: true, onSelect: () => void signOut() },
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

  return (
    <IconButton
      icon="user"
      label="Sign in"
      size="sm"
      data-testid="auth-status"
      data-auth={status}
      disabled={status === "loading"}
      className="disabled:opacity-100"
      onClick={() => void signIn()}
    />
  );
}
