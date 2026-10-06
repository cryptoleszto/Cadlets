"""Generate assets/sprites.json (hand-drawn pixel sprites) and preview PNGs.

    python tools/make_sprites.py [--preview DIR]

Each sprite is a list of equal-length strings; every character is a palette key.
'.' is transparent. Variants (blinking, eating, dead...) are derived by editing rows.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PALETTE = {
    ".": None,
    # cadlet
    "o": "#a06a1c", "Y": "#f2c84b", "L": "#ffe48a", "S": "#d9a23a", "E": "#cc552c", "e": "#a23e1e",
    "W": "#f7f5ee", "K": "#1d1610", "M": "#7a4612", "B": "#5aa9e3", "D": "#3b7fc0", "H": "#93cdf3",
    "F": "#cf8b1c", "f": "#875610", "T": "#7fd3ff", "X": "#3a1a10", "R": "#e8607a",
    # neutrals / objects
    "k": "#1a1a14", "w": "#ffffff", "g": "#e6eaea", "h": "#bcc4c8", "d": "#8a9499", "n": "#5d6669",
    "b": "#4f8fdc", "c": "#3d77c8", "s": "#a9d6fa", "y": "#e6bb3a", "u": "#a8801a",
    "r": "#d63b2b", "q": "#992016", "p": "#ff8f70", "v": "#4c9b31", "j": "#2f6a1e", "t": "#6a4020",
    "1": "#83837a", "2": "#6c6c66", "3": "#55554f", "4": "#3e3e3a", "5": "#a3a398", "6": "#2c2c28",
    "C": "#f3ead0", "G": "#d6c9a4", "P": "#b98d55", "Q": "#8a7754", "Z": "#ece9dc", "z": "#b4b1a2",
    "m": "#d8aa82", "N": "#3b2a20", "O": "#6b5341", "A": "#f1e3c9", "I": "#c0302a",
}

CADLET = [
    "..........oo........",
    ".........oLYo.......",
    "..........oYo.......",
    "..ooo....oYYo...ooo.",
    ".oEEEoooYYLLYYooEEEo",
    ".oeEEEYYLLLLLLYYEEeo",
    "..oeEYYLLLLLLLLYYEo.",
    "...oYYYLLLLLLLLYYYo.",
    "..oYYYYYYYYYYYYYYYYo",
    "..oYYYWWYYYYYWWYYYSo",
    "..oYYYWKYYYYYWKYYYSo",
    "..oYYYWKYYYYYWKYYYSo",
    "..oSYYYYYYMYYYYYYYSo",
    "...oSYYYYYYYYYYYYSo.",
    "...ooSSYYYYYYYYSSoo.",
    "..oYYooSSYYYYSSooYYo",
    "..oYSo.oBBBBBBo..oSo",
    "...oo..oBHBBBDo...o.",
    ".......oDBBBBDDo....",
    ".......oFFo.oFFo....",
    "........oo...oo.....",
]

BACK = [
    "..........oo........",
    ".........oLYo.......",
    "..........oYo.......",
    "..ooo....oYYo...ooo.",
    ".oEEEoooYYYYYYooEEEo",
    ".oeEEEYYLYYLYYYYEEeo",
    "..oeEYYYLYYYLYYYYEo.",
    "...oYYLYYYLYYYLYYYo.",
    "..oYYYYLYYYYLYYYYYYo",
    "..oYYLYYYYLYYYYLYYSo",
    "..oYYYYYLYYYYLYYYYSo",
    "..oSYYLYYYYLYYYYYYSo",
    "..oSYYYYYLYYYYYLYYSo",
    "...oSYYYYYYYYYYYYSo.",
    "...ooSSYYYYYYYYSSoo.",
    "..oYYooSSYYYYSSooYYo",
    "..oYSo.oBBBBBBo..oSo",
    "...oo..oDBBBBDo...o.",
    ".......oDDBBDDDo....",
    ".......oFFo.oFFo....",
    "........oo...oo.....",
]


def edit(base: list[str], rows: dict[int, str]) -> list[str]:
    out = list(base)
    for r, s in rows.items():
        assert len(s) == len(base[0]), (r, s, len(s))
        out[r] = s
    return out


EYES = {9: None, 10: None, 11: None}
VARIANTS = {
    "thr": CADLET,
    "thr_l": edit(CADLET, {10: "..oYYYKWYYYYYKWYYYSo", 11: "..oYYYKWYYYYYKWYYYSo"}),
    "thr_r": edit(CADLET, {10: "..oYYYWKYYYYYWKYYYSo"}),
    "thr_blink": edit(CADLET, {9: "..oYYYYYYYYYYYYYYYSo", 10: "..oYYYYYYYYYYYYYYYSo", 11: "..oYYYKKYYYYYKKYYYSo"}),
    "thr_happy": edit(CADLET, {9: "..oYYYYYYYYYYYYYYYSo", 10: "..oYYYKKYYYYYKKYYYSo", 11: "..oYYKYYKYYYKYYKYYSo", 12: "..oSYYYYYYMMYYYYYYSo"}),
    "thr_eat": edit(CADLET, {12: "..oSYYYYYMKKMYYYYYSo", 13: "...oSYYYYYKKYYYYYSo."}),
    "thr_sad": edit(CADLET, {9: "..oYYYYWYYYYYWYYYYSo", 12: "..oSYTYYYYMYYYYYYYSo", 13: "...oSTYYYYYYYYYYYSo."}),
    "thr_dead": edit(CADLET, {9: "..oYYYKYKYYYKYKYYYSo", 10: "..oYYYYKYYYYYYKYYYSo", 11: "..oYYYKYKYYYKYKYYYSo"}),
    "thr_sick": edit(CADLET, {9: "..oYYYYYYYYYYYYYYYSo", 10: "..oYYYKKKYYYKKKYYYSo", 12: "..oSYYYYYMMMYYYYYYSo"}),
    "thr_shock": edit(CADLET, {9: "..oYYWWWYYYYWWWYYYSo", 10: "..oYYWKWYYYYWKWYYYSo", 11: "..oYYWWWYYYYWWWYYYSo", 12: "..oSYYYYYYKYYYYYYYSo"}),
    "thr_back": BACK,
    # walking frames: feet alternate
    "thr_step": edit(CADLET, {19: ".......oFFo..oFFo...", 20: "........oo....oo...."}),
    "thr_back_step": edit(BACK, {19: ".......oFFo..oFFo...", 20: "........oo....oo...."}),
    "thr_reach": edit(CADLET, {14: ".oYooSSYYYYYYYYSSooY", 15: "..oo.oSSYYYYSSo...oo", 16: "......oBBBBBBo......", 17: ".......oBHBBBDo....."}),
}

SPRITES = {
    **VARIANTS,
    "egg": [
        "....QQQQ....",
        "...QCCCCQ...",
        "..QCCwCCCQ..",
        "..QCwCCPCQ..",
        ".QCCCCCCCCQ.",
        ".QCPCCCCCGQ.",
        ".QCCCCCPCGQ.",
        "QCCCCCCCCCGQ",
        "QCCCPCCCCGGQ",
        "QCCCCCCCPCGQ",
        "QGCCCCCCCGGQ",
        ".QGCCPCCGGQ.",
        ".QGGCCCGGGQ.",
        "..QQGGGGQQ..",
        "....QQQQ....",
    ],
    "egg_crack": [
        "....QQQQ....",
        "...QCCCCQ...",
        "..QCCwCCCQ..",
        "..QCwCkPCQ..",
        ".QCCCkCkCCQ.",
        ".QCPkCCCkGQ.",
        ".QCCCCCPCkQ.",
        "QCCCCCCCCCGQ",
        "QCCCPCCCCGGQ",
        "QCCCCCCCPCGQ",
        "QGCCCCCCCGGQ",
        ".QGCCPCCGGQ.",
        ".QGGCCCGGGQ.",
        "..QQGGGGQQ..",
        "....QQQQ....",
    ],
    "apple": [
        "....tv...",
        "...tvv...",
        ".qqrtrqq.",
        "qrrprrrrq",
        "qrpprrrrq",
        "qrrrrrrrq",
        "qrrrrrrqq",
        ".qrrrrqq.",
        "..qqqqq..",
    ],
    "apple_bite": [
        "....tv...",
        "...tvv...",
        ".qqrtrqq.",
        "qrrprrrA.",
        "qrpprrA..",
        "qrrrrrA..",
        "qrrrrrrA.",
        ".qrrrrqq.",
        "..qqqqq..",
    ],
    "ball": [
        "...kkkkk...",
        "..kwwrrrk..",
        ".kwwwrrrbk.",
        "kwwwwrrbbbk",
        "kwwwwrbbbbk",
        "krrrrwwwwwk",
        "krrrrwwwwwk",
        "kcrrrwwwwyk",
        ".kcrrwwwyk.",
        "..kcrwwyk..",
        "...kkkkk...",
    ],
    "tub": [
        "..........................yy....",
        "...........................yu...",
        "....kkkkkkkkkkkkkkkkkkkkkkk.u...",
        "..kkwwwwwwwwwwwwwwwwwwwwwwwkk...",
        ".kwwghhhhhhhhhhhhhhhhhhhhggwwk..",
        "kwwhdcccccccccccccccccccccdhwwk.",
        "kwghcbbbbsbbbbbbbbbbbsbbbbchgwk.",
        "kwghcbbbbbbbbsbbbbbbbbbbbbchgwk.",
        "kwwhdcbbbbbbbbbbbbbsbbbbbcdhwwk.",
        "kgwwhdddcccccccccccccccdddhwwgk.",
        ".kgwwwhhhhhhhhhhhhhhhhhhhwwwgk..",
        ".kggwwwwwwwwwwwwwwwwwwwwwwwggk..",
        "..khggwwwwwwwwwwwwwwwwwwwgghk...",
        "..kdhhggggwwwwwwwwwwwggggghdk...",
        "...kddhhhhgggggggggggghhhddk....",
        "....kkdddhhhhhhhhhhhhhdddkk.....",
        "....kyykkkkkkkkkkkkkkkkyykk.....",
        "...kyuk...............kyuk......",
        "...kuk.................kuk......",
        "....k...................k.......",
    ],
    "rock": [
        "......444444......",
        "....441222211444..",
        "...41222222222214.",
        "..412252222222221.",
        ".41225222522222214",
        ".41252222522222214",
        ".41252222552222214",
        "412222522422222224",
        "412222254222222224",
        "412222242222222234",
        "422222422222222334",
        "422222422222223334",
        ".42222422222333344",
        ".43222222223333446",
        "..4333333333344466",
        "...6644444444666..",
    ],
    "bones": [
        "zz.......zz.",
        "zZZz...zZZz.",
        ".zZZzzzZZz..",
        "..zZZZZZz...",
        ".zZZzzzZZz..",
        "zZZz...zZZzz",
        "zz....zZZZZz",
        "......zzzzz.",
    ],
    "hand": [
        "....kk..........",
        "...kAAk.........",
        "...kAAk.........",
        "...kAAk.........",
        "...kAAkkk.......",
        "...kAAkAAkkk....",
        "...kAAkAAkAAkk..",
        ".kkkAAAAAAAAkAk.",
        "kAAkAAAAAAAAAAk.",
        "kAAAAAAAAAAAAAk.",
        ".kAAAAAAAAAAAAk.",
        "..kAAAAAAAAAAAk.",
        "..kmAAAAAAAAAk..",
        "...kmAAAAAAAmk..",
        "....kmmmmmmmk...",
        ".....kkkkkkk....",
    ],
    "hand_grab": [
        "................",
        "................",
        "................",
        "....kkkkkkk.....",
        "...kAAkAAkAkk...",
        "..kkAAkAAkAAkk..",
        ".kAAkAAkAAkAAk..",
        "kAAAAAAAAAAAAAk.",
        "kAAAAAAAAAAAAAk.",
        "kAAAAAAAAAAAAAk.",
        ".kAAAAAAAAAAAAk.",
        "..kAAAAAAAAAAAk.",
        "..kmAAAAAAAAAk..",
        "...kmAAAAAAAmk..",
        "....kmmmmmmmk...",
        ".....kkkkkkk....",
    ],
}

# 9x9 icons for bubbles and the HUD
ICONS = {
    "i_apple": [
        "....tv...",
        "...tvv...",
        ".qqrtrqq.",
        "qrrprrrrq",
        "qrpprrrrq",
        "qrrrrrrrq",
        "qrrrrrrqq",
        ".qrrrrqq.",
        "..qqqqq..",
    ],
    "i_tub": [
        "......yy.",
        ".......u.",
        "kkkkkkkk.",
        "kgbbbsbgk",
        "kgcbbbcgk",
        "kwgggggwk",
        ".kwwwwwk.",
        ".ky...yk.",
        "..k...k..",
    ],
    "i_ball": [
        "..kkkkk..",
        ".kwwrrrk.",
        "kwwwrrbbk",
        "kwwwrbbbk",
        "krrrwwwwk",
        "kcrrwwwwk",
        "kccrwwwyk",
        ".kcrwwyk.",
        "..kkkkk..",
    ],
    "i_heart": [
        ".........",
        ".II...II.",
        "IRRI.IRRI",
        "IRwRIRRRI",
        "IRRRRRRRI",
        ".IRRRRRI.",
        "..IRRRI..",
        "...IRI...",
        "....I....",
    ],
    "i_zzz": [
        ".....kkkk",
        "........k",
        ".kkk...k.",
        "...k..kkk",
        "..k......",
        ".kkk.....",
        "...kkkkk.",
        ".....k...",
        "...kkkkk.",
    ],
    "i_hand": [
        "...k.....",
        "..kAk....",
        "..kAkkk..",
        "..kAkAkk.",
        "kkkAAAAAk",
        "kAkAAAAAk",
        ".kAAAAAAk",
        "..kAAAAk.",
        "...kkkk..",
    ],
    "i_flee": [
        "....kkk..",
        "....kAk..",
        "..kkkk...",
        ".k.kAk...",
        "...kkkk..",
        "..k...k..",
        ".k.....k.",
        ".........",
        "kk.kk.kk.",
    ],
    "i_wander": [
        ".........",
        "..kkkkk..",
        ".k.....k.",
        "k...k...k",
        "k..kAk..k",
        "k...k...k",
        ".k.....k.",
        "..kkkkk..",
        ".........",
    ],
    "i_bang": [
        "...kkk...",
        "...kIk...",
        "...kIk...",
        "...kIk...",
        "...kIk...",
        "...kkk...",
        ".........",
        "...kIk...",
        "...kkk...",
    ],
    "i_what": [
        "..kkkkk..",
        ".kk...kk.",
        ".k....kk.",
        ".....kk..",
        "....kk...",
        "....k....",
        ".........",
        "....k....",
        "....k....",
    ],
    "i_skull": [
        "..ZZZZZ..",
        ".ZZZZZZZ.",
        "ZZkkZkkZZ",
        "ZZkkZkkZZ",
        "ZZZZkZZZZ",
        ".ZZZZZZZ.",
        "..ZkZkZ..",
        "..ZZZZZ..",
        ".........",
    ],
    "i_sparkle": [
        "....y....",
        "....y....",
        "...yLy...",
        "yyyLwLyyy",
        "...yLy...",
        "....y....",
        "....y....",
        ".........",
        ".........",
    ],
    "i_soap": [
        "....s.s..",
        "...s.s...",
        ".........",
        ".kkkkkkk.",
        "kRRRRRRRk",
        "kRwRRRRRk",
        "kRRRRRRRk",
        ".kkkkkkk.",
        ".........",
    ],
    "i_tree": [
        "..jjjjj..",
        ".jvvvvvj.",
        "jvvrvvvvj",
        "jvvvvvrvj",
        "jvrvvvvvj",
        ".jvvvvvj.",
        "..jjtjj..",
        "....t....",
        "...ttt...",
    ],
    "i_poison": [
        "....tv...",
        "...tvv...",
        ".kkRtRkk.",
        "kRRIRRRRk",
        "kRwkRkRRk",
        "kRRRkRRRk",
        "kRRkRkRkk",
        ".kRRRRkk.",
        "..kkkkk..",
    ],
    "i_flick": [
        ".....kk..",
        "....kAAk.",
        "....kAAk.",
        "kk..kAAkk",
        "...kAAAAk",
        "kkkkAAAAk",
        "...kAAAk.",
        "kk..kmk..",
        ".....k...",
    ],
    "i_fist": [
        ".kkkkkkk.",
        "kIIkIIkIk",
        "kIIkIIkIk",
        "kIIIIIIIk",
        "kIwIIIIIk",
        ".kIIIIIk.",
        "..kqqqk..",
        "..kqqqk..",
        "...kkk...",
    ],
    # The Cadence's glyphs
    "g_ba": [
        ".........",
        ".kkkkkkk.",
        ".k.....k.",
        ".k.kkk.k.",
        ".k.k.k.k.",
        ".k.kkk.k.",
        ".k.....k.",
        ".kkkkkkk.",
        ".........",
    ],
    "g_li": [
        "....k....",
        "...k.k...",
        "..k...k..",
        ".k..k..k.",
        "k..k.k..k",
        ".k..k..k.",
        "..k...k..",
        "...k.k...",
        "....k....",
    ],
    "g_mo": [
        ".........",
        "k.......k",
        ".k.....k.",
        "..k...k..",
        "...kkk...",
        "...k.k...",
        "..k...k..",
        ".k.....k.",
        "k.......k",
    ],
}

SPRITES.update(ICONS)

UI = {
    "tab_care": [
        "..................",
        ".....AA....AA.....",
        "....AmmA..AmmA....",
        "....AmmmAAmmmA....",
        "....AmmmmmmmmA....",
        ".....AmmmmmmA.....",
        "......AmmmmA......",
        ".......AmmA.......",
        "........AA........",
        "..................",
        ".AA............AA.",
        "A..A..........A..A",
        "A..AA........AA..A",
        "A...AA......AA...A",
        ".A...AAA..AAA...A.",
        "..A....A..A....A..",
        "..AAAAAA..AAAAAA..",
        "..................",
    ],
    "tab_build": [
        "..............R.R.",
        ".............RRRRR",
        "........AA....RRR.",
        ".......AAAA....R..",
        "......AA..AA......",
        ".....AA....AA.....",
        "....AA......AA....",
        "...AA........AA...",
        "..AAAAAAAAAAAAAA..",
        "...AmmmmmmmmmmA...",
        "...AmmmmAAmmmmA...",
        "...AmmmAmmAmmmA...",
        "...AmmmAmmAmmmA...",
        "...AmmmAmmAmmmA...",
        "...AmmmAmmAmmmA...",
        "...AAAAAAAAAAAA...",
        "..................",
        "..................",
    ],
    "tools": [
        "..kkkkk.......kkk...",
        ".khhhhhk.....kgggk..",
        "khhdhhhhk...kgg.kgk.",
        "khdddhhhhk..kg...kgk",
        ".kkdhhhhhk..kg...kgk",
        "...kkhhhhk...kgg.kgk",
        ".....kkhhk....kgggk.",
        ".......kPPk..kgggk..",
        "........kPPk.kggk...",
        ".........kPPkggk....",
        "..........kPPgk.....",
        "........kgkPPk......",
        ".......kggkkPPk.....",
        "......kggk..kPPk....",
        ".....kggk....kPPk...",
        "....kggk......kPPk..",
        "...kgwk........kPPk.",
        "..kgwgk.........kPk.",
        "..kwgk...........k..",
        "...kk...............",
    ],
}
SPRITES.update(UI)



def check() -> None:
    for name, rows in SPRITES.items():
        widths = {len(r) for r in rows}
        assert len(widths) == 1, (name, widths, [len(r) for r in rows])
        for r in rows:
            for ch in r:
                assert ch in PALETTE, (name, ch)


def preview(out: Path, scale: int = 6) -> None:
    from PIL import Image

    out.mkdir(parents=True, exist_ok=True)
    names = list(SPRITES)
    pad = 4
    cols = 6
    cell_w = max(len(SPRITES[n][0]) for n in names) + pad
    cell_h = max(len(SPRITES[n]) for n in names) + pad
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (78, 90, 38))
    for i, n in enumerate(names):
        ox, oy = (i % cols) * cell_w + 2, (i // cols) * cell_h + 2
        for y, row in enumerate(SPRITES[n]):
            for x, ch in enumerate(row):
                c = PALETTE[ch]
                if c:
                    sheet.putpixel((ox + x, oy + y), tuple(int(c[k:k + 2], 16) for k in (1, 3, 5)))
    sheet = sheet.resize((sheet.width * scale, sheet.height * scale), Image.NEAREST)
    sheet.save(out / "sprites.png")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", type=Path)
    a = ap.parse_args()
    check()
    (ROOT / "assets").mkdir(exist_ok=True)
    (ROOT / "assets" / "sprites.json").write_text(
        json.dumps({"palette": PALETTE, "sprites": SPRITES}, separators=(",", ":"))
    )
    if a.preview:
        preview(a.preview)
    print(f"{len(SPRITES)} sprites")


if __name__ == "__main__":
    main()
