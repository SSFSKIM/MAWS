"""A subscriber process: GET /events on a bridge socket, stamp each line on arrival,
stop at the {"type":"bench-end"} event (or EOF), then write one JSON summary file.

    python3 sub_proc.py <socket> <out.json>
"""
import http.client
import json
import socket
import sys
import time

path, out = sys.argv[1], sys.argv[2]


class Conn(http.client.HTTPConnection):
    def __init__(self, p):
        super().__init__("bridge", timeout=None)
        self.p = p

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self.p)


t_connect = time.time()
c = Conn(path)
c.request("GET", "/events")
r = c.getresponse()
lines = []
snap_at = None
snap_len = 0
ended = "eof"
first = True
while True:
    line = r.readline()
    now = time.time()
    if not line:
        break
    if first:
        snap_at, snap_len, first = now, len(line), False
        sys.stdout.write("ready\n")
        sys.stdout.flush()
        continue
    if b'"bench-end"' in line:
        ended = "end"
        break
    lines.append((now, line))
res = {"connect": t_connect, "snap_at": snap_at, "snap_len": snap_len, "ended": ended, "lat": [], "arr": [],
       "seq": [], "types": {}}
for now, line in lines:
    e = json.loads(line)
    ts = e.get("ts")
    res["types"][e.get("type")] = res["types"].get(e.get("type"), 0) + 1
    if ts is not None:
        res["lat"].append((now - ts) * 1000.0)
        res["arr"].append(now)
        res["seq"].append(e.get("seq"))
with open(out, "w") as f:
    json.dump(res, f)
