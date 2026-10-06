// Tiny synthesised sound: chirps for the Cadence's glyphs and 8-bit effects.

let ctx = null;
let master = null;
let enabled = true;
const last = new Map();

export function unlock() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);
}

export function setEnabled(on) {
  enabled = on;
  if (master) master.gain.value = on ? 0.32 : 0;
}

export function isEnabled() {
  return enabled;
}

function limited(key, ms) {
  const now = performance.now();
  if ((last.get(key) || 0) + ms > now) return true;
  last.set(key, now);
  return false;
}

function tone({ f = 440, f2 = null, t = 0.12, type = "square", vol = 0.25, at = 0, pan = 0 }) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + t);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
  let node = g;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    node = p;
  }
  o.connect(g);
  node.connect(master);
  o.start(t0);
  o.stop(t0 + t + 0.02);
}

function noise({ t = 0.15, vol = 0.2, at = 0, hp = 800, lp = 6000 }) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + at;
  const len = Math.floor(ctx.sampleRate * t);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const f1 = ctx.createBiquadFilter(); f1.type = "highpass"; f1.frequency.value = hp;
  const f2 = ctx.createBiquadFilter(); f2.type = "lowpass"; f2.frequency.value = lp;
  const g = ctx.createGain(); g.gain.value = vol;
  s.connect(f1); f1.connect(f2); f2.connect(g); g.connect(master);
  s.start(t0);
}

// Each glyph is a little melody; each Cadlet sings it at its own pitch.
export function chirp(glyph, id = 0, pan = 0) {
  if (limited("chirp", 90) || limited("chirp" + id, 900)) return;
  const k = 1 + ((id * 37) % 9) / 30;
  const v = 0.07;
  if (glyph === 1) { tone({ f: 520 * k, f2: 390 * k, t: 0.09, type: "triangle", vol: v, pan }); tone({ f: 390 * k, t: 0.08, type: "triangle", vol: v, at: 0.1, pan }); }
  else if (glyph === 2) { for (let i = 0; i < 3; i++) tone({ f: (900 + i * 120) * k, t: 0.05, type: "square", vol: v * 0.6, at: i * 0.055, pan }); }
  else if (glyph === 3) { tone({ f: 300 * k, f2: 620 * k, t: 0.16, type: "triangle", vol: v, pan }); tone({ f: 620 * k, f2: 340 * k, t: 0.12, type: "triangle", vol: v * 0.8, at: 0.16, pan }); }
}

export const sfx = {
  click() { tone({ f: 660, t: 0.04, vol: 0.12 }); },
  eat(pan) { if (limited("eat", 120)) return; noise({ t: 0.07, vol: 0.12, hp: 1200, lp: 4000 }); tone({ f: 180, t: 0.05, vol: 0.06, type: "square", at: 0.06, pan }); },
  splash(pan) { if (limited("splash", 200)) return; noise({ t: 0.25, vol: 0.1, hp: 300, lp: 2500 }); },
  kick(pan) { if (limited("kick", 120)) return; tone({ f: 140, f2: 60, t: 0.1, type: "sine", vol: 0.25, pan }); },
  love(pan) { if (limited("love", 300)) return; tone({ f: 880, t: 0.06, type: "triangle", vol: 0.06, pan }); tone({ f: 1175, t: 0.08, type: "triangle", vol: 0.06, at: 0.07, pan }); },
  split(pan) { if (limited("split", 150)) return; tone({ f: 330, f2: 990, t: 0.18, type: "square", vol: 0.1, pan }); tone({ f: 990, t: 0.06, type: "triangle", vol: 0.08, at: 0.2, pan }); },
  hatch() { noise({ t: 0.08, vol: 0.2, hp: 2000 }); noise({ t: 0.08, vol: 0.2, hp: 2000, at: 0.12 }); tone({ f: 523, f2: 1046, t: 0.25, type: "triangle", vol: 0.15, at: 0.25 }); },
  death(pan) { if (limited("death", 400)) return; tone({ f: 392, f2: 98, t: 0.6, type: "triangle", vol: 0.16, pan }); tone({ f: 196, f2: 60, t: 0.7, type: "square", vol: 0.05, at: 0.1, pan }); },
  hurt(pan) { tone({ f: 600, f2: 200, t: 0.18, type: "square", vol: 0.14, pan }); },
  poison(pan) { if (limited("poison", 200)) return; tone({ f: 200, f2: 120, t: 0.3, type: "sawtooth", vol: 0.07, pan }); },
  squeak(pan) { tone({ f: 1300 + Math.random() * 500, f2: 1900, t: 0.07, type: "square", vol: 0.05, pan }); },
  crush(pan) { noise({ t: 0.12, vol: 0.32, hp: 150, lp: 2500 }); tone({ f: 220, f2: 40, t: 0.25, type: "sawtooth", vol: 0.12, pan }); tone({ f: 1600, f2: 300, t: 0.18, type: "square", vol: 0.06, at: 0.02, pan }); },
  pet(pan) { tone({ f: 784, t: 0.07, type: "triangle", vol: 0.1, pan }); tone({ f: 988, t: 0.09, type: "triangle", vol: 0.1, at: 0.08, pan }); },
  drop() { tone({ f: 500, f2: 240, t: 0.12, type: "triangle", vol: 0.12 }); },
  lesson() { [523, 659, 784, 1046].forEach((f, i) => tone({ f, t: 0.16, type: "triangle", vol: 0.12, at: i * 0.09 })); },
  evolve() { [262, 330, 392, 523, 659, 784].forEach((f, i) => tone({ f, t: 0.22, type: "square", vol: 0.07, at: i * 0.11 })); },
  glitch() { for (let i = 0; i < 6; i++) { noise({ t: 0.05, vol: 0.18, hp: 200 + Math.random() * 3000, at: i * 0.07 }); tone({ f: 80 + Math.random() * 900, t: 0.05, type: "square", vol: 0.06, at: i * 0.07 }); } },
};
