// Download progress of the hand model (public/models/hand.glb), shared between the loader in
// rig.ts and the loading bar in components/typing/HandsPanel. No three.js import: the panel reads
// this without pulling the 3D bundle in.

export interface HandModelProgress {
  /** "idle" until loadHandTemplate() was called, then "loading", then "done" (or "error"). */
  phase: "idle" | "loading" | "done" | "error";
  loaded: number;
  /** Bytes expected; 0 when the server did not say (then the bar is indeterminate). */
  total: number;
}

let state: HandModelProgress = { phase: "idle", loaded: 0, total: 0 };
const listeners = new Set<() => void>();

export const getHandModelProgress = (): HandModelProgress => state;

export function setHandModelProgress(patch: Partial<HandModelProgress>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeHandModelProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
