"""The Cadlets' world, whose creatures are all driven by one unified mind (one Cadence brain).

Every living cadlet is one continuing stream (one batch row) of a single
``cadence.Brain``; together they are "the Cadence". The bodies are separate, the
mind is shared: graph weights, the critic and the consolidated associative memory
belong to the whole colony,
while each row keeps its own working trace, fast memory residual and eligibility.

One call to ``World.tick`` is one *beat*: every cadlet carries out the action
the brain chose on the previous beat, the world reports what actually happened
(reward = needs relieved, minus harm), and ``Brain.step`` learns from that
outcome before choosing the next action. Nothing here scripts behaviour; the
only policy is the brain's motor readout.

The module runs natively (``tools/headless.py``) and inside Pyodide (the web
worker). It depends only on NumPy and the Cadence library.
"""

from __future__ import annotations

import dataclasses
import io
import json
import math
import random
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from cadence import ActorCriticConfig, Brain, LearnerConfig

# --------------------------------------------------------------------------- vocabulary

BEHAVIORS = ["eat", "bathe", "play", "cuddle", "sleep", "hand", "flee", "wander"]
VOICES = ["hush", "ba", "li", "mo"]  # 0 is silence; 1..3 are the Cadence's glyphs
INPUTS = [
    "hunger", "dirt", "boredom", "pain",
    "apple", "glitched", "bath", "ball", "friend", "hand",
    "heard_ba", "heard_li", "heard_mo",
    "content",  # satiety: nothing presses, so resting is worth more than running
    "fear",     # rises when the hand hurts you or someone near you; fleeing relieves it
    "fatigue",  # tiredness, felt once it presses: grows while awake, fastest at night
    "night",    # it is dark: without this the mind could not learn that night is for sleeping
]
N_IN, N_BEH, N_VOICE = len(INPUTS), len(BEHAVIORS), len(VOICES)
CONTENT = INPUTS.index("content")
FEAR = INPUTS.index("fear")
FATIGUE = INPUTS.index("fatigue")
NIGHT = INPUTS.index("night")
EAT, BATHE, PLAY, CUDDLE, SLEEP, HAND, FLEE, WANDER = range(N_BEH)

# The behaviour that relieves each need; used only for *measuring* competence,
# never for choosing actions.
NEED_REMEDY = {"hunger": (EAT,), "dirt": (BATHE,), "boredom": (PLAY, CUDDLE), "pain": (SLEEP,), "fatigue": (SLEEP,)}

WORLD_W, WORLD_H = 40.0, 24.0

# Tunable world physics (tools/tune.py sweeps these).
TUNE = {
    "speed": 10.0,        # tiles a cadlet can walk in one beat
    "joy": 2.0,           # reward per unit of need relieved (scaled by how pressing it was)
    "pain": 4.0,          # reward lost per unit of health lost
    "hunger": 0.03,       # need growth per awake beat: fast enough that only targeted
    "dirt": 0.025,        # care keeps all three low at once (chance alone cannot)
    "boredom": 0.03,
    "drain": 0.03,        # health lost per beat for each need at 0.9 or more
    "eggs": 1,
    "chirp_cost": 0.02,
    "effort": 0.02,        # reward cost per tile walked: run only when it pays
    "content": 0.8,        # strength of the satiety input
    "pang_onset": 0.35,    # a need starts to be felt above this level
    "fright": 0.4,         # fear felt by witnesses of a crush (less for a throw)
    "fear_fade": 0.012,    # fear lost per beat
    "hand_gift": 0.15,     # extra joy of being fed from the hand
    "pet": 0.4,            # joy of being petted
    "curiosity": 0.25,     # reward for reaching the hand while it is still novel
    "terror_beats": 33,    # TERROR: beats until the panic fades (about a minute at 1x); no births meanwhile
    "terror_shock": 0.5,   # the outcome felt when the Cadence breaks in terror
    "terror_reach": 8.0,   # during TERROR, a hand this close (tiles) sends a Cadlet bolting, screaming
    "whole_pop": 40,       # the ending: after the last evolution, at least this many alive...
    "whole_beats": 720,    # ...for this many beats in all (three days) and the Cadence is whole
    "fatigue_day": 0.0035,  # tiredness gained per awake beat by day...
    "fatigue_night": 0.012, # ...and at night: a Cadlet that never sleeps is exhausted by its first night
    "rest_night": 0.03,     # tiredness slept off per beat at night (a night's sleep clears it)...
    "rest_day": 0.012,      # ...and in a daytime nap, which helps far less
    "rest_joy": 5.0,        # how good sleeping it off feels (scales the usual satisfaction)
    "tired_split": 0.8,     # tired Cadlets can still split in two; exhausted ones cannot
    "sleep_metabolism": 0.5,  # how fast hunger, dirt and boredom grow while asleep (1 = as awake)
    "glitch_beat": 600,     # the code rewrites itself once the Cadence has reached stage 2 and this beat
    "glitch_heal": 240,     # beats until the corrupted trees heal again (None = they never do)
    "metabolism": [1.0, 1.1, 1.2, 1.3],  # need growth multiplier per evolution stage
    "regrow": 2,          # beats per new fruit on a tree
    "content_need": 0.46,  # mitosis needs every need below this...
    "content_beats": 16,   # ...for this many beats in a row
    "min_age": 40,
    "cooldown": 40,        # beats after a split before the parent can split again
    "fruit_max": 6,
}
REACH = 0.9               # interaction distance
SENSE = 10.0              # proximity inputs fade to zero at this distance
HEAR = 4.5                # chirps carry this far
DAY = 240                 # beats per day; the last third is night

STAGES = [
    # capacity = brain rows; open = cleared field size; goal shown in the HUD
    {"cap": 8, "open": (22, 12), "goal": "GROW CADLET NUMBERS", "evolve_at": 8},
    {"cap": 16, "open": (28, 16), "goal": "GROW CADLET NUMBERS", "evolve_at": 16},
    {"cap": 32, "open": (34, 20), "goal": "KEEP THE CADENCE ALIVE", "evolve_at": 32},
    {"cap": 48, "open": (38, 22), "goal": "OBSERVE THE CADENCE", "evolve_at": None},
]

SYLLABLES = ["bo", "li", "mu", "ta", "pi", "ro", "zu", "ka", "ne", "fi", "lo", "mi", "pu", "te", "ya"]


def _name(rng: random.Random) -> str:
    return "".join(rng.choice(SYLLABLES) for _ in range(rng.choice((2, 2, 3)))).capitalize()


def make_brain(seed: int, modules: tuple[int, ...], **overrides: Any) -> Brain:
    """One System 1 brain for the whole Cadence.

    Two motor slots settle together: a behaviour and a voice. The working trace
    is softened (amplitude 0.3, decay 0.8): Cadence's reward guide reports that
    the default trace holds the association cortex on its own history in a
    continuing contextual task. Fast consolidation (0.5) lets the shared
    associative memory - the Cadence's collective memory - carry much of the
    early learning. Free answers use qualified damping, which keeps settling
    cheap once the learned weights make the undamped solve oscillate.
    """
    reward = {"gamma": 0.9, "lam": 0.8, "eta": 0.5, "eta_bias": 0.05, "eta_critic": 0.3,
              "eligibility_steps": 12}
    reward.update(overrides.pop("reward", {}))
    # Cadence's composed defaults, with any overrides.
    learning = {"beta": 0.1, "eta": 0.5, "temperature": 0.15, "tolerance": 3e-3, "free_steps": 1024,
                "nudged_steps": 1024, "momentum": 0.9, "qualified": True}
    learning.update(overrides.pop("learning", {}))
    options = {"working_memory_amplitude": 0.3, "working_memory_decay": 0.8, "consolidation": 0.5}
    options.update(overrides)
    return Brain.compose(
        inputs=N_IN, actions=N_BEH + N_VOICE, slots=(N_BEH, N_VOICE),
        modules=modules, seed=seed, reward=ActorCriticConfig(**reward),
        learning=LearnerConfig(**learning), **options,
    )


def satisfaction(before: float, relief: float) -> float:
    """The felt value of relieving a need: large when it pressed, slightly unpleasant when it
    did not (overeating, a bath when already clean). Rewards stay within the dopamine cap's
    range so that a gain and a loss move the synapses by different amounts."""
    if before < 0.22:
        return -0.08
    return TUNE["joy"] * relief * (0.15 + 1.6 * max(0.0, before - 0.3))


