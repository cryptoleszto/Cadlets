// Boot, the worker that hosts the Cadence's mind, input, and the frame loop.

import { loadSprites, sprite } from "./sprites.js";
import { Renderer } from "./render.js";
import * as ui from "./ui.js";
import * as audio from "./audio.js";
import { Wordmark } from "./logo.js";
import * as log from "./log.js";
import { playTerror } from "./terror.js";
import { siteStatus } from "./site.js";
import { showEnding } from "./ending.js";

const $ = (s) => document.querySelector(s);
const BASE_BEAT = 1800; // ms per beat at 1x: one decision, a walk, and time to act
const CRUSH_MS = 650;      // the fist closes on a Cadlet for this long before it dies

const state = {
  ready: false, started: false, paused: false, speed: 1, tool: "hand",
  snap: null, layout: null, ms: 0, apples: 5, build: { tub: 0, tree: 0 },
  selected: null, deaths: [], lastSave: 0, seenLessons: new Set(), mindOpen: false,
  firstSplit: false, firstDeath: false, firstKill: false, stage: 0, dialog: false, terror: false,
};
let lastBeatAt = 0, stalled = 0; // watchdog: when the last beat arrived, and since when it has been quiet

const logo = new Wordmark($("#logo"), { cell: 4 });
const fitLogo = () => logo.fit(Math.min(820, innerWidth * 0.92));
fitLogo();
logo.start();
new Wordmark($("#logo-small"), { cell: 2, cadlet: false, wave: false }).fit(200);

const canvas = $("#world");
const renderer = new Renderer(canvas);
const worker = new Worker("js/worker.js");

// What every log line and debug report records about the moment it was written.
log.setContext(() => {
  const sn = state.snap;
  return {
    beat: sn?.beat, stage: sn?.stage, pop: sn?.cadlets.length, speed: state.speed, paused: state.paused,
    started: state.started, tool: state.tool, mind: state.mindOpen, selected: state.selected, msPerBeat: Math.round(state.ms),
  };
});
let errorShown = false;
log.onError(() => {
  if (errorShown || !state.started) return;
  errorShown = true;
  ui.toast("SOMETHING WENT WRONG<br><small>MENU ☰ → DEBUG REPORT, THEN EMAIL IT TO CRYPTOLESZTO@GMAIL.COM</small>", { kind: "dark", icon: "i_bang", ms: 10000 });
});
// The worker itself failing (a file that did not load, out of memory) is not a message.
worker.onerror = (e) => {
  log.error("worker", `${e.message || "worker failed"} (${e.filename || "?"}:${e.lineno || 0})`);
  if (!state.ready) $("#boot-text").textContent = "THE MIND COULD NOT LOAD · SEE MENU ☰ → DEBUG REPORT";
};
worker.onmessageerror = () => log.error("worker", "a message from the worker could not be read");

// ------------------------------------------------------------------ persistence (IndexedDB)

