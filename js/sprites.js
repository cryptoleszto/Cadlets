// Pixel art: hand-drawn sprites from assets/sprites.json plus procedural trees and ground.

export const TILE = 16;

let PALETTE = {};
const RAW = {};
const CACHE = new Map();

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

export async function loadSprites() {
  const data = await (await fetch("assets/sprites.json")).json();
  PALETTE = data.palette;
  Object.assign(RAW, data.sprites);
}

function paint(rows, map) {
  const h = rows.length, w = rows[0].length;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const key = rows[y][x];
      let col = PALETTE[key];
      if (!col) continue;
      let rgb = hex(col);
      if (map) rgb = map(rgb, key, x, y);
      if (!rgb) continue;
      const i = (y * w + x) * 4;
      img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = rgb[3] ?? 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function sprite(name, variant = "") {
  const key = name + "|" + variant;
  if (CACHE.has(key)) return CACHE.get(key);
  const rows = RAW[name];
  if (!rows) throw new Error("no sprite " + name);
  let c;
  if (variant === "flip") {
    c = flip(sprite(name));
  } else if (variant === "glitch") {
    c = paint(rows, glitchMap(name.length));
  } else if (variant === "red") {
    c = paint(rows, (rgb) => [Math.min(255, rgb[0] * 0.6 + 120), rgb[1] * 0.25, rgb[2] * 0.2]);
  } else if (variant === "white") {
    c = paint(rows, () => [255, 255, 255]);
  } else if (variant === "dark") {
    c = paint(rows, () => [0, 0, 0, 90]);
  } else if (variant === "sick") {
    c = paint(rows, (rgb, k) => (k === "Y" || k === "L" || k === "S") ? [rgb[0] * 0.72, rgb[1] * 0.92, rgb[2] * 0.45 + 30] : rgb);
  } else if (variant === "night") {
    c = paint(rows, (rgb) => [rgb[0] * 0.55, rgb[1] * 0.6, rgb[2] * 0.85]);
  } else {
    c = paint(rows);
  }
  CACHE.set(key, c);
  return c;
}

export function has(name) {
  return !!RAW[name];
}

function glitchMap(seed) {
  const r = rng(seed * 977 + 13);
  return (rgb, key) => {
    const v = r();
    if (v < 0.12) return [20, 230, 220];
    if (v < 0.22) return [10, 10, 14];
    const lum = (rgb[0] + rgb[1] + rgb[2]) / 3;
    return [Math.min(255, lum * 1.15 + 60), lum * 0.35, Math.min(255, lum * 1.2 + 70)];
  };
}

function flip(src) {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  const g = c.getContext("2d");
  g.translate(src.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

// ------------------------------------------------------------------ procedural canopies

const GREENS = ["#24421a", "#2f5a20", "#3c6e26", "#4a8230", "#5b9638", "#72ad46"];
const GLITCH_GREENS = ["#2a0f33", "#4a1a5c", "#6c2a84", "#9038a8", "#b14ccc", "#d877ec"];

function canopy(seed, w, h, greens) {
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const blobs = [];
  const n = 4 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const rad = (0.26 + r() * 0.12) * Math.min(w, h * 1.1);
    blobs.push({
      x: w / 2 + (r() - 0.5) * (w - rad * 2) * 0.9,
      y: h * 0.52 + (r() - 0.5) * (h - rad * 2) * 0.8,
      r: rad,
    });
  }
  blobs.push({ x: w / 2, y: h * 0.5, r: Math.min(w, h) * 0.42 });
  const inside = (x, y) => {
    let best = -1;
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const d = Math.hypot(x - b.x, (y - b.y) * 1.05);
      if (d <= b.r) best = Math.max(best, 1 - d / b.r);
    }
    return best;
  };
  const img = g.createImageData(w, h);
  const noise = [];
  for (let i = 0; i < w * h; i++) noise.push(r());
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = inside(x + 0.5, y + 0.5);
      if (v < 0) continue;
      const edge = inside(x + 0.5, y + 2.5) < 0 || inside(x + 2.5, y + 0.5) < 0 || inside(x - 1.5, y + 0.5) < 0 || inside(x + 0.5, y - 1.5) < 0;
      // light from the upper left, darker underneath; each blob shades its own lower part
      let shade = 2.2 + v * 2.2 - (y / h) * 1.6 - (x / w) * 0.6 + (noise[y * w + x] - 0.5) * 1.3;
      for (const b of blobs) {
        const d = Math.hypot(x - b.x, y - b.y);
        if (d < b.r && y > b.y + b.r * 0.35 && d > b.r * 0.72) shade -= 0.9;
      }
      let idx = Math.max(1, Math.min(greens.length - 1, Math.round(shade)));
      if (edge) idx = 0;
      const [R, G, B] = hex(greens[idx]);
      const i = (y * w + x) * 4;
      img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function forestTree(seed) {
  const key = "forest|" + seed;
  if (CACHE.has(key)) return CACHE.get(key);
  const r = rng(seed);
  const w = 30 + Math.floor(r() * 10), h = 30 + Math.floor(r() * 8);
  const top = canopy(seed, w, h, GREENS);
  const c = document.createElement("canvas");
  c.width = w; c.height = h + 7;
  const g = c.getContext("2d");
  if (r() < 0.6) {
    g.fillStyle = "#3d2614"; g.fillRect(Math.floor(w / 2) - 3, h - 6, 6, 12);
    g.fillStyle = "#5b3a1e"; g.fillRect(Math.floor(w / 2) - 2, h - 6, 2, 11);
  }
  g.drawImage(top, 0, 0);
  CACHE.set(key, c);
  return c;
}

export function appleTree(seed, glitched) {
  const key = "apple|" + seed + "|" + (glitched ? 1 : 0);
  if (CACHE.has(key)) return CACHE.get(key);
  const w = 42, h = 36;
  const top = canopy(seed, w, h, glitched ? GLITCH_GREENS : GREENS);
  const c = document.createElement("canvas");
  c.width = w; c.height = h + 14;
  const g = c.getContext("2d");
  g.fillStyle = glitched ? "#1c0c22" : "#3a2412"; g.fillRect(w / 2 - 4, h - 8, 8, 21);
  g.fillStyle = glitched ? "#3c1a48" : "#5c3a1c"; g.fillRect(w / 2 - 3, h - 8, 3, 20);
  g.fillStyle = glitched ? "#2a0f33" : "#2b1a0c"; g.fillRect(w / 2 - 6, h + 11, 12, 2);
  g.drawImage(top, 0, 0);
  CACHE.set(key, c);
  return c;
}

// Fruit positions on an apple tree canopy (relative to its top-left).
export const FRUIT_SPOTS = [[12, 12], [27, 9], [19, 19], [32, 20], [8, 23], [24, 27], [15, 6], [34, 13]];

// ------------------------------------------------------------------ ground

const GROUND = ["#454f1f", "#4b5623", "#515c27", "#58642c", "#5f6c31"];
const GRASS = ["#356b26", "#3f792b", "#468430", "#4f9036", "#2d5c20"];

export function ground(seed, pxW, pxH, clear, origin) {
  // clear: [x0, y0, x1, y1] in world pixels; origin: world pixel at canvas (0, 0)
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = pxW; c.height = pxH;
  const g = c.getContext("2d");
  const img = g.createImageData(pxW, pxH);
  // low-frequency value noise for worn patches
  const cell = 22;
  const gw = Math.ceil(pxW / cell) + 2, gh = Math.ceil(pxH / cell) + 2;
  const grid = [];
  for (let i = 0; i < gw * gh; i++) grid.push(r());
  const smooth = (x, y) => {
    const gx = x / cell, gy = y / cell;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1];
    const cc = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (cc * (1 - sx) + d * sx) * sy;
  };
  // a faint hex lattice, as on the game's field
  const hexR = 26;
  const hexDist = (x, y) => {
    const q = (2 / 3 * x) / hexR;
    const rr = (-1 / 3 * x + Math.sqrt(3) / 3 * y) / hexR;
    let cx = q, cz = rr, cy = -q - rr;
    let rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
    const dx = Math.abs(rx - cx), dy = Math.abs(ry - cy), dz = Math.abs(rz - cz);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
    const hx = hexR * 3 / 2 * rx, hy = hexR * Math.sqrt(3) * (rz + rx / 2);
    const px = Math.abs(x - hx), py = Math.abs(y - hy);
    return Math.max(px * 0.5 + py * Math.sqrt(3) / 2, px) / hexR;
  };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const cellLight = new Map();
  const hexCell = (x, y) => {
    // which hex cell (axial coords) a pixel lies in, and how far from its centre
    const q = (2 / 3 * x) / hexR, rr = (-1 / 3 * x + Math.sqrt(3) / 3 * y) / hexR;
    let rx = Math.round(q), rz = Math.round(rr), ry = Math.round(-q - rr);
    const dx = Math.abs(rx - q), dy = Math.abs(ry + q + rr), dz = Math.abs(rz - rr);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
    return rx * 1000 + rz;
  };
  for (let y = 0; y < pxH; y++) {
    for (let x = 0; x < pxW; x++) {
      const wx = x + origin[0], wy = y + origin[1];
      const n = smooth(x, y);
      const bay = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      const out = Math.max(clear[0] - wx, wx - clear[2], clear[1] - wy, wy - clear[3]);
      let col;
      if (out > bay * 6) {
        const k = Math.floor(n * 2.6 + bay * 0.9);
        col = GRASS[Math.max(0, Math.min(3, k))];
      } else {
        // dark olive floor; worn, lighter hexagons; soft ordered dither between levels
        const cell = hexCell(wx, wy);
        if (!cellLight.has(cell)) cellLight.set(cell, r());
        const hd = hexDist(wx, wy);
        let level = 1.25 + (n - 0.5) * 1.6 + bay * 0.7;
        const lit = cellLight.get(cell);
        if (lit > 0.62 && hd < 0.86) level += lit > 0.85 ? 1.2 : 0.8;
        if (hd > 0.9 && hd < 0.96 && lit > 0.62) level -= 0.6;
        let k = Math.floor(level);
        if (r() < 0.012) k += r() < 0.5 ? -1 : 1;
        col = GROUND[Math.max(0, Math.min(4, k))];
      }
      const [R, G, B] = hex(col);
      const i = (y * pxW + x) * 4;
      img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // tufts and pebbles
  for (let i = 0; i < (pxW * pxH) / 900; i++) {
    const x = Math.floor(r() * pxW), y = Math.floor(r() * pxH);
    const wx = x + origin[0], wy = y + origin[1];
    const inside = wx > clear[0] && wx < clear[2] && wy > clear[1] && wy < clear[3];
    if (inside) {
      g.fillStyle = r() < 0.5 ? "#68773a" : "#3b4519";
      g.fillRect(x, y, 1, 2); g.fillRect(x + 2, y + 1, 1, 1); g.fillRect(x - 1, y + 1, 1, 1);
    } else {
      g.fillStyle = "#5ea13f"; g.fillRect(x, y, 1, 2); g.fillRect(x + 1, y - 1, 1, 2);
    }
  }
  return c;
}
