// Draws the Cadlets' field from the simulation's snapshots, interpolating between beats.

import { TILE, sprite, forestTree, appleTree, ground, rng, FRUIT_SPOTS } from "./sprites.js";

const PAD = 16;                 // forest margin (tiles) around the 40x24 world
const ease = (t) => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, t))) / 2;
const lerp = (a, b, t) => a + (b - a) * t;

export const ICON_FOR = {
  eat: "i_apple", bathe: "i_tub", play: "i_ball", cuddle: "i_heart", sleep: "i_zzz",
  hand: "i_hand", flee: "i_flee", wander: "i_wander",
};
export const GLYPHS = ["", "g_ba", "g_li", "g_mo"];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.buf = document.createElement("canvas");
    this.g = this.buf.getContext("2d");
    this.world = [40, 24];
    this.snap = null;
    this.prevSnap = null;
    this.beatMs = 900;
    this.t0 = 0;
    this.bodies = new Map();    // id -> interpolation state
    this.balls = new Map();
    this.particles = [];
    this.bubbles = new Map();   // id -> {icons, until, kind}
    this.flashes = [];
    this.forest = [];
    this.decor = [];
    this.static = null;         // ground + far forest for the current clearing
    this.staticBounds = null;
    this.scale = 3;
    this.targetScale = 3;
    this.inset = 0;             // screen pixels covered by the mind panel on the right
    this.shift = 0;
    this.pan = { x: 0, y: 0 };  // camera offset from the field's centre (world pixels)
    this.zoom = 1;              // the viewer's zoom on top of the automatic fit
    this.view = { x: 0, y: 0, w: 480, h: 270 };
    this.hand = null;           // {x, y, tool, holding}
    this.held = null;           // {id, x, y}
    this.flying = new Map();    // id -> {x0,y0,x1,y1,t0,dur}
    this.ghosts = [];           // eaten apples, drawn until their eater arrives
    this.pendingFruit = new Map(); // tree id -> {n, until}: fruit still hanging until picked
    this.squeeze = null;        // {id, t0}: the hand closing on a Cadlet
    this.selected = null;
    this.lexicon = {};
    this.glitchUntil = 0;
    this.dayphase = 0;
    this.night = 0;
    this.seed = 2026;
    this.noise = rng(7);
    this._plantForest();
  }

  // ---------------------------------------------------------------- setup

  _plantForest() {
    const r = rng(this.seed);
    this.forest = [];
    const step = 1.75;
    for (let y = -PAD + 1; y < this.world[1] + PAD; y += step * 0.78) {
      for (let x = -PAD; x < this.world[0] + PAD; x += step) {
        const jx = x + (r() - 0.5) * 1.3 + ((Math.round(y / step) % 2) ? step / 2 : 0);
        const jy = y + (r() - 0.5) * 0.9;
        this.forest.push({ x: jx, y: jy, seed: Math.floor(r() * 1e6), gone: false });
      }
    }
    this.decor = [];
    for (let i = 0; i < 40; i++) {
      this.decor.push({ x: r() * (this.world[0] + 2 * PAD) - PAD, y: r() * (this.world[1] + 2 * PAD) - PAD, kind: r() < 0.5 ? "rock" : "bush", seed: Math.floor(r() * 1e6) });
    }
  }

  _inClear(x, y, b, m = 0) {
    return x > b[0] - 1.2 - m && x < b[2] + 1.2 + m && y > b[1] - 0.6 - m && y < b[3] + 1.6 + m;
  }

  _rebuildStatic(bounds) {
    const W = (this.world[0] + 2 * PAD) * TILE, H = (this.world[1] + 2 * PAD) * TILE;
    const clear = [(bounds[0] - 0.9) * TILE, (bounds[1] - 0.9) * TILE, (bounds[2] + 0.9) * TILE, (bounds[3] + 0.7) * TILE];
    const origin = [-PAD * TILE, -PAD * TILE];
    const base = ground(this.seed, W, H, clear, origin);
    const g = base.getContext("2d");
    // far forest (well clear of the field) is baked in; the edge is drawn live for depth
    const far = this.forest.filter((t) => !this._inClear(t.x, t.y, bounds, 3.2)).sort((a, b) => a.y - b.y);
    for (const t of far) this._drawForestTree(g, t, origin);
    this.static = base;
    this.staticOrigin = origin;
    this.staticBounds = bounds.slice();
    for (const t of this.forest) t.gone = this._inClear(t.x, t.y, bounds);
  }

  _drawForestTree(g, t, origin = [0, 0]) {
    const img = forestTree(t.seed);
    const x = Math.round(t.x * TILE - img.width / 2 - origin[0]);
    const y = Math.round(t.y * TILE - img.height + 6 - origin[1]);
    g.fillStyle = "rgba(10, 20, 6, .45)";
    g.fillRect(x + 4, y + img.height - 6, img.width - 4, 5);
    g.drawImage(img, x, y);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.dpr = dpr;
    this._fit(true);
  }

  _fit(snapNow) {
    if (!this.snap) return;
    const b = this.snap.bounds;
    const needW = (b[2] - b[0] + 1.6) * TILE, needH = (b[3] - b[1] + 3.0) * TILE;
    let s = Math.min(innerWidth / needW, innerHeight / needH);
    // Keep the creatures legible; a field larger than the screen can be panned.
    s = Math.max(s, Math.min(2, innerWidth / 330)) * this.zoom;
    s = Math.min(6, Math.max(0.75, s));
    // Whole pixels where the screen is coarse; quarter steps on dense (retina) screens.
    s = (this.dpr || 1) >= 2 ? Math.floor(s * 4) / 4 : (s >= 3 ? Math.floor(s) : Math.floor(s * 2) / 2);
    this.targetScale = s;
    if (snapNow) this.scale = s;
    document.documentElement.style.setProperty("--px", Math.max(2, this.scale) + "px");
  }

  // ---------------------------------------------------------------- snapshots

  update(snap, beatMs, now) {
    // Where everyone is on screen right now, read on the old clock before it restarts:
    // each new walk must begin from the current position, not from the last walk's start.
    const current = new Map();
    for (const b of this.bodies.values()) current.set(b.id, this._bodyPos(b, now));
    this.beatMs = beatMs;
    const first = !this.snap;
    this.prevSnap = this.snap;
    this.snap = snap;
    this.t0 = now;
    this.dayphase = snap.dayphase;
    if (!this.staticBounds || snap.bounds.some((v, i) => Math.abs(v - this.staticBounds[i]) > 0.01)) {
      const growing = !!this.staticBounds;
      const old = this.staticBounds;
      this._rebuildStatic(snap.bounds);
      if (growing) this._clearing(old, snap.bounds);
      this._fit(first);
    }
    const seen = new Set();
    for (const t of snap.cadlets) {
      seen.add(t.id);
      let b = this.bodies.get(t.id);
      const cur = b ? current.get(t.id) : null;
      if (!b) {
        b = { id: t.id, x: t.x, y: t.y, fx: t.x, fy: t.y, born: now, blink: now + 1000 + Math.random() * 3000, hop: Math.random() * 6 };
        this.bodies.set(t.id, b);
        // a child appears out of its parent
        const split = snap.events.find((e) => e.type === "split" && e.child === t.id);
        if (split) { b.fx = split.x; b.fy = split.y; }
      } else {
        b.fx = cur.x; b.fy = cur.y;
      }
      b.x = t.x; b.y = t.y;
      b.data = t;
      b.dist = Math.hypot(b.x - b.fx, b.y - b.fy);
      // Walk for part of the beat and act for the rest: a short errand is a stroll,
      // only a long, pressing trip is a run, and there is always time left to do the thing.
      const pace = Math.max(1, snap.speed || 10);
      b.moveMs = b.dist < 0.05 ? 0 : beatMs * Math.min(0.7, Math.max(0.25, 0.18 + 0.52 * b.dist / pace));
      b.arrive = now + b.moveMs;
      const fly = this.flying.get(t.id);
      // forget the flight once the world has put the Cadlet where it landed (or gave up)
      if (fly && now > fly.t0 + fly.dur && (Math.hypot(t.x - fly.x1, t.y - fly.y1) < 0.8 || now > fly.t0 + 3 * beatMs)) this.flying.delete(t.id);
      this._bubbleFor(t, now, snap);
      this._eventsFor(t, b, b.arrive);
    }
    for (const id of [...this.bodies.keys()]) if (!seen.has(id)) this.bodies.delete(id);
    const kicks = new Map(), arrival = (id) => this.bodies.get(id)?.arrive ?? now;
    for (const e of snap.events) {
      if (e.type === "kick") kicks.set(e.ball, arrival(e.id));
      else if (e.type === "eaten") this.ghosts.push({ x: e.x, y: e.y, glitched: e.glitched, until: arrival(e.id) });
      else if (e.type === "pick") {
        const pf = this.pendingFruit.get(e.tree) || { n: 0, until: 0 };
        this.pendingFruit.set(e.tree, { n: pf.n + 1, until: Math.max(pf.until, arrival(e.id)) });
      }
    }
    const ballSeen = new Set();
    for (const th of snap.things) {
      if (th.k !== "ball") continue;
      ballSeen.add(th.id);
      const prev = this.balls.get(th.id);
      const cur = prev ? this._ballPos(prev, now) : { x: th.x, y: th.y };
      this.balls.set(th.id, { fx: cur.x, fy: cur.y, x: th.x, y: th.y, t0: kicks.get(th.id) ?? now, spin: (prev?.spin || 0) });
    }
    for (const id of [...this.balls.keys()]) if (!ballSeen.has(id)) this.balls.delete(id);
    for (const e of snap.events) this._worldEvent(e, now);
  }

  _clearing(old, bounds) {
    for (const t of this.forest) {
      if (!this._inClear(t.x, t.y, old) && this._inClear(t.x, t.y, bounds)) {
        for (let i = 0; i < 6; i++) this._particle("leaf", t.x + (Math.random() - 0.5), t.y - 1 - Math.random(), (Math.random() - 0.5) * 2, -Math.random() * 2, 900);
      }
    }
  }

  _bodyPos(b, now) {
    if (this.squeeze && this.squeeze.id === b.id && this.squeeze.x !== undefined) {
      return { x: this.squeeze.x, y: this.squeeze.y, k: 1 };
    }
    const fly = this.flying.get(b.id);
    if (fly && now < fly.t0 + fly.dur) {
      const k = (now - fly.t0) / fly.dur;
      return { x: lerp(fly.x0, fly.x1, k), y: lerp(fly.y0, fly.y1, k) - Math.sin(k * Math.PI) * fly.arc, flying: true };
    }
    if (fly) return { x: fly.x1, y: fly.y1, k: 1 }; // landed; wait for the world to agree
    const lin = b.moveMs > 0 ? Math.min(1, Math.max(0, (now - this.t0) / b.moveMs)) : 1;
    const k = 0.85 * lin + 0.15 * ease(lin); // nearly constant speed, soft start and stop
    return { x: lerp(b.fx, b.x, k), y: lerp(b.fy, b.y, k), k };
  }

  _ballPos(ball, now) {
    const k = ease((now - ball.t0) / Math.min(this.beatMs * 0.6, 900));
    const x = lerp(ball.fx, ball.x, k), y = lerp(ball.fy, ball.y, k);
    const d = Math.hypot(ball.x - ball.fx, ball.y - ball.fy);
    return { x, y, z: Math.abs(Math.sin(k * Math.PI * 2)) * Math.min(1.2, d * 0.4) * (1 - k) };
  }

  _bubbleFor(t, now, snap) {
    const pop = snap.cadlets.length;
    const active = [...this.bubbles.values()].filter((b) => b.until > now).length;
    const budget = 4 + Math.floor(pop / 5);
    if (this.bubbles.has(t.id) && this.bubbles.get(t.id).until > now) return;
    const dur = Math.max(1200, this.beatMs * 1.6);
    if (t.v > 0 && Math.random() < (this.lexicon[["", "ba", "li", "mo"][t.v]] ? 0.16 : 0.07) && active < budget) {
      const icons = [GLYPHS[t.v]];
      const meaning = this.lexicon[["", "ba", "li", "mo"][t.v]];
      if (meaning) icons.push("=", ICON_FOR[meaning]);
      this.bubbles.set(t.id, { icons, until: now + dur, kind: "voice", born: now });
      return;
    }
    if (Math.abs(t.td) > 0.55 && Math.random() < 0.5 && active < budget + 2) {
      this.bubbles.set(t.id, { icons: [t.td > 0 ? "i_sparkle" : "i_bang"], until: now + dur * 0.7, kind: "surprise", born: now });
      return;
    }
    const intent = ["eat", "bathe", "play", "cuddle", "sleep", "hand"].includes(t.a);
    const chance = t.id === this.selected ? 0.6 : 0.16 * (t.conf > 0.5 ? 1.6 : 1);
    if (intent && Math.random() < chance && active < budget) {
      const icons = [ICON_FOR[t.a]];
      if (t.conf < 0.22 && Math.random() < 0.5) icons.push("i_what");
      this.bubbles.set(t.id, { icons, until: now + dur, kind: "intent", born: now });
    }
  }

  _eventsFor(t, b, now) { // ``now`` is when this body arrives and acts
    for (const e of t.ev) {
      if (e === "love") for (let i = 0; i < 2; i++) this._particle("heart", t.x + (Math.random() - 0.5) * 0.6, t.y - 1.3, (Math.random() - 0.5) * 0.6, -1.4, 1100, now);
      else if (e === "eat" || e === "pick") for (let i = 0; i < 5; i++) this._particle("crumb", t.x, t.y - 0.6, (Math.random() - 0.5) * 2, -Math.random() * 2, 500, now);
      else if (e === "splash") for (let i = 0; i < 6; i++) this._particle("drop", t.x + (Math.random() - 0.5), t.y - 0.6, (Math.random() - 0.5) * 3, -1 - Math.random() * 2, 700, now);
      else if (e === "poisoned") { for (let i = 0; i < 8; i++) this._particle("glitch", t.x + (Math.random() - 0.5) * 1.2, t.y - Math.random() * 1.4, 0, 0, 600, now); }
      else if (e === "hurt") for (let i = 0; i < 6; i++) this._particle("blood", t.x, t.y - 0.4, (Math.random() - 0.5) * 2.5, -Math.random() * 2, 700);
      else if (e === "fright") { this.bubbles.set(t.id, { icons: ["i_bang"], until: performance.now() + this.beatMs * 1.2, kind: "surprise", born: performance.now() }); this._particle("sweat", t.x - 0.3, t.y - 1.3, -0.3, -0.4, 600); }
      else if (e === "soap") for (let i = 0; i < 6; i++) this._particle("soap", t.x + (Math.random() - 0.5), t.y - Math.random() * 1.2, (Math.random() - 0.5) * 0.4, -0.6, 1200);
      else if (e === "confused") this.bubbles.set(t.id, { icons: ["i_what"], until: now + this.beatMs * 1.4, kind: "surprise", born: now });
      else if (e === "split") { this.flashes.push({ x: t.x, y: t.y, t0: now }); for (let i = 0; i < 10; i++) this._particle("spark", t.x, t.y - 0.6, (Math.random() - 0.5) * 3, -Math.random() * 3, 700); }
    }
    if (t.s === "sleep" && this._asleep(t) && Math.random() < 0.5) this._particle("z", t.x + 0.3, t.y - 1.2, 0.25, -0.5, 1500, now);
    if (t.s === "sick" && Math.random() < 0.6) this._particle("vomit", t.x + 0.3 * (t.f || 1), t.y - 0.5, (t.f || 1) * 0.8, 0.2, 600, now);
    if ((t.s === "flee" || t.fe > 0.45) && Math.random() < 0.5) this._particle("sweat", t.x - 0.3, t.y - 1.3, -0.3, -0.4, 600);
  }

  _worldEvent(e, now) {
    if (e.type === "death") {
      for (let i = 0; i < 12; i++) this._particle("blood", e.x, e.y - 0.4, (Math.random() - 0.5) * 3, -Math.random() * 2.5, 800);
    } else if (e.type === "hatch") {
      for (let i = 0; i < 10; i++) this._particle("shell", e.x, e.y - 0.5, (Math.random() - 0.5) * 3, -Math.random() * 3, 800);
      this.flashes.push({ x: e.x, y: e.y, t0: now });
    } else if (e.type === "glitch") {
      this.glitchUntil = now + 2200;
    }
  }

  _particle(kind, x, y, vx, vy, life, at = performance.now()) {
    this.particles.push({ kind, x, y, vx, vy, t0: at, life });
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  burst(kind, x, y, n = 6) {
    for (let i = 0; i < n; i++) this._particle(kind, x + (Math.random() - 0.5) * 0.6, y - Math.random() * 0.8, (Math.random() - 0.5) * 2, -0.5 - Math.random() * 1.5, 900);
  }

  // ---------------------------------------------------------------- coordinates

  screenToWorld(sx, sy) {
    return { x: (this.view.x + sx / this.scale) / TILE, y: (this.view.y + sy / this.scale) / TILE };
  }

  worldToScreen(wx, wy) {
    return { x: (wx * TILE - this.view.x) * this.scale, y: (wy * TILE - this.view.y) * this.scale };
  }

  pick(wx, wy, now = performance.now()) {
    let best = null, bd = 1e9;
    for (const b of this.bodies.values()) {
      const p = this._bodyPos(b, now);
      const dx = wx - p.x, dy = wy - (p.y - 0.6);
      const d = Math.hypot(dx, dy * 0.9);
      if (d < 0.85 && d < bd) { best = b.id; bd = d; }
    }
    return best;
  }

  cadlet(id) {
    return this.bodies.get(id)?.data || null;
  }

  posOf(id, now = performance.now()) {
    const b = this.bodies.get(id);
    return b ? this._bodyPos(b, now) : null;
  }

  // ---------------------------------------------------------------- drawing

  frame(now) {
    if (!this.snap || !this.static) return;
    if (Math.abs(this.scale - this.targetScale) > 0.001) {
      this.scale += (this.targetScale - this.scale) * 0.08;
      if (Math.abs(this.scale - this.targetScale) < 0.01) this.scale = this.targetScale;
      document.documentElement.style.setProperty("--px", Math.max(2, Math.round(this.scale)) + "px");
    }
    const vw = Math.ceil(innerWidth / this.scale), vh = Math.ceil(innerHeight / this.scale);
    if (this.buf.width !== vw || this.buf.height !== vh) { this.buf.width = vw; this.buf.height = vh; }
    const cx = this.world[0] / 2 * TILE, cy = (this.world[1] / 2 + 0.4) * TILE;
    this.shift += ((this.inset / 2 / this.scale) - this.shift) * 0.12;
    // keep the camera over the field (plus a little forest)
    const b = this.staticBounds;
    const limX = Math.max(0, ((b[2] - b[0]) * TILE + 3 * TILE - (vw - this.inset / this.scale)) / 2);
    const limY = Math.max(0, ((b[3] - b[1]) * TILE + 4 * TILE - vh) / 2);
    this.pan.x = Math.max(-limX, Math.min(limX, this.pan.x));
    this.pan.y = Math.max(-limY, Math.min(limY, this.pan.y));
    this.view = { x: Math.round(cx - vw / 2 + this.shift + this.pan.x), y: Math.round(cy - vh / 2 + this.pan.y), w: vw, h: vh };
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#24331a";
    g.fillRect(0, 0, vw, vh);
    g.drawImage(this.static, this.staticOrigin[0] - this.view.x, this.staticOrigin[1] - this.view.y);
    g.translate(-this.view.x, -this.view.y);

    const items = [];
    for (const t of this.forest) {
      if (t.gone || !this._inClear(t.x, t.y, this.staticBounds, 3.2)) continue;
      items.push({ y: t.y, draw: () => this._drawForestTree(g, t) });
    }
    for (const th of this.snap.things) items.push({ y: th.y + (th.k === "tree" ? 0.2 : th.k === "corpse" ? -0.3 : 0), draw: () => this._thing(g, th, now) });
    this.ghosts = this.ghosts.filter((gh) => gh.until > now);
    for (const gh of this.ghosts) items.push({ y: gh.y, draw: () => this._thing(g, { k: "apple", x: gh.x, y: gh.y, glitched: gh.glitched }, now) });
    for (const b of this.bodies.values()) {
      if (this.held && this.held.id === b.id) continue;
      if (b.data.s === "bathe" && now >= b.arrive) continue; // sitting in its tub
      const p = this._bodyPos(b, now);
      items.push({ y: p.y, draw: () => this._body(g, b, p, now) });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    this._particles(g, now);
    this._flashes(g, now);
    if (this.held) this._heldBody(g, now);

    // night
    const dp = this.dayphase;
    const target = dp > 0.69 ? Math.min(1, (dp - 0.69) / 0.04) * (dp > 0.96 ? Math.max(0, (1 - dp) / 0.04) : 1) : 0;
    this.night += (target - this.night) * 0.03;
    if (this.night > 0.01) {
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "multiply";
      g.fillStyle = `rgba(${Math.round(255 - 170 * this.night)}, ${Math.round(255 - 150 * this.night)}, ${Math.round(255 - 60 * this.night)}, 1)`;
      g.fillRect(0, 0, vw, vh);
      g.restore();
    }
    this._bubbles(g, now);
    if (this.hand) this._hand(g, now);

    // blit
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const s = this.scale * this.dpr;
    ctx.drawImage(this.buf, 0, 0, vw, vh, 0, 0, Math.round(vw * s), Math.round(vh * s));
    if (now < this.glitchUntil || this.forcedGlitch) this._glitchScreen(ctx, now);
  }

  _shadow(g, x, y, w, h = 3) {
    g.fillStyle = "rgba(14, 18, 4, .5)";
    g.beginPath();
    g.ellipse(Math.round(x) + 1, Math.round(y) + 1, w, h, 0, 0, Math.PI * 2);
    g.fill();
  }

  _thing(g, th, now) {
    const px = th.x * TILE, py = th.y * TILE;
    if (th.k === "tree") {
      const img = appleTree(th.id * 7919, th.glitched);
      const x = Math.round(px - img.width / 2), y = Math.round(py - img.height + 4);
      this._shadow(g, px + 3, py + 1, 16, 4);
      let ox = 0;
      if (th.glitched && Math.random() < 0.08) ox = (Math.random() < 0.5 ? -2 : 2);
      g.drawImage(img, x + ox, y);
      const pf = this.pendingFruit.get(th.id);
      const hanging = pf && pf.until > now ? pf.n : 0;
      const fruit = Math.min((th.fruit || 0) + hanging, FRUIT_SPOTS.length);
      for (let i = 0; i < fruit; i++) {
        const [fx, fy] = FRUIT_SPOTS[i];
        g.fillStyle = th.glitched ? (Math.random() < 0.15 ? "#2ae0d6" : "#c43ad6") : "#c8321f";
        g.fillRect(x + fx, y + fy, 3, 3);
        g.fillStyle = th.glitched ? "#f2a6ff" : "#ff8a68";
        g.fillRect(x + fx, y + fy, 1, 1);
      }
      if (th.glitched && Math.random() < 0.25) {
        g.fillStyle = Math.random() < 0.5 ? "#18e8dc" : "#0a0a10";
        g.fillRect(x + Math.random() * img.width, y + Math.random() * 30, 2 + Math.random() * 8, 1);
      }
    } else if (th.k === "tub") {
      const img = sprite("tub");
      const x = Math.round(px - img.width / 2), y = Math.round(py - img.height + 6);
      g.fillStyle = "rgba(14, 18, 4, .55)";
      g.fillRect(x + 6, y + img.height - 4, img.width - 4, 4);
      g.drawImage(img, x, y);
      // bathers sit in the water: draw their heads, then the tub's front rim over them
      const occ = th.occupants || [];
      occ.forEach((id, i) => {
        const b = this.bodies.get(id);
        if (!b || now < b.arrive) return;
        const head = sprite(b.data.id === this.selected ? "thr_happy" : (Math.floor(now / 600 + id) % 5 === 0 ? "thr_blink" : "thr_happy"));
        const hx = x + 5 + i * 11, hy = y - 6 + Math.round(Math.sin(now / 300 + id) * 0.6);
        g.drawImage(head, 0, 0, head.width, 12, hx, hy, head.width * 0.8, 12 * 0.8);
        if (Math.random() < 0.1) this._particle("bubble", (hx + 8) / TILE, (hy + 4) / TILE, (Math.random() - 0.5) * 0.4, -0.5, 900);
      });
      if (occ.some((id) => (this.bodies.get(id)?.arrive ?? 0) <= now)) g.drawImage(img, 0, 9, img.width, img.height - 9, x, y + 9, img.width, img.height - 9);
    } else if (th.k === "rock") {
      const img = sprite("rock");
      const x = Math.round(px - img.width / 2), y = Math.round(py - img.height + 3);
      g.fillStyle = "rgba(14, 18, 4, .55)";
      g.fillRect(x + 3, y + img.height - 3, img.width, 3);
      g.drawImage(img, x, y);
    } else if (th.k === "apple") {
      const glitch = th.glitched;
      const img = sprite("apple", glitch ? "glitch" : "");
      const x = Math.round(px - 4), y = Math.round(py - 8);
      this._shadow(g, px, py, 4, 1.5);
      g.drawImage(img, x + (glitch && Math.random() < 0.1 ? 1 : 0), y);
    } else if (th.k === "ball") {
      const ball = this.balls.get(th.id);
      const p = ball ? this._ballPos(ball, now) : { x: th.x, y: th.y, z: 0 };
      const img = sprite("ball");
      this._shadow(g, p.x * TILE, p.y * TILE, 5, 2);
      g.drawImage(img, Math.round(p.x * TILE - 5), Math.round(p.y * TILE - 10 - p.z * TILE));
    } else if (th.k === "egg") {
      const img = sprite(th.hatch <= 2 ? "egg_crack" : "egg");
      const wob = th.hatch <= 3 ? Math.sin(now / 70) * 1.2 : Math.sin(now / 500) * 0.4;
      this._shadow(g, px, py, 6, 2);
      g.save();
      g.translate(Math.round(px), Math.round(py));
      g.rotate(wob * 0.08);
      g.drawImage(img, -6, -15);
      g.restore();
    } else if (th.k === "corpse") {
      const x = Math.round(px), y = Math.round(py);
      if (th.bones) {
        const img = sprite("bones");
        g.drawImage(img, x - 6, y - 6);
      } else {
        g.fillStyle = "#5a0a04";
        g.beginPath(); g.ellipse(x + 3, y + 1, 11, 4, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#780e06";
        g.fillRect(x + 8, y - 1, 9, 2); g.fillRect(x - 9, y + 2, 6, 2);
        const img = sprite("thr_dead", th.facing < 0 ? "flip" : "");
        g.save();
        g.translate(x, y - 4);
        g.rotate(Math.PI / 2 * (th.facing < 0 ? -1 : 1));
        g.drawImage(img, -10, -10);
        g.restore();
      }
    }
  }

  _asleep(t) {
    // the "sleep" behaviour is a nap at night or when hurt, otherwise a quiet rest
    return (this.snap && this.snap.night) || t.hp < 0.9;
  }

  _face(t, b, now, moving) {
    if (this.squeeze && this.squeeze.id === b.id) return "thr_shock";
    if (t.ev.includes("fright") && now < this.t0 + this.beatMs * 0.8) return "thr_shock";
    if (moving) return t.s === "flee" || t.fe > 0.45 ? "thr_shock" : "thr";
    const s = t.s;
    if (s === "sick") return "thr_sick";
    if (s === "eat") return Math.floor(now / 160) % 2 ? "thr_eat" : "thr";
    if (s === "sleep") {
      if (this._asleep(t)) return "thr_blink";
      return Math.floor(now / 1700 + t.id) % 4 === 0 ? "thr_blink" : "thr"; // just resting
    }
    if (s === "cuddle" || s === "play") return "thr_happy";
    if (s === "flee") return "thr_shock";
    if (s === "reach") return "thr_reach";
    if (t.hp < 0.45 || Math.max(t.h, t.d, t.b) > 0.85) return "thr_sad";
    if (t.fe > 0.45) return "thr_shock";
    if (now > b.blink) { if (now > b.blink + 140) b.blink = now + 1800 + Math.random() * 3500; else return "thr_blink"; }
    return "thr";
  }

  _body(g, b, p, now) {
    const t = b.data;
    const moving = p.k !== undefined && p.k < 1 && b.dist > 0.05;
    const up = moving && (b.y - b.fy) < -0.25 && Math.abs(b.y - b.fy) > Math.abs(b.x - b.fx) * 0.8;
    let name = this._face(t, b, now, moving);
    if (up) name = "thr_back";
    if (moving) {
      const step = Math.floor((p.k * b.dist) * 3) % 2;
      if (step) name = up ? "thr_back_step" : (name === "thr" ? "thr_step" : name);
    }
    let flip = "";
    if (!up && name === "thr") name = t.f < 0 ? "thr_l" : "thr";
    const variant = t.s === "sick" && Math.random() < 0.08 ? "glitch" : flip;
    const img = sprite(name, variant);
    let hop = 0;
    if (moving) hop = Math.abs(Math.sin(p.k * Math.PI * Math.max(1, Math.round(b.dist * 1.3)))) * (t.s === "flee" ? 3 : 2);
    else if (t.s !== "sleep") hop = Math.max(0, Math.sin(now / 420 + b.hop)) * 0.6;
    if (p.flying) hop = 0;
    // newborns pop in
    const age = now - b.born;
    const grow = age < 400 ? 0.4 + 0.6 * ease(age / 400) : 1;
    const x = p.x * TILE, y = p.y * TILE;
    this._shadow(g, x, y, 6 * grow, 2);
    if (b.id === this.selected) {
      g.strokeStyle = Math.floor(now / 250) % 2 ? "#ffffff" : "#9fe8ff";
      g.lineWidth = 1;
      g.beginPath(); g.ellipse(Math.round(x) + 0.5, Math.round(y) + 0.5, 9, 4, 0, 0, Math.PI * 2); g.stroke();
    }
    let shake = 0, squeezed = 0;
    if (this.squeeze && this.squeeze.id === b.id) {
      squeezed = Math.min(1, (now - this.squeeze.t0) / this.squeeze.ms);
      shake = Math.round((Math.random() - 0.5) * (1 + 3 * squeezed));
    } else if (t.fe > 0.45 && !moving) shake = Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0;
    g.save();
    g.translate(Math.round(x) + shake, Math.round(y - hop));
    if (squeezed) g.scale(1 + 0.15 * squeezed, 1 - 0.3 * squeezed);
    if (t.s === "sleep" && this._asleep(t) && !moving) g.scale(1.08, 0.86);
    if (grow < 1) g.scale(grow, grow);
    g.drawImage(img, -10, -21);
    if (squeezed) {
      g.globalAlpha = 0.75 * squeezed;
      g.drawImage(sprite(name, "red"), -10, -21);
      g.globalAlpha = 1;
    }
    if (t.d > 0.55) {
      // dirt: a few brown specks
      g.fillStyle = "rgba(70, 45, 20, .85)";
      const n = Math.floor((t.d - 0.5) * 12);
      const r = rng(t.id * 31);
      for (let i = 0; i < n; i++) g.fillRect(-7 + Math.floor(r() * 14), -17 + Math.floor(r() * 15), 1, 1);
    }
    g.restore();
  }

  _heldBody(g, now) {
    const h = this.held;
    const b = this.bodies.get(h.id);
    if (!b) return;
    const x = h.x * TILE, y = h.y * TILE + 22;
    const img = sprite(Math.floor(now / 120) % 2 ? "thr_shock" : "thr_step");
    g.save();
    g.translate(Math.round(x), Math.round(y));
    g.rotate(Math.sin(now / 140) * 0.18);
    g.drawImage(img, -10, -21);
    g.restore();
  }

  _particles(g, now) {
    const keep = [];
    for (const p of this.particles) {
      const age = now - p.t0;
      if (age > p.life) continue;
      keep.push(p);
      if (age < 0) continue; // scheduled for when its Cadlet arrives
      const k = age / 1000;
      const gy = ["crumb", "drop", "blood", "shell", "leaf", "vomit"].includes(p.kind) ? 6 : 0;
      const x = (p.x + p.vx * k) * TILE, y = (p.y + p.vy * k + 0.5 * gy * k * k) * TILE;
      const fade = 1 - age / p.life;
      const X = Math.round(x), Y = Math.round(y);
      switch (p.kind) {
        case "heart": g.globalAlpha = fade; g.drawImage(sprite("i_heart"), X - 4, Y - 4); g.globalAlpha = 1; break;
        case "crumb": g.fillStyle = "#c8321f"; g.fillRect(X, Y, 1, 1); break;
        case "drop": g.fillStyle = "#8ccaf6"; g.fillRect(X, Y, 1, 2); break;
        case "bubble": case "soap": g.strokeStyle = `rgba(240, 250, 255, ${fade})`; g.strokeRect(X, Y, 2, 2); break;
        case "blood": g.fillStyle = "#8a0e06"; g.fillRect(X, Y, 2, 1); break;
        case "shell": g.fillStyle = "#efe5c6"; g.fillRect(X, Y, 2, 2); break;
        case "leaf": g.fillStyle = "#5b9638"; g.fillRect(X, Y, 2, 1); break;
        case "spark": g.fillStyle = Math.random() < 0.5 ? "#fff6c0" : "#ffd84a"; g.fillRect(X, Y, 1, 1); break;
        case "z": g.globalAlpha = fade; g.drawImage(sprite("i_zzz"), X, Y); g.globalAlpha = 1; break;
        case "vomit": g.fillStyle = "#88b02a"; g.fillRect(X, Y, 2, 1); break;
        case "sweat": g.fillStyle = "#a9dcff"; g.fillRect(X, Y, 1, 2); break;
        case "glitch": g.fillStyle = Math.random() < 0.5 ? "#e03ae8" : "#18e8dc"; g.fillRect(X, Y, 3, 1); break;
        default: g.fillStyle = "#fff"; g.fillRect(X, Y, 1, 1);
      }
    }
    this.particles = keep;
  }

  _flashes(g, now) {
    this.flashes = this.flashes.filter((f) => now - f.t0 < 350);
    for (const f of this.flashes) {
      const k = (now - f.t0) / 350;
      g.fillStyle = `rgba(255, 255, 240, ${0.8 * (1 - k)})`;
      g.beginPath(); g.arc(Math.round(f.x * TILE), Math.round(f.y * TILE - 9), 6 + 10 * k, 0, Math.PI * 2); g.fill();
    }
  }

  _bubbles(g, now) {
    for (const [id, bub] of this.bubbles) {
      if (bub.until < now) { this.bubbles.delete(id); continue; }
      const b = this.bodies.get(id);
      if (!b) { this.bubbles.delete(id); continue; }
      let p = this._bodyPos(b, now);
      if (b.data.s === "bathe") p = { x: b.x, y: b.y - 0.5 };
      const icons = bub.icons;
      const w = icons.reduce((s, ic) => s + (ic === "=" ? 7 : 11), 0) + 5;
      const h = 15;
      const pop = Math.min(1, (now - bub.born) / 120);
      const x = Math.round(p.x * TILE - w / 2 + 6), y = Math.round(p.y * TILE - 24 - h - (1 - pop) * 3);
      g.fillStyle = "#26323a";
      g.fillRect(x + 1, y, w - 2, h); g.fillRect(x, y + 1, w, h - 2);
      g.fillStyle = bub.kind === "voice" ? "#dfe9d6" : "#c6dbdb";
      g.fillRect(x + 1, y + 1, w - 2, h - 2);
      g.fillStyle = "rgba(255,255,255,.55)"; g.fillRect(x + 2, y + 2, w - 4, 1);
      // tail
      g.fillStyle = "#26323a"; g.fillRect(x + 3, y + h - 1, 4, 2); g.fillRect(x + 3, y + h + 1, 2, 2);
      g.fillStyle = bub.kind === "voice" ? "#dfe9d6" : "#c6dbdb"; g.fillRect(x + 4, y + h - 2, 2, 2); g.fillRect(x + 4, y + h, 1, 1);
      let cx = x + 3;
      for (const ic of icons) {
        if (ic === "=") { g.fillStyle = "#26323a"; g.fillRect(cx, y + 6, 4, 1); g.fillRect(cx, y + 8, 4, 1); cx += 7; continue; }
        g.drawImage(sprite(ic), cx, y + 3);
        cx += 11;
      }
    }
  }

  _hand(g, now) {
    const h = this.hand;
    const x = Math.round(h.x * TILE), y = Math.round(h.y * TILE);
    if (h.tool === "hand" || !h.tool) {
      const img = sprite(this.held || this.squeeze ? "hand_grab" : "hand");
      g.drawImage(img, x - 4, y - 1);
    } else if (h.tool === "crush") {
      const img = sprite(this.squeeze ? "hand_grab" : "i_fist");
      if (this.squeeze) g.drawImage(img, x - 7, y - 4);
      else g.drawImage(img, 0, 0, img.width, img.height, x - 9, y - 9, img.width * 2, img.height * 2);
    } else if (h.tool === "flick") {
      const img = sprite("i_flick");
      g.drawImage(img, 0, 0, img.width, img.height, x - 9, y - 9, img.width * 2, img.height * 2);
    } else if (h.tool === "tub" || h.tool === "tree") {
      g.globalAlpha = 0.6 + 0.2 * Math.sin(now / 150);
      const img = h.tool === "tub" ? sprite("tub") : appleTree(424242, false);
      g.drawImage(img, x - img.width / 2, y - img.height + 4);
      g.globalAlpha = 1;
    } else {
      const icon = { apple: "apple", ball: "ball", soap: "i_soap" }[h.tool];
      const img = sprite(icon);
      g.drawImage(img, x - img.width / 2, y - img.height - 2 + Math.sin(now / 180) * 1.5);
      g.drawImage(sprite("hand"), x - 4, y - 1);
    }
  }

  _glitchScreen(ctx, now) {
    const W = this.canvas.width, H = this.canvas.height;
    const n = 8 + Math.floor(Math.random() * 10);
    for (let i = 0; i < n; i++) {
      const y = Math.floor(Math.random() * H), h = 4 + Math.floor(Math.random() * 40);
      const dx = Math.floor((Math.random() - 0.5) * 80);
      ctx.drawImage(this.canvas, 0, y, W, h, dx, y, W, h);
      if (Math.random() < 0.35) {
        ctx.fillStyle = Math.random() < 0.6 ? "#000" : (Math.random() < 0.5 ? "rgba(224,58,232,.5)" : "rgba(24,232,220,.5)");
        ctx.fillRect(Math.random() * W * 0.6, y, W * (0.1 + Math.random() * 0.5), h * 0.6);
      }
    }
  }
}

Renderer.prototype.setInset = function (px) {
  this.inset = px;
};

Renderer.prototype.setZoom = function (z, sx = innerWidth / 2, sy = innerHeight / 2) {
  const before = this.screenToWorld(sx, sy);
  this.zoom = Math.max(0.5, Math.min(2.5, z));
  this._fit(true);
  // keep the point under the cursor in place
  const vw = Math.ceil(innerWidth / this.scale), vh = Math.ceil(innerHeight / this.scale);
  const cx = this.world[0] / 2 * TILE, cy = (this.world[1] / 2 + 0.4) * TILE;
  this.pan.x = before.x * TILE - sx / this.scale - (cx - vw / 2 + this.shift);
  this.pan.y = before.y * TILE - sy / this.scale - (cy - vh / 2);
};
