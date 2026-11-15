// Tiny WebAudio blip for wrong keys (settings.soundOnError). No assets, no dependencies.
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Short, soft low "thud". Safe to call on every wrong keystroke; silently does nothing if audio is unavailable. */
export function playErrorSound(volume = 0.12): void {
  const ac = audio();
  if (!ac) return;
  try {
    if (ac.state === "suspended") void ac.resume();
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.09);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  } catch {
    /* ignore */
  }
}
