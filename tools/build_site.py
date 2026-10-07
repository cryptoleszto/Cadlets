"""Build the deployable site into dist/ and check it:  python3 tools/build_site.py

Cloudflare runs this on every push (build command ``python3 tools/build_site.py``; wrangler.jsonc
publishes ``dist``); it needs nothing beyond the Python standard library. Only what the browser loads is
copied: the pages, css/, js/, assets/, py/cadlets.py, vendor/ (with the Cadence licence and the
wasm32 patch), site.json and _headers, plus _redirects when that file exists (the hard maintenance
block). The tools, README and local server stay out.

The deployed site.json gets a "build": a fingerprint of every other file in the build. A game that
has been open a while compares it with the one it loaded, and offers to reload when a new version
is live (js/main.js). Changing only site.json (the maintenance switch) keeps the fingerprint.

The build fails (exit 1) if a file is over Cloudflare's 25 MiB limit, if there are more files than
it allows, or if a page, stylesheet or script refers to a local file that is not in the build.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
SITE = ["index.html", "play.html", "404.html", "favicon.ico", "site.json", "_headers",
        "css", "js", "assets", "py/cadlets.py", "vendor"]
OPTIONAL = ["_redirects"]  # present only while the hard maintenance block is on
SKIP = {".DS_Store", "__pycache__"}
MAX_FILE = 25 * 1024 * 1024  # Cloudflare static assets: largest file
MAX_FILES = 20_000  # Cloudflare static assets (free plan): files per deployment

# Local references, and what each resolves against as the browser does it: pages and stylesheets
# against their own folder, a module's imports against the module, its fetch() and new Worker()
# against the page (both pages are at the top), and everything in the worker against the worker.
REFS = {
    ".html": [(re.compile(r'(?:href|src)="([^"#?]+)"'), "self")],
    ".css": [(re.compile(r'url\(([^)\'"]+)\)'), "self")],
    ".js": [(re.compile(r'import\s[^;]*?from\s+"([^"]+)"'), "self"),
            (re.compile(r'(?:fetch|importScripts|new Worker)\(\s*"([^"]+)"|indexURL:\s*"([^"]+)"'), "page")],
}
WORKERS = {"js/worker.js"}  # a worker's fetches resolve against the worker itself


def copy(rel: str) -> None:
    src, dst = ROOT / rel, DIST / rel
    if src.is_dir():
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns(*SKIP))
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def problems() -> list[str]:
    out = []
    files = [p for p in DIST.rglob("*") if p.is_file()]
    if len(files) > MAX_FILES:
        out.append(f"{len(files)} files, more than Cloudflare's {MAX_FILES}")
    for p in files:
        if p.stat().st_size > MAX_FILE:
            out.append(f"{p.relative_to(DIST)} is {p.stat().st_size / 2**20:.1f} MiB, over Cloudflare's 25 MiB")
        rel = p.relative_to(DIST).as_posix()
        text = p.read_text(encoding="utf-8") if p.suffix in REFS else ""
        for pattern, against in REFS.get(p.suffix, []):
            for match in pattern.finditer(text):
                ref = next(g for g in match.groups() if g)
                if re.match(r"^(?:[a-z]+:|//|data:)", ref) or "${" in ref:
                    continue  # another site, mailto:, a data URL, or built at run time
                base = p.parent if against == "self" or rel in WORKERS else DIST
                target = ((DIST if ref.startswith("/") else base) / ref.lstrip("/")).resolve()
                if target != DIST.resolve() and not target.exists():
                    out.append(f"{rel} refers to {ref}, which is not in the build")
    return out


def fingerprint() -> str:
    """A short hash of every file in the build except site.json (paths and contents)."""
    h = hashlib.sha256()
    for p in sorted(q for q in DIST.rglob("*") if q.is_file() and q.name != "site.json"):
        h.update(p.relative_to(DIST).as_posix().encode() + b"\0" + p.read_bytes() + b"\0")
    return h.hexdigest()[:12]


def main() -> int:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    for rel in SITE:
        copy(rel)
    for rel in OPTIONAL:
        if (ROOT / rel).exists():
            copy(rel)
            print(f"note: {rel} is included (the hard maintenance block is ON)")
    site = DIST / "site.json"
    data = json.loads(site.read_text(encoding="utf-8"))
    data["build"] = fingerprint()
    site.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    files = [p for p in DIST.rglob("*") if p.is_file()]
    size = sum(p.stat().st_size for p in files)
    print(f"dist/: {len(files)} files, {size / 2**20:.1f} MiB, build {data['build']}")
    bad = problems()
    for line in bad:
        print("error:", line)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
