// A flight recorder for bug reports: every error plus a trail of notable events
// (boot, saves, evolutions, the player's big actions), kept across reloads in this
// browser and downloadable from the menu as one JSON file, optionally with a save of
// the Cadence so the exact moment can be replayed (tools/replay.py).

export const VERSION = "0.3.0";

const KEY = "cadlets-log";
const MAX = 400;
const session = Math.random().toString(36).slice(2, 8);
const listeners = [];
let entries = [];
let context = () => ({});
let pending = null;

try { entries = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { entries = []; }

function persist(now) {
  // Errors are written at once; everything else at most every two seconds.
  if (pending && !now) return;
  clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* storage full or blocked */ }
  }, now ? 0 : 2000);
}

function write(level, src, msg, data) {
  let stack;
  if (msg instanceof Error || (msg && msg.stack)) { stack = String(msg.stack || ""); msg = `${msg.name || "Error"}: ${msg.message}`; }
  msg = String(msg);
  let ctx = {};
  try { ctx = context(); } catch { /* the game is not up yet */ }
  // The same message again (an error every frame, a slow beat every beat) is counted, not repeated.
  for (let i = entries.length - 1; i >= Math.max(0, entries.length - 30); i--) {
    const e = entries[i];
    if (e.session === session && e.level === level && e.src === src && e.msg === msg) {
      e.n = (e.n || 1) + 1;
      e.last = new Date().toISOString();
      e.lastBeat = ctx.beat;
      persist(false);
      return e;
    }
  }
  const entry = { t: new Date().toISOString(), session, level, src, msg, beat: ctx.beat };
  if (stack) entry.stack = stack.slice(0, 4000);
  if (data !== undefined) entry.data = data;
  entries.push(entry);
  if (entries.length > MAX) entries = entries.slice(-MAX);
  persist(level === "error");
  (level === "error" ? console.error : level === "warn" ? console.warn : console.debug)(`[cadlets:${src}]`, msg, data ?? "", stack ? "\n" + stack : "");
  if (level === "error") for (const fn of listeners) { try { fn(entry); } catch { /* a listener must not loop */ } }
  return entry;
}

export const info = (src, msg, data) => write("info", src, msg, data);
export const warn = (src, msg, data) => write("warn", src, msg, data);
export const error = (src, msg, data) => write("error", src, msg, data);

export function setContext(fn) { context = fn; }
export function onError(fn) { listeners.push(fn); }
export function all() { return entries.slice(); }
export function clear() { entries = []; persist(true); }

export function report(extra = {}) {
  let ctx = {};
  try { ctx = context(); } catch { /* nothing yet */ }
  return {
    app: "cadlets", version: VERSION, created: new Date().toISOString(), session,
    page: location.href.split("?")[0], userAgent: navigator.userAgent, language: navigator.language,
    screen: { w: innerWidth, h: innerHeight, dpr: window.devicePixelRatio || 1 },
    memoryMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : undefined,
    state: ctx, ...extra, log: entries,
  };
}

export function download(extra = {}) {
  const blob = new Blob([JSON.stringify(report(extra), null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cadlets-debug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

window.addEventListener("error", (e) => {
  // A failed <script>/<link> load has no error object; a thrown error does.
  write("error", "page", e.error || `${e.message || "resource failed"} (${e.filename || e.target?.src || e.target?.href || "?"}:${e.lineno || 0})`);
}, true);
window.addEventListener("unhandledrejection", (e) => write("error", "promise", e.reason instanceof Error ? e.reason : String(e.reason)));
info("page", `session ${session} · version ${VERSION}`, { ua: navigator.userAgent, screen: `${innerWidth}x${innerHeight}@${window.devicePixelRatio || 1}` });