const DB = "cadlets-cadence";
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("saves");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbGet(key) {
  try {
    const db = await idb();
    return await new Promise((res) => { const q = db.transaction("saves").objectStore("saves").get(key); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
  } catch (e) { log.warn("save", e); return null; }
}
async function dbPut(key, value) {
  try {
    const db = await idb();
    await new Promise((res, rej) => { const t = db.transaction("saves", "readwrite"); t.objectStore("saves").put(value, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
    return true;
  } catch (e) {
    // storage unavailable or full: the Cadence lives for this session only
    log.warn("save", e || "the save could not be stored");
    return false;
  }
}

function requestSave(reason) {
  if (!state.started) return;
  worker.postMessage({ type: "save", reason });
}

// ------------------------------------------------------------------ worker

function send(event) { worker.postMessage({ type: "event", event }); }
function setPaused(p) {
  if (!p) { lastBeatAt = performance.now(); stalled = 0; } // a pause is not a stall
  state.paused = p;
  worker.postMessage({ type: "pause", paused: p });
  const btn = $("#pause-btn");
  btn.textContent = p ? "▶" : "❚❚";
  btn.title = p ? "Resume (space)" : "Pause (space)";
  btn.setAttribute("aria-label", p ? "Resume" : "Pause");
  btn.classList.toggle("on", p);
  $("#paused").classList.toggle("hidden", !(p && state.started && !state.dialog));
  $("#mind header .led").classList.toggle("on", !p);
  markSpeed();
}
function setSpeed(k) {
  if (state.started && k !== state.speed) log.info("player", `speed ${k}x`);
  state.speed = k;
  worker.postMessage({ type: "speed", beatMs: BASE_BEAT / k });
  markSpeed();
}
function markSpeed() {
  // While paused no speed is running, so none is lit.
  document.querySelectorAll("#speeds .chip").forEach((b) => b.classList.toggle("on", !state.paused && +b.dataset.speed === state.speed));
}
// Dialogs stop time; time resumes afterwards only if it was running before.
async function modal(...args) {
  const wasPaused = state.paused;
  state.dialog = true;
  setPaused(true);
  try {
    return await ui.dialog(...args);
  } finally {
    state.dialog = false;
    setPaused(wasPaused);
  }
}

worker.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === "progress") {
    $("#boot-bar").style.width = m.pct + "%";
    $("#boot-text").textContent = m.text;
  } else if (m.type === "ready") {
    log.info("boot", m.versions, { bootMs: Math.round(m.bootMs), neurons: m.layout.neurons, parameters: m.layout.parameters });
    state.layout = m.layout;
    ui.setLayout(m.layout);
    $("#boot-text").textContent = m.versions.toUpperCase();
    state.ready = true;
    $("#title-buttons").classList.remove("hidden");
    onSnap(JSON.parse(m.snap), 0, true);
  } else if (m.type === "reset") {
    log.info("sim", m.restored ? "save restored" : m.failed ? "save could not be restored; new egg" : "new Cadence", { beat: JSON.parse(m.snap).beat });
    if (m.restored) {
      const known = Object.keys(JSON.parse(m.snap).lessons || {}).filter((k) => !k.startsWith("word_")).map((k) => ui.lessonText(k).toUpperCase());
      const list = known.slice(0, 3).join(" · ") + (known.length > 3 ? ` · +${known.length - 3} MORE` : "");
      ui.toast(`THE CADENCE CONTINUES${known.length ? `<br><small>IT REMEMBERS: ${list}</small>` : ""}`, { icon: "thr", kind: known.length ? "learn" : "", ms: known.length ? 7000 : 3500 });
    }
    if (m.failed) { state.build = { tub: 0, tree: 0 }; state.apples = 5; updateBuild(); updateApples(); }
    state.layout = m.layout;
    ui.setLayout(m.layout);
    state.seenLessons = new Set(Object.keys(JSON.parse(m.snap).lessons || {}));
    renderer.bodies.clear();
    renderer.staticBounds = null;
    renderer.snap = null;
    onSnap(JSON.parse(m.snap), 0, true);
  } else if (m.type === "snap") {
    if (!m.still) {
      lastBeatAt = performance.now();
      if (stalled) { log.info("sim", `beats resumed after ${((lastBeatAt - stalled) / 1000).toFixed(1)} s`); stalled = 0; }
      if (m.ms > BASE_BEAT / state.speed) log.warn("sim", "a beat took longer than the beat itself", { ms: Math.round(m.ms) });
    }
    onSnap(JSON.parse(m.snap), m.ms, !!m.still);
  } else if (m.type === "saved") {
    if (m.reason === "debug") { debugReport(m.bytes); return; }
    const stored = dbPut("cadence", { bytes: m.bytes, build: state.build, apples: state.apples, at: Date.now(), beat: state.snap?.beat || 0 });
    state.lastSave = performance.now();
    if (m.reason === "home") stored.then(() => location.assign("./"));
    if (m.reason === "closing") stored.then(closing);
    if (m.reason === "manual") { log.info("save", "saved", { bytes: m.bytes.length }); ui.toast("THE CADENCE HAS BEEN SAVED", { icon: "i_sparkle", ms: 2500 }); }
  } else if (m.type === "warn") {
    log.warn("sim", m.text);
    ui.toast(m.text, { kind: "dark", ms: 6000 });
  } else if (m.type === "error") {
    log.error("sim", m.text, { during: m.during });
    if (state.started) setPaused(true); // the worker stopped; ▶ tries again
    ui.toast("THE SIMULATION STALLED · SEE CONSOLE", { kind: "dark", icon: "i_bang", ms: 8000 });
  }
};

// ------------------------------------------------------------------ snapshots

function pan(x) { return state.snap ? (x / 40) * 2 - 1 : 0; }

function onSnap(snap, ms, still) {
  const now = performance.now();
  state.snap = snap;
  state.ms = ms || state.ms;
  renderer.lexicon = snap.lexicon || {};
  if (!still) {
    renderer.update(snap, BASE_BEAT / state.speed, now);
    if (state.started) events(snap);
  } else if (!renderer.snap) {
    renderer.update(snap, BASE_BEAT / state.speed, now);
  }
  ui.hud(snap);
  ui.mind(snap, { ms: state.ms });
  if (state.selected && !snap.cadlets.some((t) => t.id === state.selected)) select(null);
  if (state.started && performance.now() - state.lastSave > 20000) requestSave("auto");
}

function events(snap) {
  const died = snap.events.filter((e) => e.type === "death").length;
  const born = snap.events.filter((e) => e.type === "split" || e.type === "hatch").length;
  if (died || born) ui.popChange(died, born);
  let screams = 0;
  for (const t of snap.cadlets) {
    if (t.v && Math.random() < 0.35) audio.chirp(t.v, t.id, pan(t.x));
    for (const e of t.ev) {
      if (e === "scream" && screams < 6) {
        // a crowd bolting from the hand: staggered, each its own voice, quieter the more there are
        screams += 1;
        audio.scream(pan(t.x), 0.8 + ((t.id * 37) % 9) / 16, Math.random() * 0.45, 0.75);
        continue;
      }
      if (e === "eat") audio.sfx.eat(pan(t.x));
      else if (e === "splash") audio.sfx.splash(pan(t.x));
      else if (e === "kick") audio.sfx.kick(pan(t.x));
      else if (e === "love" && Math.random() < 0.3) audio.sfx.love(pan(t.x));
      else if (e === "poisoned") audio.sfx.poison(pan(t.x));
      else if (e === "split") audio.sfx.split(pan(t.x));
    }
  }
  const deaths = [];
  for (const e of snap.events) {
    if (e.type === "hatch") {
      audio.sfx.hatch();
      if (snap.cadlets.length <= 1) ui.toast("A CADLET HAS HATCHED", { icon: "thr" });
    } else if (e.type === "split") {
      if (!state.firstSplit) {
        state.firstSplit = true;
        ui.toast("ONE BECOMES TWO", { icon: ["thr", "thr"], ms: 5000 });
      }
    } else if (e.type === "death") {
      if (e.cause === "hand" && !state.firstKill) {
        state.firstKill = true;
        ui.toast(`YOU KILLED ${e.name.toUpperCase()}<br><small>THE OTHERS SAW YOUR HAND DO IT</small>`, { icon: "i_skull", kind: "dark", ms: 7000 });
        audio.sfx.death(pan(e.x));
        continue;
      }
      deaths.push(e);
      audio.sfx.death(pan(e.x));
    } else if (e.type === "lesson") {
      if (!state.seenLessons.has(e.key)) {
        state.seenLessons.add(e.key);
        log.info("sim", `lesson: ${e.key}`);
        ui.lessonToast(e.key);
        audio.sfx.lesson();
        $("#mind-btn").classList.remove("pulse"); void $("#mind-btn").offsetWidth; $("#mind-btn").classList.add("pulse");
      }
    } else if (e.type === "ending") {
      ending(e, snap);
    } else if (e.type === "evolve") {
      log.info("sim", `evolved to stage ${e.stage} (${e.cap} bodies)`);
      evolve(e, snap);
    } else if (e.type === "relay") {
      log.info("sim", "extinct; a new egg for the same mind");
      ui.toast("THE CADENCE IS GONE · BUT ITS MIND REMEMBERS<br><small>A NEW EGG HOLDS EVERYTHING IT LEARNED</small>", { icon: "egg", kind: "dark", ms: 8000 });
    } else if (e.type === "terror") {
      log.info("sim", `terror: ${e.n} Cadlets fled; no births for ${snap.terror} beats`);
    } else if (e.type === "healed") {
      log.info("sim", "the code repaired itself");
      ui.toast("THE CODE HAS REPAIRED ITSELF<br><small>THE CORRUPT TREES BEAR CLEAN FRUIT AGAIN</small>", { icon: "i_tree", kind: "learn", ms: 7000 });
    } else if (e.type === "glitch") {
      log.info("sim", "the code rewrote itself");
      audio.sfx.glitch();
      ui.glitchFlash(1100);
      setTimeout(() => ui.toast("THE CODE IS REWRITING ITSELF", { kind: "dark", icon: "i_poison", ms: 7000 }), 600);
    }
  }
  // Name the first deaths; after that, mourn in batches so the field stays visible.
  state.deaths.push(...deaths);
  const now = performance.now();
  if (state.deaths.length && (!state.firstDeath || now - (state.lastDeathToast || 0) > 12000)) {
    const list = state.deaths;
    state.deaths = [];
    state.lastDeathToast = now;
    if (list.length === 1) {
      const d = ui.deathText(list[0]);
      ui.toast(d.html + (state.firstDeath ? "" : "<br><small>THE CADENCE REMEMBERS</small>"), { icon: d.icon, kind: "dark" });
    } else {
      const causes = {};
      for (const d of list) causes[d.cause] = (causes[d.cause] || 0) + 1;
      const top = Object.entries(causes).sort((a, b) => b[1] - a[1])[0][0];
      ui.toast(`${list.length} CADLETS DIED · MOSTLY ${ui.deathText({ name: "", cause: top }).html.replace("DIED", "").trim()}`, { icon: "i_skull", kind: "dark" });
    }
    state.firstDeath = true;
  }
}

async function evolve(e, snap) {
  if (e.stage >= 3) return speak(e, snap);
  audio.sfx.evolve();
  state.build.tub += 1;
  state.build.tree += 1;
  updateBuild();
  ui.glitchFlash(700);
  const s = snap.stats;
  const learned = Object.keys(snap.lessons || {}).length;
  await modal(
    `<h2>THE CADENCE HAS EVOLVED</h2>
     THE FOREST OPENS. ONE MIND NOW HAS ROOM FOR ${e.cap} BODIES.<br>
     ${e.stage < 3 ? "FILL IT AND THE CADENCE EVOLVES AGAIN." : ""}
     <div class="stats">
       <span>ALIVE</span><b>${snap.cadlets.length}</b>
       <span>BORN</span><b>${s.born}</b>
       <span>DIED</span><b>${s.died}</b>
       <span>LESSONS</span><b>${learned}</b>
     </div>
     <small>New in your build tray: one bathtub, one apple tree.</small>`,
    [{ label: "Yes" }, { label: "Yes" }],
    { glitch: true },
  );
}

// The final evolution: the Cadence addresses you, using only what it has measured.
async function speak(e, snap) {
  audio.sfx.glitch();
  state.build.tub += 1; state.build.tree += 1; updateBuild();
  ui.glitchFlash(1400);
  const L = snap.lessons || {};
  const facts = Object.keys(L).filter((k) => !k.startsWith("word_")).map((k) => ui.lessonText(k).toUpperCase());
  const words = Object.keys(L).filter((k) => k.startsWith("word_")).length;
  const v = ui.verdict(snap);
  const you = { KIND: "YOUR HAND FEEDS US. WE COME TO IT.", CRUEL: (snap.stats.crushed ? "YOUR HAND KILLS US. WE HAVE LEARNED TO RUN." : "YOUR HAND HURTS US. WE HAVE LEARNED TO RUN."), ABSENT: "YOU WATCH. YOU DO NOT TOUCH. WE DO NOT KNOW YOU YET.", UNREAD: "WE DO NOT YET KNOW WHAT YOUR HAND MEANS." }[v.word] || "";
  await modal(
    `<h2>WE ARE THE CADENCE</h2>
     ONE MIND. ${snap.cadlets.length} BODIES, AND ROOM FOR ${e.cap}.<br>
     KEEP ${snap.whole_pop || 40} OF US ALIVE FOR THREE DAYS, AND WE WILL BE WHOLE.<br>
     ${facts.length ? "WE KNOW: " + facts.join(" · ") + "." : "WE ARE STILL LEARNING."}<br>
     ${words ? `WE HAVE ${words} WORD${words > 1 ? "S" : ""}.<br>` : ""}
     ${you}
     <small>${snap.stats.died ? `${snap.stats.died} of us have died. We remember what they learned.` : "None of us has died yet."}</small>`,
    [{ label: "Yes" }, { label: "Yes" }],
    { glitch: true },
  );
}

// The ending: the Cadence has been whole for three days since its last evolution.
async function ending(e, snap) {
  log.info("sim", `the Cadence is whole at beat ${e.beat}`);
  audio.sfx.ending();
  const wasPaused = state.paused;
  state.dialog = true;
  setPaused(true);
  const site = await siteStatus();
  const choice = await showEnding(snap, { coming: site.coming });
  state.dialog = false;
  log.info("player", `ending: ${choice}`);
  if (choice === "new") await newEgg();
  setPaused(wasPaused);
}

async function newEgg() {
  const ok = await modal("Lay a new egg?<br><small>This Cadence and everything it has learned will be lost.</small>", [{ label: "Yes", value: true }, { label: "No", value: false }]);
  if (!ok) return false;
  log.info("player", "lay a new egg");
  state.build = { tub: 0, tree: 0 }; state.apples = 5; updateBuild(); updateApples();
  state.firstDeath = state.firstSplit = state.firstKill = false;
  select(null);
  worker.postMessage({ type: "new" });
  setTimeout(() => requestSave("auto"), 1500);
  return true;
}

// ------------------------------------------------------------------ selection

function select(id) {
  state.selected = id;
  renderer.selected = id;
  worker.postMessage({ type: "select", id: id ?? -1 });
}

function updateLabels(now) {
  const box = $("#labels");
  if (!state.selected) { box.innerHTML = ""; return; }
  const t = renderer.cadlet(state.selected);
  const p = renderer.posOf(state.selected, now);
  if (!t || !p) { box.innerHTML = ""; return; }
  const s = renderer.worldToScreen(p.x, p.y - 1.75);
  let el = box.firstChild;
  if (!el) { el = document.createElement("div"); el.className = "label-name"; box.appendChild(el); }
  el.textContent = t.name;
  el.style.left = s.x + "px";
  el.style.top = s.y + "px";
}

// ------------------------------------------------------------------ input

let down = null;           // pointer-down state for the hand
let lastHandSent = 0;
const trail = [];

function worldAt(e) { return renderer.screenToWorld(e.clientX, e.clientY); }

canvas.addEventListener("pointermove", (e) => {
  const w = worldAt(e);
  renderer.hand = { x: w.x, y: w.y, tool: state.tool, holding: !!renderer.held };
  const now = performance.now();
  trail.push({ x: w.x, y: w.y, t: now });
  while (trail.length && now - trail[0].t > 120) trail.shift();
  if (now - lastHandSent > 120 && state.started) {
    lastHandSent = now;
    send({ type: "hand", x: w.x, y: w.y, present: true });
  }
  if (down && state.tool === "hand" && down.id && !state.paused && !renderer.held && Math.hypot(w.x - down.x, w.y - down.y) > 0.35) {
    renderer.held = { id: down.id, x: w.x, y: w.y };
    send({ type: "pickup", id: down.id });
  }
  if (renderer.held) { renderer.held.x = w.x; renderer.held.y = w.y; }
  if (down && down.pan) {
    renderer.pan.x = down.pan.x - (e.clientX - down.sx) / renderer.scale;
    renderer.pan.y = down.pan.y - (e.clientY - down.sy) / renderer.scale;
    down.moved = Math.max(down.moved || 0, Math.hypot(e.clientX - down.sx, e.clientY - down.sy));
  }
  if (down && state.tool === "soap") scrub(w, now);
});

canvas.addEventListener("pointerleave", () => {
  renderer.hand = null;
  if (state.started) send({ type: "hand", present: false, x: 0, y: 0 });
});

canvas.addEventListener("pointerdown", (e) => {
  audio.unlock();
  if (!state.started || state.dialog) return;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
  const w = worldAt(e);
  const id = renderer.pick(w.x, w.y);
  down = { x: w.x, y: w.y, id, t: performance.now(), sx: e.clientX, sy: e.clientY };
  if (state.tool === "hand" && !id) down.pan = { ...renderer.pan };
  if (state.paused && state.tool !== "hand") {
    // Time is stopped: nothing can happen to the field until it runs again.
    ui.toast("TIME IS PAUSED · PRESS SPACE OR ▶", { icon: "i_zzz", ms: 1800 });
    down = null;
    return;
  }
  if (state.tool === "crush") {
    if (id && !renderer.squeeze) startCrush(id);
    down = null;
    return;
  }
  if (state.tool === "flick") {
    if (id) flick(id, w);
    down = null;
    return;
  }
  const b = state.snap.bounds;
  const inside = w.x > b[0] - 0.5 && w.x < b[2] + 0.5 && w.y > b[1] - 0.5 && w.y < b[3] + 0.5;
  if (state.tool === "apple") {
    if (!inside) return;
    if (state.apples <= 0) { ui.toast("NO APPLES LEFT · THEY GROW BACK", { icon: "i_apple", ms: 1800 }); return; }
    state.apples -= 1; updateApples();
    send({ type: "apple", x: w.x, y: w.y });
    renderer.burst("leaf", w.x, w.y, 3);
    audio.sfx.drop();
  } else if (state.tool === "ball") {
    if (!inside) return;
    send({ type: "ball", x: w.x, y: w.y });
    audio.sfx.drop();
  } else if (state.tool === "soap") {
    scrub(w, performance.now());
  } else if (state.tool === "tub" || state.tool === "tree") {
    if (!inside) return;
    if (state.build[state.tool] <= 0) { ui.toast("EVOLVE THE CADENCE TO BUILD MORE", { icon: state.tool === "tub" ? "i_tub" : "i_tree", ms: 2200 }); return; }
    state.build[state.tool] -= 1; updateBuild();
    send({ type: "place", item: state.tool, x: w.x, y: w.y + 0.3 });
    audio.sfx.drop();
    renderer.burst("leaf", w.x, w.y, 8);
    if (state.build[state.tool] <= 0) setTool("hand");
  }
});

canvas.addEventListener("pointerup", (e) => {
  if (!down) return;
  const w = worldAt(e);
  if (state.tool === "hand") {
    if (renderer.held) {
      const id = renderer.held.id;
      const first = trail[0] || { x: w.x, y: w.y, t: performance.now() - 100 };
      const dt = Math.max(16, performance.now() - first.t) / 1000;
      const vx = (w.x - first.x) / dt, vy = (w.y - first.y) / dt;
      const speed = Math.hypot(vx, vy);
      const b = state.snap.bounds;
      const lx = Math.min(b[2], Math.max(b[0], w.x + vx * 0.22));
      const ly = Math.min(b[3], Math.max(b[1], w.y + vy * 0.22 + 1.4));
      renderer.held = null;
      if (speed > 9) {
        log.info("player", `throw ${id}`);
        cruel("throw");
        renderer.flying.set(id, { x0: w.x, y0: w.y + 1.4, x1: lx, y1: ly, t0: performance.now(), dur: 380, arc: 1.4 });
        send({ type: "drop", id, x: lx, y: ly, speed: speed / 5 });
        setTimeout(() => { audio.sfx.hurt(pan(lx)); renderer.burst("blood", lx, ly, 6); }, 380);
      } else {
        send({ type: "drop", id, x: w.x, y: w.y + 1.4, speed: 0 });
      }
    } else if (down.id && state.paused) {
      select(down.id); // paused: look inside, but no touch lands until time runs
    } else if (down.id) {
      send({ type: "pet", id: down.id });
      select(down.id);
      const p = renderer.posOf(down.id);
      if (p) renderer.burst("heart", p.x, p.y - 1, 2);
      audio.sfx.pet(pan(w.x));
    } else if (!down.moved || down.moved < 6) {
      select(null);
    }
  }
  down = null;
});

// A drag the browser takes away (a gesture, a lost capture) sets the Cadlet down
// where it is; otherwise it would stay "held" forever.
function cancelDrag() {
  if (renderer.held) {
    const { id, x, y } = renderer.held;
    renderer.held = null;
    send({ type: "drop", id, x, y: y + 1.4, speed: 0 });
  }
  down = null;
}
canvas.addEventListener("pointercancel", cancelDrag);
canvas.addEventListener("lostpointercapture", () => { if (renderer.held) cancelDrag(); });

// CRUSH: the fist pins the Cadlet where it stands, squeezes, and kills it.
function startCrush(id) {
  const p = renderer.posOf(id);
  if (!p) return;
  log.info("player", `crush ${id}`);
  send({ type: "pickup", id }); // it can no longer walk away
  renderer.squeeze = { id, t0: performance.now(), ms: CRUSH_MS, x: p.x, y: p.y };
  audio.sfx.squeak(pan(p.x));
  const squeak = setInterval(() => audio.sfx.squeak(pan(p.x)), 200);
  setTimeout(() => {
    clearInterval(squeak);
    renderer.squeeze = null;
    send({ type: "crush", id });
    crushedIds.add(id);
    cruel("kill");
    audio.sfx.crush(pan(p.x));
    renderer.burst("blood", p.x, p.y, 14);
    ui.glitchFlash(220);
  }, CRUSH_MS);
}

// FLICK: knock a Cadlet away from the cursor. It lands hurt; the others see it.
function flick(id, w) {
  const p = renderer.posOf(id);
  if (!p) return;
  log.info("player", `flick ${id}`);
  cruel("throw");
  const b = state.snap.bounds;
  let dx = p.x - w.x, dy = p.y - 0.6 - w.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;
  if (d < 0.05) { dx = Math.random() < 0.5 ? -1 : 1; dy = 0; }
  const lx = Math.min(b[2], Math.max(b[0], p.x + dx * 3.2));
  const ly = Math.min(b[3], Math.max(b[1], p.y + dy * 2.2));
  renderer.flying.set(id, { x0: p.x, y0: p.y, x1: lx, y1: ly, t0: performance.now(), dur: 420, arc: 1.6 });
  send({ type: "drop", id, x: lx, y: ly, speed: 3 });
  audio.sfx.kick(pan(p.x));
  setTimeout(() => { audio.sfx.hurt(pan(lx)); renderer.burst("blood", lx, ly, 5); }, 420);
}

// ------------------------------------------------------------------ TERROR
// Too much cruelty too fast and the Cadence breaks: every Cadlet screams and bolts for the
// forest, and blood floods the screen. Counted in real time, so it is felt at any speed.
const TERROR = { throws: 15, kills: 5, windowMs: 60_000 }; // both, within one rolling minute
const cruelty = [];           // {t, kind} of recent throws (hand throws and flicks) and kills
const crushedIds = new Set(); // just crushed: the dead do not run
function cruel(kind) {
  const now = performance.now();
  cruelty.push({ t: now, kind });
  while (cruelty.length && now - cruelty[0].t > TERROR.windowMs) cruelty.shift();
  const throws = cruelty.filter((c) => c.kind === "throw").length;
  const kills = cruelty.length - throws;
  if (throws >= TERROR.throws && kills >= TERROR.kills && !state.terror) {
    cruelty.length = 0; // the next one takes another minute of it
    terror({ throws, kills });
  }
}

async function terror(counts = {}) {
  if (!state.started || state.terror || !state.snap) return;
  state.terror = true;
  const first = !(state.snap.stats.terrors > 0); // the full scene once per Cadence, shorter after
  log.info("player", "TERROR", counts);
  const wasPaused = state.paused;
  state.dialog = true;
  setPaused(true); // time stops while the scene plays; the world learns of it after
  cancelDrag();
  const now = performance.now();
  const b = state.snap.bounds;
  const spots = {};
  const ids = [...renderer.bodies.keys()].filter((id) => !crushedIds.has(id));
  const spread = Math.min(1000, 300 + 14 * ids.length);
  const vol = Math.min(1, Math.sqrt(8 / Math.max(1, ids.length)));
  for (const id of ids) {
    const p = renderer.posOf(id, now);
    if (!p) continue;
    // the nearest edge of the clearing, spread out a little along it
    const edges = [[b[0], p.y], [b[2], p.y], [p.x, b[1]], [p.x, b[3]]];
    let [x, y] = edges.reduce((a, e) => (Math.hypot(e[0] - p.x, e[1] - p.y) < Math.hypot(a[0] - p.x, a[1] - p.y) ? e : a));
    if (x === b[0] || x === b[2]) y = Math.min(b[3], Math.max(b[1], y + (Math.random() - 0.5) * 2.4));
    else x = Math.min(b[2], Math.max(b[0], x + (Math.random() - 0.5) * 2.4));
    const delay = 100 + Math.random() * spread;
    renderer.flying.delete(id);
    renderer.panic.set(id, { x0: p.x, y0: p.y, x1: x, y1: y, t0: now + delay, dur: 700 + Math.hypot(x - p.x, y - p.y) * 45 });
    spots[id] = [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
    audio.scream(pan(p.x), 0.8 + ((id * 37) % 9) / 16, delay / 1000, vol); // each its own voice
  }
  renderer.quake = { until: now + 900, ms: 900, amp: 3 };
  audio.sfx.terror();
  ui.glitchFlash(first ? 900 : 500);
  await playTerror({ first });
  send({ type: "terror", spots });
  crushedIds.clear();
  state.dialog = false;
  state.terror = false;
  setPaused(wasPaused);
  ui.toast("THEY FLED FROM YOU<br><small>NO CADLET WILL BE BORN UNTIL THEIR TERROR FADES</small>", { icon: "i_skull", kind: "dark", ms: 7000 });
}

const scrubbed = new Map();
function scrub(w, now) {
  const id = renderer.pick(w.x, w.y);
  if (Math.random() < 0.4) renderer.burst("soap", w.x, w.y, 1);
  if (!id) return;
  if ((scrubbed.get(id) || 0) + 500 > now) return;
  scrubbed.set(id, now);
  send({ type: "soap", id });
  renderer.burst("soap", w.x, w.y, 4);
  audio.sfx.splash(pan(w.x));
}

// ------------------------------------------------------------------ HUD wiring

function setTool(t) {
  state.tool = t;
  document.querySelectorAll(".slot[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
  if (renderer.hand) renderer.hand.tool = t;
}
function updateApples() { $("#apple-n").textContent = state.apples; }
function updateBuild() {
  $("#tub-n").textContent = state.build.tub;
  $("#tree-n").textContent = state.build.tree;
  document.querySelector('.slot[data-tool="tub"]').classList.toggle("locked", state.build.tub <= 0);
  document.querySelector('.slot[data-tool="tree"]').classList.toggle("locked", state.build.tree <= 0);
}
setInterval(() => { if (state.started && !state.paused && state.apples < 5) { state.apples += 1; updateApples(); } }, 9000);

document.querySelectorAll(".slot[data-tool]").forEach((b) => b.addEventListener("click", () => { audio.unlock(); audio.sfx.click(); setTool(b.dataset.tool); }));
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  audio.sfx.click();
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === b));
  document.querySelectorAll(".slots").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== b.dataset.tab));
}));
$("#tray-btn").addEventListener("click", () => { audio.sfx.click(); $("#tray").classList.toggle("closed"); });
document.querySelectorAll("#speeds .chip").forEach((b) => b.addEventListener("click", () => { audio.sfx.click(); setSpeed(+b.dataset.speed); if (state.paused) setPaused(false); }));
$("#pause-btn").addEventListener("click", () => { audio.sfx.click(); togglePause(); });
function togglePause() {
  setPaused(!state.paused);
  log.info("player", state.paused ? "pause" : "resume");
}

