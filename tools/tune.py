"""Sweep world/brain variants across seeds, with no player help, and compare outcomes.

    python tools/tune.py --beats 400 --seeds 4

Each variant is a dict of ``cadlets.TUNE`` overrides plus optional ``brain``
options. ``random`` runs the same world with uniformly random actions.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "py"))
import cadlets  # noqa: E402

DEFAULT_TUNE = copy.deepcopy(cadlets.TUNE)

VARIANTS: dict[str, dict] = {
    "base": {},
}


def run(args: tuple[str, dict, int, int]) -> dict:
    name, variant, seed, beats = args
    variant = dict(variant)
    brain = variant.pop("brain", None)
    rnd = variant.pop("random", False)
    cadlets.TUNE.clear()
    cadlets.TUNE.update(copy.deepcopy(DEFAULT_TUNE))
    cadlets.TUNE.update(variant)
    if rnd:
        from headless import RandomWorld
        w = RandomWorld(seed=seed)
    else:
        w = cadlets.World(seed=seed, brain_options=brain)
    pops = []
    traj = []
    for b in range(beats):
        w.tick()
        pops.append(len(w.cadlets))
        if (b + 1) % 100 == 0:
            c = [h["competence"] for h in w.history[-10:] if h["competence"] is not None]
            traj.append(float(np.mean(c)) if c else float("nan"))
    comp = [h["competence"] for h in w.history[-10:] if h["competence"] is not None]
    early = [h["competence"] for h in w.history[:10] if h["competence"] is not None]
    return {
        "name": name, "seed": seed, "pop": len(w.cadlets), "peak": max(pops), "born": w.stats["born"],
        "died": w.stats["died"], "stage": w.stage, "extinct": len(w.cadlets) == 0,
        "comp": float(np.mean(comp)) if comp else float("nan"),
        "early": float(np.mean(early)) if early else float("nan"),
        "lessons": sorted(w.lessons),
        "steps": w.diag.get("steps", 0),
        "traj": traj,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--beats", type=int, default=400)
    ap.add_argument("--seeds", type=int, default=4)
    ap.add_argument("--variants", type=str, default="")
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    variants = json.loads(a.variants) if a.variants else VARIANTS
    jobs = [(n, v, s, a.beats) for n, v in variants.items() for s in range(a.seeds)]
    with ProcessPoolExecutor(a.workers) as ex:
        results = list(ex.map(run, jobs))
    for name in variants:
        rs = [r for r in results if r["name"] == name]
        print(
            f"{name:14s} pop {np.mean([r['pop'] for r in rs]):5.1f} peak {np.mean([r['peak'] for r in rs]):5.1f}"
            f" born {np.mean([r['born'] for r in rs]):5.1f} died {np.mean([r['died'] for r in rs]):5.1f}"
            f" extinct {sum(r['extinct'] for r in rs)}/{len(rs)} stage {np.mean([r['stage'] for r in rs]):.1f}"
            f" comp early {np.nanmean([r['early'] for r in rs]):.2f} late {np.nanmean([r['comp'] for r in rs]):.2f}"
            f" steps {np.mean([r['steps'] for r in rs]):.0f}"
        )
        traj = np.nanmean(np.array([r["traj"] for r in rs]), axis=0)
        print("       competence by 100 beats:", " ".join(f"{v:.2f}" for v in traj))
        for r in rs:
            print("      ", r["seed"], r["pop"], r["lessons"])


if __name__ == "__main__":
    main()
