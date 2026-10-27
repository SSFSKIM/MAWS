"""The plane's open of one bridged session, timed phase by phase, as sminos_plane.Plane.subscribe
builds it (BridgeReader started, then the Subscription), pumped the way the uplink pumps it.

    PYTHONDONTWRITEBYTECODE=1 python3 plane_open.py <session> <out.json> [uplink|tight] [hold_s]

Run with the isolated env (HOME, SMINOS_HOME, CLAUDE_CONFIG_DIR). `uplink`: pump on a wake or every
POLL (0.25 s), like serve_link with no hub POSTs and no other work in the tick; `tight`: every 1 ms.
After the snapshot it keeps pumping `hold_s` seconds and stamps each chunk message's emission.
"""
import json
import os
import sys
import threading
import time

SCRIPTS = "/Users/new/.claude/plugins/cache/doperpowers/sminos/1.1.1/skills/sminos/scripts"
sys.path.insert(0, SCRIPTS)
import sminos as S  # noqa: E402
import sminos_bridge as B  # noqa: E402
import sminos_plane as P  # noqa: E402

sid, out_path = sys.argv[1], sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else "uplink"
hold = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
T0 = time.monotonic()
W0 = time.time()
tl = []   # (monotonic offset s, what, detail)


def mark(what, detail=None):
    tl.append((time.monotonic() - T0, what, detail))


def wrap(obj, name, label, detail=None):
    orig = getattr(obj, name)

    def f(*a, **kw):
        mark(label + ":start")
        r = orig(*a, **kw)
        mark(label + ":end", detail(r) if detail else None)
        return r
    setattr(obj, name, f)


_orig_put = P.BridgeReader.put
puts = [0]


def put(self, item):
    puts[0] += 1
    if puts[0] <= 3 or item[0] != "line":
        mark("reader:" + item[0], item[1].get("type") if item[0] == "line" and isinstance(item[1], dict) else str(item[1])[:80])
    _orig_put(self, item)


P.BridgeReader.put = put
_orig_stream = P.BridgeReader.stream


def stream(self, conn):
    mark("reader:connect")
    return _orig_stream(self, conn)


P.BridgeReader.stream = stream
wrap(P, "build", "build", lambda r: r[0])
wrap(P, "look", "look")
wrap(S, "transcript_now", "locate", lambda r: bool(r))
wrap(P.Subscription, "derive", "derive")
logged = []
P.log = lambda line: (logged.append(line), mark("log", line))

woken = threading.Event()


def wake():
    woken.set()


heavy = sys.argv[5] if len(sys.argv) > 5 else None
if heavy:
    # Another open's build in this same process (read-only): the big transcript indexed, its rows read,
    # its disk facts looked at, on a worker thread, as the daemon would for a concurrent open.
    def heavy_open():
        mark("heavy:start")
        c0 = time.thread_time()
        ht = P.Transcript(heavy)
        P.build(ht, None, False)
        P.look(P.Disk(), heavy, None, {}, ())
        mark("heavy:end", "cpu %.2f s" % (time.thread_time() - c0))
    threading.Thread(target=heavy_open, daemon=True).start()
    time.sleep(0.05)
reader = P.BridgeReader(B.endpoint(sid), wake)
reader.start()
mark("reader:started")
sub = P.Subscription("bench", "bench", sid, None, "bench-sub", reader=reader,
                     locate=lambda: S.transcript_now(sid),
                     presence=lambda: {"record": None, "bridge": True}, alive=lambda: True,
                     transcripts=P.Transcripts(), wake=wake, disk=P.Disk())
mark("subscription:opened")
msgs = []
pumps = 0
deadline = time.monotonic() + 30
snap_at = None
while time.monotonic() < deadline:
    if mode == "tight":
        time.sleep(0.001)
    else:
        woken.wait(0.25)
        woken.clear()
    pumps += 1
    out = sub.pump()
    now_w = time.time()
    for m in out:
        body = m.get("body") or {}
        rec = {"kind": m["kind"], "n": m["n"], "w": now_w}
        if m["kind"] == "snapshot":
            rec["bytes"] = len(json.dumps(m))
            rec["rows"] = len(body.get("rows") or [])
            rec["streaming"] = len(body.get("streaming") or [])
            snap_at = time.monotonic()
            mark("snapshot:out", rec["bytes"])
        if m["kind"] == "chunk" and isinstance(body.get("t"), (int, float)):
            rec["lag_ms"] = now_w * 1000 - body["t"]
        msgs.append(rec)
    if sub.ended:
        mark("ended")
        break
    if snap_at is not None and time.monotonic() - snap_at >= hold:
        break
sub.close()
res = {"session": sid, "mode": mode, "wall0": W0, "pumps": pumps, "timeline": tl, "log": logged,
       "messages": msgs, "load": os.getloadavg(),
       "transcript_bytes": os.path.getsize(sub.main) if sub.main and os.path.exists(sub.main) else None}
with open(out_path, "w") as f:
    json.dump(res, f, indent=1)
print("\n".join(logged))
