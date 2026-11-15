import type { IconName } from "@/components/ui/Icon";

export interface NavLink {
  href: string;
  label: string;
  icon: IconName;
  keywords: string;
}

export const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Test", icon: "keyboard", keywords: "typing test home practice" },
  { href: "/learn", label: "Learn", icon: "graduation", keywords: "lessons course tutor" },
  { href: "/layouts", label: "Layouts", icon: "layers", keywords: "dvorak colemak qwerty custom kle" },
  { href: "/stats", label: "Stats", icon: "chart", keywords: "history progress wpm accuracy" },
  { href: "/settings", label: "Settings", icon: "sliders", keywords: "preferences options config" },
];

export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
