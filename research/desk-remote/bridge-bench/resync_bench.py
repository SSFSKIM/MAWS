"""What a resync costs a subscriber, standalone (no model): the child holds S characters of
streaming text over 5 messages, the 'mod' posts a gap + resync (what `lose` queues), and 1/5/20
subscribers each re-subscribe at once. Also: the snapshot's build time under the child's lock.

    PYTHONDONTWRITEBYTECODE=1 python3 resync_bench.py
"""
import json
import os
import subprocess
import sys
import time
import uuid

sys.path.insert(0, "/private/tmp/bridge-bench")
from benchlib import OUT, stats, summary  # noqa
from child_bench import Child, post  # noqa

MSGS = 5


def state(turn, size):
    """A resync whose streaming state is MSGS messages of size/MSGS characters each."""
    per = max(1, size // MSGS)
    streaming = [{"turnId": turn, "agentId": "a%d" % i, "step": 0, "model": "m", "upTo": 100,
                  "blocks": [{"index": 0, "kind": "text", "text": "x" * per, "upTo": 100}], "settled": []}
                 for i in range(MSGS)]
    return {"type": "resync", "turns": [{"turnId": turn, "agentId": None, "t": 0}], "streaming": streaming,
            "agents": [{"agentId": "a%d" % i, "running": True} for i in range(MSGS)], "pending": [], "settled": [],
            "override": None, "delivered": {}, "refused": [], "cut": {"main": None}, "t": int(time.time() * 1000)}


def run(child, nsubs, size):
    turn = str(uuid.uuid4())
    body = json.dumps([state(turn, size)])
    assert post(child.sock, child.nonce, body) == 204   # first: the child holds this state (ends any subscriber)
    subs = []
    for i in range(nsubs):
        out = os.path.join(OUT, "resync-sub-%d.json" % i)
        sp = subprocess.Popen(["python3", "/private/tmp/bridge-bench/sub_resync.py", child.sock, out],
                              stdout=subprocess.PIPE)
        subs.append((sp, out))
    for sp, _ in subs:
        assert sp.stdout.readline().strip() == b"ready"
    time.sleep(0.2)
    body = json.dumps([{"type": "gap", "dropped": 3, "t": int(time.time() * 1000)}, state(turn, size)])
    t0 = time.time()
    assert post(child.sock, child.nonce, body) == 204
    t_post = time.time() - t0
    time.sleep(0.3)
    # One event after the resync, which each re-subscribed reader takes as its first.
    post(child.sock, child.nonce, json.dumps([{"type": "heartbeat", "t": int(time.time() * 1000)}]))
    rs = []
    for sp, out in subs:
        sp.wait(60)
        with open(out) as f:
            rs.append(json.load(f))
        os.unlink(out)
    eof = [(r["eof_at"] - t0) * 1000 for r in rs]
    snap = [(r["second_snapshot"]["at"] - t0) * 1000 for r in rs]
    snapwait = [(r["second_snapshot"]["at"] - r["second_snapshot"]["connect"]) * 1000 for r in rs]
    res = {"subs": nsubs, "size": size, "resync_body": len(body), "post_ms": t_post * 1000,
           "snapshot_bytes": rs[0]["second_snapshot"]["bytes"], "eof_ms": stats(eof), "resnap_ms": stats(snap),
           "connect_to_snapshot_ms": stats(snapwait)}
    print("subs=%-2d text=%8d resync body=%8d B post=%7.1f ms | stream end p50 %7.1f max %7.1f | new snapshot "
          "(%d B) p50 %7.1f max %7.1f ms after the resync; connect->snapshot p50 %6.1f max %6.1f" % (
              nsubs, size, len(body), t_post * 1000, res["eof_ms"]["p50"], res["eof_ms"]["max"], res["snapshot_bytes"],
              res["resnap_ms"]["p50"], res["resnap_ms"]["max"], res["connect_to_snapshot_ms"]["p50"],
              res["connect_to_snapshot_ms"]["max"]), flush=True)
    return res


def main():
    child = Child(shim=False)
    out = []
    try:
        for size in (10_000, 100_000, 1_000_000, 4_000_000):
            for nsubs in (1, 5, 20):
                out.append(run(child, nsubs, size))
    finally:
        child.stop()
    with open(os.path.join(OUT, "resync_bench.json"), "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
