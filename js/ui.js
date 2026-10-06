// HUD, toasts, dialogs and the Cadence's mind panel (diagnostics from the Cadence library).

import { sprite } from "./sprites.js";
import { ICON_FOR, GLYPHS } from "./render.js";
import * as log from "./log.js";

const $ = (s) => document.querySelector(s);
export const BEH_COLORS = {
  eat: "#d63b2b", bathe: "#4f8fdc", play: "#f2c84b", cuddle: "#e8607a",
  sleep: "#7b6bd6", hand: "#f1e3c9", flee: "#8a9499", wander: "#4c9b31",
};
const NEED_ICON = { hunger: "i_apple", filth: "i_tub", despair: "i_ball", poison: "i_poison", injury: "i_bang", exhaustion: "i_zzz" };

const LESSONS = {
  apples: { icon: "i_apple", text: "<b>APPLES</b> END HUNGER" },
  baths: { icon: "i_tub", text: "<b>BATHS</b> WASH AWAY DIRT" },
  play: { icon: "i_ball", text: "<b>PLAY</b> CURES BOREDOM" },
  rest: { icon: "i_zzz", text: "<b>SLEEP</b> HEALS WOUNDS" },
  calm: { icon: "i_zzz", text: "WHEN NOTHING PRESSES, <b>REST</b>" },
  night: { icon: "i_zzz", text: "THE NIGHT IS FOR <b>SLEEP</b>" },
  glitch: { icon: "i_poison", text: "<b>CORRUPT FRUIT</b> IS POISON" },
  hand_kind: { icon: "i_hand", text: "YOUR <b>HAND</b> IS KIND" },
  hand_cruel: { icon: "i_hand", text: "TO <b>FLEE</b> YOUR HAND" },
};

export function icon(name, size = 27) {
  const c = document.createElement("canvas");
  const img = sprite(name);
  c.width = img.width; c.height = img.height;
  c.getContext("2d").drawImage(img, 0, 0);
  c.style.width = size + "px"; c.style.height = Math.round(size * img.height / img.width) + "px";
  return c;
}

export function paintIcons(root = document) {
  for (const c of root.querySelectorAll("canvas[data-icon]")) {
    const img = sprite(c.dataset.icon);
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0);
  }
  const pop = $("#pop-icon");
  const thr = sprite("thr");
  pop.width = thr.width; pop.height = thr.height;
  pop.getContext("2d").drawImage(thr, 0, 0);
}

// ------------------------------------------------------------------ toasts

export function toast(html, { icon: ic = null, kind = "", ms = 5200 } = {}) {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast " + kind;
  if (ic) (Array.isArray(ic) ? ic : [ic]).forEach((n) => el.appendChild(n === "=" ? Object.assign(document.createElement("span"), { textContent: "=" }) : icon(n)));
  const span = document.createElement("span");
  span.innerHTML = html;
  el.appendChild(span);
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 420); }, ms);
}

export function lessonToast(key) {
  if (key.startsWith("word_")) {
    const [, glyph, meaning] = key.split("_");
    toast(`THE CADENCE HAS A WORD FOR <b>${meaning.toUpperCase()}</b>`, { icon: [GLYPHS[["", "ba", "li", "mo"].indexOf(glyph)], "=", ICON_FOR[meaning]], kind: "learn", ms: 7000 });
    return;
  }
  const L = LESSONS[key];
  if (!L) return;
  toast(`THE CADENCE HAS LEARNED: ${L.text}`, { icon: L.icon, kind: "learn", ms: 7000 });
}

export function lessonText(key) {
  if (key.startsWith("word_")) {
    const [, glyph, meaning] = key.split("_");
    return `a word: “${glyph}” means ${meaning}`;
  }
  const L = LESSONS[key];
  return L ? L.text.replace(/<\/?b>/g, "").toLowerCase() : key;
}

// ------------------------------------------------------------------ dialogs

