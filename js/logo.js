// The CADLETS wordmark: chunky pixel letters with a dithered sunset fill, a bevel,
// a 3D block extrusion and a dark outline, drawn on a canvas so it stays crisp at
// any size and needs no web font. A Cadlet sits on the T.

import { sprite } from "./sprites.js";

// 7x9 cells, rounded where it reads well ("#" = filled)
const GLYPHS = {
  C: [".#####.", "#######", "##...##", "##.....", "##.....", "##.....", "##...##", "#######", ".#####."],
  A: [".#####.", "#######", "##...##", "##...##", "#######", "#######", "##...##", "##...##", "##...##"],
  D: ["#####..", "######.", "##..###", "##...##", "##...##", "##...##", "##..###", "######.", "#####.."],
  L: ["##.....", "##.....", "##.....", "##.....", "##.....", "##.....", "##.....", "#######", "#######"],
  E: ["#######", "#######", "##.....", "##.....", "######.", "######.", "##.....", "#######", "#######"],
  T: ["######", "######", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##.."],
  S: [".######", "#######", "##.....", "######.", ".######", ".....##", ".....##", "#######", "######."],
};

const FILL = ["#fff2b8", "#ffd45c", "#ffad38", "#f4812b", "#da561f"]; // top to bottom
const BEVEL_LIGHT = "#fff8dc";
const BEVEL_DARK = "#b23d16";
const EXTRUDE = ["#8a3412", "#6a260c", "#4c1a08"];
const OUTLINE = "#240d04";
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

function letter(ch, cell) {
  const rows = GLYPHS[ch];
  const cols = rows[0].length;
  const o = Math.max(1, Math.round(cell / 2));     // outline thickness
  const ext = Math.max(2, Math.round(cell * 1.5)); // extrusion depth
  const fw = cols * cell, fh = rows.length * cell;
  const W = fw + 2 * o + Math.ceil(ext * 0.5) + 1, H = fh + 2 * o + ext + 1;
  const face = new Uint8Array(W * H);
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols; c++) {
      if (rows[r][c] !== "#") continue;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) face[(o + r * cell + y) * W + o + c * cell + x] = 1;
    }
  }
  // the block below and to the right of the face
  const depth = new Uint8Array(W * H); // 0 = none, k = extruded k pixels deep
  for (let k = ext; k >= 1; k--) {
    const dx = Math.round(k * 0.5);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!face[y * W + x]) continue;
      const X = x + dx, Y = y + k;
      if (at(X, Y) && !face[Y * W + X]) depth[Y * W + X] = k;
    }
  }
  const solid = (x, y) => at(x, y) && (face[y * W + x] || depth[y * W + x]);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (solid(x, y)) continue;
    let near = false;
    for (let dy = -o; dy <= o && !near; dy++) for (let dx = -o; dx <= o && !near; dx++) {
      if (Math.abs(dx) + Math.abs(dy) <= o + (o > 1 ? 1 : 0) && solid(x + dx, y + dy)) near = true;
    }
    if (near) px(x, y, OUTLINE);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = depth[y * W + x];
    if (k) px(x, y, EXTRUDE[Math.min(EXTRUDE.length - 1, Math.floor((k - 1) / ext * EXTRUDE.length))]);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!face[y * W + x]) continue;
    const f = (xx, yy) => at(xx, yy) && face[yy * W + xx];
    let col;
    if (!f(x - 1, y) || !f(x, y - 1)) col = (!f(x - 1, y) && !f(x, y - 1)) ? "#ffffff" : BEVEL_LIGHT;
    else if (!f(x + 1, y) || !f(x, y + 1)) col = BEVEL_DARK;
    else {
      // vertical sunset, ordered-dithered between bands like 16-colour art
      const t = (y - o) / fh * (FILL.length - 1);
      const band = Math.floor(t), frac = t - band;
      col = FILL[Math.min(FILL.length - 1, band + (frac * 16 > BAYER[y % 4][x % 4] ? 1 : 0))];
    }
    px(x, y, col);
  }
  return { canvas: c, w: W, h: H, face: fw, top: o };
}

export class Wordmark {
  constructor(canvas, { cell = 4, gap = null, word = "CADLETS", cadlet = true, wave = true } = {}) {
    this.canvas = canvas;
    this.cell = cell;
    this.wave = wave;
    this.cadlet = cadlet;
    this.letters = [...word].map((ch) => letter(ch, cell));
    this.perch = [...word].indexOf("T");
    this.gap = gap ?? Math.round(cell * 0.5);
    this.amp = wave ? Math.max(1, Math.round(cell * 0.75)) : 0;
    this.headroom = cadlet ? 21 + this.amp : this.amp;
    this.w = this.letters.reduce((s, l) => s + l.w, 0) + this.gap * (this.letters.length - 1);
    this.h = Math.max(...this.letters.map((l) => l.h)) + this.headroom + this.amp;
    canvas.width = this.w;
    canvas.height = this.h;
    this.blink = 0;
    this.hop = 0;
    this.running = false;
    this.draw(0);
  }

  draw(now) {
    const g = this.canvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, this.w, this.h);
    let x = 0;
    this.letters.forEach((l, i) => {
      const dy = this.wave ? Math.round(Math.sin(now / 520 - i * 0.75) * this.amp) : 0;
      const y = this.headroom + dy;
      g.drawImage(l.canvas, x, y);
      if (this.cadlet && i === this.perch && this._ready()) this._cadlet(g, x, y, l, now);
      x += l.w + this.gap;
    });
  }

  _ready() {
    try { sprite("thr"); return true; } catch { return false; }
  }

  _cadlet(g, x, y, l, now) {
    if (now > this.blink + 160) this.blink = now + 1800 + Math.random() * 2600;
    if (now > this.hop + 500) this.hop = now + 2600 + Math.random() * 4000;
    const blinking = now > this.blink;
    const hopping = now > this.hop;
    const up = hopping ? Math.round(Math.sin(((now - this.hop) / 500) * Math.PI) * 5) : 0;
    const img = sprite(hopping ? "thr_happy" : blinking ? "thr_blink" : "thr");
    // centred on the T's bar, feet sinking into the outline
    g.drawImage(img, Math.round(x + l.face / 2 + l.top - img.width / 2 + 1), y + l.top - img.height + 3 - up);
  }

  // Scale by whole CSS pixels so every logo pixel is the same size.
  fit(maxCss) {
    const k = Math.max(1, Math.floor(maxCss / this.w));
    this.canvas.style.width = this.w * k + "px";
    this.canvas.style.height = this.h * k + "px";
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (now) => {
      if (!this.running) return;
      if (this.canvas.offsetParent !== null) this.draw(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }
}
