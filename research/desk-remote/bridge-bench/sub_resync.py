"""A subscriber that measures one resync: snapshot, events until the stream ends, an immediate
re-subscribe, the new snapshot, and the first event after it.

    python3 sub_resync.py <socket> <out.json>
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


def subscribe():
    t0 = time.time()
    c = Conn(path)
    c.request("GET", "/events")
    r = c.getresponse()
    line = r.readline()
    return c, r, t0, time.time(), len(line)


res = {}
c, r, t0, t1, n = subscribe()
res["first_snapshot"] = {"connect": t0, "at": t1, "bytes": n}
sys.stdout.write("ready\n")
sys.stdout.flush()
events = 0
while True:
    line = r.readline()
    if not line:
        break
    events += 1
res["eof_at"] = time.time()
res["events_before_eof"] = events
c.close()
c, r, t0, t1, n = subscribe()
res["second_snapshot"] = {"connect": t0, "at": t1, "bytes": n}
line = r.readline()
res["first_event_at"] = time.time()
res["first_event"] = json.loads(line).get("type") if line else None
c.close()
with open(out, "w") as f:
    json.dump(res, f)
