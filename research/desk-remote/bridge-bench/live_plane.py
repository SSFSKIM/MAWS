"""One interactive (tmux) session, hooks on, the child under the timing shim. Measures:
  - the plane's open (plane_open.py, uplink cadence): idle fresh, mid-stream, idle after a turn,
    right after a prompt, and after a `claude --resume` (cold child);
  - a row's notice on the bridge vs the row reaching the transcript on disk;
  - delta latency in a terminal session (the mod's t vs arrival), with the shim's segments;
  - a 2 s stall of the child (SIGSTOP) mid-stream, and the catch-up;
  - a permission decision through POST /requests/<id>/decision until the tool runs;
  - a child SIGKILLed mid-stream: the stale window, the respawn, the new snapshot, streaming again.

    PYTHONDONTWRITEBYTECODE=1 python3 live_plane.py --tag P1
"""
import argparse
import glob
import json
import os
import re
import shlex
import signal
import subprocess
import sys
import threading
import time

sys.path.insert(0, "/private/tmp/bridge-bench")
from benchlib import *  # noqa

STORY = ("Write a 450-word story about a clockmaker who repairs a clock that runs backwards. "
         "Plain prose, no headings. Use no tools.")
WRAPPER = """#!/usr/bin/env bash
if [ "$1" = "bridge" ]; then exec python3 /private/tmp/bridge-bench/bridge_shim.py "$(dirname "$(readlink -f "$0")")" "$@"; fi
exec python3 "$(dirname "$(readlink -f "$0")")/sminos.py" "$@"
"""
UUID = re.compile(rb'"uuid":"([0-9a-f-]{36})"')


