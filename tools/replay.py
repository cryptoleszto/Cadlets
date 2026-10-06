"""Replay a debug report from the game:  python tools/replay.py cadlets-debug-....json [--beats 100]

A report (menu ☰ → DEBUG REPORT) holds the browser's log and, when the simulation
could still answer, a save of that exact moment. This prints the log's warnings and
errors, then loads the save natively and runs it on, so a simulation problem can be
reproduced with a debugger at hand. Needs the Cadence library (pip install -e path/to/cadence).
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "py"))
import cadlets  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("report")
    ap.add_argument("--beats", type=int, default=100)
    ap.add_argument("--all", action="store_true", help="print the whole log, not only warnings and errors")
    args = ap.parse_args()
    rep = json.loads(Path(args.report).read_text())

    print(f"version {rep.get('version')} · {rep.get('created')} · {rep.get('userAgent', '')[:80]}")
    print(f"screen {rep.get('screen')} · state {rep.get('state')}")
    print()
    for e in rep.get("log", []):
        if not args.all and e.get("level") == "info":
            continue
        n = f" ×{e['n']}" if e.get("n") else ""
        print(f"{e.get('t', '')[11:19]} beat {e.get('beat')} {e.get('level', ''):5s} {e.get('src', ''):7s} {e.get('msg')}{n}")
        if e.get("data"):
            print("        ", e["data"])
        if e.get("stack"):
            print("        " + e["stack"].replace("\n", "\n        "))

    save = rep.get("save")
    if not save:
        print("\nno save in this report (the simulation could not answer)")
        return
    w = cadlets.World.load(base64.b64decode(save["base64"]))
    print(f"\nloaded beat {w.beat}: {len(w.cadlets)} alive, stage {w.stage}, cap {w.cap}; running {args.beats} beats")
    t0 = time.time()
    for _ in range(args.beats):
        try:
            snap = w.tick()
            json.dumps(snap, allow_nan=False)
        except Exception:
            print(f"\nbeat {w.beat} failed:")
            traceback.print_exc()
            sys.exit(1)
        for e in snap["events"]:
            if e["type"] in ("evolve", "glitch", "relay", "lesson"):
                print(f"  beat {w.beat}  {e}")
    print(f"ok: beat {w.beat}, {len(w.cadlets)} alive, {(time.time() - t0) / args.beats * 1000:.0f} ms/beat")


if __name__ == "__main__":
    main()
