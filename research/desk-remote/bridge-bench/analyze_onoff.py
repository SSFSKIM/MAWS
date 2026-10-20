"""Hooks on vs off: TTFT, inter-delta cadence, turn time, engine CPU per turn; and the bridge's latency
in the hooks-on sessions (no shim, no pings: as in production).

    python3 analyze_onoff.py ON1 ON2 ... -- OFF1 OFF2 ...
"""
import json
import os
import random
import sys

sys.path.insert(0, "/private/tmp/bridge-bench")
from benchlib import OUT, stats  # noqa
import analyze_live as A  # noqa

args = sys.argv[1:]
cut = args.index("--")
on, off = args[:cut], args[cut + 1:]


def collect(tags):
    agg = {"ttft": [], "first_text": [], "cadence": [], "turn_s": [], "cpu": [], "cpu_per_delta_ms": [],
           "bms": [], "bmt": [], "smt": [], "child_cpu": []}
    for tag in tags:
        base = os.path.join(OUT, tag)
        meta = json.load(open(base + ".meta.json"))
        sd, starts, results, sthink, anyd = A.read_stdout(base)
        main = sd.get(None, [])
        for turn in meta["turns"]:
            ds = [t for t in anyd.get(None, []) if turn["t_send"] < t <= turn["t_result"]]
            if not ds:
                continue
            agg["ttft"].append((ds[0] - turn["t_send"]) * 1000)
            agg["cadence"] += [(b - a) * 1000 for a, b in zip(ds, ds[1:])]
            agg["turn_s"].append(turn["t_result"] - turn["t_send"])
            agg["cpu"].append(turn["claude_cpu_s"])
            agg["cpu_per_delta_ms"].append(1000 * turn["claude_cpu_s"] / len(ds))
            if turn.get("child_cpu_s") is not None:
                agg["child_cpu"].append(turn["child_cpu_s"])
        if os.path.exists(base + ".bridge0.tsv"):
            bc, events = A.read_bridge(base)
            pairs, mism = A.match(main, bc.get(None, []))
            agg["bms"] += [(b[0] - s[0]) * 1000 for s, b in pairs]
            agg["bmt"] += [b[0] * 1000 - b[1] for s, b in pairs]
            agg["smt"] += [s[0] * 1000 - b[1] for s, b in pairs]
    return agg


def perm_test(x, y, iters=5000):
    """Two-sided permutation test on the difference of medians."""
    import statistics as st
    obs = abs(st.median(x) - st.median(y))
    pool = x + y
    k = 0
    for _ in range(iters):
        random.shuffle(pool)
        if abs(st.median(pool[:len(x)]) - st.median(pool[len(x):])) >= obs:
            k += 1
    return k / iters


a, b = collect(on), collect(off)
res = {}
for key in ("ttft", "cadence", "turn_s", "cpu", "cpu_per_delta_ms"):
    sa, sb = stats(a[key]), stats(b[key])
    p = perm_test(list(a[key]), list(b[key]), 2000 if key == "cadence" else 5000) if a[key] and b[key] else None
    res[key] = {"on": sa, "off": sb, "p_median_diff": p}
    print("%-17s ON  n=%-4d p50=%9.2f p95=%9.2f mean=%9.2f | OFF n=%-4d p50=%9.2f p95=%9.2f mean=%9.2f | p=%.3f" % (
        key, sa["n"], sa["p50"], sa["p95"], sa["mean"], sb["n"], sb["p50"], sb["p95"], sb["mean"], p if p is not None else -1))
for key in ("bms", "bmt", "smt", "child_cpu"):
    s = stats(a[key])
    if s["n"]:
        res[key] = s
        print("%-17s n=%-5d p50=%8.2f p95=%8.2f p99=%8.2f max=%8.2f mean=%8.2f" % (
            {"bms": "bridge-stdout ms", "bmt": "bridge-t ms", "smt": "stdout-t ms", "child_cpu": "child cpu s/turn"}[key],
            s["n"], s["p50"], s["p95"], s["p99"], s["max"], s["mean"]))
json.dump(res, open(os.path.join(OUT, "onoff.analysis.json"), "w"), indent=1)
