// Settings updates re-parse the active layout into a new (identical) object. Heavy consumers
// (the 3D scene, the generated curriculum) key their work on object identity, so hand them the
// same object for as long as the layout's content is unchanged.
import type { ParsedLayout } from "@/lib/types";

const recent: { signature: string; layout: ParsedLayout }[] = [];
const known = new WeakMap<ParsedLayout, ParsedLayout>();

function signatureOf(layout: ParsedLayout): string {
  return (
    `${layout.name}#${layout.width}x${layout.height}#` +
    layout.keys
      .map((k) => `${k.id},${k.x},${k.y},${k.w},${k.h},${k.label},${k.base},${k.shifted},${k.code ?? ""},${k.finger ? k.finger.hand + k.finger.finger : ""},${k.isHome ? 1 : 0},${k.rotation ? `${k.rotation.angle}/${k.rotation.cx}/${k.rotation.cy}` : ""}`)
      .join("|") +
    `#${layout.layers ? JSON.stringify(layout.layers) : ""}`
  );
}

/** The first parsed object seen with this exact content (small most-recently-used cache). */
export function stableLayout(layout: ParsedLayout): ParsedLayout {
  const hit = known.get(layout);
  if (hit) return hit;
  const signature = signatureOf(layout);
  const i = recent.findIndex((r) => r.signature === signature);
  let stable = layout;
  if (i >= 0) {
    stable = recent[i].layout;
    recent.unshift(...recent.splice(i, 1));
  } else {
    recent.unshift({ signature, layout });
    if (recent.length > 6) recent.pop();
  }
  known.set(layout, stable);
  return stable;
}
