// The landing page: the animated wordmark, the maintenance switch (site.json), the
// visitor's saved Cadence, and a little clearing of decorative Cadlets. These ones are
// scripted (a few lines of random walking); the real ones in the game are not.

import { loadSprites, sprite, ground, forestTree, appleTree, rng, FRUIT_SPOTS } from "./sprites.js";
import { Wordmark } from "./logo.js";
import { siteStatus, savedCadence } from "./site.js";

const $ = (s) => document.querySelector(s);
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ wordmark

const logo = new Wordmark($("#logo"), { cell: 4, wave: !still });
const fitLogo = () => logo.fit(Math.min(820, innerWidth * 0.9));
fitLogo();
if (!still) logo.start();

// ------------------------------------------------------------------ open or closed

async function gate() {
  const [site, save] = await Promise.all([siteStatus(), savedCadence()]);
  const status = $("#status");
  status.classList.remove("checking");
  if (site.status === "maintenance") {
    status.classList.add("maintenance");
    status.lastElementChild.textContent = "MAINTENANCE";
    $("#cta").classList.add("hidden");
    $("#closed").classList.remove("hidden");
    if (site.message) $("#closed-msg").textContent = site.message;
    $("#closed-back").textContent = site.back;
    $("#fine").classList.add("hidden");
    for (const a of document.querySelectorAll(".play-link")) {
      a.removeAttribute("href");
      a.setAttribute("aria-disabled", "true");
      a.classList.add("hidden");
    }
    return;
  }
  status.lastElementChild.textContent = "OPEN";
  if (save) {
    const day = Math.floor(save.beat / 240) + 1;
    for (const a of document.querySelectorAll(".play-link")) a.innerHTML = `CONTINUE<small>YOUR COLONY · DAY ${day} · BEAT ${save.beat}</small>`;
    $("#final-line").textContent = "Your colony is waiting.";
    $("#fine").textContent = "Your colony is saved in this browser · pick up where you left off";
  }
}
$("#status").classList.add("checking");
gate();

// ------------------------------------------------------------------ pixel icons

function paintIcons() {
  for (const c of document.querySelectorAll("canvas[data-icon]")) {
    const img = sprite(c.dataset.icon);
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0);
  }
}

// ------------------------------------------------------------------ the clearing

const H = 132; // world pixels tall

