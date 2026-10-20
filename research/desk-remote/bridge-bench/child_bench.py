"""The bridge child's ceiling, with no model calls: run `sminos bridge` standalone, act as the mod
(take its hello's nonce, resync, then post synthetic chunk batches the way bridge-stream.tsx's
poster does: one POST in flight, up to BATCH_MAX events each), and attach 1, 5, 20 subscriber
processes. Measures produce->arrival latency, throughput, batch sizes, child CPU, backlog cut-offs.

    python3 child_bench.py [--quick]
"""
import collections
import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid

sys.path.insert(0, "/private/tmp/bridge-bench")
from benchlib import PLUGIN, OUT, stats, summary, cpu_seconds, clean_path  # noqa: E402

SCRIPTS = os.path.join(PLUGIN, "skills/sminos/scripts")
BATCH_MAX = 500
TEXT = "the keeper climbed the stair "   # ~a haiku text delta (14-40 chars live)


class UConn(http.client.HTTPConnection):
    def __init__(self, p, timeout=30):
        super().__init__("bridge", timeout=timeout)
        self.p = p

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.p)


def post(path, nonce, body):
    c = UConn(path)
    try:
        c.request("POST", "/events", body=body, headers={"content-type": "application/json", "X-Bridge-Nonce": nonce})
        r = c.getresponse()
        r.read()
        return r.status
    finally:
        c.close()


class Child:
    def __init__(self, shim=True):
        self.root = tempfile.mkdtemp(prefix="brc.", dir="/tmp")
        self.env = {"PATH": clean_path(), "HOME": os.path.join(self.root, "home"),
                    "SMINOS_HOME": os.path.join(self.root, "s"),
                    "CLAUDE_CONFIG_DIR": os.path.join(self.root, "home", ".claude"),
                    "BRIDGE_SHIM_LOG": os.path.join(OUT, "child-shim.log")}
        for d in (self.env["CLAUDE_CONFIG_DIR"], self.env["SMINOS_HOME"]):
            os.makedirs(d, mode=0o700)
        self.session = str(uuid.uuid4())
        self.shim = shim
        self.env["PYTHONDONTWRITEBYTECODE"] = "1"
        argv = (["python3", "/private/tmp/bridge-bench/bridge_shim.py", SCRIPTS] if shim
                else ["python3", os.path.join(SCRIPTS, "sminos.py")]) + ["bridge", "--session", self.session]
        t0 = time.time()
        self.p = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=self.env)
        hello = json.loads(self.p.stdout.readline())
        self.hello_after = time.time() - t0
        self.sock, self.nonce = hello["socket"], hello["nonce"]
        self.pid = hello["pid"]
        t1 = time.time()
        st = post(self.sock, self.nonce, json.dumps([
            {"type": "session", "phase": "start", "session": self.session, "cwd": "/tmp", "t": int(time.time() * 1000)},
            {"type": "resync", "turns": [], "streaming": [], "agents": [], "pending": [], "settled": [], "override": None,
             "delivered": {}, "refused": [], "cut": {"main": None}, "t": int(time.time() * 1000)}]))
        self.resync_rtt = time.time() - t1
        assert st == 204, st

    def stop(self):
        self.p.terminate()
        try:
            self.p.wait(5)
        except subprocess.TimeoutExpired:
            self.p.kill()


class Poster(threading.Thread):
    """The mod's poster: one POST in flight, the queue's head up to BATCH_MAX each."""

    def __init__(self, child):
        super().__init__(daemon=True)
        self.child = child
        self.q = collections.deque()
        self.cv = threading.Condition()
        self.batches = []     # (start, end, size, bytes)
        self.stopping = False

    def put(self, events):
        with self.cv:
            self.q.extend(events)
            self.cv.notify()

    def run(self):
        while True:
            with self.cv:
                while not self.q and not self.stopping:
                    self.cv.wait()
                if not self.q and self.stopping:
                    return
                batch = [self.q.popleft() for _ in range(min(BATCH_MAX, len(self.q)))]
            body = json.dumps(batch)
            t0 = time.time()
            st = post(self.child.sock, self.child.nonce, body)
            self.batches.append((t0, time.time(), len(batch), len(body)))
            assert st == 204, st


def chunk_events(turn, step, start, n, now):
    return [{"type": "chunk", "turnId": turn, "agentId": None, "step": step, "chunkIndex": start + i,
             "chunk": {"kind": "text", "index": 0, "text": TEXT, "ref": 3}, "t": int(now * 1000), "ts": now,
             "seq": start + i} for i in range(n)]


SHIM_LOG = os.path.join(OUT, "child-shim.log")


