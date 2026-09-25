export type SoundPresetId =
  | "tritone"
  | "crystal"
  | "chime"
  | "marimba"
  | "ding"
  | "pop";

export const SOUND_PRESETS: { id: SoundPresetId; label: string }[] = [
  { id: "tritone", label: "Tri-tone (premium)" },
  { id: "crystal", label: "Crystal" },
  { id: "chime", label: "Chime" },
  { id: "marimba", label: "Marimba" },
  { id: "ding", label: "Ding" },
  { id: "pop", label: "Pop" },
];

// Satu AudioContext dipakai ulang (bikin baru itu mahal), dan browser cuma
// izinkan resume setelah user gesture pertama (klik/keydown).
let sharedAudioCtx: AudioContext | null = null;

function getCtx() {
  if (!sharedAudioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    sharedAudioCtx = new Ctor();
  }
  return sharedAudioCtx;
}

export function unlockAudio() {
  const ctx = getCtx();
  if (ctx.state === "suspended") ctx.resume();
}

function tone(
  ctx: AudioContext,
  {
    freq,
    start,
    dur,
    type,
    peak,
    glideTo,
  }: {
    freq: number;
    start: number;
    dur: number;
    type: OscillatorType;
    peak: number;
    glideTo?: number;
  }
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
  if (glideTo) {
    osc.frequency.exponentialRampToValueAtTime(
      glideTo,
      ctx.currentTime + start + dur
    );
  }
  gain.gain.setValueAtTime(0, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(peak, ctx.currentTime + start + 0.01); // attack
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur); // decay
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur + 0.05);
}

export function playSound(preset: SoundPresetId, volume = 0.6) {
  const ctx = getCtx();
  switch (preset) {
    case "tritone":
      [659.25, 783.99, 1046.5].forEach((freq, i) =>
        tone(ctx, {
          freq,
          start: i * 0.13,
          dur: 0.34,
          type: "triangle",
          peak: volume,
        })
      );
      break;
    case "crystal":
      [1046.5, 1318.51, 1567.98].forEach((freq, i) =>
        tone(ctx, { freq, start: i * 0.09, dur: 0.7, type: "sine", peak: volume })
      );
      tone(ctx, {
        freq: 2093,
        start: 0.05,
        dur: 0.5,
        type: "sine",
        peak: volume * 0.3,
      }); // sparkle
      break;
    case "chime":
      [587.33, 880].forEach((freq, i) =>
        tone(ctx, { freq, start: i * 0.16, dur: 0.5, type: "sine", peak: volume })
      );
      break;
    case "marimba":
      [523.25, 783.99].forEach((freq, i) =>
        tone(ctx, {
          freq,
          start: i * 0.11,
          dur: 0.22,
          type: "triangle",
          peak: volume,
        })
      );
      break;
    case "ding":
      tone(ctx, { freq: 880, start: 0, dur: 0.6, type: "sine", peak: volume });
      tone(ctx, {
        freq: 1760,
        start: 0,
        dur: 0.4,
        type: "sine",
        peak: volume * 0.4,
      });
      break;
    case "pop":
      tone(ctx, {
        freq: 420,
        start: 0,
        dur: 0.13,
        type: "sine",
        peak: volume,
        glideTo: 900,
      });
      break;
  }
}
