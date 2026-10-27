"""Read-only: the plane's open build (index + newest rows + the disk facts' look) on a real transcript,
timed in wall and CPU seconds. Reads the file; writes nothing but the result line; prints no content.

    PYTHONDONTWRITEBYTECODE=1 python3 -I real_index.py <transcript.jsonl> [<label>]
"""
import json
import os
import sys
import time

SCRIPTS = "/Users/new/.claude/plugins/cache/doperpowers/sminos/1.1.1/skills/sminos/scripts"
sys.path.insert(0, SCRIPTS)
import sminos_plane as P  # noqa: E402

path = sys.argv[1]
label = sys.argv[2] if len(sys.argv) > 2 else os.path.basename(path)[:8]
size = os.path.getsize(path)
la0 = os.getloadavg()
t = P.Transcript(path)
w0, c0 = time.perf_counter(), time.process_time()
idx = t.extended()
w1, c1 = time.perf_counter(), time.process_time()
kind, built = P.build(t, None, False)       # the index is warm now: what is left is reading the rows that fit
w2, c2 = time.perf_counter(), time.process_time()
facts = P.look(P.Disk(), path, None, {}, ())
w3, c3 = time.perf_counter(), time.process_time()
res = {"label": label, "bytes": size, "rows": len(idx.uuids), "parsed_bytes": idx.parsed,
       "index_wall_s": w1 - w0, "index_cpu_s": c1 - c0, "rows_wall_s": w2 - w1, "rows_cpu_s": c2 - c1,
       "shown": len(built.shown), "look_wall_s": w3 - w2, "look_cpu_s": c3 - c2,
       "metas": len(facts.metas), "load_before": la0, "load_after": os.getloadavg()}
print(json.dumps(res))
with open("/private/tmp/bridge-bench/real_index.jsonl", "a") as f:
    f.write(json.dumps(res) + "\n")
