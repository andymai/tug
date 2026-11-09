import html
import http.server
import os
import urllib.parse
import re
import sys
import threading
import time

SIZE = 32 << 20
RATE = 1 << 20
CHUNK = 64 << 10
LOG = os.environ.get("SLOW_SERVER_LOG")
lock = threading.Lock()
next_at = [time.monotonic()]


def pace(n):
    with lock:
        now = time.monotonic()
        start = max(now, next_at[0])
        next_at[0] = start + n / RATE
    if start > now:
        time.sleep(start - now)


class Slow(http.server.BaseHTTPRequestHandler):
    def send_range(self, body):
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        if "status" in query:
            self.send_error(int(query["status"][0]))
            return
        size = int(query.get("size", [SIZE])[0])
        if LOG:
            fields = [self.path] + [self.headers.get(h, "") for h in ("Cookie", "Referer", "User-Agent", "Sec-Fetch-Mode")]
            with lock, open(LOG, "a") as log:
                log.write("\t".join(fields) + "\n")
        start, end = 0, size - 1
        match = re.match(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
        if match:
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else size - 1
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Content-Type", "application/octet-stream")
        self.end_headers()
        if not body:
            return
        left = end - start + 1
        while left > 0:
            n = min(CHUNK, left)
            pace(n)
            self.wfile.write(b"\0" * n)
            left -= n

    def do_HEAD(self):
        self.send_range(False)

    def do_GET(self):
        page = urllib.parse.urlsplit(self.path)
        if page.path.endswith(".html"):
            name = urllib.parse.parse_qs(page.query).get("file", ["captured.bin"])[0]
            body = f'<!doctype html><a id="file" href="/{html.escape(name)}">{html.escape(name)}</a>'.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        try:
            self.send_range(True)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Slow).serve_forever()
