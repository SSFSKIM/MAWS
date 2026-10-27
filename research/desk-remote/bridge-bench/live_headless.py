"""Live bridge latency in one headless session (`claude -p` stream-json in/out, partial messages).

Every main-loop text delta is seen twice on this process's clock: on the engine's stdout and on the
bridge subscription (a daemon-like reader). The mod's own `t` stamp (Date.now() at emit) is also kept.

    python3 live_headless.py --tag T [--hooks 0|1] [--shim] [--prompts N] [--pings] [--agents K]
                             [--snapprobe] [--kill]
Raw data: /private/tmp/bridge-bench/<tag>.*.
"""
import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time

sys.path.insert(0, "/private/tmp/bridge-bench")
from benchlib import *  # noqa

PROMPT = ("Write a 450-word story about a lighthouse keeper who finds a message in a bottle. "
          "Plain prose, no headings. Use no tools.")
AGENTS_PROMPT = ("In a single message, launch {k} Agent tool calls in parallel (subagent_type general-purpose), "
                 "each asking its subagent to write a 300-word story about a different animal, using no tools, "
                 "and to reply with only the story. After they all finish, reply with only the word: done.")

WRAPPER = """#!/usr/bin/env bash
if [ "$1" = "bridge" ]; then exec python3 /private/tmp/bridge-bench/bridge_shim.py "$(dirname "$(readlink -f "$0")")" "$@"; fi
exec python3 "$(dirname "$(readlink -f "$0")")/sminos.py" "$@"
"""