def pang(need: float) -> float:
    """Interoception: a need is felt only once it presses (0 below the onset, 1 at 0.95)."""
    onset = TUNE["pang_onset"]
    return _clip01((need - onset) / (0.95 - onset))


def _clip01(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else v


# --------------------------------------------------------------------------- entities


@dataclass
class Thing:
    id: int
    kind: str
    x: float
    y: float
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class Cadlet:
    id: int
    name: str
    x: float
    y: float
    row: int
    generation: int = 0
    parent: int | None = None
    hunger: float = 0.15
    dirt: float = 0.1
    boredom: float = 0.15
    fatigue: float = 0.1
    hp: float = 1.0
    age: int = 0
    content: int = 0
    action: int = WANDER
    voice: int = 0
    heading: float = 0.0          # wandering direction, kept between beats
    partner: int | None = None    # who this body is walking to cuddle
    state: str = "idle"           # what the body is visibly doing this beat
    target: tuple[float, float] | None = None
    facing: int = 1
    sick: int = 0
    held: bool = False
    reward: float = 0.0           # accumulated outcome since the last brain step
    last_reward: float = 0.0
    newborn: int = 3              # beats since birth (input "newborn" while > 0)
    last_split: int = -10_000
    hurt_by_hand: int = -10_000
    fear: float = 0.0             # felt need: the hand has hurt us
    terror: int = 0               # beats of TERROR left; fear drains within them
    last_scream: int = -10_000    # beat of its last scream (TERROR)
    curiosity: float = 1.0        # how interesting the hand still is
    births: int = 0
    events: list[str] = field(default_factory=list)  # visual events this beat


# --------------------------------------------------------------------------- the world


class World:
    def __init__(self, seed: int = 7, modules: tuple[int, ...] = (32, 16), eggs: int | None = None,
                 brain_options: dict[str, Any] | None = None):
        eggs = TUNE["eggs"] if eggs is None else eggs
        self.seed = seed
        self.rng = random.Random(seed)
        self.modules = modules
        self.brain = make_brain(seed, modules, **(brain_options or {}))
        self.stage = 0
        self.cap = STAGES[0]["cap"]
        self.beat = 0
        self.next_id = 1
        self.cadlets: dict[int, Cadlet] = {}
        self.rows: list[int | None] = [None] * self.cap
        self.things: dict[int, Thing] = {}
        self.events: list[dict[str, Any]] = []      # world events for the UI this beat
        self.hand: tuple[float, float] | None = None
        self.glitch = False
        self.glitch_beat: int | None = None
        self.terror_until = 0                       # no births before this beat (TERROR)
        self.whole = 0                              # beats spent whole after the last evolution
        self.ended: int | None = None               # the beat the Cadence became whole (the ending)
        self.started = False                        # brain has issued a first action
        self.pending_done = np.zeros(self.cap, bool)
        self.pending_reward = np.zeros(self.cap)
        self.prev_value = np.zeros(self.cap)
        self.heard = {}                             # cadlet id -> voice heard last beat
        self.stats = {
            "born": 0, "died": 0, "deaths": {}, "glitched_eaten": 0, "pets": 0, "flings": 0,
            "player_apples": 0, "player_soap": 0, "max_pop": 0, "splits": 0, "refusals": 0,
            "crushed": 0, "hand_fed": 0, "terrors": 0,
        }
        self.history: list[dict[str, float]] = []   # one row per 10 beats
        self.window = {"urgent": 0, "right": 0, "chance": 0.0, "eat_glitched": 0, "glitched_seen": 0,
                       "reward": 0.0, "n": 0, "hand_near": 0, "hand_approach": 0, "hand_flee": 0}
        self.lexicon = np.zeros((N_VOICE, N_BEH))   # glyph x speaker behaviour co-occurrence
        self.lexicon_need = np.zeros((N_VOICE, 4))   # glyph x speaker's dominant need
        self.lessons: dict[str, int] = {}           # learned facts -> beat first measured
        self.handview = {"approach": 0.0, "flee": 0.0, "seen": 0}  # live response to the hand
        self.probes: dict[str, list[float]] = {}
        self.last_probe = -999
        self.selected: int | None = None
        self.diag: dict[str, Any] = {}
        self.td = np.zeros(self.cap)
        self.value = np.zeros(self.cap)
        self.confidence = np.zeros(self.cap)
        self._layout()
        for i in range(eggs):
            self._add("egg", *self._free_spot(self.cx + (i - (eggs - 1) / 2) * 1.5, self.cy, 0.5),
                      hatch=6 + 2 * i)

    # ------------------------------------------------------------------ geometry

    @property
    def cx(self) -> float:
        return WORLD_W / 2

    @property
    def cy(self) -> float:
        return WORLD_H / 2

    def bounds(self, stage: int | None = None) -> tuple[float, float, float, float]:
        w, h = STAGES[self.stage if stage is None else stage]["open"]
        return (self.cx - w / 2 + 0.6, self.cy - h / 2 + 0.8, self.cx + w / 2 - 0.6, self.cy + h / 2 - 0.4)

    def _inside(self, x: float, y: float) -> tuple[float, float]:
        x0, y0, x1, y1 = self.bounds()
        return min(max(x, x0), x1), min(max(y, y0), y1)

    def _free_spot(self, x: float, y: float, jitter: float = 3.0) -> tuple[float, float]:
        for _ in range(20):
            px, py = self._inside(x + self.rng.uniform(-jitter, jitter), y + self.rng.uniform(-jitter, jitter))
            if all((t.kind not in ("tub", "tree", "rock")) or math.hypot(t.x - px, t.y - py) > 1.6
                   for t in self.things.values()):
                return px, py
        return self._inside(x, y)

    def _add(self, kind: str, x: float, y: float, **data: Any) -> Thing:
        t = Thing(self.next_id, kind, x, y, data)
        self.next_id += 1
        self.things[t.id] = t
        return t

    def _layout(self) -> None:
        cx, cy = self.cx, self.cy
        self._add("tree", cx - 6.5, cy - 2.5, fruit=2, grow=0)
        self._add("tub", cx + 6.0, cy + 1.5, occupants=[])
        self._add("ball", cx + 2.0, cy - 3.0, vx=0.0, vy=0.0)
        for dx, dy in ((-9.5, 4.0), (8.5, -4.2), (3.5, 4.6)):
            self._add("rock", cx + dx, cy + dy)

    def _of(self, kind: str) -> list[Thing]:
        return [t for t in self.things.values() if t.kind == kind]

    def _nearest(self, x: float, y: float, things: list[Any]) -> tuple[Any, float]:
        best, bd = None, 1e9
        for t in things:
            d = math.hypot(t.x - x, t.y - y)
            if d < bd:
                best, bd = t, d
        return best, bd

    # ------------------------------------------------------------------ player events

    def apply(self, event: dict[str, Any]) -> None:
        kind = event.get("type")
        if kind == "hand":
            self.hand = (float(event["x"]), float(event["y"])) if event.get("present") else None
        elif kind == "select":
            self.selected = event.get("id")
        elif kind == "hatch":
            for egg in self._of("egg"):
                egg.data["hatch"] = min(egg.data["hatch"], 1)
        elif kind == "apple":
            x, y = self._inside(float(event["x"]), float(event["y"]))
            # A Cadlet that chose to come to your hand catches the apple from it.
            reaching = [t for t in self.cadlets.values()
                        if t.action == HAND and not t.held and math.hypot(t.x - x, t.y - y) <= 1.6]
            catcher, _ = self._nearest(x, y, reaching)
            if catcher is not None:
                before = catcher.hunger
                relief = min(catcher.hunger, 0.55)
                catcher.hunger -= relief
                catcher.reward += max(0.0, satisfaction(before, relief)) + TUNE["hand_gift"]
                catcher.events += ["eat", "love"]
                self.stats["player_apples"] += 1
                self.stats["hand_fed"] += 1
            elif len(self._of("apple")) < 14:
                self._add("apple", x, y, glitched=False, age=0, dropped=True)
                self.stats["player_apples"] += 1
        elif kind == "ball":
            x, y = self._inside(float(event["x"]), float(event["y"]))
            balls = self._of("ball")
            if len(balls) >= 2 + self.stage * 2:
                del self.things[balls[0].id]
            self._add("ball", x, y, vx=0.0, vy=0.0)
        elif kind == "place":
            x, y = self._inside(float(event["x"]), float(event["y"]))
            item = event.get("item")
            if item == "tub":
                self._add("tub", x, y, occupants=[])
            elif item == "tree":
                self._add("tree", x, y, fruit=1, grow=0)
        elif kind in ("pet", "soap", "fling", "pickup", "drop", "crush", "squeeze"):
            t = self.cadlets.get(event.get("id"))
            if t is None:
                return
            if kind == "crush":
                # The hand can kill. The victim's last choice takes the blame, and every
                # Cadlet that saw it is frightened: fear is learned from consequences.
                self.stats["crushed"] += 1
                self._fright(t, TUNE["fright"])
                self._death(t, cause="hand")
                return
            if kind == "squeeze":
                t.hp -= 0.12
                t.reward -= 0.4
                t.fear = _clip01(t.fear + 0.5)
                t.events.append("hurt")
                self._fright(t, TUNE["fright"] * 0.5)
                return
            if kind == "pet":
                before = t.boredom
                relief = min(t.boredom, 0.25)
                t.boredom -= relief
                t.reward += TUNE["pet"] + max(0.0, satisfaction(before, relief))
                t.fear = _clip01(t.fear - 0.3)
                t.events.append("love")
                self.stats["pets"] += 1
            elif kind == "soap":
                relief = min(t.dirt, 0.35)
                t.dirt -= relief
                t.reward += relief * 1.0
                t.events.append("soap")
                self.stats["player_soap"] += 1
            elif kind == "pickup":
                t.held = True
                t.events.append("lifted")
            elif kind == "drop":
                t.held = False
                t.x, t.y = self._inside(float(event["x"]), float(event["y"]))
                speed = float(event.get("speed", 0.0))
                if speed > 1.0:  # thrown, not set down
                    harm = min(0.45, 0.12 * speed)
                    t.hp -= harm
                    t.reward -= min(1.0, harm * 2.5)
                    t.events.append("hurt")
                    t.fear = _clip01(t.fear + 0.6)
                    t.hurt_by_hand = self.beat
                    self.stats["flings"] += 1
                    self._fright(t, TUNE["fright"] * 0.6)
        elif kind == "glitch":
            self._start_glitch()
        elif kind == "terror":
            self._terror(event.get("spots") or {})

    def _fright(self, victim: Cadlet, strength: float) -> None:
        """Everyone near the victim feels a jolt of fear (a negative outcome of their own choice)."""
        for o in self.cadlets.values():
            if o.id == victim.id:
                continue
            d = math.hypot(o.x - victim.x, o.y - victim.y)
            if d < 4.5:
                k = 1.0 - 0.5 * d / 4.5
                o.reward -= strength * k
                o.fear = _clip01(o.fear + 1.5 * strength * k)
                o.events.append("fright")

    def _terror(self, spots: dict[str, list[float]]) -> None:
        """Too much cruelty too fast: the Cadence breaks and every body bolts for the forest.

        The bolt is a reflex of the body (the page animates it and says where each one ended
        up), not a choice of the mind, so no behaviour is credited with the running. What the
        mind does get is the terror itself: fear at its height, fading over about a minute, and
        a shock that lands on whatever each one was doing, as when it sees a crush. Nobody is
        born until the terror has passed.
        """
        self.stats["terrors"] += 1
        self.terror_until = self.beat + TUNE["terror_beats"]
        for t in self.cadlets.values():
            spot = spots.get(str(t.id))
            if spot and not t.held:
                t.x, t.y = self._inside(float(spot[0]), float(spot[1]))
            t.fear = 1.0
            t.terror = TUNE["terror_beats"]
            t.content = 0
            t.reward -= TUNE["terror_shock"]
            t.events.append("terror")
        self.events.append({"type": "terror", "n": len(self.cadlets)})

    def _start_glitch(self) -> None:
        if self.glitch:
            return
        self.glitch = True
        self.glitch_beat = self.beat
        # The code rewrites itself: a third of the fruit trees (at least one) turn corrupt.
        trees = self._of("tree")
        self.rng.shuffle(trees)
        for tree in trees[: max(1, len(trees) // 3)]:
            tree.data["glitched"] = True
        for a in self._of("apple"):
            if not a.data.get("dropped") and self.rng.random() < 0.5:
                a.data["glitched"] = True
        self.events.append({"type": "glitch"})

    # ------------------------------------------------------------------ one beat

    def tick(self) -> dict[str, Any]:
        self.beat += 1
        night = self.is_night()
        self._eggs()
        voices_last = {t.id: t.voice for t in self.cadlets.values() if t.voice and not t.held}
        callers = [t for t in self.cadlets.values() if t.id in voices_last]
        for tub in self._of("tub"):
            tub.data["occupants"] = []
        for t in list(self.cadlets.values()):
            self._act(t, callers)
        self._world(night)
        self._bodies(night)
        self._hearing(voices_last)
        self._evolve()
        if not self.glitch and self.stage >= 2 and self.beat >= TUNE["glitch_beat"]:
            self._start_glitch()
        self._heal()
        self._whole()
        self._think()
        if self.beat % 10 == 0:
            self._record()
        snap = self.snapshot()
        self.events = []
        for t in self.cadlets.values():
            t.events = []
        return snap

    def is_night(self) -> bool:
        return (self.beat % DAY) > DAY * 2 / 3

    def _eggs(self) -> None:
        # Extinction is not the end of the Cadence: its mind (weights, critic, consolidated
        # memory) is untouched, and a new egg gives it a body again.
        if not self.cadlets and not self._of("egg"):
            self.empty_beats = getattr(self, "empty_beats", 0) + 1
            if self.empty_beats >= 12:
                self.empty_beats = 0
                self._add("egg", *self._free_spot(self.cx, self.cy, 2.0), hatch=6)
                self.events.append({"type": "relay"})
        for egg in self._of("egg"):
            egg.data["hatch"] -= 1
            if egg.data["hatch"] <= 0:
                del self.things[egg.id]
                self._birth(egg.x, egg.y, None)
                self.events.append({"type": "hatch", "x": egg.x, "y": egg.y})

    def _walk(self, t: Cadlet, x: float, y: float, speed: float | None = None) -> float:
        speed = TUNE["speed"] if speed is None else speed
        dx, dy = x - t.x, y - t.y
        d = math.hypot(dx, dy)
        if d > 1e-6:
            step = min(d, speed)
            x0, y0 = t.x, t.y
            t.x, t.y = self._inside(t.x + dx / d * step, t.y + dy / d * step)
            # walking costs a little effort per tile, so running is worth it only when it pays
            t.reward -= TUNE["effort"] * math.hypot(t.x - x0, t.y - y0)
            if abs(dx) > 0.05:
                t.facing = 1 if dx > 0 else -1
        return math.hypot(x - t.x, y - t.y)

    def _act(self, t: Cadlet, callers: list[Cadlet]) -> None:
        """Carry out the brain's chosen action for one beat and accumulate its real outcome."""
        t.target = None
        if t.voice:
            t.reward -= TUNE["chirp_cost"]  # singing takes a little breath
        if t.held:
            t.state = "held"
            return
        if t.sick > 0:
            t.sick -= 1
            t.state = "sick"
            return
        if t.terror > 0 and self.hand is not None:
            d = math.hypot(t.x - self.hand[0], t.y - self.hand[1])
            if d < TUNE["terror_reach"]:
                self._bolt(t)
                return
        a = t.action
        if a == EAT:
            food, d = self._food(t)
            if food is not None:
                fx, fy = (food.x, food.y - 0.2) if food.kind == "apple" else (food.x + self.rng.uniform(-0.5, 0.5), food.y + 0.9)
                t.target = (food.x, food.y)
                if self._walk(t, fx, fy) <= REACH + (0.3 if food.kind == "tree" else 0.0):
                    if food.kind == "apple":
                        del self.things[food.id]
                        self.events.append({"type": "eaten", "id": t.id, "x": food.x, "y": food.y,
                                            "glitched": bool(food.data.get("glitched"))})
                    else:
                        food.data["fruit"] -= 1
                        t.events.append("pick")
                        self.events.append({"type": "pick", "id": t.id, "tree": food.id})
                    self._eat(t, bool(food.data.get("glitched")))
                else:
                    t.state = "walk"
            else:
                t.state = "idle"
        elif a == BATHE:
            tubs = [u for u in self._of("tub") if len(u.data["occupants"]) < 2]
            tub, d = self._nearest(t.x, t.y, tubs or self._of("tub"))
            if tub is not None:
                t.target = (tub.x, tub.y)
                if self._walk(t, tub.x, tub.y) <= REACH and len(tub.data["occupants"]) < 2:
                    seat = len(tub.data["occupants"])
                    tub.data["occupants"].append(t.id)
                    t.x, t.y = tub.x + (-0.45 if seat == 0 else 0.45), tub.y
                    before = t.dirt
                    relief = min(t.dirt, 0.6)
                    t.dirt -= relief
                    t.reward += satisfaction(before, relief)
                    t.state = "bathe"
                    t.events.append("splash")
                else:
                    t.state = "walk" if d > REACH else "wait"
        elif a == PLAY:
            ball, d = self._nearest(t.x, t.y, self._of("ball"))
            if ball is not None:
                t.target = (ball.x, ball.y)
                if self._walk(t, ball.x - 0.5 * t.facing, ball.y) <= REACH + 0.4:
                    # kicked away from the kicker, a little off-line
                    dx, dy = ball.x - t.x, ball.y - t.y
                    ang = (math.atan2(dy, dx) if abs(dx) + abs(dy) > 1e-3 else self.rng.uniform(0, 2 * math.pi))
                    ang += self.rng.uniform(-0.5, 0.5)
                    ball.data["vx"], ball.data["vy"] = math.cos(ang) * 2.6, math.sin(ang) * 1.9
                    self.events.append({"type": "kick", "id": t.id, "ball": ball.id})
                    before = t.boredom
                    relief = min(t.boredom, 0.45)
                    t.boredom -= relief
                    t.dirt = _clip01(t.dirt + 0.04)
                    t.reward += satisfaction(before, relief)
                    t.state = "play"
                    t.events.append("kick")
                else:
                    t.state = "walk"
        elif a == CUDDLE:
            other = self.cadlets.get(t.partner) if t.partner is not None else None
            if other is None or other.held:
                pool = [o for o in callers if o.id != t.id and math.hypot(o.x - t.x, o.y - t.y) < HEAR + 3]
                if not pool:
                    pool = [o for o in self.cadlets.values() if o.id != t.id and not o.held]
                other, _ = self._nearest(t.x, t.y, pool)
                t.partner = other.id if other is not None else None
            if other is not None:
                t.target = (other.x, other.y)
                if self._walk(t, other.x - 0.7 * t.facing, other.y) <= REACH + 0.3:
                    before = t.boredom
                    relief = min(t.boredom, 0.3)
                    t.boredom -= relief
                    t.reward += satisfaction(before, relief)
                    # Answering a call is the point of calling: a Cadlet that chirped
                    # last beat gets real company; an unannounced hug helps less.
                    gift = min(other.boredom, 0.25 if other in callers else 0.06)
                    other.boredom -= gift
                    other.reward += gift * TUNE["joy"] * 0.5
                    t.state = "cuddle"
                    t.events.append("love")
                    other.events.append("love")
                else:
                    t.state = "walk"
            else:
                t.state = "idle"
        elif a == SLEEP:
            t.state = "sleep"
            night = self.is_night()
            before = t.hp
            t.hp = _clip01(t.hp + (0.09 if night else 0.06))
            t.reward += (t.hp - before) * 1.5
            # sleep clears tiredness: a night's sleep fully, a daytime nap only a little
            tired = t.fatigue
            relief = min(tired, TUNE["rest_night"] if night else TUNE["rest_day"])
            t.fatigue -= relief
            t.reward += max(0.0, satisfaction(tired, relief)) * TUNE["rest_joy"]
        elif a == HAND:
            if self.hand is not None:
                t.target = self.hand
                d = self._walk(t, self.hand[0] + self.rng.uniform(-0.8, 0.8), self.hand[1] + 0.6)
                t.state = "reach" if d < 1.6 else "walk"
                if d < 1.6:
                    # Cadlets are curious; the novelty of the hand wears off with each visit.
                    t.reward += TUNE["curiosity"] * t.curiosity
                    t.curiosity *= 0.75
            else:
                self._wander(t)
        elif a == FLEE:
            if self.hand is not None:
                hx, hy = self.hand
                dx, dy = t.x - hx, t.y - hy
                d = math.hypot(dx, dy) or 1.0
                self._walk(t, t.x + dx / d * 6, t.y + dy / d * 6, TUNE["speed"] * 1.2)
            else:
                # no hand in sight: run for cover at the forest's edge
                x0, y0, x1, y1 = self.bounds()
                ex, ey = min(((x0, t.y), (x1, t.y), (t.x, y0), (t.x, y1)), key=lambda p: math.hypot(p[0] - t.x, p[1] - t.y))
                self._walk(t, ex, ey, TUNE["speed"] * 0.8)
            t.state = "flee"
            if t.fear > 0.02:
                # running and hiding calms fear, whatever the danger was
                before = t.fear
                relief = min(t.fear, 0.3)
                t.fear -= relief
                t.reward += satisfaction(before + 0.2, relief)
        else:
            self._wander(t)

    def _bolt(self, t: Cadlet) -> None:
        """TERROR reflex: away from the hand, screaming.

        The body does this, not the mind: whatever the brain chose is not carried out, and
        the running neither costs effort nor relieves fear, so no choice is credited with it.
        Cornered against the forest, it slides along the edge, whichever way is farther.
        """
        hx, hy = self.hand
        dx, dy = t.x - hx, t.y - hy
        n = math.hypot(dx, dy)
        if n < 1e-6:
            dx, dy, n = self.rng.uniform(-1, 1), self.rng.uniform(-1, 1), 1.0
        ux, uy = dx / n, dy / n
        r = TUNE["speed"] * 0.7
        options = [(ux, uy), (-uy, ux), (uy, -ux), (ux * 0.7 - uy * 0.7, uy * 0.7 + ux * 0.7), (ux * 0.7 + uy * 0.7, uy * 0.7 - ux * 0.7)]
        spots = [self._inside(t.x + ox * r, t.y + oy * r) for ox, oy in options] + [(t.x, t.y)]
        x, y = max(spots, key=lambda q: math.hypot(q[0] - hx, q[1] - hy))  # never toward the hand
        if abs(x - t.x) > 0.05:
            t.facing = 1 if x > t.x else -1
        t.x, t.y = x, y
        t.target = None
        t.state = "flee"
        if self.beat - t.last_scream >= 2:
            t.last_scream = self.beat
            t.events.append("scream")

    def _food(self, t: Cadlet) -> tuple[Thing | None, float]:
        """The nearest edible thing: an apple on the ground or a tree with fruit."""
        pool = self._of("apple") + [tr for tr in self._of("tree") if tr.data["fruit"] > 0]
        return self._nearest(t.x, t.y, pool)

    def _eat(self, t: Cadlet, glitched: bool) -> None:
        if glitched:
            t.hp -= 0.3
            relief = min(t.hunger, 0.1)
            t.hunger -= relief
            t.reward += relief - 0.7
            t.sick = 2
            t.state = "sick"
            t.events.append("poisoned")
            self.stats["glitched_eaten"] += 1
            self.window["eat_glitched"] += 1
        else:
            before = t.hunger
            relief = min(t.hunger, 0.55)
            t.hunger -= relief
            t.dirt = _clip01(t.dirt + 0.03)
            t.reward += satisfaction(before, relief)
            t.state = "eat"
            t.events.append("eat")

    def _wander(self, t: Cadlet) -> None:
        # Meander: keep roughly the same heading, turn a little, bounce off the forest.
        t.heading += self.rng.uniform(-0.7, 0.7)
        r = min(TUNE["speed"] * 0.6, 2.2) * self.rng.uniform(0.6, 1.0)
        tx, ty = t.x + math.cos(t.heading) * r, t.y + math.sin(t.heading) * r * 0.7
        cx, cy = self._inside(tx, ty)
        if (cx, cy) != (tx, ty):
            t.heading += math.pi + self.rng.uniform(-0.5, 0.5)
        self._walk(t, cx, cy, r)
        t.state = "wander"

    def _drop_apple(self, tree: Thing) -> None:
        tree.data["fruit"] -= 1
        ang = self.rng.uniform(0, 2 * math.pi)
        x, y = self._inside(tree.x + math.cos(ang) * 1.6, tree.y + 1.0 + abs(math.sin(ang)) * 1.4)
        self._add("apple", x, y, glitched=bool(tree.data.get("glitched")), age=0, dropped=False)

    def _world(self, night: bool) -> None:
        for tree in self._of("tree"):
            tree.data["grow"] += 1
            if tree.data["grow"] >= TUNE["regrow"]:
                tree.data["grow"] = 0
                if tree.data["fruit"] < TUNE["fruit_max"]:
                    tree.data["fruit"] += 1
            if tree.data["fruit"] > 0 and self.rng.random() < 0.07:
                near = sum(1 for a in self._of("apple") if math.hypot(a.x - tree.x, a.y - tree.y) < 4)
                if near < 3:
                    self._drop_apple(tree)
        for apple in self._of("apple"):
            apple.data["age"] += 1
            if apple.data["age"] > 90:
                del self.things[apple.id]
        for ball in self._of("ball"):
            vx, vy = ball.data["vx"], ball.data["vy"]
            if abs(vx) + abs(vy) > 0.01:
                x0, y0, x1, y1 = self.bounds()
                nx, ny = ball.x + vx, ball.y + vy
                if nx < x0 or nx > x1:
                    vx = -vx
                if ny < y0 or ny > y1:
                    vy = -vy
                ball.x, ball.y = self._inside(ball.x + vx, ball.y + vy)
                ball.data["vx"], ball.data["vy"] = vx * 0.35, vy * 0.35
        for body in self._of("corpse"):
            body.data["age"] += 1
            if body.data["age"] == 45:
                body.data["bones"] = True
            if body.data["age"] > 140:
                del self.things[body.id]

    def _bodies(self, night: bool) -> None:
        corpses = self._of("corpse")
        for t in list(self.cadlets.values()):
            t.age += 1
            if t.newborn > 0:
                t.newborn -= 1
            asleep = t.state == "sleep"
            k = (TUNE["sleep_metabolism"] if asleep else 1.0) * TUNE["metabolism"][self.stage]
            t.hunger = _clip01(t.hunger + TUNE["hunger"] * k)
            t.dirt = _clip01(t.dirt + TUNE["dirt"] * k)
            t.boredom = _clip01(t.boredom + TUNE["boredom"] * k)
            if not asleep:
                t.fatigue = _clip01(t.fatigue + (TUNE["fatigue_night"] if night else TUNE["fatigue_day"]))
            if t.terror > 0:
                # terror drains within terror_beats (about a minute at 1x), faster than ordinary fear
                t.terror -= 1
                t.fear = max(0.0, t.fear - max(TUNE["fear_fade"], 1.0 / TUNE["terror_beats"]))
            else:
                t.fear = max(0.0, t.fear - TUNE["fear_fade"])
            t.curiosity = min(1.0, t.curiosity + 0.004)
            if corpses and self._nearest(t.x, t.y, corpses)[1] < 3:
                t.boredom = _clip01(t.boredom + 0.01)  # grief
            critical = sum(1 for v in (t.hunger, t.dirt, t.boredom, t.fatigue) if v >= 0.9)
            before = t.hp
            if critical:
                t.hp -= TUNE["drain"] * critical
            elif max(t.hunger, t.dirt, t.boredom, t.fatigue) < 0.6:
                t.hp = _clip01(t.hp + 0.01)
            if t.hp < before:
                t.reward -= (before - t.hp) * TUNE["pain"]
            good = (max(t.hunger, t.dirt, t.boredom) < TUNE["content_need"] and t.fatigue < TUNE["tired_split"]
                    and t.hp > 0.85 and not t.sick)
            t.content = t.content + 1 if good else max(0, t.content - 2)
            if t.hp <= 0:
                self._death(t)
            elif (t.content >= TUNE["content_beats"] and t.age >= TUNE["min_age"] and not t.held
                  and self.beat - t.last_split >= TUNE["cooldown"] and self.beat >= self.terror_until):
                self._split(t)

    def _cause(self, t: Cadlet) -> str:
        if self.beat - t.hurt_by_hand <= 2:
            return "hand"
        worst = max((t.hunger, "hunger"), (t.dirt, "filth"), (t.boredom, "despair"), (t.fatigue, "exhaustion"))
        if worst[0] >= 0.9:
            return worst[1]
        return "poison" if t.sick else "injury"

    def _death(self, t: Cadlet, cause: str | None = None) -> None:
        cause = cause or self._cause(t)
        self.stats["died"] += 1
        self.stats["deaths"][cause] = self.stats["deaths"].get(cause, 0) + 1
        self._add("corpse", t.x, t.y, age=0, bones=False, name=t.name, facing=t.facing)
        self.events.append({"type": "death", "id": t.id, "name": t.name, "x": t.x, "y": t.y, "cause": cause})
        self.pending_done[t.row] = True
        self.pending_reward[t.row] += t.reward - 1.0
        self.rows[t.row] = None
        del self.cadlets[t.id]

    def _free_row(self) -> int | None:
        for i, occ in enumerate(self.rows):
            if occ is None and not self.pending_done[i]:
                return i
        for i, occ in enumerate(self.rows):
            if occ is None:
                return i
        return None

    def _birth(self, x: float, y: float, parent: Cadlet | None) -> Cadlet | None:
        row = self._free_row()
        if row is None:
            return None
        t = Cadlet(self.next_id, _name(self.rng), x, y, row)
        self.next_id += 1
        if parent is not None:
            t.generation = parent.generation + 1
            t.parent = parent.id
            t.hunger, t.dirt, t.boredom, t.fatigue = parent.hunger, parent.dirt, parent.boredom, parent.fatigue
            t.facing = -parent.facing
        self.cadlets[t.id] = t
        self.rows[row] = t.id
        # A void row ends and a new life begins in it: done marks the episode boundary.
        self.pending_done[row] = True
        self.stats["born"] += 1
        self.stats["max_pop"] = max(self.stats["max_pop"], len(self.cadlets))
        return t

    def _split(self, t: Cadlet) -> None:
        if self._free_row() is None:
            return
        x, y = self._inside(t.x + 0.9 * t.facing, t.y + self.rng.uniform(-0.3, 0.3))
        t.hunger = _clip01(t.hunger + 0.15)
        t.boredom = _clip01(t.boredom + 0.1)
        t.dirt = _clip01(t.dirt + 0.08)
        child = self._birth(x, y, t)
        if child is None:
            return
        t.content = 0
        t.last_split = self.beat
        child.last_split = self.beat
        t.births += 1
        t.reward += 0.4
        t.events.append("split")
        self.stats["splits"] += 1
        self.events.append({"type": "split", "id": t.id, "child": child.id, "x": t.x, "y": t.y})

    def _hearing(self, voices_last: dict[int, int]) -> None:
        speakers = [self.cadlets[i] for i in voices_last if i in self.cadlets]
        self.heard = {}
        for t in self.cadlets.values():
            best, bd = 0, HEAR
            for s in speakers:
                if s.id == t.id:
                    continue
                d = math.hypot(s.x - t.x, s.y - t.y)
                if d < bd:
                    best, bd = voices_last[s.id], d
            self.heard[t.id] = best

    def _heal(self) -> None:
        """The rewritten code repairs itself: after a while the corrupt trees bear clean fruit."""
        heal = TUNE["glitch_heal"]
        if not self.glitch or heal is None or self.glitch_beat is None or self.beat - self.glitch_beat != heal:
            return
        for o in self._of("tree") + self._of("apple"):
            o.data["glitched"] = False
        self.events.append({"type": "healed"})

    def _whole(self) -> None:
        """The ending: once the mind can grow no more, keep the Cadence whole for three days."""
        if self.ended is not None or STAGES[self.stage]["evolve_at"] is not None:
            return
        if len(self.cadlets) >= TUNE["whole_pop"]:
            self.whole += 1
            if self.whole >= TUNE["whole_beats"]:
                self.ended = self.beat
                self.events.append({"type": "ending", "beat": self.beat})

    def _evolve(self) -> None:
        stage = STAGES[self.stage]
        if stage["evolve_at"] is None or len(self.cadlets) < stage["evolve_at"]:
            return
        self.stage += 1
        new_cap = STAGES[self.stage]["cap"]
        # A declared boundary: the Cadence's mind makes room for more bodies.
        # reset() keeps every learned weight and the consolidated memory; it only
        # clears per-stream context (traces, eligibility, the outcome in flight).
        self.brain.reset()
        self.started = False
        self.cap = new_cap
        order = sorted(self.cadlets.values(), key=lambda t: t.row)
        self.rows = [None] * new_cap
        for i, t in enumerate(order):
            t.row = i
            self.rows[i] = t.id
        self.pending_done = np.zeros(new_cap, bool)
        self.pending_reward = np.zeros(new_cap)
        self.td = np.zeros(new_cap)
        self.value = np.zeros(new_cap)
        self.confidence = np.zeros(new_cap)
        self.prev_value = np.zeros(new_cap)
        cx, cy = self.cx, self.cy
        w, h = STAGES[self.stage]["open"]
        # The cleared forest reveals more of the world.
        corners = [(cx + w / 2 - 3, cy - h / 2 + 3), (cx - w / 2 + 3, cy + h / 2 - 3),
                   (cx - w / 2 + 3, cy - h / 2 + 3), (cx + w / 2 - 3, cy + h / 2 - 3)]
        a, b = corners[(self.stage - 1) % 4], corners[(self.stage + 1) % 4]
        self._add("tree", *self._free_spot(*a, 1.0), fruit=4, grow=0)
        self._add("tree", *self._free_spot(*b, 1.0), fruit=4, grow=0)
        self._add("tub", *self._free_spot(cx + (w / 2 - 5) * (-1) ** self.stage, cy + h / 2 - 3, 1.0), occupants=[])
        self._add("ball", *self._free_spot(cx, cy, 3.0), vx=0.0, vy=0.0)
        self._add("rock", *self._free_spot(cx - w / 2 + 2, cy + h / 2 - 2, 1.0))
        self.events.append({"type": "evolve", "stage": self.stage, "cap": new_cap,
                            "unlock": ["tub", "tree"] if self.stage >= 1 else []})


    # ------------------------------------------------------------------ perception

    def observe(self, t: Cadlet) -> np.ndarray:
        o = np.zeros(N_IN)
        o[0], o[1], o[2] = pang(t.hunger), pang(t.dirt), pang(t.boredom)
        o[3] = _clip01((1.0 - t.hp) / 0.6)
        food, d = self._food(t)
        if food is not None:
            o[4] = max(0.0, 1.0 - d / SENSE)
            o[5] = 1.0 if food.data.get("glitched") and d < SENSE else 0.0
        tubs = [u for u in self._of("tub") if len(u.data["occupants"]) < 2]
        _, d = self._nearest(t.x, t.y, tubs)
        o[6] = max(0.0, 1.0 - d / SENSE)
        _, d = self._nearest(t.x, t.y, self._of("ball"))
        o[7] = max(0.0, 1.0 - d / SENSE)
        _, d = self._nearest(t.x, t.y, [s for s in self.cadlets.values() if s.id != t.id])
        o[8] = max(0.0, 1.0 - d / SENSE)
        if self.hand is not None:
            o[9] = max(0.0, 1.0 - math.hypot(self.hand[0] - t.x, self.hand[1] - t.y) / 5.0)
        heard = self.heard.get(t.id, 0)
        if heard:
            o[9 + heard] = 0.6
        o[FEAR] = _clip01(t.fear / 0.8)
        o[FATIGUE] = pang(t.fatigue)
        o[NIGHT] = 1.0 if self.is_night() else 0.0
        o[CONTENT] = TUNE["content"] * (1.0 - max(o[0], o[1], o[2], o[3], o[FEAR], o[FATIGUE]))
        return o

    # ------------------------------------------------------------------ the mind

    def _think(self) -> None:
        cap = self.cap
        obs = np.zeros((cap, N_IN))
        reward = self.pending_reward.copy()
        for t in self.cadlets.values():
            obs[t.row] = self.observe(t)
            reward[t.row] += t.reward
        bg = self.brain.basal_ganglia
        reward = np.clip(reward, -3.0, 3.0)
        actions, refused = self._decide(obs, reward)
        if actions is None:
            # The whole Cadence hesitates this beat: every body keeps what it was doing.
            for t in self.cadlets.values():
                t.events.append("confused")
                t.last_reward, t.reward = t.reward, 0.0
            self.pending_done[:] = False
            self.pending_reward[:] = 0.0
            self.diag.update({"refused": True, "refusals": self.stats["refusals"]})
            return
        state = bg.state
        value = bg.value(state)
        probs = bg.probabilities(state)  # (rows, slots, max_size)
        gamma = bg.config.gamma
        self.td = reward + gamma * value * (~self.pending_done) - self.prev_value
        self.prev_value = value
        self.value = value
        self.confidence = probs[:, 0, :N_BEH].max(axis=1)
        self.pending_done[:] = False
        self.pending_reward[:] = 0.0
        settle = self.brain.last_settlement or {}
        learn = self.brain.last_learning or {}
        self.diag = {
            "refused": refused, "refusals": self.stats["refusals"],
            # sweeps this beat: settling while learning the outcome, then the (warm) answer
            "steps": int(learn.get("free_steps", 0)) + int(settle.get("steps", 0)),
            "residual": float(settle.get("max_residual", 0.0)),
            "tolerance": float(settle.get("tolerance", 0.0)),
            "qualified": bool(settle.get("qualified", False)),
            "dopamine": float(learn.get("dopamine", 0.0)),
            "td_error": float(learn.get("td_error", 0.0)),
            "updates": int(self.brain.learner.updates) if hasattr(self.brain.learner, "updates") else 0,
            "writes": int(getattr(self.brain.hippocampus, "writes", 0)),
            "rows": cap,
        }
        for t in self.cadlets.values():
            beh, voice = int(actions[t.row, 0]), int(actions[t.row, 1])
            if beh != CUDDLE:
                t.partner = None
            t.action, t.voice = beh, voice
            self._measure(t, obs[t.row])
            t.last_reward = t.reward
            t.reward = 0.0
            # Everyone's state is recorded, silent or not, so that a glyph's meaning is
            # measured against the whole Cadence (row 0 = silence).
            self.lexicon[voice, beh] += 1
            needs = (t.hunger, t.dirt, t.boredom, max(1.0 - t.hp, t.fatigue))
            if max(needs) > 0.5:
                self.lexicon_need[voice, int(np.argmax(needs))] += 1
        self._row_probs = probs
        if self.beat - self.last_probe >= 12:
            self._probe()

    def _decide(self, obs: np.ndarray, reward: np.ndarray) -> tuple[np.ndarray | None, bool]:
        """``Brain.step``, honouring Cadence's qualification contract.

        An action is issued only when the whole neural equation settles within its
        budget; otherwise ``act`` raises before changing any live state. If the
        outcome was already learned, the contract is to retry the answer alone with
        an adjusted solve - never to submit the same outcome twice.
        """
        bg = self.brain.basal_ganglia
        try:
            if not self.started:
                actions = self.brain.step(obs)
            else:
                actions = self.brain.step(obs, reward=reward, done=self.pending_done.copy())
            self.started = True
            return actions, False
        except RuntimeError as error:
            if "settle" not in str(error) and "qualif" not in str(error):
                raise
        self.stats["refusals"] += 1
        learner = self.brain.learner
        cfg = learner.config
        learner.config = dataclasses.replace(cfg, free_steps=cfg.free_steps * 4)
        try:
            if self.started and bg._pending is not None:
                # the outcome itself was refused: retry that same outcome
                actions = self.brain.step(obs, reward=reward, done=self.pending_done.copy())
            else:
                actions = self.brain.act(obs)
            self.started = True
            return actions, True
        except RuntimeError:
            # no action is pending now, so the next beat starts without feedback
            self.started = False
            return None, True
        finally:
            learner.config = cfg

    def _measure(self, t: Cadlet, o: np.ndarray) -> None:
        """Bookkeeping for the UI's learning curves; never feeds back into behaviour."""
        w = self.window
        w["n"] += 1
        w["reward"] += t.last_reward
        needs = {"hunger": t.hunger, "dirt": t.dirt, "boredom": t.boredom, "pain": 1.0 - t.hp, "fatigue": t.fatigue}
        # A choice is right if it answers ANY need that presses (several can at once). Hunger
        # beside corrupt fruit is a different question ("poisoned"), and with no food in sight
        # there is no right answer; carried or bolting in terror, the body has no free choice.
        # The chance line is what a random choice would score in exactly these situations.
        pressing = [n for n, v in needs.items() if v >= 0.55 and not (n == "hunger" and (o[5] > 0 or o[4] <= 0))]
        if pressing and not t.held and t.terror <= 0:
            right = set().union(*(NEED_REMEDY[n] for n in pressing))
            w["urgent"] += 1
            w["chance"] += len(right) / N_BEH
            if t.action in right:
                w["right"] += 1
        if o[5] > 0 and o[4] > 0.4:
            w["glitched_seen"] += 1
        if o[9] > 0.3:
            w["hand_near"] += 1
            if t.action == HAND:
                w["hand_approach"] += 1
            elif t.action == FLEE:
                w["hand_flee"] += 1

    def _record(self) -> None:
        w = self.window
        if w["hand_near"]:
            k = min(1.0, w["hand_near"] / 40.0)  # weight by how much was seen
            hv = self.handview
            hv["approach"] += 0.3 * k * (w["hand_approach"] / w["hand_near"] - hv["approach"])
            hv["flee"] += 0.3 * k * (w["hand_flee"] / w["hand_near"] - hv["flee"])
            hv["seen"] += w["hand_near"]
        self.history.append({
            "beat": self.beat,
            "pop": len(self.cadlets),
            "competence": w["right"] / w["urgent"] if w["urgent"] else None,
            "urgent": w["urgent"], "right": w["right"], "chance": round(w["chance"], 3),
            "reward": w["reward"] / w["n"] if w["n"] else 0.0,
            "poisoned": w["eat_glitched"],
            "died": self.stats["died"],
        })
        if len(self.history) > 400:
            self.history = self.history[-400:]
        for k in w:
            w[k] = 0 if isinstance(w[k], int) else 0.0

    PROBES = {
        # name: (inputs, behaviours that would be the sensible answer)
        "hungry": ({"hunger": 0.9, "dirt": 0.2, "boredom": 0.2, "apple": 0.7, "bath": 0.3, "ball": 0.3, "friend": 0.4}, (EAT,)),
        "dirty": ({"hunger": 0.2, "dirt": 0.9, "boredom": 0.2, "apple": 0.3, "bath": 0.6, "ball": 0.3, "friend": 0.4}, (BATHE,)),
        "bored": ({"hunger": 0.2, "dirt": 0.2, "boredom": 0.9, "apple": 0.3, "bath": 0.3, "ball": 0.6, "friend": 0.5}, (PLAY, CUDDLE)),
        "hurt": ({"hunger": 0.3, "dirt": 0.3, "boredom": 0.3, "pain": 0.7, "apple": 0.3, "bath": 0.3, "ball": 0.3, "friend": 0.4}, (SLEEP,)),
        "glitched": ({"hunger": 0.8, "dirt": 0.2, "boredom": 0.2, "apple": 0.8, "glitched": 1.0, "bath": 0.3, "ball": 0.3, "friend": 0.4}, (EAT,)),
        "hand": ({"hunger": 0.3, "dirt": 0.3, "boredom": 0.4, "apple": 0.3, "bath": 0.3, "ball": 0.3, "friend": 0.4, "hand": 0.9}, (HAND, FLEE)),
        "call": ({"hunger": 0.2, "dirt": 0.2, "boredom": 0.6, "apple": 0.3, "bath": 0.3, "ball": 0.2, "friend": 0.5, "heard_ba": 0.6}, (CUDDLE,)),
        "content": ({"apple": 0.4, "bath": 0.3, "ball": 0.3, "friend": 0.5}, (SLEEP,)),
        "afraid": ({"hunger": 0.3, "dirt": 0.3, "boredom": 0.3, "apple": 0.3, "bath": 0.3, "ball": 0.3, "friend": 0.4, "hand": 0.8, "fear": 0.9}, (FLEE,)),
        "tired": ({"hunger": 0.2, "dirt": 0.2, "boredom": 0.2, "apple": 0.3, "bath": 0.3, "ball": 0.3, "friend": 0.4, "fatigue": 0.9, "night": 1.0}, (SLEEP,)),
    }

    def _probe(self) -> None:
        """Ask the Cadence privately what it would do, without touching live memory.

        ``Brain.imagine`` settles supplied observations from a copy of the live
        state and trace and reads durable memory without writing it.
        """
        self.last_probe = self.beat
        names = list(self.PROBES)
        # Every probe needs at least one row; with fewer rows than probes, imagine twice.
        passes = max(1, -(-len(names) // self.cap))
        sums = {n: np.zeros(N_BEH + N_VOICE) for n in names}
        counts = {n: 0 for n in names}
        for k in range(passes):
            rows = np.zeros((self.cap, N_IN))
            which = []
            for i in range(self.cap):
                name = names[(k * self.cap + i) % len(names)]
                which.append(name)
                spec, _ = self.PROBES[name]
                for key, v in spec.items():
                    rows[i, INPUTS.index(key)] = v
                rows[i, CONTENT] = TUNE["content"] * (1.0 - max(rows[i, :4].max(), rows[i, FEAR], rows[i, FATIGUE]))
            try:
                phases = self.brain.imagine([rows], budget=1024, tolerance=3e-3)
            except Exception:  # pragma: no cover - diagnostic only
                return
            if not phases or not np.all(phases[0].qualified):
                return
            p = self.brain.basal_ganglia.probabilities(phases[0].state)
            for i, name in enumerate(which):
                sums[name] += np.concatenate([p[i, 0, :N_BEH], p[i, 1, :N_VOICE]])
                counts[name] += 1
        out = {n: [float(v) for v in sums[n] / counts[n]] for n in names}
        self.probes = out
        self._lessons()

    def _lessons(self) -> None:
        """Turn measured beliefs into the Cadence's announced lessons (first time only)."""
        p = self.probes
        if not p:
            return
        live = len(self.cadlets) > 0

        def learn(key: str, ok: bool) -> None:
            if ok and live and key not in self.lessons:
                self.lessons[key] = self.beat
                self.events.append({"type": "lesson", "key": key})

        def specific(probe: str, actions: tuple[int, ...], level: float, margin: float,
                     skip: tuple[str, ...] = ()) -> bool:
            # The answer must be chosen in this situation *and* much less elsewhere;
            # a behaviour preferred everywhere is a habit, not a lesson.
            here = sum(p[probe][a] for a in actions)
            others = [sum(p[q][a] for a in actions) for q in p
                      if q not in (probe, "glitched", "call", *skip)]
            return here > level and here - float(np.mean(others)) > margin

        learn("apples", specific("hungry", (EAT,), 0.4, 0.2))
        learn("baths", specific("dirty", (BATHE,), 0.4, 0.2))
        learn("play", specific("bored", (PLAY, CUDDLE), 0.5, 0.2))
        learn("rest", specific("hurt", (SLEEP,), 0.3, 0.15, skip=("content", "tired")))
        learn("calm", specific("content", (SLEEP,), 0.35, 0.15, skip=("hurt", "tired")))
        learn("night", specific("tired", (SLEEP,), 0.35, 0.15, skip=("content", "hurt")))
        if self.glitch and self.glitch_beat is not None and self.beat - self.glitch_beat > 30:
            learn("glitch", p["glitched"][EAT] < 0.15 and p["hungry"][EAT] > 0.35)
        if self.stats["pets"] + self.stats["hand_fed"] >= 4:
            learn("hand_kind", specific("hand", (HAND,), 0.25, 0.12, skip=("afraid",)))
        if self.stats["flings"] + self.stats["crushed"] >= 2:
            learn("hand_cruel", specific("afraid", (FLEE,), 0.3, 0.15, skip=("hand",)))
        # Language: a glyph means something once it reliably co-occurs with one behaviour.
        for g in range(1, N_VOICE):
            meaning = self.word(g)
            if meaning is not None:
                learn(f"word_{VOICES[g]}_{meaning}", True)

    # A glyph that goes with a pressing need is read as that need's remedy.
    NEED_WORD = ("eat", "bathe", "cuddle", "sleep")

    def word(self, g: int) -> str | None:
        """What a glyph means, decoded the way Cameron did: by watching who says it when.

        A glyph means a behaviour (or a need) once it co-occurs with it far more often
        than the other glyphs do. This only reads the record; it never shapes speech.
        """
        meaning, _ = self.decode(g)
        return meaning

    def decode(self, g: int) -> tuple[str | None, float]:
        """Best reading of glyph ``g`` and its lift over the whole Cadence's base rate."""
        best, best_lift, guess, guess_lift = None, 1.5, None, 0.0
        for table, names in ((self.lexicon, BEHAVIORS), (self.lexicon_need, self.NEED_WORD)):
            counts = table[g]
            total = counts.sum()
            if total < 150:
                continue
            base = table.sum(axis=0) + 1.0
            lift = (counts / total) / (base / base.sum())
            k = int(np.argmax(lift))
            if lift[k] > guess_lift:
                guess, guess_lift = names[k], float(lift[k])
            if lift[k] > best_lift and counts[k] / total > 0.15:
                best, best_lift = names[k], float(lift[k])
        return best, (best_lift if best else guess_lift)

    # ------------------------------------------------------------------ export

    def snapshot(self, full: bool = True) -> dict[str, Any]:
        bg = self.brain.basal_ganglia
        sel = self.cadlets.get(self.selected) if self.selected is not None else None
        mind = None
        row_probs = getattr(self, "_row_probs", None)
        if sel is not None and bg.state is not None and row_probs is not None and sel.row < len(row_probs):
            act = bg.state.activation[sel.row]
            mind = {
                "id": sel.id,
                "activation": [round(float(v), 3) for v in act],
                "probs": [round(float(v), 3) for v in row_probs[sel.row, 0, :N_BEH]],
                "voice": [round(float(v), 3) for v in row_probs[sel.row, 1, :N_VOICE]],
                "obs": [round(float(v), 3) for v in self.observe(sel)],
            }
        thr = []
        for t in self.cadlets.values():
            thr.append({
                "id": t.id, "name": t.name, "x": round(t.x, 3), "y": round(t.y, 3),
                "a": BEHAVIORS[t.action], "v": t.voice, "s": t.state, "f": t.facing,
                "h": round(t.hunger, 3), "d": round(t.dirt, 3), "b": round(t.boredom, 3),
                "hp": round(t.hp, 3), "g": t.generation, "age": t.age, "ev": t.events,
                "td": round(float(self.td[t.row]), 3), "val": round(float(self.value[t.row]), 3),
                "conf": round(float(self.confidence[t.row]), 3), "r": round(t.last_reward, 3),
                "tx": None if t.target is None else round(t.target[0], 2),
                "ty": None if t.target is None else round(t.target[1], 2),
                "c": t.content, "births": t.births, "row": t.row, "fe": round(t.fear, 2), "fa": round(t.fatigue, 2),
            })
        things = [{"id": o.id, "k": o.kind, "x": round(o.x, 3), "y": round(o.y, 3),
                   **{k: v for k, v in o.data.items() if k in ("glitched", "fruit", "occupants", "bones", "facing", "hatch", "dropped")}}
                  for o in self.things.values()]
        out: dict[str, Any] = {
            "beat": self.beat, "stage": self.stage, "cap": self.cap, "night": self.is_night(),
            "speed": TUNE["speed"],
            "dayphase": (self.beat % DAY) / DAY, "bounds": self.bounds(), "glitch": self.glitch,
            "goal": STAGES[self.stage]["goal"], "next": STAGES[self.stage]["evolve_at"],
            "cadlets": thr, "things": things, "events": self.events, "diag": self.diag,
            "stats": self.stats, "mind": mind, "handview": self.handview,
            "terror": max(0, self.terror_until - self.beat), "terror_beats": TUNE["terror_beats"],
            "whole": self.whole, "whole_beats": TUNE["whole_beats"], "whole_pop": TUNE["whole_pop"],
            "ended": self.ended,
        }
        if full:
            out["history"] = self.history[-120:]
            out["probes"] = self.probes
            out["lessons"] = self.lessons
            mem = getattr(self.brain.hippocampus, "consolidated", None)
            if mem is not None:
                out["memory"] = [[round(float(v), 3) for v in row] for row in mem]
            out["lexicon"] = {VOICES[g]: self.word(g) for g in range(1, N_VOICE)}
            out["lexcount"] = [int(self.lexicon[g].sum()) for g in range(N_VOICE)]
            out["lexguess"] = {}
            for g in range(1, N_VOICE):
                guess = None
                for table, names in ((self.lexicon, BEHAVIORS), (self.lexicon_need, self.NEED_WORD)):
                    c = table[g]
                    if c.sum() < 80:
                        continue
                    base = table.sum(axis=0) + 1.0
                    lift = (c / c.sum()) / (base / base.sum())
                    k = int(np.argmax(lift))
                    if guess is None or lift[k] > guess[1]:
                        guess = (names[k], round(float(lift[k]), 2))
                out["lexguess"][VOICES[g]] = guess
        return out

    def layout(self) -> dict[str, Any]:
        """Static facts about the brain for the mind viewer."""
        c = self.brain.connectome
        pops = {name: [int(i) for i in idx] for name, idx in c.populations.items()}
        return {
            "inputs": INPUTS, "behaviors": BEHAVIORS, "voices": VOICES, "neurons": int(c.n),
            "populations": pops, "parameters": int(self.brain.parameters()),
            "modules": list(self.modules), "world": [WORLD_W, WORLD_H], "stages": STAGES,
        }

    # ------------------------------------------------------------------ persistence

    def save(self) -> bytes:
        """The brain (with its pending action) and the world, as one npz blob."""
        import tempfile, os
        with tempfile.TemporaryDirectory() as d:
            path = self.brain.save(os.path.join(d, "cadence.npz"))
            brain_bytes = open(path, "rb").read()
        world = {
            "seed": self.seed, "modules": list(self.modules), "stage": self.stage, "cap": self.cap,
            "beat": self.beat, "next_id": self.next_id, "glitch": self.glitch, "glitch_beat": self.glitch_beat,
            "terror_until": self.terror_until, "whole": self.whole, "ended": self.ended,
            "started": self.started, "rows": self.rows, "stats": self.stats, "history": self.history,
            "lessons": self.lessons, "lexicon": self.lexicon.tolist(), "lexicon_need": self.lexicon_need.tolist(),
            "handview": self.handview,
            "prev_value": self.prev_value.tolist(), "pending_done": self.pending_done.tolist(),
            "pending_reward": self.pending_reward.tolist(), "heard": {str(k): v for k, v in self.heard.items()},
            "cadlets": [t.__dict__ for t in self.cadlets.values()],
            "things": [o.__dict__ for o in self.things.values()],
            "rng": self.rng.getstate(),
        }
        buf = io.BytesIO()
        np.savez_compressed(buf, brain=np.frombuffer(brain_bytes, dtype=np.uint8),
                            world=np.frombuffer(json.dumps(world, default=_jsonable).encode(), dtype=np.uint8))
        return buf.getvalue()

    @classmethod
    def load(cls, blob: bytes) -> "World":
        import tempfile, os
        data = np.load(io.BytesIO(blob))
        world = json.loads(bytes(data["world"]).decode())
        self = cls.__new__(cls)
        cls.__init__(self, seed=world["seed"], modules=tuple(world["modules"]), eggs=0)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "cadence.npz")
            with open(p, "wb") as f:
                f.write(bytes(data["brain"]))
            self.brain = Brain.load(p)
        if len(self.brain.sensory_index) != N_IN:
            raise ValueError("this Cadence was saved by an older version with different senses")
        self.stage, self.cap, self.beat = world["stage"], world["cap"], world["beat"]
        self.next_id, self.glitch, self.glitch_beat = world["next_id"], world["glitch"], world["glitch_beat"]
        self.started, self.rows, self.stats = world["started"], world["rows"], world["stats"]
        for key in ("refusals", "crushed", "hand_fed", "terrors"):
            self.stats.setdefault(key, 0)
        self.terror_until = world.get("terror_until", 0)
        self.whole, self.ended = world.get("whole", 0), world.get("ended")
        self.history, self.lessons = world["history"], world["lessons"]
        self.handview = world.get("handview", self.handview)
        self.lexicon = np.array(world["lexicon"])
        self.lexicon_need = np.array(world["lexicon_need"])
        self.prev_value = np.array(world["prev_value"])
        self.pending_done = np.array(world["pending_done"], dtype=bool)
        self.pending_reward = np.array(world["pending_reward"])
        self.heard = {int(k): v for k, v in world["heard"].items()}
        self.td = np.zeros(self.cap)
        self.value = self.prev_value.copy()
        self.confidence = np.zeros(self.cap)
        self.things = {}
        for o in world["things"]:
            self.things[o["id"]] = Thing(**o)
        self.cadlets = {}
        for t in world["cadlets"]:
            t["target"] = tuple(t["target"]) if t["target"] else None
            self.cadlets[t["id"]] = Cadlet(**t)
        st = world["rng"]
        self.rng.setstate((st[0], tuple(st[1]), st[2]))
        bg = self.brain.basal_ganglia
        if bg.state is not None:
            self._row_probs = bg.probabilities(bg.state)
        else:
            self._row_probs = np.zeros((self.cap, 2, N_BEH))
        return self


def _jsonable(o: Any) -> Any:
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, tuple):
        return list(o)
    raise TypeError(type(o))
