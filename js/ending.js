// The ending: the Cadence is whole. A group portrait of everyone alive, its life in
// numbers, what it learned, and what is coming next (site.json "coming").
// Resolves "watch" (keep observing) or "new" (lay a new egg).

import { sprite } from "./sprites.js";
import { Wordmark } from "./logo.js";
import { lessonText, verdict } from "./ui.js";

const $ = (s) => document.querySelector(s);

function icon(name) {
  const c = document.createElement("canvas");
  try {
    const img = sprite(name);
    c.width = img.width; c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0);
  } catch { c.width = c.height = 1; }
  return c;
}

// Everyone alive, side by side in rows, each hopping in its own time.
function portrait(canvas, n) {
  const cols = Math.min(12, Math.max(1, n));
  const rows = Math.ceil(n / cols);
  const cw = 22, rh = 19;
  canvas.width = cols * cw + 14;
  canvas.height = rows * rh + 12;
  const k = Math.max(2, Math.min(4, Math.floor(Math.min(innerWidth * 0.86, 640) / canvas.width)));
  canvas.style.width = canvas.width * k + "px";
  canvas.style.height = canvas.height * k + "px";
  const g = canvas.getContext("2d");
  const bodies = Array.from({ length: n }, (_, i) => ({
    x: (i % cols) * cw + 2 + (Math.floor(i / cols) % 2 ? cw / 2 : 0),
    y: Math.floor(i / cols) * rh + 22,
    face: Math.random() < 0.5 ? "thr_happy" : "thr",
    phase: Math.random() * 6, blink: Math.random() * 5000,
  })).sort((a, b) => a.y - b.y);
  let running = true;
  const draw = (now) => {
    if (!running) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (const b of bodies) {
      const hop = Math.max(0, Math.sin(now / 260 + b.phase)) * 2;
      const name = (now + b.blink) % 4200 < 140 ? "thr_blink" : b.face;
      g.fillStyle = "rgba(4, 10, 30, .45)";
      g.fillRect(b.x + 4, b.y - 1, 13, 2);
      g.drawImage(sprite(name), b.x, Math.round(b.y - 21 - hop));
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return () => { running = false; };
}

export function showEnding(snap, { coming = [] } = {}) {
  const el = $("#ending");
  const s = snap.stats || {};
  const n = snap.cadlets.length;
  const lessons = Object.keys(snap.lessons || {});
  const facts = lessons.filter((k) => !k.startsWith("word_")).map((k) => lessonText(k).toUpperCase());
  const words = lessons.filter((k) => k.startsWith("word_")).length;
  const v = verdict(snap);
  const hand = { KIND: "KIND", CRUEL: "CRUEL", ABSENT: "A STRANGER", UNREAD: "UNREADABLE" }[v.word] || v.word;

  $("#ending-cap").textContent = `${n} ${n === 1 ? "BODY" : "BODIES"} · ONE UNIFIED MIND`;
  const rows = [
    ["DAYS LIVED", Math.floor(snap.beat / 240) + 1],
    ["BORN", s.born || 0],
    ["DIED", s.died || 0],
    ["MOST AT ONCE", s.max_pop || n],
    ["LESSONS", facts.length],
    ["WORDS", words],
    ["YOUR HAND WAS", hand],
  ];
  if (s.terrors) rows.push(["TERRORS", s.terrors]);
  $("#ending-stats").innerHTML = rows.map(([k, val]) => `<span>${k}</span><b>${val}</b>`).join("");
  $("#ending-lessons").textContent = facts.length ? `IT LEARNED: ${facts.join(" · ")}.` : "";

  const box = $("#ending-coming");
  box.innerHTML = "";
  for (const c of coming) {
    const card = document.createElement("div");
    card.className = "coming";
    const slot = document.createElement("span");
    slot.className = "slot" + (String(c.icon).startsWith("g_") ? " glyph" : ""); // glyphs sit in a speech bubble
    slot.appendChild(icon(c.icon || "i_sparkle"));
    const h = document.createElement("h4");
    h.textContent = c.title;
    const p = document.createElement("p");
    p.textContent = c.text || "";
    card.append(slot, h, p);
    box.appendChild(card);
  }
  $("#ending-coming-h").classList.toggle("hidden", !coming.length);

  const logo = new Wordmark($("#ending-logo"), { cell: 3 });
  logo.fit(Math.min(560, innerWidth * 0.8));
  logo.start();
  const stopPortrait = portrait($("#ending-portrait"), n);
  el.scrollTop = 0;
  el.classList.remove("hidden");

  return new Promise((resolve) => {
    for (const b of el.querySelectorAll("[data-end]")) {
      b.onclick = () => {
        logo.stop();
        stopPortrait();
        el.classList.add("hidden");
        resolve(b.dataset.end);
      };
    }
  });
}