def shim_records(offset):
    recs = []
    if not os.path.exists(SHIM_LOG):
        return recs
    with open(SHIM_LOG) as f:
        f.seek(offset)
        for line in f:
            try:
                recs.append(json.loads(line))
            except ValueError:
                pass
    return recs


def segments(recs, sub_results):
    """Per event: produce->accept, accept->ingest start, ingest (batch), ingest start->dequeue, dequeue->arrival."""
    import bisect
    posts = sorted([r for r in recs if r["k"] == "post" and r.get("smin") is not None], key=lambda r: r["smin"])
    starts = [r["smin"] for r in posts]
    deq = collections.defaultdict(list)
    for r in recs:
        if r["k"] == "deq":
            for row in r["rows"]:
                if row[1] is not None:
                    deq[row[1]].append(row[0])
    A, B, C, D, E = [], [], [], [], []
    for res in sub_results:
        for arr, lat, sq in zip(res["arr"], res["lat"], res["seq"]):
            k = bisect.bisect_right(starts, sq) - 1
            if k < 0 or not (posts[k]["smin"] <= sq <= posts[k]["smax"]):
                continue
            pr = posts[k]
            ts = arr - lat / 1000.0
            if pr.get("acc") is None or pr.get("i0") is None:
                continue
            A.append((pr["acc"] - ts) * 1000)
            B.append((pr["i0"] - pr["acc"]) * 1000)
            C.append((pr["i1"] - pr["i0"]) * 1000)
            ds = deq.get(sq) or []
            if ds:
                d = min(ds, key=lambda x: abs(x - arr))   # the dequeue nearest this arrival
                D.append((d - pr["i0"]) * 1000)
                E.append((arr - d) * 1000)
    return {"produce_to_accept": stats(A), "accept_to_ingest": stats(B), "ingest_batch": stats(C),
            "ingest_to_dequeue": stats(D), "dequeue_to_arrival": stats(E)}


def scenario(child, nsubs, rate, seconds, tag):
    offset = os.path.getsize(SHIM_LOG) if os.path.exists(SHIM_LOG) else 0
    subs = []
    for i in range(nsubs):
        out = os.path.join(OUT, "child-sub-%s-%d.json" % (tag, i))
        sp = subprocess.Popen(["python3", "/private/tmp/bridge-bench/sub_proc.py", child.sock, out],
                              stdout=subprocess.PIPE)
        subs.append((sp, out))
    for sp, _ in subs:
        assert sp.stdout.readline().strip() == b"ready"
    turn = str(uuid.uuid4())
    poster = Poster(child)
    poster.start()
    now = time.time()
    poster.put([{"type": "turn", "phase": "start", "turnId": turn, "agentId": None, "t": int(now * 1000)},
                {"type": "step", "phase": "start", "turnId": turn, "agentId": None, "step": 0, "model": "m",
                 "t": int(now * 1000)}])
    cpu0, w0 = cpu_seconds(child.pid), time.time()
    seq = 0
    t_end = time.time() + seconds
    if rate == "max":
        # Keep the poster's queue topped up so every post is a full batch.
        while time.time() < t_end:
            with poster.cv:
                backlog = len(poster.q)
            if backlog < 4 * BATCH_MAX:
                now = time.time()
                poster.put(chunk_events(turn, 0, seq, BATCH_MAX, now))
                seq += BATCH_MAX
            else:
                time.sleep(0.0005)
    else:
        tick = 0.001
        due = time.time()
        carry = 0.0
        while time.time() < t_end:
            now = time.time()
            if now < due:
                time.sleep(due - now)
                now = time.time()
            carry += rate * tick
            k = int(carry)
            carry -= k
            if k:
                poster.put(chunk_events(turn, 0, seq, k, now))
                seq += k
            due += tick
    produced_until = time.time()
    poster.put([{"type": "bench-end", "t": int(time.time() * 1000)}])
    with poster.cv:
        poster.stopping = True
        poster.cv.notify()
    poster.join(60)
    drained = time.time()
    for sp, _ in subs:
        sp.wait(120)
    cpu1, w1 = cpu_seconds(child.pid), time.time()
    lat, ends, got, subres = [], collections.Counter(), [], []
    for _, out in subs:
        with open(out) as f:
            r = json.load(f)
        lat += r["lat"]
        ends[r["ended"]] += 1
        got.append(len(r["lat"]))
        subres.append(r)
        os.unlink(out)
    # One more event, so every writer whose reader left finds out, and its dequeue record is written.
    post(child.sock, child.nonce, json.dumps([{"type": "flush", "t": int(time.time() * 1000)}]))
    time.sleep(0.3)
    seg = segments(shim_records(offset), subres) if child.shim else None
    sizes = [b[2] for b in poster.batches]
    rtts = [(b[1] - b[0]) * 1000 for b in poster.batches]
    res = {"tag": tag, "subs": nsubs, "rate": rate, "seconds": seconds, "produced": seq,
           "achieved_in_rate": seq / max(1e-9, produced_until - (t_end - seconds)),
           "drain_after_s": drained - produced_until,
           "delivered_per_sub": got, "ends": dict(ends), "lat_ms": stats(lat),
           "batch_size": stats(sizes), "post_rtt_ms": stats(rtts), "posts": len(sizes),
           "child_cpu_s": (cpu1 - cpu0) if cpu0 is not None and cpu1 is not None else None,
           "wall_s": w1 - w0, "segments": seg, "load": os.getloadavg()}
    res["child_cpu_pct"] = 100.0 * res["child_cpu_s"] / res["wall_s"] if res["child_cpu_s"] is not None else None
    # End the step so the next scenario starts a fresh message.
    post(child.sock, child.nonce, json.dumps([
        {"type": "step", "phase": "end", "turnId": turn, "agentId": None, "step": 0, "t": int(time.time() * 1000)},
        {"type": "turn", "phase": "complete", "turnId": turn, "agentId": None, "t": int(time.time() * 1000)}]))
    print("%-14s subs=%-2d rate=%-5s in=%7.0f ev/s posts=%-5d batch p50=%5.0f max=%4.0f  lat %s  cpu=%s%%  ends=%s drain=%.2fs" % (
        tag, nsubs, rate, res["achieved_in_rate"], res["posts"], res["batch_size"].get("p50", 0),
        res["batch_size"].get("max", 0), summary(lat), "%.0f" % res["child_cpu_pct"] if res["child_cpu_pct"] is not None else "?",
        dict(ends), res["drain_after_s"]), flush=True)
    if seg:
        print("    segments p50/p95/p99: " + "  ".join("%s=%.2f/%.2f/%.2f" % (k, v.get("p50", 0), v.get("p95", 0), v.get("p99", 0))
                                                for k, v in seg.items() if v.get("n")), flush=True)
    return res


