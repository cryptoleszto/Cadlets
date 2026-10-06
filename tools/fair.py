"""Is the Cadence better than chance? The chart's own measure, with two controls.

    python tools/fair.py --beats 1500 --seeds 6

Three minds run the same world, with no player:

  cadence  the game as shipped
  random   uniformly random choices (the chart's dashed line must equal this one's score)
  ideal    a hand-written rule (eat when hungry, bathe when dirty, play when bored, sleep at
           night and when nothing presses). It is not learnable information and plays no part
           in the game; it only shows how high the measure can go in this world.

For every window of beats: the share of right choices when a need presses, the chance line
for exactly those situations (the dashed line in MIND), their ratio, and what the choices led
to: mean population, the share of Cadlet-beats in crisis (a need at 0.9 or more), deaths.
"""

from __future__ import annotations

import argparse
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "py"))
import cadlets as m  # noqa: E402

REMEDY = {"hunger": m.EAT, "dirt": m.BATHE, "pain": m.SLEEP, "fatigue": m.SLEEP}


def ideal(w: m.World, t: m.Cadlet) -> int:
    o = w.observe(t)
    if w.is_night() and t.fatigue > 0.25:
        return m.SLEEP
    food, _ = w._food(t)
    needs = {"hunger": t.hunger, "dirt": t.dirt, "boredom": t.boredom, "pain": 1 - t.hp, "fatigue": t.fatigue}
    ok = {k: v for k, v in needs.items() if v >= 0.45 and not (k == "hunger" and (food is None or food.data.get("glitched")))}
    if not ok:
        return m.SLEEP
    need = max(ok, key=ok.get)
    if need == "boredom":
        return m.PLAY if o[7] > o[8] else m.CUDDLE
    return REMEDY[need]


class Scripted(m.World):
    """The same world; the brain is never asked, ``policy`` chooses instead."""

    policy = "random"

    def _think(self) -> None:
        for t in self.cadlets.values():
            o = self.observe(t)
            t.action = self.rng.randrange(m.N_BEH) if self.policy == "random" else ideal(self, t)
            t.voice = 0
            self._measure(t, o)
            t.last_reward, t.reward = t.reward, 0.0
        self.pending_done[:] = False
        self.pending_reward[:] = 0.0
        self._row_probs = np.zeros((self.cap, 2, m.N_BEH))


def run(job: tuple[str, int, int, int]) -> dict:
    mind, seed, beats, window = job
    if mind == "cadence":
        w = m.World(seed=seed)
    else:
        w = type("W", (Scripted,), {"policy": mind})(seed=seed)
    w.apply({"type": "hatch"})
    wins, acc = [], None
    for b in range(beats):
        if acc is None:
            acc = {"pop": 0, "cb": 0, "crisis": 0}
        w.tick()
        acc["pop"] += len(w.cadlets)
        for t in w.cadlets.values():
            acc["cb"] += 1
            acc["crisis"] += max(t.hunger, t.dirt, t.boredom, t.fatigue) >= 0.9
        if (b + 1) % window == 0:
            h = [q for q in w.history if q["beat"] > w.beat - window]
            acc.update(urgent=sum(q["urgent"] for q in h), right=sum(q["right"] for q in h),
                       chance=sum(q["chance"] for q in h), stage=w.stage)
            wins.append(acc)
            acc = None
    return {"mind": mind, "wins": wins, "deaths": w.stats["deaths"], "born": w.stats["born"]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--beats", type=int, default=1500)
    ap.add_argument("--seeds", type=int, default=6)
    ap.add_argument("--window", type=int, default=300)
    ap.add_argument("--minds", type=str, default="cadence,random,ideal")
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    minds = a.minds.split(",")
    jobs = [(mind, s, a.beats, a.window) for mind in minds for s in range(a.seeds)]
    with ProcessPoolExecutor(a.workers) as ex:
        res = list(ex.map(run, jobs))
    for mind in minds:
        rs = [r for r in res if r["mind"] == mind]
        print(f"\n{mind}  ({len(rs)} colonies)")
        print("  beats       right  chance  ratio |   pop  crisis | stages")
        for i in range(len(rs[0]["wins"])):
            W = [r["wins"][i] for r in rs]
            U = sum(x["urgent"] for x in W) or 1
            R = sum(x["right"] for x in W)
            C = sum(x["chance"] for x in W) or 1e-9
            print(f"  {i * a.window:4d}-{(i + 1) * a.window:<5d} {R / U:6.2f} {C / U:7.2f} {R / C:5.2f}× |"
                  f" {sum(x['pop'] for x in W) / a.window / len(W):5.1f} {sum(x['crisis'] for x in W) / max(1, sum(x['cb'] for x in W)):6.2f}"
                  f" | {' '.join(str(x['stage']) for x in W)}")
        deaths: dict[str, int] = {}
        for r in rs:
            for k, v in r["deaths"].items():
                deaths[k] = deaths.get(k, 0) + v
        print(f"  born {sum(r['born'] for r in rs)}, died {sum(deaths.values())} {deaths}")


if __name__ == "__main__":
    main()
