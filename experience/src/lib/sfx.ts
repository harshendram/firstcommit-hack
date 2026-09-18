/**
 * Tiny Web-Audio SFX — no asset downloads, unlocks on first user gesture.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let muted = false;
let stepClock = 0;

/** Global loudness multiplier (~3× previous default). */
const MASTER_GAIN = 0.85;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
  }
  return ctx;
}

function out(): AudioNode {
  if (!master) ac();
  return master ?? ctx!.destination;
}

export function setSfxMuted(v: boolean) {
  muted = v;
  // The Sound pill governs the theme too — the repo's standing rule is that
  // music respects the same mute flag and never starts before a gesture.
  if (music) music.volume = v ? 0 : MUSIC_VOLUME;
}

export function isSfxMuted() {
  return muted;
}

/* ------------------------------------------------------------------ *
 * Background theme.
 *
 * Quiet on purpose: this plays under narration during a demo, so it sits at
 * a level you stop noticing. Started from the same first-gesture unlock as
 * the SFX, because browsers will not autoplay audio before one.
 * ------------------------------------------------------------------ */

/** Deliberately low — it is a bed, not a soundtrack. 40% down from 0.12. */
const MUSIC_VOLUME = 0.072;

let music: HTMLAudioElement | null = null;

/** Idempotent: safe to call on every unlock attempt. */
export function startMusic(src: string) {
  if (typeof window === "undefined" || music) return;
  const el = new Audio(src);
  el.loop = true;
  el.preload = "auto";
  el.volume = 0;
  music = el;
  void el.play().then(fadeMusicIn).catch(() => {
    // Autoplay refused (no gesture yet). Drop it so the next unlock retries.
    music = null;
  });
}

function fadeMusicIn() {
  const el = music;
  if (!el) return;
  const target = muted ? 0 : MUSIC_VOLUME;
  const started = performance.now();
  const step = () => {
    if (music !== el) return;
    const t = Math.min(1, (performance.now() - started) / 2500);
    el.volume = (muted ? 0 : target) * t;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Call from a click/key so browsers allow audio. */
export async function unlockSfx() {
  const c = ac();
  if (!c) return;
  if (c.state === "suspended") await c.resume();
  unlocked = true;
}

function beep(
  freq: number,
  dur: number,
  type: OscillatorType = "sine",
  gain = 0.22,
  slideTo?: number,
) {
  if (muted || !unlocked) return;
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  }
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g);
  g.connect(out());
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function thud(dur = 0.08, gain = 0.18) {
  if (muted || !unlocked) return;
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime;
  const bufferSize = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 420;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(out());
  src.start(t0);
}

/**
 * Filtered noise with the band sweeping — air moving, rather than something
 * being hit.
 *
 * Same buffer-and-filter shape as `thud()`, but a bandpass that ramps instead
 * of a fixed lowpass, so one helper can voice a whoosh, a cloth rustle or a
 * scuff depending on where the sweep starts and ends.
 */
function noiseSweep(
  from: number,
  to: number,
  dur: number,
  gain = 0.14,
  q = 0.9,
) {
  if (muted || !unlocked) return;
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime;
  const size = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, size, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buffer;

  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = q;
  band.frequency.setValueAtTime(from, t0);
  band.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);

  const g = c.createGain();
  // Fade in as well as out: a noise burst that starts at full gain clicks.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.28);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(band);
  band.connect(g);
  g.connect(out());
  src.start(t0);
}

/**
 * A jump, as a body rather than a game console.
 *
 * This was `beep(240, 0.2, "square", 0.16, 95)` — a square wave sliding down,
 * which is a 1980s arcade sound and the one thing in the mix that did not
 * belong in a village. Three quiet layers now: cloth and air moving up, a soft
 * effort in the chest, and the scuff of the foot leaving the ground.
 */
export function sfxJump() {
  noiseSweep(900, 2400, 0.13, 0.1);
  beep(180, 0.16, "sine", 0.1, 260);
  thud(0.04, 0.1);
}

/** The other half of the pair: boot first, then the cloth settling after it. */
export function sfxLand() {
  thud(0.11, 0.22);
  noiseSweep(1600, 500, 0.16, 0.075);
  beep(110, 0.09, "sine", 0.09, 78);
}

export function sfxFootstep(running: boolean) {
  const interval = running ? 0.22 : 0.38;
  const now = performance.now() / 1000;
  if (now - stepClock < interval) return;
  stepClock = now;
  thud(running ? 0.055 : 0.075, running ? 0.14 : 0.11);
  beep(running ? 150 : 115, 0.045, "triangle", running ? 0.09 : 0.07);
}

export function sfxUi() {
  beep(540, 0.06, "sine", 0.14);
}

export function sfxModal() {
  beep(340, 0.12, "sine", 0.15, 560);
}

/** The wardstone asking, then not getting an answer. Urgent, not shrill. */
export function sfxAlert() {
  beep(660, 0.09, "square", 0.12);
  window.setTimeout(() => beep(520, 0.14, "square", 0.12), 130);
}

/** Someone is coming, or she said she was fine. Either way it lets go. */
export function sfxCalm() {
  beep(420, 0.12, "sine", 0.12, 620);
  window.setTimeout(() => beep(620, 0.22, "sine", 0.1, 780), 120);
}
