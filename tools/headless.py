"""Run the Cadence without a browser and print its learning curves.

    python tools/headless.py --beats 1200            # the Cadence, learning
    python tools/headless.py --beats 1200 --random   # control: uniformly random actions

The control uses the same world and needs but replaces the brain's choices with
random ones, so the gap between the two runs is what the brain learned.
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "py"))
import cadlets  # noqa: E402


class RandomWorld(cadlets.World):
    def _think(self) -> None:
        for t in self.cadlets.values():
            t.action = self.rng.randrange(cadlets.N_BEH)
            t.voice = self.rng.randrange(cadlets.N_VOICE)
            t.last_reward, t.reward = t.reward, 0.0
            self._measure(t, self.observe(t))
        self.pending_done[:] = False
        self.pending_reward[:] = 0.0
        self._row_probs = np.zeros((self.cap, 2, cadlets.N_BEH))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--beats", type=int, default=1200)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--random", action="store_true")
    ap.add_argument("--glitch", type=int, default=0, help="force the glitch at this beat")
    ap.add_argument("--every", type=int, default=50)
    args = ap.parse_args()
    cls = RandomWorld if args.random else cadlets.World
    w = cls(seed=args.seed)
    t0 = time.time()
    for beat in range(1, args.beats + 1):
        if args.glitch and beat == args.glitch:
            w.apply({"type": "glitch"})
        snap = w.tick()
        for e in snap["events"]:
            if e["type"] in ("lesson", "evolve", "glitch"):
                print(f"  beat {beat:5d}  {e}")
        if beat % args.every == 0:
            h = w.history[-5:]
            comp = [x["competence"] for x in h if x["competence"] is not None]
            print(
                f"beat {beat:5d}  pop {len(w.cadlets):3d}  stage {w.stage}  born {w.stats['born']:4d}"
                f"  died {w.stats['died']:3d}  competence {np.mean(comp) if comp else float('nan'):.2f}"
                f"  reward/beat {np.mean([x['reward'] for x in h]):+.3f}"
                f"  poisoned {sum(x['poisoned'] for x in h):3d}"
                f"  {(time.time() - t0) / beat * 1000:.0f} ms/beat",
                flush=True,
            )
    print("deaths:", w.stats["deaths"])
    if not args.random:
        for k, v in w.probes.items():
            top = np.argsort(v[: cadlets.N_BEH])[::-1][:3]
            print(f"  probe {k:9s}", ", ".join(f"{cadlets.BEHAVIORS[i]} {v[i]:.2f}" for i in top))
        print("lexicon:", {cadlets.VOICES[g]: w.word(g) for g in range(1, cadlets.N_VOICE)})


if __name__ == "__main__":
    main()
