import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { AccountProvider } from "@/components/account/AccountProvider";
import { AppShell } from "@/components/shell/AppShell";
import { getAuthConfig } from "@/lib/auth/config";
import { DEFAULT_THEME, themeInitScript } from "@/lib/settings/themes";
import "./globals.css";

// Sheet lettering (tracked caps), UI and body, and typing text / legends / readouts.
// Fonts are self-hosted (latin subset, SIL Open Font License) so the build never depends on Google Fonts.
const display = localFont({
  src: [{ path: "./fonts/josefin-sans-latin.woff2", weight: "300 700", style: "normal" }],
  variable: "--font-josefin",
  display: "swap",
});
const sans = localFont({
  src: [
    { path: "./fonts/barlow-semi-condensed-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/barlow-semi-condensed-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/barlow-semi-condensed-600-latin.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-barlow",
  display: "swap",
});
const mono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-600-latin.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

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