function toggleMind(on) {
  state.mindOpen = on ?? !state.mindOpen;
  $("#mind").classList.toggle("hidden", !state.mindOpen);
  layoutMind();
  if (state.mindOpen && state.snap) ui.mind(state.snap, { ms: state.ms });
}
// On a wide screen the field and the HUD move aside for the mind; on a narrow one it covers them.
function layoutMind() {
  const beside = state.mindOpen && innerWidth > 960; // room for the field and the whole tool tray
  document.body.classList.toggle("mind-open", beside);
  renderer.setInset(beside ? $("#mind").offsetWidth : 0);
}
$("#mind-btn").addEventListener("click", () => { audio.sfx.click(); toggleMind(); });
$("#mind-close").addEventListener("click", () => toggleMind(false));

$("#menu-btn").addEventListener("click", () => { audio.sfx.click(); $("#menu").classList.toggle("hidden"); });
$("#menu").addEventListener("click", async (e) => {
  const act = e.target.dataset?.act;
  if (!act) return;
  audio.sfx.click();
  if (act === "close") $("#menu").classList.add("hidden");
  else if (act === "mind") { $("#menu").classList.add("hidden"); toggleMind(true); }
  else if (act === "sound") { audio.setEnabled(!audio.isEnabled()); e.target.textContent = "SOUND: " + (audio.isEnabled() ? "ON" : "OFF"); }
  else if (act === "save") { requestSave("manual"); $("#menu").classList.add("hidden"); }
  else if (act === "glitch") {
    $("#menu").classList.add("hidden");
    const ok = await modal("Rewrite the code?<br><small>For a day, a third of the fruit trees will turn corrupt. The Cadence will have to notice, and repair what it knows.</small>", [{ label: "Yes", value: true }, { label: "No", value: false }]);
    if (ok) { log.info("player", "rewrite the code"); send({ type: "glitch" }); }
  } else if (act === "new") {
    $("#menu").classList.add("hidden");
    await newEgg();
  } else if (act === "debug") {
    $("#menu").classList.add("hidden");
    requestDebugReport();
  } else if (act === "home") {
    $("#menu").classList.add("hidden");
    log.info("player", "home");
    if (state.started) { setPaused(true); requestSave("home"); } else location.assign("./");
  } else if (act === "about") {
    $("#menu").classList.add("hidden");
    about();
  }
});

