// The Cadence's mind runs here: Pyodide (CPython on WebAssembly) + NumPy + the Cadence
// library, stepping py/cadlets.py once per beat. The page only draws what comes back.
// Everything crosses the boundary as JSON strings, so no Python proxies pile up.

/* global importScripts, loadPyodide */
importScripts("../vendor/pyodide/pyodide.js");

let py = null;
let api = null; // Python helpers: {tick, snap, select, save, load, fresh}
let beatMs = 900;
let paused = true;
let timer = null;
let busy = false;
let queue = [];

const HELPERS = `
import json, random, sys
import numpy, cadence, cadlets

_world = None

def fresh(seed):
    global _world
    _world = cadlets.World(seed=int(seed))
    return json.dumps(_world.layout())

def load(blob):
    global _world
    _world = cadlets.World.load(bytes(blob))
    return json.dumps(_world.layout())

def tick(events):
    for e in json.loads(events):
        _world.apply(e)
    return json.dumps(_world.tick())

def snap():
    return json.dumps(_world.snapshot())

def select(tid):
    _world.apply({"type": "select", "id": None if tid < 0 else int(tid)})
    return json.dumps(_world.snapshot())

def save():
    return _world.save()

def versions():
    return f"cadence {getattr(cadence, '__version__', '0.74.0')} · numpy {numpy.__version__} · python {sys.version.split()[0]}"
`;

function post(msg, transfer) {
  self.postMessage(msg, transfer || []);
}

function progress(text, pct) {
  post({ type: "progress", text, pct });
}

function seed() {
  return (Math.random() * 1e6) | 0;
}

async function boot(save) {
  const t0 = performance.now();
  progress("LOADING PYTHON 3.12 (PYODIDE)", 5);
  py = await loadPyodide({ indexURL: "../vendor/pyodide/" });
  progress("LOADING NUMPY", 35);
  await py.loadPackage("numpy", { messageCallback: () => {} });
  progress("UNPACKING CADENCE 0.74.0", 60);
  const wheel = await (await fetch("../vendor/cadence_net-0.74.0-py3-none-any.whl")).arrayBuffer();
  py.unpackArchive(wheel, "wheel", { extractDir: "/lib/python3.12/site-packages" });
  progress("GROWING THE CADENCE'S MIND", 75);
  const src = await (await fetch("../py/cadlets.py", { cache: "no-cache" })).text();
  py.FS.writeFile("/home/pyodide/cadlets.py", src);
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
  const mod = py.runPython(HELPERS + "\nimport types\ntypes.SimpleNamespace(fresh=fresh, load=load, tick=tick, snap=snap, select=select, save=save, versions=versions)");
  api = mod;
  progress("COMPOSING ONE BRAIN", 88);
  let layout = null;
  let restored = false;
  if (save) {
    try {
      const blob = py.toPy(save);
      layout = api.load(blob);
      blob.destroy();
      restored = true;
    } catch (e) {
      post({ type: "warn", text: "The saved Cadence could not be restored; a new egg was laid." });
      layout = null;
    }
  }
  if (!layout) layout = api.fresh(seed());
  progress("READY", 100);
  post({
    type: "ready", layout: JSON.parse(layout), versions: api.versions(), restored,
    bootMs: performance.now() - t0, snap: api.snap(),
  });
  if (!paused) schedule(0); // play was pressed while the mind was still loading
}

function tick() {
  timer = null;
  if (paused || !api || busy) return;
  busy = true;
  const t0 = performance.now();
  try {
    const events = JSON.stringify(queue);
    queue = [];
    const snap = api.tick(events);
    post({ type: "snap", snap, ms: performance.now() - t0 });
  } catch (e) {
    post({ type: "error", text: String(e.message || e) });
    paused = true;
  }
  busy = false;
  schedule(Math.max(0, beatMs - (performance.now() - t0)));
}

function schedule(delay) {
  if (timer !== null || paused) return;
  timer = setTimeout(tick, delay);
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === "boot") {
      await boot(m.save || null);
    } else if (m.type === "event") {
      queue.push(m.event);
    } else if (m.type === "select") {
      // Display-only: answer at once so the mind panel can follow the selection.
      if (api && !busy) post({ type: "snap", snap: api.select(m.id ?? -1), ms: 0, still: true });
      else queue.push({ type: "select", id: m.id });
    } else if (m.type === "speed") {
      beatMs = m.beatMs;
    } else if (m.type === "pause") {
      paused = m.paused;
      if (!paused) schedule(0);
    } else if (m.type === "save") {
      if (!api) return;
      const proxy = api.save();
      const bytes = proxy.toJs();
      proxy.destroy();
      post({ type: "saved", bytes, reason: m.reason }, [bytes.buffer]);
    } else if (m.type === "load") {
      queue = [];
      let layout;
      let restored = true;
      try {
        const blob = py.toPy(m.bytes);
        layout = api.load(blob);
        blob.destroy();
      } catch (e) {
        restored = false;
        post({ type: "warn", text: "THIS SAVE IS FROM AN OLDER VERSION OF THE CADENCE · A NEW EGG WAS LAID" });
        layout = api.fresh(seed());
      }
      post({ type: "reset", layout: JSON.parse(layout), snap: api.snap(), restored, failed: !restored });
    } else if (m.type === "new") {
      queue = [];
      const layout = api.fresh(seed());
      post({ type: "reset", layout: JSON.parse(layout), snap: api.snap() });
    }
  } catch (e) {
    post({ type: "error", text: String(e.message || e) });
  }
};
