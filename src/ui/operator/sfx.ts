// Small synthesized sound cues (Web Audio, no assets). Started by the first user gesture (Start shift).

export type Sfx = "call" | "callA" | "launch" | "arrive" | "good" | "bad" | "warn";

let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem("dfr-muted") === "1";
  } catch {
    return false;
  }
})();

export const isMuted = () => muted;

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem("dfr-muted", m ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

/** Create the audio context inside a user gesture so browsers allow playback. */
export function unlockAudio() {
  if (!ctx && typeof AudioContext !== "undefined") ctx = new AudioContext();
  void ctx?.resume();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.08, slideTo?: number) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function sfx(kind: Sfx) {
  if (muted || !ctx) return;
  switch (kind) {
    case "call":
      tone(880, 0, 0.12, "sine", 0.06);
      tone(1175, 0.12, 0.16, "sine", 0.05);
      break;
    case "callA":
      tone(988, 0, 0.1, "square", 0.04);
      tone(988, 0.16, 0.1, "square", 0.04);
      tone(1319, 0.32, 0.18, "square", 0.04);
      break;
    case "launch":
      tone(220, 0, 0.35, "sawtooth", 0.025, 660);
      break;
    case "arrive":
      tone(660, 0, 0.09, "triangle", 0.07);
      tone(990, 0.09, 0.14, "triangle", 0.06);
      break;
    case "good":
      tone(523, 0, 0.1, "triangle", 0.07);
      tone(659, 0.1, 0.1, "triangle", 0.07);
      tone(784, 0.2, 0.22, "triangle", 0.07);
      break;
    case "bad":
      tone(330, 0, 0.18, "sawtooth", 0.04);
      tone(247, 0.18, 0.3, "sawtooth", 0.04);
      break;
    case "warn":
      tone(440, 0, 0.12, "square", 0.03);
      tone(440, 0.2, 0.12, "square", 0.03);
      break;
  }
}
