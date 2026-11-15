"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";

export default function SessionProviderWrapper({ children }: { children: ReactNode }) {
  // No refetch-on-focus: the session is only used for a small nav item.
  return <SessionProvider refetchOnWindowFocus={false}>{children}</SessionProvider>;
}
