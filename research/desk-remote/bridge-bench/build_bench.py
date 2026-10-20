"""The plane's open build (sminos_plane.build: index the transcript, read the newest rows that fit)
against transcripts of growing size, made from this bench's own isolated transcript by repeating its
rows under fresh uuids. No session, no model.

    PYTHONDONTWRITEBYTECODE=1 python3 build_bench.py <seed transcript.jsonl>
"""
import json
import os
import sys
import tempfile
import time
import uuid

SCRIPTS = "/Users/new/.claude/plugins/cache/doperpowers/sminos/1.1.1/skills/sminos/scripts"
sys.path.insert(0, SCRIPTS)
import sminos_plane as P  # noqa: E402

seed = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
rows = [r for r in seed if isinstance(r, dict) and r.get("uuid")]
print("seed: %d rows, %d bytes" % (len(rows), os.path.getsize(sys.argv[1])))
d = tempfile.mkdtemp(prefix="brb.", dir="/tmp")
out = []
for target in (600_000, 5_000_000, 20_000_000, 50_000_000):
    path = os.path.join(d, "%s.jsonl" % uuid.uuid4())
    size, parent, last = 0, None, None
    with open(path, "w") as f:
        while size < target:
            for r in rows:
                r = dict(r)
                r["uuid"] = str(uuid.uuid4())
                r["parentUuid"] = parent
                parent = last = r["uuid"]
                line = json.dumps(r) + "\n"
                f.write(line)
                size += len(line)
    times = []
    for rep in range(2):
        t = P.Transcript(path)      # a fresh index, as after a daemon restart
        t0 = time.perf_counter()
        kind, built = P.build(t, last, True)
        t1 = time.perf_counter()
        times.append((t1 - t0) * 1000)
    # a second open on the same Transcript: the index is kept (Transcripts keeps INDEX_KEEP)
    t0 = time.perf_counter()
    P.build(t, last, True)
    warm = (time.perf_counter() - t0) * 1000
    n = len(t.index.uuids)
    rec = {"bytes": os.path.getsize(path), "rows": n, "cold_ms": times, "warm_ms": warm,
           "shown": len(built.shown)}
    out.append(rec)
    print("%9d bytes %6d rows: cold build %s ms, warm %.1f ms, %d rows shown" % (
        rec["bytes"], n, ", ".join("%.0f" % x for x in times), warm, rec["shown"]), flush=True)
    os.unlink(path)
os.rmdir(d)
json.dump(out, open("/private/tmp/bridge-bench/build_bench.json", "w"), indent=1)