class Clearing {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.visible = true;
    this.last = 0;
    this.build();
  }

  build() {
    const css = Math.max(320, this.canvas.parentElement.clientWidth);
    this.scale = css < 700 ? 2 : 3;
    const w = (this.w = Math.ceil(css / this.scale) + 2);
    this.canvas.width = w;
    this.canvas.height = H;
    this.canvas.style.width = w * this.scale + "px";
    this.canvas.style.height = H * this.scale + "px";
    const r = rng(2026);
    this.clear = [12, 40, w - 12, H - 20];
    // ground and the back row of the forest, baked once
    const bg = ground(2026, w, H, this.clear, [0, 0]);
    const g = bg.getContext("2d");
    const back = [];
    for (let x = -12; x < w + 16; x += 15 + r() * 6) back.push({ x, y: 30 + r() * 10, seed: Math.floor(r() * 1e6) });
    for (let y = 40; y < H; y += 22) { back.push({ x: 2 + r() * 6, y, seed: Math.floor(r() * 1e6) }); back.push({ x: w - 4 - r() * 6, y, seed: Math.floor(r() * 1e6) }); }
    back.sort((a, b) => a.y - b.y);
    for (const t of back) this.tree(g, t);
    this.bg = bg;
    this.front = [];
    for (let x = -10; x < w + 16; x += 16 + r() * 8) this.front.push({ x, y: H + 22 + r() * 6, seed: Math.floor(r() * 1e6) });
    // props
    this.props = [
      { kind: "apple", x: Math.round(w * 0.16), y: 82 },
      { kind: "tub", x: Math.round(w * 0.8), y: 100 },
      { kind: "rock", x: Math.round(w * 0.6), y: 106 },
    ];
    this.ball = { x: w * 0.45, y: 96, vx: 0, vy: 0 };
    const n = Math.max(4, Math.min(9, Math.round(w / 48)));
    this.cadlets = Array.from({ length: n }, (_, i) => this.spawn(i));
    this.particles = [];
    this.draw(performance.now());
  }

  tree(g, t) {
    const img = forestTree(t.seed);
    const x = Math.round(t.x - img.width / 2), y = Math.round(t.y - img.height + 6);
    g.fillStyle = "rgba(10, 20, 6, .45)";
    g.fillRect(x + 4, y + img.height - 6, img.width - 4, 5);
    g.drawImage(img, x, y);
  }

  spot() {
    const [x0, y0, x1, y1] = this.clear;
    return { x: x0 + 8 + Math.random() * (x1 - x0 - 16), y: y0 + 14 + Math.random() * (y1 - y0 - 18) };
  }

  spawn(i) {
    const s = this.spot();
    return { id: i, x: s.x, y: s.y, tx: s.x, ty: s.y, face: Math.random() < 0.5 ? -1 : 1, state: "idle", until: 0, phase: Math.random() * 9, blink: 0, bubble: null };
  }

  think(c, now) {
    // pick the next thing to do: mostly wander, sometimes visit the tree, the ball, a nap, a chirp
    const r = Math.random();
    const tree = this.props[0], tub = this.props[1];
    if (r < 0.16) { c.goal = "eat"; c.tx = tree.x + (Math.random() - 0.5) * 22; c.ty = tree.y + 10; }
    else if (r < 0.28) { c.goal = "play"; c.tx = this.ball.x - 5 * Math.sign(this.ball.x - c.x || 1); c.ty = this.ball.y; }
    else if (r < 0.36) { c.goal = "bathe"; c.tx = tub.x + (Math.random() - 0.5) * 12; c.ty = tub.y + 6; }
    else { const s = this.spot(); c.goal = Math.random() < 0.25 ? "sleep" : Math.random() < 0.5 ? "chirp" : "idle"; c.tx = s.x; c.ty = s.y; }
    c.state = "walk";
  }

  arrive(c, now) {
    const say = (icons, ms) => { c.bubble = { icons, until: now + ms }; };
    if (c.goal === "eat") { c.state = "eat"; c.until = now + 2200; say(["i_apple"], 1500); }
    else if (c.goal === "play") {
      c.state = "play"; c.until = now + 900;
      const a = Math.atan2(this.ball.y - c.y, this.ball.x - c.x) + (Math.random() - 0.5);
      this.ball.vx = Math.cos(a) * 46; this.ball.vy = Math.sin(a) * 30;
      say(["i_ball"], 1200);
    } else if (c.goal === "bathe") { c.state = "idle"; c.until = now + 1600; say(["i_tub"], 1400); }
    else if (c.goal === "sleep") { c.state = "sleep"; c.until = now + 4000 + Math.random() * 3000; }
    else if (c.goal === "chirp") {
      c.state = "idle"; c.until = now + 1800;
      const glyph = ["g_ba", "g_li", "g_mo"][Math.floor(Math.random() * 3)];
      say(Math.random() < 0.4 ? [glyph, "=", ["i_apple", "i_heart", "i_tub"][Math.floor(Math.random() * 3)]] : [glyph], 1700);
    } else { c.state = "idle"; c.until = now + 1200 + Math.random() * 2600; if (Math.random() < 0.2) say(["i_heart"], 1200); }
  }

  step(now, dt) {
    for (const c of this.cadlets) {
      if (c.state === "walk") {
        const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
        const v = 15 * dt;
        if (d <= v) { c.x = c.tx; c.y = c.ty; this.arrive(c, now); }
        else { c.x += (dx / d) * v; c.y += (dy / d) * v; if (Math.abs(dx) > 0.5) c.face = dx > 0 ? 1 : -1; }
      } else if (now > c.until) this.think(c, now);
      if (c.state === "sleep" && Math.random() < dt * 0.8) this.particles.push({ x: c.x + 4, y: c.y - 20, t0: now, life: 1600, kind: "z" });
    }
    const b = this.ball;
    if (Math.abs(b.vx) + Math.abs(b.vy) > 0.5) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      const [x0, y0, x1, y1] = this.clear;
      if (b.x < x0 + 6 || b.x > x1 - 6) { b.vx = -b.vx; b.x = Math.max(x0 + 6, Math.min(x1 - 6, b.x)); }
      if (b.y < y0 + 10 || b.y > y1 - 2) { b.vy = -b.vy; b.y = Math.max(y0 + 10, Math.min(y1 - 2, b.y)); }
      const f = Math.pow(0.18, dt);
      b.vx *= f; b.vy *= f;
    }
    this.particles = this.particles.filter((p) => now - p.t0 < p.life);
  }

  shadow(x, y, w, h = 2) {
    const g = this.g;
    g.fillStyle = "rgba(14, 18, 4, .5)";
    g.beginPath();
    g.ellipse(Math.round(x) + 1, Math.round(y) + 1, w, h, 0, 0, Math.PI * 2);
    g.fill();
  }

  drawCadlet(c, now) {
    const g = this.g;
    const walking = c.state === "walk";
    let name = "thr";
    if (walking) name = Math.floor(now / 170 + c.phase) % 2 ? "thr_step" : "thr";
    else if (c.state === "eat") name = Math.floor(now / 160) % 2 ? "thr_eat" : "thr";
    else if (c.state === "sleep") name = "thr_blink";
    else if (c.state === "play") name = "thr_happy";
    else if (now % 3600 < 140 + c.phase * 10 && now % 3600 > c.phase * 10) name = "thr_blink";
    let variant = "";
    if (c.face < 0) { if (name === "thr") name = "thr_l"; else variant = "flip"; }
    const img = sprite(name, variant);
    const hop = walking ? Math.abs(Math.sin(now / 170 * Math.PI + c.phase)) * 2 : c.state === "sleep" ? 0 : Math.max(0, Math.sin(now / 420 + c.phase)) * 0.6;
    this.shadow(c.x, c.y, 6);
    g.save();
    g.translate(Math.round(c.x), Math.round(c.y - hop));
    if (c.state === "sleep") g.scale(1.08, 0.86);
    g.drawImage(img, -10, -21);
    g.restore();
    if (c.bubble && now < c.bubble.until) this.bubble(c, c.bubble.icons);
  }

  bubble(c, icons) {
    const g = this.g;
    const w = icons.reduce((s, ic) => s + (ic === "=" ? 7 : 11), 0) + 5, h = 15;
    const x = Math.round(c.x - w / 2 + 6), y = Math.round(c.y - 24 - h);
    g.fillStyle = "#26323a"; g.fillRect(x + 1, y, w - 2, h); g.fillRect(x, y + 1, w, h - 2);
    g.fillStyle = "#c6dbdb"; g.fillRect(x + 1, y + 1, w - 2, h - 2);
    g.fillStyle = "#26323a"; g.fillRect(x + 3, y + h - 1, 4, 2); g.fillRect(x + 3, y + h + 1, 2, 2);
    g.fillStyle = "#c6dbdb"; g.fillRect(x + 4, y + h - 2, 2, 2);
    let cx = x + 3;
    for (const ic of icons) {
      if (ic === "=") { g.fillStyle = "#26323a"; g.fillRect(cx, y + 6, 4, 1); g.fillRect(cx, y + 8, 4, 1); cx += 7; continue; }
      g.drawImage(sprite(ic), cx, y + 3);
      cx += 11;
    }
  }

  drawProp(p) {
    const g = this.g;
    if (p.kind === "apple") {
      const img = appleTree(4242, false);
      const x = Math.round(p.x - img.width / 2), y = Math.round(p.y - img.height + 4);
      this.shadow(p.x + 3, p.y + 1, 16, 4);
      g.drawImage(img, x, y);
      for (let i = 0; i < 5; i++) {
        const [fx, fy] = FRUIT_SPOTS[i];
        g.fillStyle = "#c8321f"; g.fillRect(x + fx, y + fy, 3, 3);
        g.fillStyle = "#ff8a68"; g.fillRect(x + fx, y + fy, 1, 1);
      }
    } else {
      const img = sprite(p.kind);
      const x = Math.round(p.x - img.width / 2), y = Math.round(p.y - img.height + (p.kind === "tub" ? 6 : 3));
      g.fillStyle = "rgba(14, 18, 4, .55)";
      g.fillRect(x + 4, y + img.height - 4, img.width - 3, 4);
      g.drawImage(img, x, y);
    }
  }

  draw(now) {
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.bg, 0, 0);
    const items = [];
    for (const p of this.props) items.push({ y: p.y, draw: () => this.drawProp(p) });
    items.push({ y: this.ball.y, draw: () => { this.shadow(this.ball.x, this.ball.y, 5); g.drawImage(sprite("ball"), Math.round(this.ball.x - 5), Math.round(this.ball.y - 10)); } });
    for (const c of this.cadlets) items.push({ y: c.y, draw: () => this.drawCadlet(c, now) });
    for (const t of this.front) items.push({ y: t.y, draw: () => this.tree(g, t) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    for (const p of this.particles) {
      const k = (now - p.t0) / p.life;
      g.globalAlpha = 1 - k;
      g.drawImage(sprite("i_zzz"), Math.round(p.x + k * 6), Math.round(p.y - k * 10));
      g.globalAlpha = 1;
    }
  }

  frame(now) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.step(now, dt);
    this.draw(now);
  }
}

