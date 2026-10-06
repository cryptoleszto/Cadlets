"""Simulated players: what does the Cadence learn about a hand that is kind, cruel, or changes?

    python tools/players.py --players turncoat,redeemer --beats 1200 --seeds 6

The hand hovers at a spot that moves every 40 beats. A kind hand pets Cadlets that come
within reach and drops an apple there every 8 beats (eaten from the hand by one that came).
A cruel hand, at most once every 6 beats, throws one that came within reach, or crushes it
(35%, only while more than 3 are alive). Measured: of the Cadlets that sense the hand, how
many choose to come to it or flee, how often afraid ones flee, and what the Cadence
privately imagines (Brain.imagine probes) - never fed back into behaviour.
"""

from __future__ import annotations

import argparse
import copy
import math
import random
import sys
import warnings
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "py"))
import cadlets  # noqa: E402

DEFAULT_TUNE = copy.deepcopy(cadlets.TUNE)

# player -> list of (from_beat, mode); the last entry whose beat has passed applies
SCHEDULES = {
    "kind": [(0, "kind")],
    "cruel": [(0, "cruel")],
    "absent": [(0, "absent")],
    "late_cruel": [(0, "absent"), (300, "cruel")],
    "turncoat": [(0, "kind"), (450, "cruel")],
    "redeemer": [(0, "cruel"), (450, "kind")],
    "story": [(0, "kind"), (400, "cruel"), (800, "kind")],  # the landing page's "they learn who you are"
}


def mode_at(player: str, beat: int) -> str:
    mode = "absent"
    for start, m in SCHEDULES[player]:
        if beat >= start:
            mode = m
    return mode


def verdict(w: cadlets.World) -> str:
    """The mind panel's "what the Cadence thinks of you" (js/ui.js verdict)."""
    s, hv = w.stats, w.handview
    kindness = s["pets"] + s["hand_fed"] + s["player_apples"] + s["player_soap"]
    harm = s["flings"] + s["crushed"]
    if kindness + harm < 3 or hv["seen"] < 20:
        return "ABSENT"
    if harm >= 2 and (hv["flee"] > hv["approach"] or hv["approach"] < 0.1):
        return "CRUEL"
    if hv["approach"] > 0.25 and hv["approach"] > 2 * hv["flee"]:
        return "KIND"
    return "UNREAD"


