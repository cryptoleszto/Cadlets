// The site's switch and the visitor's save, shared by the landing page and the game.
//
// site.json: {"status": "open" | "maintenance", "message": "...", "back": "...",
//             "coming": [{"icon": sprite, "title": "...", "text": "..."}]} (the end screen's teasers),
//             and in the deployed copy "build": a fingerprint of the files (tools/build_site.py).
// If it cannot be read (offline, missing), the site counts as open: maintenance is a
// courtesy for players, and the game itself runs entirely in the browser.

// What the end screen teases when site.json has no "coming" list of its own.
export const COMING = [
  { icon: "i_tree", title: "A WIDER FOREST", text: "Room for twice as many Cadlets, and new places to find beyond the trees." },
  { icon: "i_sparkle", title: "A SHARED RECORD", text: "See what other players' Cadences learned, and how they judged the hand that raised them." },
  { icon: "g_mo", title: "▢ ◇ ✕", text: "They have more to say." },
];

export async function siteStatus() {
  try {
    const r = await fetch("site.json", { cache: "no-store" });
    if (!r.ok) throw new Error(`site.json: HTTP ${r.status}`);
    const s = await r.json();
    return {
      status: s.status === "maintenance" ? "maintenance" : "open",
      message: String(s.message || ""),
      back: String(s.back || ""),
      build: String(s.build || ""),
      coming: Array.isArray(s.coming) ? s.coming.filter((c) => c && c.title).slice(0, 4) : COMING,
    };
  } catch (e) {
    return { status: "open", message: "", back: "", build: "", coming: COMING, error: String(e) };
  }
}

// The Cadence saved in this browser (the game's IndexedDB store), without loading it.
export function savedCadence() {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open("cadlets-cadence", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("saves");
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        try {
          const q = open.result.transaction("saves").objectStore("saves").get("cadence");
          q.onsuccess = () => resolve(q.result && q.result.bytes ? { beat: q.result.beat || 0, at: q.result.at || 0 } : null);
          q.onerror = () => resolve(null);
        } catch { resolve(null); }
      };
    } catch { resolve(null); }
  });
}