// ------------------------------------------------------------------ the story's crowds

// Ten Cadlets per panel, with the hand on the right. Those who trust it gather close and
// hop; the rest keep to the far side, turned away (kind) or huddled and trembling (cruel).
const NEAR = [[62, 31], [80, 31], [98, 31], [116, 31], [71, 51], [89, 51], [107, 51], [125, 51]];
const FAR = [[2, 27], [20, 27], [38, 27], [11, 43], [29, 43], [2, 59], [20, 59], [38, 59], [47, 43]];
const MIDDLE = [[70, 45], [86, 49], [78, 31]]; // the wary few who still come to a cruel hand

function crowds() {
  const out = [];
  for (const c of document.querySelectorAll("canvas.crowd")) {
    const come = +c.dataset.come, cruel = c.dataset.mood === "cruel";
    c.width = 168;
    c.height = 64;
    c.style.width = "100%";
    c.style.maxWidth = c.width * 2 + "px";
    const r = rng(come * 31 + (cruel ? 7 : 0));
    const bodies = [];
    const away = 10 - come;
    // the ones keeping their distance, spread evenly over the far side whatever their number
    // (the innermost far spot, FAR[8], is only for a crowd hiding from a cruel hand)
    const far = (i) => FAR[Math.round((i * (FAR.length - 2)) / Math.max(1, away - 1))];
    if (cruel) {
      for (let i = 0; i < come; i++) bodies.push({ x: MIDDLE[i][0], y: MIDDLE[i][1], kind: "wary", phase: r() * 6 });
      for (let i = 0; i < away; i++) bodies.push({ x: FAR[i][0], y: FAR[i][1], kind: r() < 0.7 ? "scared" : "fleeing", phase: r() * 6 });
    } else {
      for (let i = 0; i < come; i++) bodies.push({ x: NEAR[i][0], y: NEAR[i][1], kind: "happy", phase: r() * 6 });
      for (let i = 0; i < away; i++) bodies.push({ x: far(i)[0], y: far(i)[1], kind: "away", phase: r() * 6 });
    }
    bodies.sort((a, b) => a.y - b.y);
    out.push({ c, g: c.getContext("2d"), bodies, cruel });
  }
  return out;
}

