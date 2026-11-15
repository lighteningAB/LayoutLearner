import type { ReactNode, SVGProps } from "react";

// Small inline icon set (24×24 grid, 1.75 stroke, round joins). No dependency.
const p = (d: string) => <path d={d} />;
const c = (cx: number, cy: number, r: number) => <circle cx={cx} cy={cy} r={r} />;

const ICONS = {
  keyboard: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      {p("M6.5 9.5h.01M10.2 9.5h.01M13.8 9.5h.01M17.5 9.5h.01M6.5 12.5h.01M10.2 12.5h.01M13.8 12.5h.01M17.5 12.5h.01M8.5 15.5h7")}
    </>
  ),
  book: p("M12 6.5C10.5 5 8 4.5 3.5 4.5v13c4.5 0 7 .5 8.5 2 1.5-1.5 4-2 8.5-2v-13c-4.5 0-7 .5-8.5 2zM12 6.5v13"),
  graduation: p("M2.5 9.5 12 5l9.5 4.5L12 14 2.5 9.5zM6.5 11.5V16c1.5 1.4 3.4 2 5.5 2s4-.6 5.5-2v-4.5M21.5 9.5V15"),
  chart: p("M5 20v-7M12 20V5M19 20v-10M3 20h18"),
  sliders: (
    <>
      {p("M4 7h9M19 7h1M4 17h1M11 17h9")}
      {c(16, 7, 2.5)}
      {c(8, 17, 2.5)}
    </>
  ),
  palette: (
    <>
      {p("M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A3.7 3.7 0 0 0 21 10.7C21 6.4 17 3 12 3z")}
      {p("M7.5 12h.01M9.5 8h.01M14 7h.01")}
    </>
  ),
  search: (
    <>
      {c(11, 11, 6.5)}
      {p("m20 20-4.3-4.3")}
    </>
  ),
  check: p("m5 12.5 4.5 4.5L19 7.5"),
  x: p("M6 6l12 12M18 6 6 18"),
  "chevron-down": p("m6 9 6 6 6-6"),
  "chevron-up": p("m6 15 6-6 6 6"),
  "chevron-right": p("m9 6 6 6-6 6"),
  "chevron-left": p("m15 6-6 6 6 6"),
  "arrow-right": p("M5 12h14M13 6l6 6-6 6"),
  "arrow-left": p("M19 12H5M11 6l-6 6 6 6"),
  "arrow-up": p("M12 19V5M6 11l6-6 6 6"),
  "arrow-down": p("M12 5v14M6 13l6 6 6-6"),
  restart: p("M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5"),
  user: (
    <>
      {c(12, 8, 3.5)}
      {p("M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5")}
    </>
  ),
  "log-in": p("M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l4 4-4 4M14 12H4"),
  "log-out": p("M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 8l4 4-4 4M19 12H9"),
  sun: (
    <>
      {c(12, 12, 4)}
      {p("M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4")}
    </>
  ),
  moon: p("M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"),
  hand: p("M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5v-1a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V12m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.9-2.5l-2.3-3.6a1.5 1.5 0 0 1 2.4-1.8L8 14.5"),
  info: (
    <>
      {c(12, 12, 9)}
      {p("M12 11v5M12 8h.01")}
    </>
  ),
  alert: p("M12 4l9 15.5H3L12 4zM12 10v4M12 17h.01"),
  trash: p("M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"),
  plus: p("M12 5v14M5 12h14"),
  minus: p("M5 12h14"),
  command: p("M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zm0 0h6m-6 0v6m6-6V6.5A2.5 2.5 0 1 1 17.5 9H15zm0 0v6m0 0v2.5a2.5 2.5 0 1 0 2.5-2.5H15zm0 0H9m0 0v2.5A2.5 2.5 0 1 1 6.5 15H9z"),
  enter: p("M19 5v7a3 3 0 0 1-3 3H5M9 11l-4 4 4 4"),
  clock: (
    <>
      {c(12, 12, 9)}
      {p("M12 7v5l3 2")}
    </>
  ),
  type: p("M5 6.5v-2h14v2M12 4.5v15M9 19.5h6"),
  hash: p("M9.5 4 7.5 20M16.5 4l-2 16M4.5 9h15.5M4 15h15.5"),
  at: (
    <>
      {c(12, 12, 3.5)}
      {p("M15.5 8.5v5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.5 6.9")}
    </>
  ),
  layers: p("M12 4l9 4.75-9 4.75-9-4.75L12 4zM3 13.25 12 18l9-4.75"),
  code: p("M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"),
  play: p("M7 5l12 7-12 7V5z"),
  pause: p("M8 5v14M16 5v14"),
  upload: p("M12 16V4M7 9l5-5 5 5M4 20h16"),
  download: p("M12 4v12M7 11l5 5 5-5M4 20h16"),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      {p("M5 15V6a2 2 0 0 1 2-2h8")}
    </>
  ),
  edit: p("M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"),
  external: p("M14 5h5v5M19 5l-8 8M11 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-5"),
  eye: (
    <>
      {p("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z")}
      {c(12, 12, 3)}
    </>
  ),
  "eye-off": (
    <>
      {p("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM4 4l16 16")}
      {c(12, 12, 3)}
    </>
  ),
  volume: p("M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"),
  "volume-off": p("M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4zM16 9.5l5 5M21 9.5l-5 5"),
  target: (
    <>
      {c(12, 12, 9)}
      {c(12, 12, 5)}
      {c(12, 12, 1)}
    </>
  ),
  zap: p("M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z"),
  trophy: p("M8 4h8v6a4 4 0 0 1-8 0V4zM8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11M12 14v4M8.5 20h7M10 18h4"),
  flame: p("M12 3c.5 3-1.5 4.500-3 6.500A6 6 0 0 0 12 21a6 6 0 0 0 5-9.500c-.7 1-1.5 1.500-2.500 1.500.5-3.500-.5-7.500-2.500-10z"),
  star: p("m12 3.5 2.6 5.4 5.9.8-4.3 4.100 1 5.900L12 16.900l-5.200 2.800 1-5.900L3.500 9.700l5.900-.8L12 3.500z"),
  menu: p("M4 7h16M4 12h16M4 17h16"),
  more: p("M5 12h.01M12 12h.01M19 12h.01"),
  cursor: p("M12 4v16M9 4h6M9 20h6"),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Pixel size (width = height). Default 18. */
  size?: number;
  /** Accessible label. When omitted the icon is decorative (aria-hidden). */
  label?: string;
}

export function Icon({ name, size = 18, label, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-icon={name}
      {...rest}
      style={{ flexShrink: 0, ...rest.style }}
    >
      {ICONS[name]}
    </svg>
  );
}
