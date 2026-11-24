import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Barlow_Semi_Condensed, IBM_Plex_Mono, Josefin_Sans } from "next/font/google";
import { AccountProvider } from "@/components/account/AccountProvider";
import { AppShell } from "@/components/shell/AppShell";
import { getAuthConfig } from "@/lib/auth/config";
import { DEFAULT_THEME, themeInitScript } from "@/lib/settings/themes";
import "./globals.css";

// Sheet lettering (tracked caps), UI and body, and typing text / legends / readouts.
const display = Josefin_Sans({ subsets: ["latin"], weight: ["300", "600", "700"], variable: "--font-josefin", display: "swap" });
const sans = Barlow_Semi_Condensed({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-barlow", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

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
    <html lang="en" data-theme={DEFAULT_THEME} className={`${display.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
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