def load():
    return subprocess.run(["sysctl", "-n", "vm.loadavg"], capture_output=True, text=True).stdout.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--hooks", type=int, default=1)
    ap.add_argument("--shim", action="store_true")
    ap.add_argument("--prompts", type=int, default=3)
    ap.add_argument("--pings", action="store_true")
    ap.add_argument("--agents", type=int, default=0)
    ap.add_argument("--snapprobe", action="store_true")
    ap.add_argument("--kill", action="store_true", help="SIGKILL the child mid-stream once (recovery)")
    ap.add_argument("--subs", type=int, default=1)
    ap.add_argument("--env", action="append", default=[], help="K=V for the session")
    ap.add_argument("--debugfile", action="store_true")
    a = ap.parse_args()
    base = os.path.join(OUT, a.tag)
    meta = {"tag": a.tag, "hooks": a.hooks, "shim": a.shim, "load_start": load(), "turns": [], "pings": [],
            "snapprobes": [], "kills": []}
    b = Bench(hooks=bool(a.hooks))
    b.setup()
    extra_env = {"CLAUDE_CODE_SUBAGENT_MODEL": "haiku", "CLAUDE_CODE_SUBAGENT_MODEL_FORCE": "1",
                 "PYTHONDONTWRITEBYTECODE": "1"}
    extra_env.update(kv.split("=", 1) for kv in a.env)
    meta["env"] = sorted(extra_env)
    if a.shim:
        shim_log = base + ".shim.log"
        if os.path.exists(shim_log):
            os.unlink(shim_log)
        extra_env["BRIDGE_SHIM_LOG"] = shim_log
        w = os.path.join(b.plugin, "skills/sminos/scripts/sminos")
        with open(w, "w") as f:
            f.write(WRAPPER)
        os.chmod(w, 0o755)
    b.write_env(bool(a.hooks), extra_env)
    subs = []
    try:
        t_launch = time.time()
        extra = (["--allowedTools", "Agent"] if a.agents else []) + (["--debug-file", base + ".debug.log"] if a.debugfile else [])
        p = b.headless(extra=extra, stderr_path=base + ".stderr")
        out = LineReader(p.stdout, "stdout")
        out.start()
        if a.hooks:
            sid = b.find_session(60)
            meta["socket_after_s"] = time.time() - t_launch
            st = lbc.wait_for("status", 20, b.status, every=0.01)
            meta["child_pid"] = st["pid"]
            for i in range(a.subs):
                s = Subscriber(b.endpoint, name="sub%d" % i)
                s.start()
                subs.append(s)
            lbc.wait_for("snapshot", 10, lambda: all(s.lines for s in subs), every=0.005)
            meta["snapshot_after_s"] = time.time() - t_launch
        else:
            time.sleep(3.0)
        meta["claude_pid"] = p.pid

        def run_turn(text, during=None):
            n0 = len(out.lines)
            cpu0 = cpu_seconds(p.pid)
            ccpu0 = cpu_seconds(meta["child_pid"]) if a.hooks else None
            t0 = time.time()
            p.stdin.write(user_line(text))
            p.stdin.flush()
            th = None
            if during:
                th = threading.Thread(target=during, args=(t0,), daemon=True)
                th.start()

            def done():
                return any(b'"type":"result"' in l for _, l in out.lines[n0:])
            lbc.wait_for("the turn's result", 300, done, every=0.01)
            t1 = time.time()
            if th:
                th.join(30)
            cpu1 = cpu_seconds(p.pid)
            ccpu1 = cpu_seconds(meta["child_pid"]) if a.hooks else None
            turn = {"t_send": t0, "t_result": t1, "claude_cpu_s": cpu1 - cpu0, "hook": during.__name__ if during else None,
                    "child_cpu_s": (ccpu1 - ccpu0) if a.hooks and ccpu0 is not None and ccpu1 is not None else None,
                    "load": load()}
            meta["turns"].append(turn)
            print("turn %d: %.2fs, claude cpu %.2fs, child cpu %s, load %s" % (
                len(meta["turns"]), t1 - t0, turn["claude_cpu_s"], turn["child_cpu_s"], turn["load"]), flush=True)
            return turn

        def ping(where):
            t0 = time.time()
            s, body = lbc.request(b.endpoint(), "POST", "/command?wait=8000", {"op": "ping"}, timeout=15)
            t1 = time.time()
            meta["pings"].append({"where": where, "t0": t0, "rtt_ms": (t1 - t0) * 1000, "status": s,
                                  "streaming": ((body or {}).get("result") or {}).get("state", {}).get("isStreaming")})

        def snapprobe(where):
            t0 = time.time()
            c = Conn(b.endpoint(), timeout=10)
            c.request("GET", "/events")
            r = c.getresponse()
            line = r.readline()
            t1 = time.time()
            c.close()
            try:
                snap = json.loads(line)
                streaming = snap.get("streaming") or []
                chars = sum(len(bl.get("text") or "") for m in streaming for bl in m.get("blocks") or [])
            except ValueError:
                streaming, chars = [], 0
            meta["snapprobes"].append({"where": where, "t0": t0, "ms": (t1 - t0) * 1000, "bytes": len(line),
                                       "streaming": len(streaming), "text_chars": chars})

        if a.hooks and a.pings:
            time.sleep(1.0)
            for _ in range(30):
                ping("idle")
                time.sleep(0.1)

        def during_stream(t0):
            # Wait for the first text delta on stdout, then ping / probe every 250 ms until the result.
            lbc.wait_for("streaming", 120, lambda: any(b'content_block_delta' in l for t, l in out.lines if t > t0), every=0.005)
            k = 0
            while not any(b'"type":"result"' in l for t, l in out.lines if t > t0):
                if a.pings:
                    ping("stream")
                if a.snapprobe and k % 2 == 0:
                    snapprobe("stream")
                k += 1
                time.sleep(0.25)

        def kill_mid(t0):
            lbc.wait_for("streaming", 60, lambda: sum(1 for t, l in out.lines if t > t0 and b'text_delta' in l) > 40,
                         every=0.005)
            old = meta["child_pid"]
            tk = time.time()
            os.kill(old, signal.SIGKILL)
            new = lbc.wait_for("respawned child", 30, lambda: (b.status() or {}).get("pid") not in (None, old)
                               and b.status(), every=0.01)
            meta["kills"].append({"t_kill": tk, "old": old, "new": new["pid"], "t_answer": time.time()})
            meta["child_pid"] = new["pid"]

        for i in range(a.prompts):
            hook = None
            if a.hooks and (a.pings or a.snapprobe) and i == a.prompts - 1:
                hook = during_stream
            if a.hooks and a.kill and i == a.prompts - 1:
                hook = kill_mid
            run_turn(PROMPT, hook)
            time.sleep(1.0)
        if a.agents:
            run_turn(AGENTS_PROMPT.format(k=a.agents), during_stream if (a.hooks and a.snapprobe) else None)
            time.sleep(1.0)
        if a.hooks and a.pings:
            for _ in range(10):
                ping("idle-after")
                time.sleep(0.1)
        if a.shim:
            # Close the subscriptions first: each writer finds its reader gone at the next event
            # (a heartbeat, every 5 s) and its dequeue record is written before the child is stopped.
            for s in subs:
                s.close()
            time.sleep(6.5)
        p.stdin.close()
        p.wait(60)
        meta["load_end"] = load()
    finally:
        for s in subs:
            s.close()
        time.sleep(0.2)
        with open(base + ".stdout.tsv", "wb") as f:
            for t, l in out.lines:
                f.write(b"%.6f\t" % t + l)
        for i, s in enumerate(subs):
            with open(base + ".bridge%d.tsv" % i, "wb") as f:
                for t, l, k in s.lines:
                    f.write(b"%.6f\t%d\t" % (t, k) + l)
            meta.setdefault("subscriptions", []).append({"subs": s.subs, "ends": s.ends})
        with open(base + ".meta.json", "w") as f:
            json.dump(meta, f, indent=1)
        b.cleanup()


if __name__ == "__main__":
    main()
