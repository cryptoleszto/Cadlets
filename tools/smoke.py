"""Quick checks of the world without a browser:  python tools/smoke.py

Exercises every player event, snapshots (JSON-safe, as the web worker sends them),
save/load continuing identically, extinction and evolution. Needs the Cadence
library (pip install -e path/to/cadence).
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "py"))
import cadlets  # noqa: E402

failures: list[str] = []


def check(ok: bool, what: str) -> None:
    print(("ok    " if ok else "FAIL  ") + what)
    if not ok:
        failures.append(what)


def run(w: cadlets.World, beats: int) -> dict:
    snap = {}
    for _ in range(beats):
        snap = w.tick()
        json.dumps(snap, allow_nan=False)  # the worker sends this as JSON
    return snap


def main() -> None:
    w = cadlets.World(seed=11)
    w.apply({"type": "hatch"})
    snap = run(w, 3)
    check(len(w.cadlets) == 1, "the egg hatches when clicked")
    t = next(iter(w.cadlets.values()))

    w.apply({"type": "select", "id": t.id})
    snap = run(w, 1)
    check(snap["mind"] is not None and len(snap["mind"]["probs"]) == cadlets.N_BEH, "a selected Cadlet's stream is exported")
    check(snap["diag"].get("steps", 0) > 0, "settling sweeps are reported")

    w.apply({"type": "hand", "x": t.x, "y": t.y, "present": True})
    w.apply({"type": "pet", "id": t.id})
    w.apply({"type": "soap", "id": t.id})
    w.apply({"type": "apple", "x": t.x + 2, "y": t.y})
    w.apply({"type": "ball", "x": t.x - 2, "y": t.y})
    w.apply({"type": "place", "item": "tub", "x": t.x, "y": t.y + 3})
    w.apply({"type": "place", "item": "tree", "x": t.x + 4, "y": t.y + 3})
    snap = run(w, 1)
    s = w.stats
    check(s["pets"] == 1 and s["player_soap"] == 1 and s["player_apples"] == 1, "pet, soap and apple are counted")
    check(len(w._of("tub")) == 2 and len(w._of("tree")) == 2, "placed tub and tree exist")

    hp = t.hp
    w.apply({"type": "pickup", "id": t.id})
    check(t.held, "pickup holds the Cadlet")
    w.apply({"type": "drop", "id": t.id, "x": t.x + 3, "y": t.y, "speed": 3.0})
    check(not t.held and t.hp < hp and t.fear > 0.5 and s["flings"] == 1, "a throw hurts and frightens")
    snap = run(w, 1)
    check("hurt" in next(c for c in snap["cadlets"] if c["id"] == t.id)["ev"], "the throw is shown")

    # save mid-life and continue identically
    blob = w.save()
    a = run(w, 25)
    w2 = cadlets.World.load(blob)
    b = run(w2, 25)
    same = [(c["x"], c["y"], c["a"]) for c in a["cadlets"]] == [(c["x"], c["y"], c["a"]) for c in b["cadlets"]]
    check(same and a["beat"] == b["beat"], "a save continues identically")

    # crush: death by the hand, witnesses frightened
    w.apply({"type": "hatch"})
    while len(w.cadlets) < 2:
        w._birth(*w._free_spot(w.cx, w.cy, 1.0), None)
    victim, witness = list(w.cadlets.values())[:2]
    witness.x, witness.y = victim.x + 1.0, victim.y
    fear = witness.fear
    w.apply({"type": "crush", "id": victim.id})
    snap = run(w, 1)
    deaths = [e for e in snap["events"] if e["type"] == "death"]
    check(deaths and deaths[0]["cause"] == "hand" and s["crushed"] == 1, "crush kills, blamed on the hand")
    check(witness.fear > fear, "a witness is frightened")

    # extinction: a new egg for the same mind
    for c in list(w.cadlets.values()):
        w._death(c)
    snap = run(w, 14)
    check(any(e["type"] == "relay" for e in snap["events"]) or w._of("egg") or w.cadlets, "extinction lays a new egg")

    # evolution: fill the field and the mind makes room
    w3 = cadlets.World(seed=5)
    run(w3, 8)
    while len(w3.cadlets) < cadlets.STAGES[0]["evolve_at"]:
        w3._birth(*w3._free_spot(w3.cx, w3.cy, 3.0), None)
    snap = run(w3, 1)
    check(w3.stage == 1 and w3.cap == 16 and any(e["type"] == "evolve" for e in snap["events"]), "evolution grows the mind to 16 rows")
    snap = run(w3, 20)
    check(len(snap["cadlets"]) > 0 and all(math.isfinite(c["val"]) for c in snap["cadlets"]), "the larger mind keeps running")
    # TERROR: everyone bolts to where the page says, fear peaks and drains in ~33 beats, no births meanwhile
    x0, y0, x1, y1 = w3.bounds()
    spots = {str(t.id): [x0, t.y] for t in w3.cadlets.values()}

    def ready() -> None:  # everyone able to split this very beat, if terror allowed it
        for t in w3.cadlets.values():
            t.content, t.age, t.last_split, t.sick, t.held = 99, 99, -999, 0, False
            t.hunger = t.dirt = t.boredom = 0.1
            t.hp = 1.0

    born = w3.stats["born"]
    w3.apply({"type": "terror", "spots": spots})
    check(all(abs(t.x - x0) < 1e-6 and t.fear == 1.0 for t in w3.cadlets.values()), "terror sends everyone to the forest edge, terrified")
    ready()
    snap = run(w3, 1)
    check(any(e["type"] == "terror" for e in snap["events"]) and snap["terror"] > 0, "terror is reported")
    # the hand comes near a terrified Cadlet: it bolts away from it, screaming
    t = next(iter(w3.cadlets.values()))
    t.x, t.y = w3.cx, w3.cy
    w3.apply({"type": "hand", "x": t.x + 1.5, "y": t.y, "present": True})
    ready()
    snap = run(w3, 1)
    me = next(c for c in snap["cadlets"] if c["id"] == t.id)
    check(t.x < w3.cx - 3 and me["s"] == "flee" and "scream" in me["ev"], "a terrified Cadlet bolts from the hand, screaming")
    w3.apply({"type": "hand", "x": 0, "y": 0, "present": False})
    while w3.beat < w3.terror_until - 1:  # up to the last beat of terror
        ready()
        run(w3, 1)
    check(w3.stats["born"] == born, "nobody is born during terror")
    check(all(t.fear < 0.1 for t in w3.cadlets.values()), "terror has drained after about a minute")
    for _ in range(3):
        ready()
        run(w3, 1)
    check(w3.stats["born"] > born, "births resume after terror")
    blob = w3.save()
    check(cadlets.World.load(blob).terror_until == w3.terror_until, "terror survives a save")
    w3.apply({"type": "glitch"})
    snap = run(w3, 1)
    check(w3.glitch and any(tr.data.get("glitched") for tr in w3._of("tree")), "the glitch corrupts fruit trees")

    print()
    print("all passed" if not failures else f"{len(failures)} failed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