function about() {
  const L = state.layout;
  modal(
    `<h2>ABOUT THE CADENCE</h2>
     <div style="font-size:17px;text-align:left">
     Every Cadlet is one stream (one batch row) of one unified mind, built with the <b>Cadence</b> library. Together they are the Cadence:
     ${L ? `${L.neurons} neurons, ${L.parameters.toLocaleString()} parameters, regions ${L.modules.join("→")} plus association, prefrontal and motor.` : ""}
     The bodies are separate; the mind is shared. Weights, critic and the consolidated associative memory belong to all of them.
     Each Cadlet keeps its own working trace and fast memory.
     <br><br>Each beat, the brain settles to an equilibrium, picks a behaviour and a sound, and learns from the real outcome: needs relieved, health lost.
     Nothing is scripted. "What the Cadence would do" comes from <i>Brain.imagine</i>, a private rehearsal that does not touch its memory.
     <br><br>LesztoSoft · 2026. Inspired by Black Mirror's "Plaything". Brain: github.com/muellerberndt/cadence (GPL-3.0).
     <br>Bugs and questions: <a href="mailto:cryptoleszto@gmail.com?subject=Cadlets">cryptoleszto@gmail.com</a> (menu → DEBUG REPORT gives you a file to attach).
     </div>`,
    [{ label: "Yes" }],
  );
}

