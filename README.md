# Cadlets · Cadence

An artificial life in the browser by LesztoSoft, inspired by Black Mirror's *Plaything*.
Every creature is driven by **one unified mind**, built with the [Cadence](https://github.com/muellerberndt/cadence) library.
Together the Cadlets are **the Cadence**: one mind, many bodies. Nothing they do is scripted. They learn from what happens to them, and you mostly watch.

```bash
python3 serve.py
```

That opens <http://localhost:8642>: the landing page, with the game at `play.html`. Python is only used to serve the files. The brain
(Pyodide/CPython 3.12, NumPy 2.0.2 and the Cadence 0.74.0 library) is vendored in `vendor/` and
runs in a Web Worker in your browser, offline. The fonts are served from the site too, so nothing
loads from anywhere else. `serve.py` applies the site's `_headers` like the live site does.

**Deploying:** Cloudflare (a Worker serving static assets, `wrangler.jsonc`), built with
`python3 tools/build_site.py` (build command) and `npx wrangler deploy`.

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

- **One mind, many bodies.** `Brain.compose(inputs=17, actions=8+4, slots=(8, 4), modules=(32, 16))`
  is built once: 93 neurons and 1,852 parameters. Each living Cadlet is one **stream** (one batch row).
  Graph weights, the critic and the consolidated associative memory belong to the whole Cadence.
  Each row keeps its own working trace, fast memory residual and eligibility.
- **One beat = one `Brain.step`.** Each body carries out the action chosen last beat. The world
  then reports the real outcome: needs relieved (more when they pressed), health lost, being petted
  or thrown. `step` learns from that outcome, settles the neural graph to an equilibrium, and reads
  two motor slots that settle together: a behaviour (`eat bathe play cuddle sleep hand flee wander`)
  and a voice (`silence ▢ ◇ ✕`).
- **Senses** (`py/cadlets.py`, `World.observe`): felt needs (they register only once they press),
  pain, fear, tiredness, contentment (nothing presses), whether it is night, nearest food and
  whether it looks corrupt, tub, ball, friend, your hand, and the glyph just heard.
- **Tiredness.** It grows while a Cadlet is awake, slowly by day and fast at night. A night's sleep
  clears it; a daytime nap barely helps. At 90% it drains health like hunger does, and a Cadlet that
  never sleeps dies of exhaustion. Sleeping it off is rewarded, so they learn "THE NIGHT IS FOR SLEEP"
  (all 6 test colonies; with random choices instead of a mind, none of 6 evolves and they keep dying of
  exhaustion).
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
- **Collective memory.** Cadence's episodic `SynapticMemory` learns, for the situation at hand,
  what each behaviour brought; its recall is added to the motor drive. Most of the learning
  happens here. The game weighs that recall 4× Cadence's default and keeps each body's own record
  of its last outcome at a fifth of the default rate (`MEMORY` in `py/cadlets.py`; see "Why the
  lines were close" below). The MIND panel draws `SynapticMemory.consolidated`, the shared
  cue → outcome matrix, as a heatmap.
- **Refusals.** If the graph can't qualify an answer within its budget, the library raises instead
  of acting. Following its contract, the world retries the answer alone with a larger budget (never
  re-submitting the outcome). If that fails too, everyone hesitates for a beat (`?` bubbles).
- **Extinction isn't the end.** If all bodies die, a new egg appears for the *same* mind.

Brain settings are in `make_brain` (`py/cadlets.py`). They follow the Cadence library's reward guide for
continuing contextual tasks: a softened working trace (amplitude 0.3, decay 0.8), fast consolidation
(0.5), actor rate 0.5, softmax temperature 0.15, and qualified free answers. The collective memory is
weighed by `MEMORY` (recall 4×, last-outcome record 0.2), also in colonies loaded from older saves. At 1× a beat lasts
1.8 s. A Cadlet heading somewhere walks for part of it (short errands are strolls; only long,
pressing trips are runs) and then does the thing; every outcome (a kick, a bite, a bath) plays when
it arrives. A Cadlet that is only walking or wandering keeps going straight into the next beat, and
one standing about looks around, so nobody freezes between beats.

## What to watch for

1. **Bootstrap.** Within the first ~40–200 beats: "THE CADENCE HAS LEARNED: APPLES END HUNGER",
   then baths, then play, then "WHEN NOTHING PRESSES, REST" and "THE NIGHT IS FOR SLEEP". The amber
   learning line climbs well above the dashed line (what random choices would score in exactly the
   same situations): about 2× chance within the first day, 3× and more once the colony is full.
2. **Growth comes from competence.** Mitosis needs every need low for a stretch, which chance
   behaviour can't manage. In the headless comparison below, random actions never evolve.
3. **Witnessed failure → local repair.** At beat 600 (stage 3+) or from the menu, the code rewrites
   itself and a third of the fruit trees turn corrupt for a day. Poisonings spike (purple bars), then
   fall once the Cadence learns to tell corrupt fruit apart, while it keeps eating good fruit. Then the
   code repairs itself. (A Cadlet's body walks to the nearest food, so with permanent corruption many
   could reach only corrupt trees and starved; healing after a day cut starvation by a third.)
4. **Your hand.** Pet and feed them and they learn to come to you. Throw or kill them and they
   learn to stop coming and to flee when afraid. The MIND panel's "what the Cadence thinks of you"
   shows what Cadlets near your hand actually do, next to what the Cadence privately imagines.
5. **Language.** Chirps are free choices of the voice slot. They cost a little breath, and a chirp
   draws company. The decoder (like Cameron, it only watches who says what when) calls a glyph a
   word once it goes with one behaviour or need 1.5× more often than usual. This is weak and slow,
   and some colonies never develop words.

## Measured, not claimed

`tools/fair.py` runs the chart's own measure for three minds in the same world, with no player:
the Cadence, uniformly random choices (the control: it must land on the chance line), and a
hand-written ideal rule that shows how high the measure can go. 6 colonies each, beats 1200–1500:

| | The Cadence | Random choices | Ideal rule |
|---|---|---|---|
| Right remedy when a need presses (any pressing need counts) | **0.61** | 0.20 | 1.00 |
| The chance line in those same situations | 0.17 | 0.20 | 0.22 |
| Ratio | **3.6×** | 0.97× (on the line) | 4.6× |
| Alive (of 48) / time in crisis (a need ≥ 0.9) | 48 / 0% | ~1 / 32% (never grows) | 48 / 0% |

`tools/tune.py` and `tools/headless.py`, 900 beats, 6 seeds:

| | The Cadence | Random choices |
|---|---|---|
| First evolution (8 alive) | beat 224–486, all 6 seeds | never |
| Lessons (all in 6 of 6 runs) | apples ~50–145, baths ~40–170, play ~40–160, calm ~100–340, rest ~110–700, night ~220–700, corrupt fruit ~700–780 | — |
| Beats spent resting | 57% (mostly when nothing presses) | 13% |

Simulated players (`tools/players.py`, 1200 beats, 4 seeds each), measuring what Cadlets that
can see the hand choose:

| Player | Result |
|---|---|
| Kind (pets and feeds whoever comes) | about half come to the hand (46–54% from beat 375 on); "your hand is kind" in 3 of 4 runs |
| Kind, then cruel from beat 450 | trust falls from 52% to 14–21%; frightened ones flee 22–35% |
| Cruel, then kind from beat 450 | trust recovers to the kind level: 46% within 375 beats, 49–56% after |
| Cruel from beat 300 | almost none approach (2–10%); frightened ones flee 38–59% live (46–66% imagined), every run |

The Cadence holds no grudge: kindness wins trust back about as fast as cruelty destroys it.
A Cadlet with a pressing need sees to it first, so even a kind hand gets about half of them.

### Why the lines were close (and what fixed it)

Until October 2026 the Cadence scored only ~1.6× the chance line, and in the chart the two lines
nearly touched. The chart was right (random choices land exactly on its dashed line); the mind was
weak. What we measured:

- A hungry Cadlet **rested half the time**, though its private imagination ("what would you do if
  hungry?") said eat 80% of the time. Re-imagining the live situations reproduced the live choice,
  so it was not a sampling or measuring fault.
- Cadence's slow synaptic policy cannot tell situations apart within a game's time. Without the
  episodic memory a colony learns nothing but a context-free habit, resting, which is right on
  average because resting is never punished. Changing its credit trace, learning rates, lateral
  inhibition, saturated motor neurons, bias learning or the empty-row averaging did not move the
  live choice.
- The episodic memory had learned the right thing: for live hungry Cadlets it predicted eating
  at +0.2 to +0.45 and resting at −0.02. But it entered the decision at strength 1, too weak to
  overrule the habit, and each body's own record of its last outcome was written at full strength.
  In a crowd, most walks to food end with someone else eating it first, so one miss told that body
  that food does not help hunger.

The fix weighs the memory's recall 4× and the last-outcome record at 0.2, for every behaviour alike.
Nothing about which behaviour is right is added, the world and its rewards are unchanged, and the
measure and its chance line are computed exactly as before. A smoke test checks the weighting is
applied to new and to loaded minds.

TERROR is the exception to "nothing is scripted": the bolt into the forest, and the bolts from your
hand while the terror lasts, are reflexes of the body. The brain's choice is not carried out on those
beats and nothing is credited to it; what the mind does learn from is the terror itself (fear at its
height, draining over the 33 beats, and a shock on whatever each one was doing).

A save/load continues identically. Settling and learning cost ~25 ms per beat at 8 bodies and
~50 ms at 48 bodies in Chrome/WebAssembly.

Limits: competence is well above chance but short of the ideal rule; boredom is the weak spot (live,
a bored Cadlet plays or cuddles barely more often than chance, though imagined it does so 9 times in
10); crowding causes starvation; the language rarely gets past a word or two.

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
- Bug reports and contact: cryptoleszto@gmail.com (the game asks players to email the debug report there).

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
- Set `"status": "open"` to reopen. On Cloudflare a push redeploys in about a minute, and
  `_headers` keeps `site.json` from being cached.
- The check runs in the browser, so someone determined could still open the game. For a hard block on
  Cloudflare, also rename `_redirects.maintenance` to `_redirects` (and back afterwards).
- If `site.json` cannot be read, the site counts as open.
- `"coming"` lists the end screen's teasers (`icon` is a sprite name, `title`, `text`); edit them
  to announce what is next without touching the code.

## Layout

```
index.html, css/landing.css    the landing page (js/landing.js); site.json, js/site.js: the switch
404.html                       the page for addresses that do not exist
_headers, _redirects           response headers; the hard maintenance block (off when named _redirects.maintenance)
css/fonts.css, assets/fonts/   the self-hosted pixel fonts (SIL Open Font License)
play.html, css/, js/           the game: rendering, HUD, input, audio, mind panel
js/worker.js                   Pyodide host; JSON in, JSON out
js/log.js                      flight recorder and debug reports
js/terror.js                   the TERROR scene
js/ending.js                   the end screen
py/cadlets.py                  the world and the Cadence integration (runs natively too)
assets/sprites.json            pixel art (from tools/make_sprites.py)
vendor/                        Pyodide 0.27.7 core (vendor/pyodide-0.27.7/), NumPy wheel, Cadence wheel
serve.py                       local server; tools/build_site.py builds dist/ for deployment
tools/headless.py, tune.py     learning curves and parameter sweeps without a browser
tools/smoke.py                 quick checks of every player event, save/load, evolution
tools/replay.py                replay a debug report's save natively
tools/players.py               simulated kind, cruel and changing players
tools/fair.py                  the chart's measure for the Cadence, random choices and an ideal rule
tools/make_sprites.py          edit and preview the sprites
```

To run the tools natively: `pip install -e path/to/cadence` (Python ≥ 3.11), then
`python tools/headless.py --beats 900` (add `--random` for the control), `python tools/fair.py`, or `python tools/smoke.py`.

## Notes

- `vendor/cadence_net-0.74.0-py3-none-any.whl` is built from muellerberndt/cadence at `8d1b82c`
  with a one-line fix for 32-bit WebAssembly (`vendor/cadence-wasm32.patch`): `np.repeat` needs
  `intp` repeat counts.
- Cadence is GPL-3.0 (`vendor/CADENCE-LICENSE.txt`). Pyodide is MPL-2.0; NumPy is BSD-3. The fonts
  (Pixelify Sans, Silkscreen, VT323) are under the SIL Open Font License 1.1 (`assets/fonts/OFL-*.txt`).
- Inspired by Black Mirror's "Plaything" and the game at its heart. Not affiliated with Netflix
  or Night School Studio. All art and sound here are original and procedural.
