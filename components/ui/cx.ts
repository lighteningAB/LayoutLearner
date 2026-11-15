export type ClassValue = string | number | false | null | undefined;

/** Tiny className joiner: cx("a", cond && "b") */
export function cx(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(" ");
}
