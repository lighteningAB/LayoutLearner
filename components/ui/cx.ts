export type ClassValue = string | number | false | null | undefined;

/** Tiny className joiner: cx("a", cond && "b") */
export function cx(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Plain text children (a string or number): the case where a label can be trimmed to its cap height. */
export function isText(node: unknown): node is string | number {
  return typeof node === "string" || typeof node === "number";
}