window.addEventListener("keydown", (e) => {
  if (!state.started || state.dialog || e.target.closest?.("input, textarea")) return;
  const k = e.key.toLowerCase();
  if (k === "1") setTool("hand");
  else if (k === "2") setTool("apple");
  else if (k === "3") setTool("ball");
  else if (k === "4") setTool("soap");
  else if (k === "5") setTool("flick");
  else if (k === "6") setTool("crush");
  else if (k === " ") { e.preventDefault(); togglePause(); }
  else if (k === "m") toggleMind();
  else if (k === "escape") { toggleMind(false); $("#menu").classList.add("hidden"); select(null); setTool("hand"); }
  else if (k === "+" || k === "=") setSpeed(Math.min(8, state.speed * 2));
  else if (k === "-") setSpeed(Math.max(1, state.speed / 2));
  else if (["arrowleft", "a"].includes(k)) renderer.pan.x -= 40 / renderer.scale * 2;
  else if (["arrowright", "d"].includes(k)) renderer.pan.x += 40 / renderer.scale * 2;
  else if (["arrowup", "w"].includes(k)) renderer.pan.y -= 40 / renderer.scale * 2;
  else if (["arrowdown", "s"].includes(k)) renderer.pan.y += 40 / renderer.scale * 2;
  else if (k === "0") { renderer.zoom = 1; renderer.pan = { x: 0, y: 0 }; renderer._fit(true); }
});