def single_post_rtt(child, n=300):
    """An idle round trip for one event, one subscriber attached: POST start -> subscriber arrival."""
    out = os.path.join(OUT, "child-sub-rtt.json")
    sp = subprocess.Popen(["python3", "/private/tmp/bridge-bench/sub_proc.py", child.sock, out], stdout=subprocess.PIPE)
    assert sp.stdout.readline().strip() == b"ready"
    turn = str(uuid.uuid4())
    post(child.sock, child.nonce, json.dumps([{"type": "step", "phase": "start", "turnId": turn, "agentId": None,
                                                "step": 0, "model": "m", "t": int(time.time() * 1000)}]))
    rtt = []
    for i in range(n):
        now = time.time()
        post(child.sock, child.nonce, json.dumps(chunk_events(turn, 0, i, 1, now)))
        rtt.append((time.time() - now) * 1000)
        time.sleep(0.01)
    post(child.sock, child.nonce, json.dumps([{"type": "bench-end", "t": 0}]))
    sp.wait(30)
    with open(out) as f:
        r = json.load(f)
    os.unlink(out)
    print("idle single-event: POST rtt %s | produce->arrival %s" % (summary(rtt), summary(r["lat"])), flush=True)
    return {"post_rtt_ms": stats(rtt), "lat_ms": stats(r["lat"])}


def main():
    quick = "--quick" in sys.argv
    shim = "--noshim" not in sys.argv
    try:
        os.unlink(os.path.join(OUT, "child-shim.log"))
    except FileNotFoundError:
        pass
    results = {"runs": []}
    starts = []
    for _ in range(5):
        c = Child(shim=False)
        starts.append(c.hello_after * 1000)
        c.stop()
    print("child spawn->hello: %s" % summary(starts))
    results["spawn_to_hello_ms"] = stats(starts)
    child = Child(shim=shim)
    print("child pid %s, first resync rtt %.1f ms" % (child.pid, child.resync_rtt * 1000), flush=True)
    try:
        results["idle"] = single_post_rtt(child)
        secs = 3 if quick else 5
        reps = int(os.environ.get("REPS", "1"))
        rates = [r if r == "max" else int(r) for r in os.environ.get("RATES", "100,500,1000,3000,10000,max").split(",")]
        for rep in range(reps):
            for nsubs in [int(x) for x in os.environ.get("SUBS", "1,5,20").split(",")]:
                for rate in rates:
                    results["runs"].append(scenario(child, nsubs, rate, secs, "s%d-r%s-%d" % (nsubs, rate, rep)))
    finally:
        child.stop()
    with open(os.path.join(OUT, os.environ.get("RESULT", "child_bench.json")), "w") as f:
        json.dump(results, f, indent=1)


if __name__ == "__main__":
    main()
