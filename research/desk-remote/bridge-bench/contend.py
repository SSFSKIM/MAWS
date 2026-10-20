"""A small warm bridged open, alone and beside a concurrent big build in the same process."""
import json, os, subprocess, sys, time
sys.path.insert(0, "/private/tmp/bridge-bench")
from benchlib import *  # noqa
HEAVY = "/Users/new/.claude/projects/-Users-new-Developer-GitHub-doperpowers/a45b97a3-375e-4b0c-a46e-a6659b76e229.jsonl"
b = Bench(hooks=True)
b.setup()
b.write_env(True, {"PYTHONDONTWRITEBYTECODE": "1"})
env = b.local_env(); env["PYTHONDONTWRITEBYTECODE"] = "1"
res = []
try:
    p = b.headless(stderr_path=os.path.join(OUT, "contend.stderr"))
    out = LineReader(p.stdout, "stdout"); out.start()
    sid = b.find_session(60)
    lbc.wait_for("status", 20, b.status, every=0.01)
    p.stdin.write(user_line("Say hello in five words.")); p.stdin.flush()
    lbc.wait_for("result", 120, lambda: any(b'"type":"result"' in l for _, l in out.lines), every=0.05)
    time.sleep(1.0)
    for label, heavy in (("alone-1", None), ("heavy-1", HEAVY), ("alone-2", None), ("heavy-2", HEAVY)):
        o = os.path.join(OUT, "contend-%s.json" % label)
        la = os.getloadavg()
        args = ["python3", "/private/tmp/bridge-bench/plane_open.py", sid, o, "uplink", "0"] + ([HEAVY] if heavy else [])
        r = subprocess.run(args, env=env, capture_output=True, text=True, timeout=300)
        d = json.load(open(o))
        tl = {w: t for t, w, det in d["timeline"]}
        hv = [det for t, w, det in d["timeline"] if w == "heavy:end"]
        line = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-300:]
        print("%-8s load %5.0f  %s  %s" % (label, la[0], line, hv), flush=True)
        res.append({"label": label, "load": la, "line": line, "timeline": d["timeline"]})
        time.sleep(1.0)
    p.stdin.close(); p.wait(60)
finally:
    json.dump(res, open(os.path.join(OUT, "contend.json"), "w"), indent=1)
    b.cleanup()