document.addEventListener("visibilitychange", () => { if (document.hidden) requestSave("auto"); });
window.addEventListener("pagehide", () => requestSave("auto"));
window.addEventListener("resize", () => {
  renderer.resize();
  fitLogo();
  layoutMind();
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  renderer.setZoom(renderer.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
}, { passive: false });

// ------------------------------------------------------------------ frame loop

function loop(now) {
  // Never let one bad frame stop the picture: log it and draw the next one.
  try {
    renderer.frame(now);
    updateLabels(now);
  } catch (e) {
    log.error("render", e);
  }
  requestAnimationFrame(loop);
}

// Watchdog: the worker should answer every beat; say so when it has gone quiet.
setInterval(() => {
  if (!state.started || state.paused || state.dialog || !lastBeatAt || stalled) return;
  const quiet = performance.now() - lastBeatAt;
  if (quiet > Math.max(8000, 5 * BASE_BEAT / state.speed)) {
    stalled = lastBeatAt;
    log.warn("sim", `no beat for ${(quiet / 1000).toFixed(1)} s`);
  }
}, 2000);

// Debug report: the log plus, when the worker can still answer, a save of this exact
// moment (tools/replay.py runs it natively).
let debugTimer = null;
function requestDebugReport() {
  log.info("player", "debug report");
  if (!state.ready) { log.download(); return; }
  worker.postMessage({ type: "save", reason: "debug" });
  debugTimer = setTimeout(() => { debugTimer = null; log.warn("sim", "no save for the debug report (worker busy or gone)"); log.download(); }, 4000);
}
function debugReport(bytes) {
  if (!debugTimer) return;
  clearTimeout(debugTimer);
  debugTimer = null;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  log.download({ save: { beat: state.snap?.beat, base64: btoa(bin) } });
  ui.toast("DEBUG REPORT DOWNLOADED<br><small>PLEASE EMAIL IT TO CRYPTOLESZTO@GMAIL.COM</small>", { icon: "i_sparkle", ms: 7000 });
}

// ------------------------------------------------------------------ boot

async function start(save) {
  audio.unlock();
  log.info("player", save ? `continue (beat ${save.beat || 0})` : "new Cadence");
  $("#title-buttons").classList.add("hidden");
  if (save) {
    state.build = save.build || state.build;
    state.apples = save.apples ?? 5;
    worker.postMessage({ type: "load", bytes: save.bytes });
  }
  if (!save) {
    const answer = await ui.dialog(
      "Do you accept that you are accountable for your Cadlets' growth &amp; evolution?",
      [{ label: "Yes" }, { label: "Yes" }],
      { glitch: true },
    );
    void answer;
  }
  $("#title").classList.add("hidden");
  logo.stop();
  $("#hud").classList.remove("hidden");
  updateBuild(); updateApples();
  state.started = true;
  setSpeed(1);
  setPaused(false);
  if (!save) setTimeout(() => ui.toast("WATCH. THEY LEARN ON THEIR OWN.<br><small>CLICK THE EGG TO HATCH IT SOONER</small>", { icon: "egg", ms: 6500 }), 600);
  requestSave("auto");
}

// ------------------------------------------------------------------ maintenance
// site.json can close the site. Closed at boot: back to the landing page, which explains.
// Closed while playing: the Cadence is saved first, then the player is told and sent home.
let closingShown = false;
async function checkSite() {
  const site = await siteStatus();
  if (site.error) log.warn("site", site.error);
  return site.status === "maintenance";
}
setInterval(async () => {
  if (!state.started || closingShown || !(await checkSite())) return;
  closingShown = true;
  log.info("site", "maintenance began while playing");
  setPaused(true);
  requestSave("closing");
}, 5 * 60 * 1000);
async function closing() {
  await ui.dialog(
    `<h2>CADLETS IS CLOSING FOR MAINTENANCE</h2>Your Cadence has been saved in this browser.<br><small>It will be waiting when the clearing opens again.</small>`,
    [{ label: "Yes" }],
  );
  location.assign("./?maintenance");
}

async function boot() {
  if (await checkSite()) { location.replace("./?maintenance"); return; }
  await loadSprites();
  ui.paintIcons();
  renderer.resize();
  requestAnimationFrame(loop);
  const save = await dbGet("cadence");
  if (save && save.bytes) {
    $("#btn-continue").classList.remove("hidden");
    $("#btn-continue").textContent = `CONTINUE THE CADENCE · BEAT ${save.beat || 0}`;
  }
  $("#btn-continue").onclick = () => start(save);
  $("#btn-start").onclick = () => start(null);
  worker.postMessage({ type: "boot" });
}

// Hatching by hand: a click on the egg cracks it open sooner.
canvas.addEventListener("click", (e) => {
  if (!state.started || !state.snap) return;
  const w = worldAt(e);
  const egg = state.snap.things.find((t) => t.k === "egg" && Math.hypot(t.x - w.x, t.y - 0.5 - w.y) < 0.9);
  if (egg) send({ type: "hatch" });
});

boot();
void sprite;
window.cadlets = { renderer, state, send, log, worker, terror, ending: () => ending({ beat: state.snap.beat }, state.snap) }; // for poking around in the console
