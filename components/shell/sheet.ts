/**
 * The page column every route shares: 1360px of content at most (1440 with its margins), with a margin that clears the sheet frame.
 * Nav, main and footer all use it, so their edges line up. Pages that want a narrower measure
 * constrain themselves inside it.
 */
export const SHEET_COLUMN = "mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-10";
