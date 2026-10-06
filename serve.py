"""Serve the Cadlets webapp locally:  python3 serve.py [port] [--no-browser] [--root DIR]

A plain static server with the WebAssembly MIME type Pyodide needs. It applies the site's
``_headers`` file the way Cloudflare does (security headers, cache rules), so a local run
matches the deployed site; anything that file does not cache is sent with ``no-cache``, so edits
show up on reload. ``--root dist`` serves the folder ``tools/build_site.py`` builds for deployment.
Nothing else is required: the brain (Pyodide, NumPy and the Cadence library) is vendored and runs
in the browser.
"""

from __future__ import annotations

import http.server
import re
import socketserver
import sys
import webbrowser
from functools import partial
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent


def header_rules(root: Path) -> list[tuple[re.Pattern, list[tuple[str, str]]]]:
    """The rules of ``root/_headers``: a URL pattern line, then indented ``Name: value`` lines."""
    rules: list[tuple[re.Pattern, list[tuple[str, str]]]] = []
    path = root / "_headers"
    if not path.exists():
        return rules
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if not raw[0].isspace():  # a new URL pattern; * matches anything
            rules.append((re.compile("^" + ".*".join(map(re.escape, line.split("*"))) + "$"), []))
        elif rules and ":" in line:
            name, value = line.split(":", 1)
            rules[-1][1].append((name.strip(), value.strip()))
    return rules


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".json": "application/json",
        ".whl": "application/zip",
        ".woff2": "font/woff2",
    }

    def end_headers(self) -> None:
        path = urlsplit(self.path).path
        combined: dict[str, list[str]] = {}
        for pattern, headers in header_rules(Path(self.directory)):
            if pattern.match(path):
                for name, value in headers:
                    combined.setdefault(name, []).append(value)
        combined.setdefault("Cache-Control", ["no-cache"])
        for name, values in combined.items():
            self.send_header(name, ", ".join(values))
        super().end_headers()

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        page = Path(self.directory) / "404.html"
        if code != 404 or not page.exists():
            return super().send_error(code, message, explain)
        body = page.read_bytes()  # the site's own 404 page, as Cloudflare serves it
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # quiet
        if args and str(args[1]) not in ("200", "304"):
            super().log_message(format, *args)


def main() -> None:
    args = sys.argv[1:]
    root = ROOT
    if "--root" in args:
        i = args.index("--root")
        root = (ROOT / args[i + 1]).resolve()
        del args[i : i + 2]
    port = int(args[0]) if args and args[0].isdigit() else 8642
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", port), partial(Handler, directory=str(root))) as httpd:
        url = f"http://localhost:{port}/"
        print(f"Cadlets: {url}  serving {root.name}/  (Ctrl+C to stop)")
        if "--no-browser" not in args:
            webbrowser.open(url)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