class DiskWatch(threading.Thread):
    """Polls the session's transcript every 2 ms; the first time each row uuid is on disk."""

    def __init__(self, find):
        super().__init__(daemon=True)
        self.find = find
        self.seen = {}
        self.stop = threading.Event()

    def run(self):
        path, off, carry = None, 0, b""
        while not self.stop.is_set():
            if path is None:
                path = self.find()
                if path is None:
                    time.sleep(0.01)
                    continue
            try:
                with open(path, "rb") as f:
                    f.seek(off)
                    data = f.read()
            except OSError:
                data = b""
            now = time.time()
            if data:
                off += len(data)
                lines = (carry + data).split(b"\n")
                carry = lines.pop()
                for line in lines:
                    m = UUID.search(line)
                    if m and m.group(1) not in self.seen:
                        self.seen[m.group(1).decode()] = now
            time.sleep(0.002)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="P1")
    ap.add_argument("--skip", default="", help="comma list of steps to skip")
    a = ap.parse_args()
    skip = set(filter(None, a.skip.split(",")))
    base = os.path.join(OUT, a.tag)
    meta = {"tag": a.tag, "load_start": os.getloadavg(), "opens": [], "marks": []}

    def mark(what, **kw):
        meta["marks"].append(dict(what=what, t=time.time(), **kw))
        print("  %.3f %s %s" % (time.time() % 1000, what, kw if kw else ""), flush=True)

    b = Bench(hooks=True)
    b.setup()
    shim_log = base + ".shim.log"
    if os.path.exists(shim_log):
        os.unlink(shim_log)
    w = os.path.join(b.plugin, "skills/sminos/scripts/sminos")
    with open(w, "w") as f:
        f.write(WRAPPER)
    os.chmod(w, 0o755)
    b.write_env(True, {"BRIDGE_SHIM_LOG": shim_log, "PYTHONDONTWRITEBYTECODE": "1",
                       "CLAUDE_CODE_DISABLE_THINKING": "1"})
    plane_env = b.local_env()
    plane_env["PYTHONDONTWRITEBYTECODE"] = "1"
    sub = None
    subs_all = []
    watch = None
    try:
        t_launch = time.time()
        b.start_session()
        sid = b.find_session(90)
        mark("socket", after=time.time() - t_launch)
        st = lbc.wait_for("status", 20, b.status, every=0.01)
        meta["child_pid"] = st["pid"]
        sub = Subscriber(b.endpoint, name="main")
        subs_all.append(sub)
        sub.start()
        lbc.wait_for("snapshot", 10, lambda: sub.lines, every=0.005)
        mark("subscribed")

        def transcript():
            hits = glob.glob(os.path.join(b.cfg, "projects", "*", sid + ".jsonl"))
            return hits[0] if hits else None
        watch = DiskWatch(transcript)
        watch.start()

        def plane_open(label, mode="uplink", hold=0.0, wait=True):
            out = "%s.open-%s.json" % (base, label)
            t0 = time.time()
            pr = subprocess.Popen(["python3", "/private/tmp/bridge-bench/plane_open.py", sid, out, mode, str(hold)],
                                  env=plane_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

            def finish():
                text = pr.communicate(timeout=60)[0]
                meta["opens"].append({"label": label, "mode": mode, "t0": t0, "out": out, "log": text.strip()})
                print("  open %-14s %s" % (label, text.strip().splitlines()[-1] if text.strip() else "(no line)"), flush=True)
            if wait:
                finish()
                return None
            th = threading.Thread(target=finish, daemon=True)
            th.start()
            return th

        def chunks_since(t0, agent=None):
            return [(w_, e) for w_, l, k in list(sub.lines) if w_ >= t0
                    for e in [json.loads(l)] if e.get("type") == "chunk" and e.get("agentId") == agent
                    and e["chunk"].get("kind") == "text"]

        def turn_end(t0, seconds=180):
            return lbc.wait_for("turn end", seconds, lambda: [1 for w_, l, k in list(sub.lines) if w_ >= t0
                                                              and b'"phase": "complete"' in l and b'"type": "turn"' in l],
                                every=0.02)

        # A. a fresh idle session
        time.sleep(1.0)
        plane_open("idle-fresh")
        plane_open("idle-fresh-tight", mode="tight")

        # B. mid-stream, holding 4 s to stamp the plane's chunk messages
        t1 = time.time()
        mark("prompt1")
        b.prompt(STORY)
        lbc.wait_for("text", 90, lambda: len(chunks_since(t1)) >= 5, every=0.01)
        plane_open("mid-stream", hold=4.0)
        turn_end(t1)
        mark("turn1-end")
        time.sleep(1.5)

        # C. idle after a turn
        plane_open("idle-after")
        plane_open("idle-after-tight", mode="tight")

        # D. right after a prompt; a 2 s child stall mid-stream
        t2 = time.time()
        mark("prompt2")
        b.prompt(STORY)
        th = plane_open("after-prompt", wait=False)
        lbc.wait_for("text", 90, lambda: len(chunks_since(t2)) >= 30, every=0.01)
        if "stall" not in skip:
            pid = b.status()["pid"]
            mark("sigstop", pid=pid)
            os.kill(pid, signal.SIGSTOP)
            time.sleep(2.0)
            os.kill(pid, signal.SIGCONT)
            mark("sigcont", pid=pid)
        turn_end(t2)
        th.join(60)
        mark("turn2-end")
        time.sleep(1.5)

        # E. a permission decided from outside
        if "perm" not in skip:
            # The bridge raises no permission until a tool call has settled its place among the
            # secrets guards: a Read (no permission in the cwd) settles it first.
            with open(os.path.join(b.work, "probe.txt"), "w") as f:
                f.write("lighthouse\n")
            tr0 = time.time()
            b.prompt("Use the Read tool to read probe.txt and reply with its first word only.")
            turn_end(tr0, 120)
            mark("read-turn-end")
            time.sleep(1.0)
            t3 = time.time()
            mark("prompt3")
            b.prompt("Run exactly this Bash command and nothing else: python3 -c 'print(\"brl-perm-ok\")'")

            def raised():
                for w_, l, k in list(sub.lines):
                    if w_ >= t3 and b'"type": "raised"' in l:
                        return json.loads(l)
            r = lbc.wait_for("a raised request", 120, raised, every=0.005)
            mark("raised", request=r["request"], tool=r.get("tool"), rt=r.get("t"))
            time.sleep(0.5)
            td = time.time()
            s, body = lbc.request(b.endpoint(), "POST", "/requests/%s/decision" % r["request"],
                                  {"behavior": "allow", "by": "bench"}, timeout=10)
            meta["decision"] = {"t_post": td, "rtt_ms": (time.time() - td) * 1000, "status": s, "body": body}
            mark("decided", status=s, rtt_ms=meta["decision"]["rtt_ms"])
            turn_end(t3, 120)
            mark("turn3-end")
            time.sleep(1.5)

        # F. the child killed mid-stream
        if "kill" not in skip:
            t4 = time.time()
            mark("prompt4")
            b.prompt(STORY)
            lbc.wait_for("text", 90, lambda: len(chunks_since(t4)) >= 40, every=0.01)
            old = b.status()["pid"]
            tk = time.time()
            os.kill(old, signal.SIGKILL)
            mark("sigkill", pid=old)
            new = lbc.wait_for("respawn", 30, lambda: (b.status() or {}).get("pid") not in (None, old) and b.status(),
                               every=0.005)
            mark("respawned", pid=new["pid"], after=time.time() - tk)
            meta["child_pid"] = new["pid"]
            turn_end(t4)
            mark("turn4-end")
            time.sleep(1.5)

        # G. exit and resume: the plane's open against a cold child
        if "resume" not in skip:
            sub.close()
            time.sleep(0.3)
            mark("exit")
            b.keys("-l", "/exit")
            time.sleep(0.3)
            b.keys("Enter")
            lbc.wait_for("the endpoint gone", 30, lambda: not os.path.exists(b.endpoint()), every=0.05)
            mark("endpoint-gone")
            subprocess.run(b.tmux + ["kill-session", "-t", "brl"], capture_output=True)
            time.sleep(1.0)
            tr = time.time()
            b.start_session(extra="--resume %s" % sid)
            mark("resume-launch")
            lbc.wait_for("the resumed socket", 90, lambda: os.path.exists(b.endpoint()), every=0.002)
            mark("resume-socket", after=time.time() - tr)
            plane_open("resume-cold")
            time.sleep(2.0)
            plane_open("resume-warm")
            sub = Subscriber(b.endpoint, name="main2")
            subs_all.append(sub)
            sub.start()
            lbc.wait_for("snapshot", 10, lambda: sub.lines, every=0.005)
            t5 = time.time()
            mark("prompt5")
            b.prompt("Say hello in five words.")
            th = plane_open("resume-after-prompt", wait=False)
            turn_end(t5, 120)
            th.join(60)
            mark("turn5-end")
        # Let each writer find its reader gone (the heartbeat) so the shim's dequeue records are kept.
        sub.close()
        time.sleep(6.5)
    finally:
        if watch:
            watch.stop.set()
            meta["disk_seen"] = watch.seen
        meta["load_end"] = os.getloadavg()
        meta["pane"] = b.pane()[-3000:]
        for hit in glob.glob(os.path.join(b.cfg, "projects", "*", "*.jsonl")):
            import shutil
            shutil.copy(hit, base + ".transcript-" + os.path.basename(hit))
        for i, sb in enumerate(subs_all):
            sb.close()
            with open(base + ".bridge%d.tsv" % i, "wb") as f:
                for t_, l, k in sb.lines:
                    f.write(b"%.6f\t%d\t" % (t_, k) + l)
        meta["subscriptions"] = [{"subs": sb.subs, "ends": sb.ends} for sb in subs_all]
        with open(base + ".meta.json", "w") as f:
            json.dump(meta, f, indent=1)
        b.cleanup()


if __name__ == "__main__":
    main()
