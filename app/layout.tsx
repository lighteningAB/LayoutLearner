import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, JetBrains_Mono } from "next/font/google";
import { AccountProvider } from "@/components/account/AccountProvider";
import { AppShell } from "@/components/shell/AppShell";
import { getAuthConfig } from "@/lib/auth/config";
import { DEFAULT_THEME, themeInitScript } from "@/lib/settings/themes";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "LayoutLearner", template: "%s · LayoutLearner" },
  description: "Learn Dvorak, Colemak or your own keyboard layout: guided lessons, a calm typing test and 3D hands that show which finger goes where.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME} className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <AccountProvider config={getAuthConfig()}>
          <AppShell>{children}</AppShell>
        </AccountProvider>
      </body>
    </html>
  );
}