function drawCrowds(list, now) {
  for (const { c, g, bodies, cruel } of list) {
    g.clearRect(0, 0, c.width, c.height);
    for (const b of bodies) {
      let name = "thr", variant = "", dx = 0, hop = 0;
      if (b.kind === "happy") { name = "thr_happy"; hop = Math.max(0, Math.sin(now / 240 + b.phase)) * 2; }
      else if (b.kind === "wary") name = (now / 900) % 4 < 0.3 ? "thr_blink" : "thr";
      else if (b.kind === "scared") { name = "thr_shock"; dx = Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0; }
      else { name = "thr_step"; variant = "flip"; hop = Math.abs(Math.sin(now / 160 + b.phase)) * (b.kind === "fleeing" ? 2 : 0); }
      g.fillStyle = "rgba(40, 20, 8, .35)";
      g.fillRect(b.x + 4, b.y - 1, 12, 2);
      g.drawImage(sprite(name, variant), Math.round(b.x + dx), Math.round(b.y - 21 - hop));
      if (b.kind === "scared" && (now / 300 + b.phase) % 3 < 0.6) { g.fillStyle = "#a9dcff"; g.fillRect(b.x + 2, b.y - 20, 1, 2); }
    }
    // the hand, reaching in from the right: open when kind, grabbing when cruel
    const hand = sprite(cruel ? "hand_grab" : "hand");
    const bob = Math.round(Math.sin(now / 500) * 1.5);
    g.drawImage(hand, c.width - hand.width - 4, 20 + bob);
  }
}

// ------------------------------------------------------------------ start

loadSprites().then(() => {
  paintIcons();
  logo.draw(performance.now()); // now with its Cadlet on the T
  const field = new Clearing($("#field"));
  const crowdList = crowds();
  drawCrowds(crowdList, 0);
  if (still) return;
  let crowdsOn = false;
  new IntersectionObserver(([e]) => { crowdsOn = e.isIntersecting; }).observe($(".story"));
  // animate only while the clearing is on screen and the tab is visible
  new IntersectionObserver(([e]) => { field.visible = e.isIntersecting; }).observe($("#field"));
  const loop = (now) => {
    if (field.visible && !document.hidden) field.frame(now);
    else field.last = 0;
    if (crowdsOn && !document.hidden) drawCrowds(crowdList, now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  let resize = null;
  addEventListener("resize", () => {
    clearTimeout(resize);
    resize = setTimeout(() => { fitLogo(); field.build(); }, 200);
  });
});
