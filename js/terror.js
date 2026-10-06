// TERROR, the scene: the screen floods red, blood splatters, and TERROR slams into the
// middle and drips. Pixel art on one low-resolution canvas scaled up, like the field.

import { wordCanvas, BLOOD } from "./logo.js";

let word = null;

function rand(a, b) { return a + Math.random() * (b - a); }

// lowest opaque pixel of each column: where blood can drip from
function bottoms(c) {
  const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
  const out = new Array(c.width).fill(-1);
  for (let x = 0; x < c.width; x++) {
    for (let y = c.height - 1; y >= 0; y--) if (data[(y * c.width + x) * 4 + 3] > 0) { out[x] = y; break; }
  }
  return out;
}

function splat(n) {
  // a blob of a few rough squares and some flecks around it
  const parts = [];
  const r = rand(2, 6);
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), d = Math.random() < 0.7 ? rand(0, r) : rand(r, r * 2.6);
    const s = d < r ? Math.ceil(rand(1, 3.5)) : 1;
    parts.push([Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d * 0.8), s]);
  }
  return parts;
}

/** Play the scene; resolves when it is over (even if the tab is hidden meanwhile). */
export function playTerror({ first = true, ms = null } = {}) {
  const dur = ms ?? (first ? 4200 : 2800);
  const el = document.getElementById("terror");
  if (!word) word = wordCanvas("TERROR", 3, BLOOD);
  const W = innerWidth, H = innerHeight;
  const s = Math.max(2, Math.floor(Math.min((W * 0.7) / word.width, (H * 0.34) / word.height)));
  const w = Math.ceil(W / s), h = Math.ceil(H / s);
  el.width = w; el.height = h;
  el.style.width = w * s + "px"; el.style.height = h * s + "px";
  el.classList.remove("hidden");
  const g = el.getContext("2d");
  g.imageSmoothingEnabled = false;

  const wx = Math.round((w - word.width) / 2), wy = Math.round((h - word.height) / 2 - h * 0.04);
  const bot = bottoms(word);
  const cols = bot.map((y, x) => (y > word.height * 0.6 ? x : -1)).filter((x) => x >= 0);
  const drips = Array.from({ length: first ? 18 : 12 }, () => ({
    x: cols[Math.floor(Math.random() * cols.length)], len: rand(6, first ? 46 : 30),
    start: rand(380, 1100), grow: rand(1400, 2600), wide: Math.random() < 0.3,
  }));
  const splats = Array.from({ length: first ? 46 : 26 }, () => {
    const edge = Math.random() < 0.65;
    return {
      x: edge ? (Math.random() < 0.5 ? rand(0, w * 0.22) : rand(w * 0.78, w)) : rand(0, w),
      y: edge ? rand(0, h) : (Math.random() < 0.5 ? rand(0, h * 0.25) : rand(h * 0.75, h)),
      at: rand(0, 900), parts: splat(Math.floor(rand(8, 18))), dark: Math.random() < 0.5,
    };
  });

  const draw = (t) => {
    const fade = t > dur - 500 ? Math.max(0, (dur - t) / 500) : 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.globalAlpha = fade;
    // the flood: a hard flash, then a deep red that stays
    const a = t < 120 ? 0.94 : t < 700 ? 0.94 - 0.3 * ((t - 120) / 580) : 0.64 + 0.05 * Math.sin(t / 90);
    g.fillStyle = `rgba(128, 0, 10, ${a})`;
    g.fillRect(0, 0, w, h);
    const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(10,0,0,.85)");
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
    for (const sp of splats) {
      if (t < sp.at) continue;
      g.fillStyle = sp.dark ? "#3a0006" : "#6e0410";
      for (const [dx, dy, sz] of sp.parts) g.fillRect(Math.round(sp.x + dx), Math.round(sp.y + dy), sz, sz);
    }
    if (t < 250) return;
    // TERROR slams in, then trembles
    const k = Math.min(1, (t - 250) / 160);
    const scale = k < 1 ? 1.7 - 0.7 * Math.round(k * 4) / 4 : 1;
    const jx = Math.random() < 0.35 ? (Math.random() < 0.5 ? -1 : 1) : 0;
    const jy = Math.random() < 0.15 ? (Math.random() < 0.5 ? -1 : 1) : 0;
    const dw = Math.round(word.width * scale), dh = Math.round(word.height * scale);
    const x = Math.round(w / 2 - dw / 2) + jx, y = Math.round(wy + word.height / 2 - dh / 2) + jy;
    g.drawImage(word, x, y, dw, dh);
    if (k === 1 && Math.random() < 0.18) {
      // a torn line, as if the screen itself flinched
      const sy = Math.floor(rand(0, word.height - 3)), sh = Math.ceil(rand(2, 5));
      g.drawImage(word, 0, sy, word.width, sh, x + Math.round(rand(-6, 6)), y + sy, word.width, sh);
    }
    if (k < 1) return;
    for (const d of drips) {
      if (t < d.start) continue;
      const p = Math.min(1, (t - d.start) / d.grow);
      const len = Math.round(d.len * (1 - (1 - p) * (1 - p)));
      const dx = x + d.x, dy = y + bot[d.x] - 2, ww = d.wide ? 3 : 2;
      g.fillStyle = BLOOD.outline;
      g.fillRect(dx - 1, dy, ww + 2, len + 1);
      g.fillStyle = "#8e0a14";
      g.fillRect(dx, dy, ww, len);
      g.fillStyle = "#d42a30";
      g.fillRect(dx, dy, 1, Math.max(0, len - 2));
      // the drop gathering at the end
      g.fillStyle = BLOOD.outline;
      g.fillRect(dx - 1, dy + len - 1, ww + 2, 4);
      g.fillStyle = "#8e0a14";
      g.fillRect(dx - 1 + 1, dy + len, ww, 2);
    }
  };

  return new Promise((resolve) => {
    const t0 = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.classList.add("hidden");
      g.clearRect(0, 0, w, h);
      resolve();
    };
    const step = (now) => {
      if (done) return;
      draw(now - t0);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(finish, dur); // a hidden tab draws no frames, but the scene still ends
  });
}