export function dialog(html, buttons = [{ label: "OK" }], { glitch = false } = {}) {
  return new Promise((resolve) => {
    const d = $("#dialog");
    $("#dialog-text").innerHTML = html;
    const bx = $("#dialog-buttons");
    bx.innerHTML = "";
    for (const b of buttons) {
      const el = document.createElement("button");
      el.className = "plank-btn";
      el.textContent = b.label;
      el.onclick = () => { d.classList.add("hidden"); resolve(b.value ?? b.label); };
      bx.appendChild(el);
    }
    d.classList.remove("hidden");
    if (glitch) glitchFlash(900);
  });
}

export function glitchFlash(ms = 700) {
  const el = $("#glitch");
  el.innerHTML = "";
  for (let i = 0; i < 18; i++) {
    const bar = document.createElement("div");
    const top = Math.random() * 100, h = 1 + Math.random() * 6;
    const colors = ["#000", "#000", "#e03ae8", "#18e8dc", "#3b5d2c", "#c9a477"];
    Object.assign(bar.style, {
      position: "absolute", top: top + "%", height: h + "%", left: Math.random() * 40 + "%",
      width: 20 + Math.random() * 70 + "%", background: colors[Math.floor(Math.random() * colors.length)], opacity: 0.85,
    });
    el.appendChild(bar);
  }
  el.classList.add("on");
  setTimeout(() => el.classList.remove("on"), ms);
}

// ------------------------------------------------------------------ HUD

let lastPop = -1;

