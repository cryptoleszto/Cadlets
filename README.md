# Cadlets · Cadence

An artificial life in the browser by LesztoSoft, inspired by Black Mirror's *Plaything*.
Every creature is driven by **one unified mind**, built with the [Cadence](https://github.com/muellerberndt/cadence) library.
Together the Cadlets are **the Cadence**: one mind, many bodies. Nothing they do is scripted. They learn from what happens to them, and you mostly watch.

```bash
python3 serve.py
```

That opens <http://localhost:8642>: the landing page, with the game at `play.html`. Python is only used to serve the files. The brain
(Pyodide/CPython 3.12, NumPy 2.0.2 and the Cadence 0.74.0 library) is vendored in `vendor/` and
runs in a Web Worker in your browser, offline. Google Fonts are optional.

## Playing

You start with one egg. Click it to hatch it sooner, or wait.

| | |
|---|---|
| **Hand** (1) | Hover: the Cadlets can see your hand. Click a Cadlet: pet it, and open its mind. Drag it: pick it up. Drag it fast and let go: throw it, and it gets hurt. Drag empty ground: pan. |
| **Apple** (2) / **Ball** (3) / **Soap** (4) | Drop food (5 apples, regrowing), drop a beach ball, scrub a dirty Cadlet. An apple dropped next to a Cadlet that came to your hand is eaten straight from it. |
| **Flick** (5) / **Crush** (6) | Click a Cadlet to knock it away (it's hurt) or to crush it (it dies). Every Cadlet nearby sees it and is frightened. |
| **The ending** | After the last evolution, keep at least 40 of the 48 alive for three days in all (the goal banner counts them; terror and starvation pause it). Then the Cadence is whole: a group portrait, its life in numbers, what is coming next. Keep watching, or lay a new egg. |
| **TERROR** | 15 throws and 5 crushes within one minute and the Cadence breaks: time stops, every Cadlet screams and bolts for the forest, and TERROR drips across the screen. For about a minute (33 beats) they are terrified: each one bolts screaming from your hand when it comes near, and none is born. |
| **Build tray** | Every evolution gives you a bathtub and an apple tree to place. |
| **MIND** (M) | The Cadence's mind: the library's diagnostics, learning curve, imagined choices, collective memory, one Cadlet's stream, language, what it thinks of you. |
| Clock | ❚❚ / Space pauses (while paused you can look inside minds and pan, but not touch). 1× 2× 4× 8× set the speed and resume. `+`/`-` change speed too. |
| Wheel / `0` | Zoom / reset the view. Arrow keys or WASD pan. |
| Menu ☰ | Save, rewrite the code (trigger the glitch), lay a new egg, sound, debug report. |

The Cadence autosaves to IndexedDB, and **CONTINUE THE CADENCE** resumes the same brain where it left off.

## How the Cadence library drives them

- **One mind, many bodies.** `Brain.compose(inputs=15, actions=8+4, slots=(8, 4), modules=(32, 16))`
  is built once: 91 neurons and 1,762 parameters. Each living Cadlet is one **stream** (one batch row).
  Graph weights, the critic and the consolidated associative memory belong to the whole Cadence.
  Each row keeps its own working trace, fast memory residual and eligibility.
- **One beat = one `Brain.step`.** Each body carries out the action chosen last beat. The world
  then reports the real outcome: needs relieved (more when they pressed), health lost, being petted
  or thrown. `step` learns from that outcome, settles the neural graph to an equilibrium, and reads
  two motor slots that settle together: a behaviour (`eat bathe play cuddle sleep hand flee wander`)
  and a voice (`silence ▢ ◇ ✕`).
- **Senses** (`py/cadlets.py`, `World.observe`): felt needs (they register only once they press),
  pain, fear, contentment (nothing presses), nearest food and whether it looks corrupt, tub,
  ball, friend, your hand, and the glyph just heard.
- **The hand is learned, not scripted.** Reaching your hand is mildly rewarding while it's novel
  (curiosity wears off with each visit). What you do then decides what they learn. Pets and
  hand-feeding are real rewards. A throw, a squeeze or a crush hurts, and every Cadlet that
  sees it is frightened. Fear is a felt need that fleeing relieves, so a cruel hand teaches them
  to run.
- **Walking costs a little effort** per tile. Together with the contentment sense, this lets the
  brain learn to rest when nothing presses and to run only when it pays. That's why the Cadlets
  move calmly. The body walks in a straight line toward the nearest target; the brain chooses
  *what* to do, not each step.
- **Birth and death are episode boundaries.** A death ends its row's episode (`done`, reward −1).
  Mitosis starts a new life in a free row. A child inherits nothing individually and everything
  collectively.
- **Evolution is a declared boundary.** When the field fills, `Brain.reset()` makes room for more
  rows (8 → 16 → 32 → 48). Learned weights and consolidated memory survive; only per-stream context
  resets.
- **Private imagination.** Every 12 beats the Cadence is asked what it *would* do in seven
  situations (hungry, dirty, bored, hurt, corrupt fruit, hand near, hearing a call) with
  `Brain.imagine`. That reads memory without writing it and leaves live state alone. These answers
  drive the "THE CADENCE HAS LEARNED…" announcements. A lesson needs the right answer *in that
  situation* and much less elsewhere, so a habit doesn't count.
- **Collective memory.** The MIND panel draws `SynapticMemory.consolidated`, the shared
  cue → outcome matrix, as a heatmap.
- **Refusals.** If the graph can't qualify an answer within its budget, the library raises instead
  of acting. Following its contract, the world retries the answer alone with a larger budget (never
  re-submitting the outcome). If that fails too, everyone hesitates for a beat (`?` bubbles).
- **Extinction isn't the end.** If all bodies die, a new egg appears for the *same* mind.

Brain settings are in `make_brain` (`py/cadlets.py`). They follow the Cadence library's reward guide for
continuing contextual tasks: a softened working trace (amplitude 0.3, decay 0.8), fast consolidation
(0.5), actor rate 0.5, softmax temperature 0.15, and qualified free answers. At 1× a beat lasts
1.8 s. A Cadlet walks for part of it (short errands are strolls; only long, pressing trips
are runs) and then does the thing. Every outcome (a kick, a bite, a bath) plays when it arrives.

## What to watch for

1. **Bootstrap.** Within the first ~40–200 beats: "THE CADENCE HAS LEARNED: APPLES END HUNGER",
   then baths, then play. The amber learning line climbs above random chance (1 in 8). Later,
   often: "WHEN NOTHING PRESSES, REST".
2. **Growth comes from competence.** Mitosis needs every need low for a stretch, which chance
   behaviour can't manage. In the headless comparison below, random actions never evolve.
3. **Witnessed failure → local repair.** At beat 600 (stage 3+) or from the menu, the code rewrites
   itself and a third of the fruit trees turn corrupt. Poisonings spike (purple bars), then fall once
   the Cadence learns to tell corrupt fruit apart, while it keeps eating good fruit.
4. **Your hand.** Pet and feed them and they learn to come to you. Throw or kill them and they
   learn to stop coming and to flee when afraid. The MIND panel's "what the Cadence thinks of you"
   shows what Cadlets near your hand actually do, next to what the Cadence privately imagines.
5. **Language.** Chirps are free choices of the voice slot. They cost a little breath, and a chirp
   draws company. The decoder (like Cameron, it only watches who says what when) calls a glyph a
   word once it goes with one behaviour or need 1.5× more often than usual. This is weak and slow,
   and some colonies never develop words.

## Measured, not claimed

`tools/headless.py` and `tools/tune.py` run the same world natively, with a uniformly random
policy as the control. Results over 900 beats, 6 seeds:

| | The Cadence | Random actions |
|---|---|---|
| First evolution (8 alive) | beat 272–479, all 6 seeds | beat 437–817 in 3 seeds, never in 3 |
| Lessons | apples ~36–170, baths ~36–190, play ~70–700, rest ~380–610 (half the runs), corrupt fruit ~660–770 | — |
| Right remedy when a need presses | peaks 0.39–0.46, then ~0.2–0.35 under crowding | ~0.12–0.15 |
| Beats spent resting | 35% | 18% |

Simulated players (`tools/` harness, 900 beats, 3 seeds each), measuring what Cadlets that
can see the hand choose:

| Player | Result |
|---|---|
| Kind (pets and feeds whoever comes) | come to the hand 74–89% of the time; "your hand is kind" learned in every run |
| Kind, then cruel from beat 450 | trust rises to 66–78%, then falls to 2–17% |
| Cruel, then kind from beat 450 | trust recovers fully: 60% come within 300 beats, 78% by beat 1200 |
| Cruel from beat 300 | stop approaching; afraid ones flee up to ~33% live (38–53% imagined) in 2 of 3 runs |

Fear-fleeing is the weakest of these: real, but slower and not in every run. The Cadence holds no
grudge: kindness wins trust back about as fast as cruelty destroys it (`tools/players.py`).

TERROR is the exception to "nothing is scripted": the bolt into the forest, and the bolts from your
hand while the terror lasts, are reflexes of the body. The brain's choice is not carried out on those
beats and nothing is credited to it; what the mind does learn from is the terror itself (fear at its
height, draining over the 33 beats, and a shock on whatever each one was doing).

A save/load continues identically. Settling and learning cost ~25 ms per beat at 8 bodies and
~50 ms at 48 bodies in Chrome/WebAssembly.

Limits: competence is clearly above chance but far from perfect; crowding causes starvation; the
language rarely gets past a word or two.

## When something goes wrong

The game keeps a flight recorder (`js/log.js`): every error (page, render loop, mind panel,
the Python simulation with its full traceback, the worker failing to load) and a trail of notable
events (boot and versions, saves, evolutions, lessons, the glitch, the player's pauses, speed changes,
throws, flicks and crushes). Repeats are counted, not repeated. It survives a reload in the same
browser (localStorage, the last 400 entries). A watchdog notes when no beat has arrived for a while,
and slow beats are counted.

- **Menu ☰ → DEBUG REPORT** downloads one JSON file: the log, the game's state, the browser and
  screen, and, if the simulation still answers, a save of that exact moment.
- `python tools/replay.py cadlets-debug-….json --beats 100` prints the report's warnings and errors,
  loads the save natively and runs it on, so a simulation bug can be reproduced under a debugger.
- In the browser console: `cadlets.log.all()` shows the log, `cadlets.log.download()` saves it.

A broken frame no longer stops the picture: the render loop logs the error and draws the next one.

## The site and maintenance

`index.html` is the landing page; the game is `play.html`. `site.json` is the switch:

```json
{ "status": "maintenance", "message": "We are teaching the Cadence something new.", "back": "BACK AROUND 18:00 CET" }
```

- **Landing page:** reads it on every visit. While closed, PLAY becomes a maintenance notice with
  your message and return time.
- **Game:** checks at start (closed: back to the landing page) and every 5 minutes while playing
  (closed: the Cadence is saved, the player is told, and sent to the landing page).
- Set `"status": "open"` to reopen. On Cloudflare Pages a push redeploys in about a minute, and
  `_headers` keeps `site.json` from being cached.
- The check runs in the browser, so someone determined could still open the game. For a hard block on
  Cloudflare Pages, also rename `_redirects.maintenance` to `_redirects` (and back afterwards).
- If `site.json` cannot be read, the site counts as open.
- `"coming"` lists the end screen's teasers (`icon` is a sprite name, `title`, `text`); edit them
  to announce what is next without touching the code.

## Layout

```
index.html, css/landing.css    the landing page (js/landing.js); site.json, js/site.js: the switch
play.html, css/, js/           the game: rendering, HUD, input, audio, mind panel
js/worker.js                   Pyodide host; JSON in, JSON out
js/log.js                      flight recorder and debug reports
js/terror.js                   the TERROR scene
js/ending.js                   the end screen
py/cadlets.py                  the world and the Cadence integration (runs natively too)
assets/sprites.json            pixel art (from tools/make_sprites.py)
vendor/                        Pyodide 0.27.7 core, NumPy wheel, Cadence wheel
tools/headless.py, tune.py     learning curves and parameter sweeps without a browser
tools/smoke.py                 quick checks of every player event, save/load, evolution
tools/replay.py                replay a debug report's save natively
tools/players.py               simulated kind, cruel and changing players
tools/make_sprites.py          edit and preview the sprites
```

To run the tools natively: `pip install -e path/to/cadence` (Python ≥ 3.11), then
`python tools/headless.py --beats 900` (add `--random` for the control), or `python tools/smoke.py`.

## Notes

- `vendor/cadence_net-0.74.0-py3-none-any.whl` is built from muellerberndt/cadence at `8d1b82c`
  with a one-line fix for 32-bit WebAssembly (`vendor/cadence-wasm32.patch`): `np.repeat` needs
  `intp` repeat counts.
- Cadence is GPL-3.0 (`vendor/CADENCE-LICENSE.txt`). Pyodide is MPL-2.0; NumPy is BSD-3.
- Inspired by Black Mirror's "Plaything" and the game at its heart. Not affiliated with Netflix
  or Night School Studio. All art and sound here are original and procedural.
