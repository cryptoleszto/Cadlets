"""Serve the Cadlets webapp locally:  python3 serve.py [port]

A plain static server with no-cache headers (so edits show up on reload) and the
WebAssembly MIME type Pyodide needs. Nothing else is required: the brain (Pyodide,
NumPy and the Cadence library) is vendored and runs in the browser.
"""

import http.server
import socketserver
import sys
import webbrowser
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".json": "application/json",
        ".whl": "application/zip",
    }

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format: str, *args: object) -> None:  # quiet
        if args and str(args[1]) not in ("200", "304"):
            super().log_message(format, *args)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT))) as httpd:
        url = f"http://localhost:{port}/"
        print(f"Cadlets: {url}  (Ctrl+C to stop)")
        if "--no-browser" not in sys.argv:
            webbrowser.open(url)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