// A death or a birth shows on the ring as a floating -1 / +1, even when a Cadlet splits
// into the freed place a beat later and the number itself barely moves.
export function popChange(died, born) {
  const ring = $("#pop");
  for (const [n, cls] of [[died, "down"], [born, "up"]]) {
    if (!n) continue;
    const el = document.createElement("span");
    el.className = `pop-delta ${cls}`;
    el.textContent = `${cls === "down" ? "−" : "+"}${n}`;
    ring.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
  if (died) { ring.classList.remove("hurt"); void ring.offsetWidth; ring.classList.add("hurt"); }
}

export function hud(snap) {
  const n = snap.cadlets.length;
  if (n !== lastPop) { $("#pop-n").textContent = n; lastPop = n; }
  const eggs = snap.things.filter((t) => t.k === "egg").length;
  // Toward the next evolution; after the last one, how full the forest is (the mind's room).
  const next = snap.next;
  const room = next || snap.cap || n || 1;
  $("#pop-of").textContent = `/${room}`;
  $("#pop").style.setProperty("--p", Math.min(100, (n / room) * 100));
  $("#pop").classList.toggle("final", !next);
  $("#pop").title = next ? `${n} alive · the Cadence evolves at ${next}` : `${n} of ${room} alive · the Cadence has grown as far as this forest allows`;
  let goal = snap.goal;
  if (eggs && !n) goal = "HATCH THE EGG";
  if (snap.glitch && snap.beat - (snap.glitch_beat || snap.beat) < 0) goal = "SOMETHING IS WRONG";
  // the last stretch: keep the Cadence whole for three days, and it ends
  let whole = null;
  if (!next && n) {
    if (snap.ended != null) goal = "THE CADENCE IS WHOLE";
    else {
      // counted in days spent whole (40+ alive) since the last evolution, not calendar days
      const need = snap.whole_pop || 40, beats = snap.whole_beats || 720, days = Math.round(beats / 240);
      whole = Math.min(1, (snap.whole || 0) / beats);
      const done = `${Math.min(days, (snap.whole || 0) / 240).toFixed(1)} OF ${days} DAYS DONE`;
      goal = n >= need ? `KEEP ${need}+ ALIVE · ${done}` : `KEEP ${need}+ ALIVE · ${n} NOW · ${done}`;
    }
  }
  if (!n && !eggs) goal = "THE CADENCE IS GONE";
  // TERROR takes over the banner until it has drained away
  const terror = snap.terror > 0 && n > 0;
  if (terror) goal = "THEY ARE TERRIFIED OF YOU";
  $("#goal-label").textContent = terror ? "TERROR" : "GOAL";
  $("#goal-text").textContent = goal;
  $("#goal").classList.toggle("terror", terror);
  $("#goal").classList.toggle("whole", !terror && whole !== null);
  $("#goal").classList.toggle("alert", !n && !eggs);
  $("#goal").style.setProperty("--left", terror ? (snap.terror / (snap.terror_beats || 33)).toFixed(3) : whole !== null ? whole.toFixed(3) : "0");
  const day = Math.floor(snap.beat / 240) + 1;
  $("#beat").textContent = `DAY ${day} · BEAT ${snap.beat}${snap.night ? " · NIGHT" : ""}`;
}

// ------------------------------------------------------------------ the mind

let layout = null;
export function setLayout(l) { layout = l; }

function kv(el, rows) {
  el.innerHTML = rows.map(([k, v, cls]) => `<span>${k}</span><span class="${cls || ""}">${v}</span>`).join("");
}

export function mind(snap, extra) {
  if ($("#mind").classList.contains("hidden") || !layout) return;
  const d = snap.diag || {};
  const bodies = snap.cadlets.length;
  $("#m-bodies").textContent = `${bodies} ${bodies === 1 ? "BODY" : "BODIES"}`;
  kv($("#m-brain"), [
    ["NEURONS · PARAMETERS", `${layout.neurons} · ${layout.parameters.toLocaleString()}`],
    ["STREAMS (BATCH ROWS)", `${d.rows ?? snap.cap}`],
    ["SETTLED IN", `${d.steps ?? 0} SWEEPS`],
    ["RESIDUAL / TOLERANCE", `${(d.residual ?? 0).toExponential(1)} / ${(d.tolerance ?? 0).toExponential(0)}`],
    ["QUALIFIED", d.refused ? "REFUSED · RETRIED" : d.qualified ? "YES" : "NO", d.qualified && !d.refused ? "good" : "bad"],
    ["REFUSED ANSWERS", `${d.refusals ?? 0}`],
    ["DOPAMINE (MEAN TD)", `${(d.dopamine ?? 0) >= 0 ? "+" : ""}${(d.dopamine ?? 0).toFixed(3)}`, (d.dopamine ?? 0) >= 0 ? "good" : "bad"],
    ["REWARD UPDATES", `${(d.updates ?? 0).toLocaleString()}`],
    ["MEMORY WRITES", `${(d.writes ?? 0).toLocaleString()}`],
    ["MEMORY WEIGHT · LAST OUTCOME", d.memory ? `${d.memory[0]}× · ${d.memory[1]}` : "—"],
    ["THINKING TIME", `${extra.ms.toFixed(0)} MS / BEAT`],
  ]);
  // One broken section must not blank the rest of the panel (or the caller).
  for (const part of [chart, probes, memory, one, lexicon, you, lessons]) {
    try { part(snap); } catch (err) { log.error("mind", err, { part: part.name }); }
  }
}

// How the Cadence reads the player: its imagined response to a hand nearby, compared
// with how often it would approach or flee anyway. Measured, never scripted.
export function verdict(snap) {
  // What Cadlets near your hand actually do (a live record), checked against what the
  // Cadence privately imagines it would do with a hand near, calm or afraid.
  const p = snap.probes || {};
  const s = snap.stats || {};
  const hv = snap.handview || { approach: 0, flee: 0, seen: 0 };
  const kindness = (s.pets || 0) + (s.hand_fed || 0) + (s.player_apples || 0) + (s.player_soap || 0);
  const harm = (s.flings || 0) + (s.crushed || 0);
  let imaginedCome = 0, imaginedFlee = 0;
  if (layout && p.hand) imaginedCome = p.hand[layout.behaviors.indexOf("hand")];
  if (layout && p.afraid) imaginedFlee = p.afraid[layout.behaviors.indexOf("flee")];
  let word = "UNREAD";
  if (kindness + harm < 3 || hv.seen < 20) word = "ABSENT";
  else if (harm >= 2 && (hv.flee > hv.approach || hv.approach < 0.1)) word = "CRUEL";
  else if (hv.approach > 0.25 && hv.approach > 2 * hv.flee) word = "KIND";
  return { word, approach: hv.approach, flee: hv.flee, imaginedCome, imaginedFlee, kindness, harm };
}

function you(snap) {
  const s = snap.stats || {};
  const v = verdict(snap);
  const pct = (x) => `${Math.round(x * 100)}%`;
  $("#m-you").innerHTML = `
    <div class="kv">
      <span>PETS · FED FROM HAND</span><span>${s.pets || 0} · ${s.hand_fed || 0}</span>
      <span>APPLES · SCRUBS</span><span>${s.player_apples || 0} · ${s.player_soap || 0}</span>
      <span>THROWN · KILLED · TERRORS</span><span class="${v.harm ? "bad" : ""}">${s.flings || 0} · ${s.crushed || 0} · ${s.terrors || 0}</span>
      <span>NEAR YOUR HAND THEY</span><span>COME ${pct(v.approach)} · FLEE ${pct(v.flee)}</span>
      <span>IMAGINED: COME · FLEE IF AFRAID</span><span>${pct(v.imaginedCome)} · ${pct(v.imaginedFlee)}</span>
      <span>THE CADENCE THINKS YOU ARE</span><span class="${v.word === "CRUEL" ? "bad" : v.word === "KIND" ? "good" : ""}">${v.word}</span>
    </div>`;
}

function hiCanvas(c) {
  // Logical size comes from the width/height attributes; the backing store follows the CSS size.
  if (!c.dataset.lw) { c.dataset.lw = c.width; c.dataset.lh = c.height; }
  const lw = +c.dataset.lw, lh = +c.dataset.lh;
  const k = Math.max(2, window.devicePixelRatio || 1) * ((c.clientWidth || lw) / lw);
  const W = Math.round(lw * k), H = Math.round(lh * k);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext("2d");
  g.setTransform(k, 0, 0, k, 0, 0);
  g.imageSmoothingEnabled = false;
  return { g, w: lw, h: lh };
}

// How often a pressing need gets the right answer, next to what random choices would score
// in exactly the same situations (the sim counts both). Pooled over 60 beats.
function chart(snap) {
  const { g, w, h } = hiCanvas($("#m-chart"));
  const hist = snap.history || [];
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#0e1812"; g.fillRect(0, 0, w, h);
  g.font = "11px VT323, monospace";
  const pooled = hist.map((_, i) => {
    const win = hist.slice(Math.max(0, i - 5), i + 1);
    const urgent = win.reduce((a, q) => a + (q.urgent ?? 0), 0);
    if (urgent < 6) return null;
    const right = win.reduce((a, q) => a + (q.right ?? 0), 0);
    // older saves did not count chance; one choice in eight is what it was before
    const chance = win.reduce((a, q) => a + (q.chance ?? (q.urgent ?? 0) / 8), 0);
    return { you: right / urgent, chance: chance / urgent };
  });
  const seen = pooled.filter(Boolean);
  const top = Math.min(1, Math.max(0.5, Math.ceil(Math.max(0, ...seen.map((p) => Math.max(p.you, p.chance))) * 10 + 0.5) / 10));
  const Y = (v) => h - 2 - Math.max(0, Math.min(1, v / top)) * (h - 14);
  // gridlines with their percentages
  g.strokeStyle = "#1f3326"; g.lineWidth = 1; g.fillStyle = "#3d6a46";
  for (let v = 0.1; v < top + 1e-6; v += top > 0.6 ? 0.2 : 0.1) {
    const y = Math.round(Y(v)) + 0.5;
    g.beginPath(); g.moveTo(24, y); g.lineTo(w, y); g.stroke();
    g.fillText(`${Math.round(v * 100)}%`, 1, y + 3);
  }
  const score = $("#m-score");
  if (!hist.length || !seen.length) {
    g.fillStyle = "#4f9a5a";
    g.fillText(hist.length ? "WAITING FOR A NEED TO PRESS" : "THE FIRST POINT APPEARS AT BEAT 10", 30, h / 2);
    score.innerHTML = "";
    return;
  }
  const n = Math.max(30, hist.length);
  const X = (i) => 26 + (i / (n - 1)) * (w - 28);
  g.fillStyle = "rgba(208, 90, 224, .7)";
  hist.forEach((p, i) => { if (p.poisoned) g.fillRect(X(i) - 1, h - Math.min(h, p.poisoned * 3), 2, Math.min(h, p.poisoned * 3)); });
  // the gap between the two lines: what the mind adds over chance
  g.fillStyle = "rgba(255, 207, 90, .16)";
  for (let i = 1; i < pooled.length; i++) {
    const a = pooled[i - 1], b = pooled[i];
    if (!a || !b) continue;
    g.beginPath();
    g.moveTo(X(i - 1), Y(a.you)); g.lineTo(X(i), Y(b.you)); g.lineTo(X(i), Y(b.chance)); g.lineTo(X(i - 1), Y(a.chance));
    g.closePath(); g.fill();
  }
  const line = (pick, color, dash = []) => {
    g.strokeStyle = color; g.lineWidth = 1.6; g.setLineDash(dash); g.beginPath();
    let on = false;
    pooled.forEach((p, i) => {
      const v = p && pick(p);
      if (v === null || v === undefined || Number.isNaN(v)) { on = false; return; }
      if (!on) { g.moveTo(X(i), Y(v)); on = true; } else g.lineTo(X(i), Y(v));
    });
    g.stroke(); g.setLineDash([]);
  };
  // population, on its own scale (the mind's room), faint so it does not read as a score
  g.globalAlpha = 0.55;
  g.strokeStyle = "#6fb7e0"; g.lineWidth = 1; g.beginPath();
  hist.forEach((p, i) => { const y = h - 2 - Math.min(1, p.pop / 48) * (h - 14); if (i) g.lineTo(X(i), y); else g.moveTo(X(i), y); });
  g.stroke(); g.globalAlpha = 1;
  line((p) => p.chance, "#8fae96", [3, 3]);
  line((p) => p.you, "#ffcf5a");
  const last = seen[seen.length - 1];
  const ratio = last.chance > 0 ? last.you / last.chance : 0;
  score.innerHTML = `NOW: <b>THE CADENCE ${Math.round(last.you * 100)}%</b> · <span class="r">RANDOM CHOICE ${Math.round(last.chance * 100)}%</span> · ${ratio.toFixed(1)}× CHANCE`;
}

const PROBE_LABEL = { content: "CONTENT", hungry: "HUNGRY", dirty: "DIRTY", bored: "BORED", tired: "TIRED, NIGHT", hurt: "HURT", glitched: "CORRUPT", hand: "HAND NEAR", afraid: "AFRAID", call: "HEARS ▢" };

// the colour key for the probe and choice bars
function behLegend() {
  const el = $("#m-beh-legend");
  if (!layout || el.childElementCount) return;
  el.innerHTML = layout.behaviors.map((b) => `<span><i style="background:${BEH_COLORS[b]}"></i>${b.toUpperCase()}</span>`).join("");
}

function probes(snap) {
  behLegend();
  const el = $("#m-probes");
  const p = snap.probes || {};
  if (!layout || !Object.keys(p).length) { el.innerHTML = '<div class="hint">The Cadence has not imagined anything yet. It is asked every 12 beats.</div>'; return; }
  const beh = layout.behaviors;
  el.innerHTML = "";
  for (const k of Object.keys(PROBE_LABEL)) {
    if (!p[k]) continue;
    const probs = p[k].slice(0, beh.length);
    const top = probs.indexOf(Math.max(...probs));
    const row = document.createElement("div");
    row.className = "probe";
    row.innerHTML = `<span>${PROBE_LABEL[k]}</span><div class="bar">${probs.map((v, i) => `<i style="width:${(v * 100).toFixed(1)}%;background:${BEH_COLORS[beh[i]]}" title="${beh[i]} ${(v * 100).toFixed(0)}%"></i>`).join("")}</div>`;
    const topEl = document.createElement("span");
    topEl.className = "top";
    topEl.title = `most likely: ${beh[top]} ${(probs[top] * 100).toFixed(0)}%`;
    topEl.appendChild(icon(ICON_FOR[beh[top]], 18));
    topEl.appendChild(Object.assign(document.createElement("small"), { textContent: `${Math.round(probs[top] * 100)}%` }));
    row.appendChild(topEl);
    el.appendChild(row);
  }
}

const IN_LABEL = { hunger: "HUNGER", dirt: "DIRT", boredom: "BOREDOM", pain: "PAIN", apple: "FOOD NEAR", glitched: "CORRUPT", bath: "TUB NEAR", ball: "BALL NEAR", friend: "FRIEND", hand: "HAND", heard_ba: "HEARD ▢", heard_li: "HEARD ◇", heard_mo: "HEARD ✕", content: "CONTENT", fear: "FEAR", fatigue: "TIRED", night: "NIGHT" };

function memory(snap) {
  const c = $("#m-memory");
  const { g, w, h } = hiCanvas(c);
  g.clearRect(0, 0, w, h);
  const M = snap.memory;
  if (!M || !M.length || !layout) return;
  const rows = M.length, cols = M[0].length;
  const left = 74, top = 14;
  const cw = (w - left - 2) / cols, ch = (h - top - 2) / rows;
  let mx = 0.05;
  for (const r of M) for (const v of r) mx = Math.max(mx, Math.abs(v));
  g.font = "11px VT323, monospace";
  for (let i = 0; i < rows; i++) {
    g.fillStyle = "#4f9a5a";
    g.fillText(IN_LABEL[layout.inputs[i]] || layout.inputs[i] || "", 0, top + i * ch + ch * 0.75);
    for (let j = 0; j < cols; j++) {
      const v = M[i][j] / mx;
      const a = Math.min(1, Math.abs(v));
      g.fillStyle = v >= 0 ? `rgba(255, 207, 90, ${a})` : `rgba(208, 90, 224, ${a})`;
      g.fillRect(left + j * cw + 0.5, top + i * ch + 0.5, cw - 1, ch - 1);
    }
  }
  layout.behaviors.forEach((b, j) => { g.drawImage(sprite(ICON_FOR[b]), left + j * cw + cw / 2 - 4.5, 2, 9, 9); });
  g.fillStyle = "#4f9a5a";
  g.fillText("VOICE", left + layout.behaviors.length * cw + 2, 10);
}

function meter(label, v, inverse = false) {
  const bad = inverse ? v < 0.35 : v > 0.75;
  const warn = inverse ? v < 0.6 : v > 0.5;
  return `<span>${label}</span><div class="meter ${bad ? "bad" : warn ? "warn" : ""}"><i style="width:${(Math.max(0, Math.min(1, v)) * 100).toFixed(0)}%"></i></div>`;
}

function one(snap) {
  const sel = snap.mind && snap.cadlets.find((t) => t.id === snap.mind.id);
  const el = $("#m-sel");
  const neurons = $("#m-neurons");
  if (!sel) {
    $("#m-name").textContent = "—";
    el.className = "hint";
    el.innerHTML = "Click a Cadlet to look inside its stream of the brain.";
    neurons.style.display = "none";
    return;
  }
  neurons.style.display = "block";
  $("#m-name").textContent = `${sel.name.toUpperCase()} · GEN ${sel.g}`;
  el.className = "";
  const beh = layout.behaviors;
  const probs = snap.mind.probs || [];
  const sign = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
  el.innerHTML = `
    <div class="needs">
      ${meter("HUNGER", sel.h)}${meter("DIRT", sel.d)}${meter("BOREDOM", sel.b)}${meter("TIRED", sel.fa || 0)}${meter("FEAR", sel.fe || 0)}${meter("HEALTH", sel.hp, true)}
    </div>
    <div class="kv">
      <span>INTENT</span><span>${sel.a.toUpperCase()} · ${(sel.conf * 100).toFixed(0)}% SURE</span>
      <span>HOPE (CRITIC VALUE)</span><span>${sign(sel.val)}</span>
      <span>LAST OUTCOME</span><span class="${sel.r >= 0 ? "good" : "bad"}">${sign(sel.r)}</span>
      <span>SURPRISE (TD ERROR)</span><span class="${sel.td >= 0 ? "good" : "bad"}">${sign(sel.td)}</span>
      <span>AGE · CHILDREN</span><span>${sel.age} BEATS · ${sel.births}</span>
      <span>STREAM</span><span>ROW ${sel.row}</span>
    </div>
    <div class="probe" style="margin-top:6px"><span>CHOICES</span><div class="bar">${probs.map((v, i) => `<i style="width:${(v * 100).toFixed(1)}%;background:${BEH_COLORS[beh[i]]}" title="${beh[i]} ${(v * 100).toFixed(0)}%"></i>`).join("")}</div><span></span></div>`;
  // neural activity by region
  const { g, w, h } = hiCanvas(neurons);
  g.clearRect(0, 0, w, h);
  const act = snap.mind.activation || [];
  const regions = ["sensory", "module_0", "association", "prefrontal", "motor"].filter((r) => layout.populations[r]);
  if (!regions.length) return;
  const rh = h / regions.length;
  g.font = "11px VT323, monospace";
  regions.forEach((r, ri) => {
    const idx = layout.populations[r];
    g.fillStyle = "#4f9a5a";
    g.fillText(r === "module_0" ? "MODULE" : r.toUpperCase(), 0, ri * rh + rh * 0.72);
    const left = 74, cw = Math.min(7, (w - left) / idx.length);
    idx.forEach((n, i) => {
      const v = Math.max(0, Math.min(1, act[n] ?? 0));
      g.fillStyle = r === "motor" ? `rgba(255, 207, 90, ${0.12 + 0.88 * v})` : `rgba(140, 245, 154, ${0.1 + 0.9 * v})`;
      g.fillRect(left + i * cw, ri * rh + 2, cw - 1, rh - 4);
    });
  });
}

function lexicon(snap) {
  const el = $("#m-lex");
  const lex = snap.lexicon || {};
  const guess = snap.lexguess || {};
  const counts = snap.lexcount || [];
  el.innerHTML = "";
  ["ba", "li", "mo"].forEach((g, i) => {
    const row = document.createElement("div");
    row.className = "word";
    row.appendChild(icon(GLYPHS[i + 1], 22));
    const eq = document.createElement("span");
    eq.textContent = lex[g] ? "=" : "≈";
    row.appendChild(eq);
    const gs = guess[g];
    const mean = lex[g] || (gs && gs[0]);
    if (mean) {
      const ic = icon(ICON_FOR[mean], 22);
      if (!lex[g]) ic.style.opacity = 0.35;
      row.appendChild(ic);
    }
    const t = document.createElement("span");
    t.className = "hint";
    const n = counts[i + 1] || 0;
    t.textContent = lex[g]
      ? `${lex[g].toUpperCase()} · ${gs ? gs[1].toFixed(1) : "?"}× · said ${n}×`
      : gs ? `${gs[0]}? only ${gs[1].toFixed(1)}× · said ${n}×` : `??? · said ${n}×`;
    row.appendChild(t);
    el.appendChild(row);
  });
  const silent = counts[0] || 0, total = counts.reduce((a, b) => a + b, 0) || 1;
  const foot = document.createElement("div");
  foot.className = "hint";
  foot.textContent = `Silent ${(100 * silent / total).toFixed(0)}% of the time. A glyph becomes a word when it goes with one behaviour or need 1.5× more than usual.`;
  el.appendChild(foot);
}

function lessons(snap) {
  const el = $("#m-lessons");
  const L = Object.entries(snap.lessons || {}).sort((a, b) => a[1] - b[1]);
  const html = L.length ? L.map(([k, beat]) => `<li>${lessonText(k)} <span>· beat ${beat}</span></li>`).join("") : '<li class="hint">Nothing yet. Watch.</li>';
  if (el.innerHTML !== html) el.innerHTML = html;
}

export function deathText(e) {
  if (e.cause === "hand") return { html: `${e.name.toUpperCase()} WAS KILLED BY YOUR HAND`, icon: "i_skull" };
  const how = { hunger: "OF HUNGER", filth: "OF FILTH", despair: "OF DESPAIR", poison: "OF POISON", injury: "OF ITS WOUNDS", exhaustion: "OF EXHAUSTION", hand: "BY YOUR HAND" }[e.cause] || "";
  return { html: `${e.name.toUpperCase()} DIED ${how}`, icon: NEED_ICON[e.cause] || "i_skull" };
}
