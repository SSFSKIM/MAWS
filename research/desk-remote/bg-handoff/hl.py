"""Headless resume driver: python3 hl.py <run> <tag> <session-id> [ENV=VAL ...] -- keeps the process in a
background python that reads commands from <out>/<tag>.cmd (one JSON user text per line) and stops when the file
holds 'CLOSE'."""
import json, os, sys, time
sys.path.insert(0, "/private/tmp/bg-handoff")
import hb
run, tag, sid = sys.argv[1:4]
extra = dict(a.split("=", 1) for a in sys.argv[4:])
e = hb.Env(run)
args = ["--resume", sid, "--debug-file", os.path.join(e.root, "debug-%s.txt" % tag)]
p = e.headless(args, tag, extra_env=extra)
with open(os.path.join(e.out, tag + ".pid"), "w") as f:
    f.write(str(p.pid))
cmd = os.path.join(e.out, tag + ".cmd")
open(cmd, "a").close()
done = 0
while p.poll() is None:
    lines = open(cmd).read().splitlines()
    for l in lines[done:]:
        if l == "CLOSE":
            p.stdin.close()
        else:
            e.send(p, json.loads(l))
    done = len(lines)
    time.sleep(0.5)
print("exit", p.returncode)