def run(job: tuple[str, int, int, int]) -> dict:
    player, seed, beats, every = job
    cadlets.TUNE.clear()
    cadlets.TUNE.update(copy.deepcopy(DEFAULT_TUNE))
    w = cadlets.World(seed=seed)
    rng = random.Random(seed + 99)
    hx, hy = w.cx, w.cy
    last_harm = -99
    acc = {"n": 0, "hand": 0, "flee": 0, "af": 0, "afl": 0, "fear": 0.0, "pop": 0}
    rows = []
    for b in range(beats):
        if b % 40 == 0:
            x0, y0, x1, y1 = w.bounds()
            hx, hy = rng.uniform(x0 + 2, x1 - 2), rng.uniform(y0 + 2, y1 - 2)
        mode = mode_at(player, b)
        if mode != "absent":
            w.apply({"type": "hand", "x": hx, "y": hy, "present": True})
            close = [t for t in w.cadlets.values() if math.hypot(t.x - hx, t.y - hy) < 1.6]
            if mode == "kind":
                for t in close:
                    if rng.random() < 0.5:
                        w.apply({"type": "pet", "id": t.id})
                if b % 8 == 0:
                    w.apply({"type": "apple", "x": hx, "y": hy})
            elif mode == "cruel" and close and b - last_harm > 6:
                t = rng.choice(close)
                if rng.random() < 0.35 and len(w.cadlets) > 3:
                    w.apply({"type": "crush", "id": t.id})
                else:
                    w.apply({"type": "pickup", "id": t.id})
                    w.apply({"type": "drop", "id": t.id, "x": hx + 1, "y": hy + 1, "speed": 2.5})
                last_harm = b
        else:
            w.apply({"type": "hand", "x": 0, "y": 0, "present": False})
        w.tick()
        # what the Cadlets that sense the hand chose for the next beat
        if mode != "absent":
            for t in w.cadlets.values():
                if 1 - math.hypot(t.x - hx, t.y - hy) / 5 > 0.3:
                    acc["n"] += 1
                    acc["hand"] += t.action == cadlets.HAND
                    acc["flee"] += t.action == cadlets.FLEE
                    if t.fear > 0.2:
                        acc["af"] += 1
                        acc["afl"] += t.action == cadlets.FLEE
        acc["fear"] += sum(t.fear for t in w.cadlets.values())
        acc["pop"] += len(w.cadlets)
        if (b + 1) % every == 0:
            ph, pa = w.probes.get("hand", [0] * 8), w.probes.get("afraid", [0] * 8)
            rows.append({
                "beat": b + 1, "mode": mode,
                "come": acc["hand"] / acc["n"] if acc["n"] else float("nan"),
                "flee": acc["flee"] / acc["n"] if acc["n"] else float("nan"),
                "afraid_flee": acc["afl"] / acc["af"] if acc["af"] else float("nan"),
                "fear": acc["fear"] / acc["pop"] if acc["pop"] else float("nan"),
                "pop": len(w.cadlets),
                "imagined_come": ph[cadlets.HAND], "imagined_afraid_flee": pa[cadlets.FLEE],
                "verdict": verdict(w),
            })
            acc = {k: 0 for k in acc}
    return {
        "player": player, "seed": seed, "rows": rows, "pop": len(w.cadlets), "died": w.stats["died"],
        "crushed": w.stats["crushed"], "flings": w.stats["flings"], "pets": w.stats["pets"],
        "fed": w.stats["hand_fed"], "lessons": {k: v for k, v in w.lessons.items() if k.startswith("hand")},
    }


def main() -> None:
    warnings.filterwarnings("ignore", "Mean of empty slice")  # no afraid Cadlet in a window: shown as --
    ap = argparse.ArgumentParser()
    ap.add_argument("--players", default="turncoat,redeemer")
    ap.add_argument("--beats", type=int, default=1200)
    ap.add_argument("--seeds", type=int, default=6)
    ap.add_argument("--every", type=int, default=75)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    players = a.players.split(",")
    jobs = [(p, s, a.beats, a.every) for p in players for s in range(a.seeds)]
    with ProcessPoolExecutor(a.workers) as ex:
        results = list(ex.map(run, jobs))
    pct = lambda v: "  -- " if v != v else f"{v * 100:4.0f}%"  # noqa: E731
    for p in players:
        rs = [r for r in results if r["player"] == p]
        print(f"\n=== {p}: {' then '.join(f'{m} from {s}' for s, m in SCHEDULES[p])} · {len(rs)} seeds")
        print(" beat  mode    come  flee  afraid→flee  fear   pop | imagined: come  afraid→flee | verdicts")
        for i in range(len(rs[0]["rows"])):
            col = lambda k: float(np.nanmean([r["rows"][i][k] for r in rs]))  # noqa: E731
            row = rs[0]["rows"][i]
            verdicts = "".join(r["rows"][i]["verdict"][0] for r in rs)
            print(f" {row['beat']:4d}  {row['mode']:6s} {pct(col('come'))} {pct(col('flee'))}    {pct(col('afraid_flee'))}    {col('fear'):.2f} {col('pop'):5.1f} |"
                  f"        {pct(col('imagined_come'))}      {pct(col('imagined_afraid_flee'))}    | {verdicts}")
        for r in rs:
            print(f"   seed {r['seed']}: pop {r['pop']:2d} died {r['died']:3d} crushed {r['crushed']:2d} thrown {r['flings']:3d}"
                  f" pets {r['pets']:4d} fed {r['fed']:3d} lessons {r['lessons']}")
    print("\nverdict letters per seed: K kind, C cruel, U unread, A absent")


if __name__ == "__main__":
    main()
