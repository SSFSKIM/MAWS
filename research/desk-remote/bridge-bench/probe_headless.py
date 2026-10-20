"""Feasibility: does the bridge come up in `claude -p` stream-json mode? One tiny haiku call."""
import json, os, sys, time
sys.path.insert(0, "/private/tmp/bridge-bench")
from benchlib import *

b = Bench(hooks=True)
print("root", b.root, flush=True)
try:
    b.setup()
    t_start = time.time()
    p = b.headless(stderr_path=os.path.join(OUT, "probe.stderr"))
    out = LineReader(p.stdout, "stdout"); out.start()
    try:
        sid = b.find_session(60)
        t_sock = time.time()
        print("bridge socket after %.2fs: %s" % (t_sock - t_start, sid), flush=True)
        st = lbc.wait_for("status", 20, b.status, every=0.02)
        print("status", {k: st[k] for k in ("pid", "ready", "subscribers")}, "after %.2fs" % (time.time() - t_start))
        sub = Subscriber(b.endpoint, reconnect=False); sub.start()
        lbc.wait_for("snapshot", 10, lambda: sub.lines, every=0.01)
        print("snapshot after %.2fs" % (time.time() - t_start))
    except TimeoutError as e:
        print("NO BRIDGE:", e)
        sub = None
    p.stdin.write(user_line("Say hi in three words.")); p.stdin.flush()
    lbc.wait_for("result", 120, lambda: any(b'"type":"result"' in l for _, l in out.lines), every=0.05)
    time.sleep(1.0)
    if sub:
        s, body = b.ping()
        print("ping idle", s, json.dumps(body)[:300])
    p.stdin.close()
    p.wait(30)
    time.sleep(0.5)
    kinds = {}
    for _, l in out.lines:
        d = json.loads(l)
        k = d["type"] + ("/" + d["event"]["type"] if d["type"] == "stream_event" else "")
        kinds[k] = kinds.get(k, 0) + 1
    print("stdout kinds", kinds)
    if sub:
        sub.close()
        bk = {}
        for _, l, _k in sub.lines:
            d = json.loads(l)
            k = d["type"] + ("/" + str(d.get("phase") or (d.get("chunk") or {}).get("kind") or ""))
            bk[k] = bk.get(k, 0) + 1
        print("bridge kinds", bk)
        with open(os.path.join(OUT, "probe.bridge.ndjson"), "wb") as f:
            for t, l, k in sub.lines:
                f.write(l)
    with open(os.path.join(OUT, "probe.stdout.ndjson"), "wb") as f:
        for t, l in out.lines:
            f.write(l)
finally:
    b.cleanup()
