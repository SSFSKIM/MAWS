"""Runs `sminos bridge` with timing probes: every accept, every POST and its ingest, every
subscriber dequeue. The child's logic is untouched; probes read clocks and keep records.

    python3 bridge_shim.py <scripts dir> bridge --session <id>

Writes JSON lines to $BRIDGE_SHIM_LOG (default /private/tmp/bridge-bench/shim-<pid>.log):
  {"k":"post", acc, t0, i0, i1, t1, n, types, subs, tmin, tsmin, len}   one per POST /events
  {"k":"deq", "rows": [[wall, seq, chunkIndex, t], ...]}                 one per subscription, at its end
"""
import json
import os
import queue
import sys
import threading
import time

scripts = sys.argv[1]
sys.argv = [os.path.join(scripts, "sminos.py")] + sys.argv[2:]
sys.path.insert(0, scripts)

import sminos  # noqa: E402
sys.modules.setdefault("sminos", sminos)
import sminos_bridge as B  # noqa: E402

_log = open(os.environ.get("BRIDGE_SHIM_LOG") or "/private/tmp/bridge-bench/shim-%d.log" % os.getpid(), "a", buffering=1)
_wlock = threading.Lock()


def _write(rec):
    line = json.dumps(rec) + "\n"
    with _wlock:
        _log.write(line)


_write({"k": "start", "pid": os.getpid(), "t": time.time(), "argv": sys.argv[1:]})
_accepts = {}
_tl = threading.local()

_orig_pr = B._Server.process_request


def process_request(self, request, client_address):
    _accepts[id(request)] = time.time()
    return _orig_pr(self, request, client_address)


B._Server.process_request = process_request

_orig_post = B._Handler.do_POST


def do_POST(self):
    t0 = time.time()
    rec = {"k": "post", "path": self.path, "acc": _accepts.pop(id(self.request), None), "t0": t0,
           "len": int(self.headers.get("Content-Length") or 0)}
    _tl.rec = rec
    try:
        _orig_post(self)
    finally:
        _tl.rec = None
        rec["t1"] = time.time()
        _write(rec)


B._Handler.do_POST = do_POST

_orig_get = B._Handler.do_GET


def do_GET(self):
    t0 = time.time()
    acc = _accepts.pop(id(self.request), None)
    if self.path.startswith("/events"):
        _write({"k": "sub", "acc": acc, "t0": t0})
    return _orig_get(self)


B._Handler.do_GET = do_GET

_orig_ingest = B.Bridge.ingest


def ingest(self, events):
    i0 = time.time()
    _orig_ingest(self, events)
    i1 = time.time()
    rec = getattr(_tl, "rec", None)
    if rec is None or rec.get("path") != "/events":   # the child's own `command` event (POST /command)
        return
    types = {}
    tmin = tsmin = smin = smax = None
    for e in events:
        sq = e.get("seq")
        if isinstance(sq, int):
            smin = sq if smin is None else min(smin, sq)
            smax = sq if smax is None else max(smax, sq)
        k = e.get("type")
        types[k] = types.get(k, 0) + 1
        t = e.get("t")
        if isinstance(t, (int, float)):
            tmin = t if tmin is None else min(tmin, t)
        ts = e.get("ts")
        if isinstance(ts, float):
            tsmin = ts if tsmin is None else min(tsmin, ts)
    rec.update({"i0": i0, "i1": i1, "n": len(events), "types": types, "subs": len(self.subscribers),
                "tmin": tmin, "tsmin": tsmin, "smin": smin, "smax": smax})


B.Bridge.ingest = ingest


class _TimedQueue(queue.Queue):
    def __init__(self, maxsize):
        super().__init__(maxsize)
        self.rows = []

    def get(self, *a, **kw):
        e = super().get(*a, **kw)
        if e is not None:
            self.rows.append((time.time(), e.get("seq"), e.get("chunkIndex"), e.get("t"), e.get("type")))
        return e


def subscribe(self):
    q = _TimedQueue(B.SUBSCRIBER_BACKLOG)
    q.cut = False
    t0 = time.time()
    with self.lock:
        snap = self.snapshot()
        self.subscribers.add(q)
    _write({"k": "subscribed", "t0": t0, "t1": time.time(), "streaming": len(snap.get("streaming") or [])})
    return snap, q


B.Bridge.subscribe = subscribe

_orig_unsubscribe = B.Bridge.unsubscribe


def unsubscribe(self, q):
    _orig_unsubscribe(self, q)
    rows = getattr(q, "rows", None)
    if rows:
        _write({"k": "deq", "rows": rows})


B.Bridge.unsubscribe = unsubscribe

sminos.main()
