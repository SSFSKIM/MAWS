"""Analysis of a live_headless.py run: delta matching stdout <-> bridge, the mod's t, the shim's batches.

    python3 analyze_live.py <tag> [<tag> ...]     (prints a summary, writes <tag>.analysis.json)
"""
import collections
import json
import os
import sys

sys.path.insert(0, "/private/tmp/bridge-bench")
from benchlib import OUT, stats, summary, pct  # noqa


def read_stdout(base):
    deltas = collections.defaultdict(list)   # parent_tool_use_id -> [(wall, text)]
    thinking = collections.defaultdict(list)
    anyd = collections.defaultdict(list)
    msg_starts = collections.defaultdict(list)
    results = []
    first_delta_after = []
    with open(base + ".stdout.tsv", "rb") as f:
        for raw in f:
            t, line = raw.split(b"\t", 1)
            t = float(t)
            d = json.loads(line)
            if d.get("type") == "stream_event":
                ev = d["event"]
                parent = d.get("parent_tool_use_id")
                if ev.get("type") == "content_block_delta" and ev["delta"].get("type") == "text_delta":
                    deltas[parent].append((t, ev["delta"]["text"]))
                    anyd[parent].append(t)
                elif ev.get("type") == "content_block_delta" and ev["delta"].get("type") == "thinking_delta":
                    thinking[parent].append((t, ev["delta"].get("thinking") or ""))
                    anyd[parent].append(t)
                elif ev.get("type") == "content_block_delta":
                    anyd[parent].append(t)
                elif ev.get("type") == "message_start":
                    msg_starts[parent].append(t)
            elif d.get("type") == "result":
                results.append(t)
    return deltas, msg_starts, results, thinking, anyd


def read_bridge(base, i=0):
    chunks = collections.defaultdict(list)   # agentId -> [(wall, t_ms, text, key)]
    thinking = collections.defaultdict(list)
    class L(list):
        pass
    events = L()                              # (wall, event)
    path = base + ".bridge%d.tsv" % i
    if not os.path.exists(path):
        return chunks, events
    with open(path, "rb") as f:
        for raw in f:
            t, k, line = raw.split(b"\t", 2)
            t = float(t)
            e = json.loads(line)
            events.append((t, int(k), e))
            if e.get("type") == "chunk" and (e.get("chunk") or {}).get("kind") == "text":
                chunks[e.get("agentId")].append((t, e["t"], e["chunk"].get("text") or "",
                                                 (e["turnId"], e["step"], e["chunkIndex"])))
            elif e.get("type") == "chunk" and (e.get("chunk") or {}).get("kind") == "thinking":
                thinking[e.get("agentId")].append((t, e["t"], e["chunk"].get("text") or "",
                                                   (e["turnId"], e["step"], e["chunkIndex"])))
    events.thinking = thinking
    return chunks, events


def match(sd, bc):
    """Pairs stdout deltas and bridge chunks by order, checking the text; resyncs on mismatch by text search."""
    pairs, i, j, mism = [], 0, 0, 0
    while i < len(sd) and j < len(bc):
        if sd[i][1] == bc[j][2]:
            pairs.append((sd[i], bc[j]))
            i += 1
            j += 1
        else:
            mism += 1
            # skip whichever side has an extra piece
            nxt = next((jj for jj in range(j, min(j + 20, len(bc))) if bc[jj][2] == sd[i][1]), None)
            if nxt is not None:
                j = nxt
            else:
                i += 1
    return pairs, mism


def shim(base, bridge_events):
    """Per-event segments from the shim: emit t -> child accept -> ingest start -> dequeue -> arrival."""
    path = base + ".shim.log"
    if not os.path.exists(path):
        return None
    posts, deqs = [], []
    with open(path) as f:
        for line in f:
            r = json.loads(line)
            if r["k"] == "post" and r["path"] == "/events" and r.get("i0") is not None:
                posts.append(r)
            elif r["k"] == "deq":
                deqs.append(r["rows"])
    posts.sort(key=lambda r: r["i0"])
    sizes = [p["n"] for p in posts]
    chunky = [p for p in posts if p["types"].get("chunk")]
    res = {"posts": len(posts), "batch": stats(sizes), "batch_chunky": stats([p["n"] for p in chunky]),
           "types": dict(sum((collections.Counter(p["types"]) for p in posts), collections.Counter())),
           "child_post_ms": stats([(p["t1"] - p["acc"]) * 1000 for p in posts if p.get("acc")]),
           "ingest_ms": stats([(p["i1"] - p["i0"]) * 1000 for p in posts]),
           "accept_minus_oldest_t_ms": stats([p["acc"] * 1000 - p["tmin"] for p in posts if p.get("acc") and p.get("tmin")]),
           "bytes": stats([p["len"] for p in posts])}
    # The main subscription's stream (subscription 1) against the posts, in order.
    main = [(w, e) for w, k, e in bridge_events if k == 1 and e.get("type") != "snapshot"]
    if not main or not deqs:
        return res
    deq = max(deqs, key=len)
    fanned = []
    for p in posts:
        skip = sum(p["types"].get(t, 0) for t in ("export", "inbox", "resync"))
        fanned.append(p["n"] - skip)
    A, B, C, D, T = [], [], [], [], []
    pi, left = 0, fanned[0] if fanned else 0
    for w, e in main:
        n = e.get("n")
        if e.get("type") in ("command", "kept"):
            continue
        while pi < len(posts) and left == 0:
            pi += 1
            left = fanned[pi] if pi < len(posts) else 0
        if pi >= len(posts):
            break
        left -= 1
        p = posts[pi]
        if e.get("type") != "chunk" or not isinstance(e.get("t"), (int, float)) or not p.get("acc"):
            continue
        if n is None or n - 1 >= len(deq):
            continue
        d = deq[n - 1]
        if d[2] != e.get("chunkIndex") or d[3] != e.get("t"):
            continue   # the order did not line up: leave it out
        A.append(p["acc"] * 1000 - e["t"])
        B.append((p["i0"] - p["acc"]) * 1000)
        C.append((d[0] - p["i0"]) * 1000)
        D.append((w - d[0]) * 1000)
        T.append(w * 1000 - e["t"])
    res["seg_n"] = len(T)
    res["seg_emit_to_accept_ms"] = stats(A)
    res["seg_accept_to_ingest_ms"] = stats(B)
    res["seg_ingest_to_dequeue_ms"] = stats(C)
    res["seg_dequeue_to_arrival_ms"] = stats(D)
    res["seg_total_ms"] = stats(T)
    return res


def analyze(tag):
    base = os.path.join(OUT, tag)
    meta = json.load(open(base + ".meta.json"))
    sd, starts, results, sthink, anyd = read_stdout(base)
    bc, events = read_bridge(base)
    out = {"tag": tag, "load_start": meta.get("load_start"), "load_end": meta.get("load_end")}
    # TTFT and cadence per turn (stdout, main loop)
    ttft, cadence, turn_s = [], [], []
    main = sd.get(None, [])
    first_text = []
    for turn in meta["turns"]:
        ds = [t for t in anyd.get(None, []) if turn["t_send"] < t <= turn["t_result"]]
        tx = [t for t, _ in main if turn["t_send"] < t <= turn["t_result"]]
        if ds:
            ttft.append((ds[0] - turn["t_send"]) * 1000)
            cadence += [(b - a) * 1000 for a, b in zip(ds, ds[1:])]
            turn_s.append(turn["t_result"] - turn["t_send"])
        if tx:
            first_text.append((tx[0] - turn["t_send"]) * 1000)
    out["first_text_ms"] = stats(first_text)
    out["ttft_ms"] = stats(ttft)
    out["inter_delta_ms"] = stats(cadence)
    out["deltas_per_turn"] = len(main) / max(1, len(meta["turns"]))
    out["turn_s"] = stats(turn_s)
    out["claude_cpu_s_per_turn"] = stats([t["claude_cpu_s"] for t in meta["turns"]])
    if meta["turns"] and meta["turns"][0].get("child_cpu_s") is not None:
        out["child_cpu_s_per_turn"] = stats([t["child_cpu_s"] for t in meta["turns"] if t.get("child_cpu_s") is not None])
    if bc:
        pairs, mism = match(main, bc.get(None, []))
        tpairs, _ = match(sthink.get(None, []), events.thinking.get(None, []))
        out["thinking_matched"] = len(tpairs)
        if tpairs:
            out["thinking_bridge_minus_stdout_ms"] = stats([(b[0] - s[0]) * 1000 for s, b in tpairs])
        out["matched"] = len(pairs)
        out["mismatches"] = mism
        out["bridge_minus_stdout_ms"] = stats([(b[0] - s[0]) * 1000 for s, b in pairs])
        clean = [tr for tr in meta["turns"] if not tr.get("hook")]
        if len(clean) < len(meta["turns"]):
            cp = [(s, b) for s, b in pairs if any(tr["t_send"] < s[0] <= tr["t_result"] for tr in clean)]
            out["clean_bridge_minus_stdout_ms"] = stats([(b[0] - s[0]) * 1000 for s, b in cp])
            out["clean_bridge_minus_t_ms"] = stats([b[0] * 1000 - b[1] for s, b in cp])
            hp = [(s, b) for s, b in pairs if not any(tr["t_send"] < s[0] <= tr["t_result"] for tr in clean)]
            out["hooked_bridge_minus_stdout_ms"] = stats([(b[0] - s[0]) * 1000 for s, b in hp])
        out["bridge_minus_t_ms"] = stats([b[0] * 1000 - b[1] for s, b in pairs])
        out["stdout_minus_t_ms"] = stats([s[0] * 1000 - b[1] for s, b in pairs])
        # every bridge event with a t (all loops, all types)
        lag_all = [w * 1000 - e["t"] for w, k, e in events if isinstance(e.get("t"), (int, float)) and e.get("type") not in ("snapshot",)]
        out["all_events_minus_t_ms"] = stats(lag_all)
        sub_chunks = [c for a, cs in bc.items() if a is not None for c in cs]
        if sub_chunks:
            out["subagent_chunks"] = len(sub_chunks)
            out["subagent_chunk_minus_t_ms"] = stats([w * 1000 - t for w, t, _, _ in sub_chunks])
            # stdout subagent deltas, if the engine prints them
            sub_sd = [d for k, v in sd.items() if k is not None for d in v]
            out["stdout_subagent_deltas"] = len(sub_sd)
        types = collections.Counter(e.get("type") for _, _, e in events)
        out["bridge_types"] = dict(types)
        out["gaps"] = [e for _, _, e in events if e.get("type") == "gap"]
        out["subscriptions"] = meta.get("subscriptions")
        # event rate: events per second in the busiest 1 s window
        ws = sorted(w for w, _, _ in events)
        best, j = 0, 0
        for i in range(len(ws)):
            while ws[i] - ws[j] > 1.0:
                j += 1
            best = max(best, i - j + 1)
        out["peak_events_per_s"] = best
    sh = shim(base, events)
    if sh:
        out["shim"] = sh
    if meta.get("pings"):
        by = collections.defaultdict(list)
        for pg in meta["pings"]:
            by[pg["where"]].append(pg["rtt_ms"])
        out["ping_ms"] = {k: stats(v) for k, v in by.items()}
    if meta.get("snapprobes"):
        out["snapprobes"] = meta["snapprobes"]
    if meta.get("kills"):
        out["kills"] = meta["kills"]
    json.dump(out, open(base + ".analysis.json", "w"), indent=1)
    return out


def show(o):
    print("== %s  (load %s -> %s)" % (o["tag"], o.get("load_start"), o.get("load_end")))
    for k in ("ttft_ms", "first_text_ms", "inter_delta_ms", "thinking_bridge_minus_stdout_ms", "turn_s", "claude_cpu_s_per_turn", "child_cpu_s_per_turn",
              "bridge_minus_stdout_ms", "bridge_minus_t_ms", "clean_bridge_minus_stdout_ms", "clean_bridge_minus_t_ms",
              "hooked_bridge_minus_stdout_ms", "stdout_minus_t_ms", "all_events_minus_t_ms",
              "subagent_chunk_minus_t_ms"):
        if k in o and o[k].get("n"):
            s = o[k]
            print("  %-28s n=%-5d p50=%8.2f p95=%8.2f p99=%8.2f max=%8.2f mean=%8.2f" % (
                k, s["n"], s["p50"], s["p95"], s["p99"], s["max"], s["mean"]))
    for k in ("deltas_per_turn", "matched", "thinking_matched", "mismatches", "peak_events_per_s", "subagent_chunks", "stdout_subagent_deltas"):
        if k in o:
            print("  %-28s %s" % (k, o[k]))
    if "shim" in o:
        sh = o["shim"]
        print("  shim: posts=%d types=%s" % (sh["posts"], sh["types"]))
        for k in ("batch", "batch_chunky", "accept_minus_oldest_t_ms", "child_post_ms", "ingest_ms", "bytes",
                  "seg_emit_to_accept_ms", "seg_accept_to_ingest_ms", "seg_ingest_to_dequeue_ms",
                  "seg_dequeue_to_arrival_ms", "seg_total_ms"):
            s = sh.get(k) or {}
            if s.get("n"):
                print("    %-26s n=%-5d p50=%8.2f p95=%8.2f p99=%8.2f max=%8.2f mean=%8.2f" % (
                    k, s["n"], s["p50"], s["p95"], s["p99"], s["max"], s["mean"]))
    if "ping_ms" in o:
        for k, s in o["ping_ms"].items():
            print("  ping %-10s n=%-3d p50=%7.2f p95=%7.2f max=%7.2f" % (k, s["n"], s["p50"], s["p95"], s["max"]))
    if o.get("gaps"):
        print("  GAPS:", o["gaps"])
    if o.get("subscriptions"):
        print("  subscriptions:", [(len(s["subs"]), len(s["ends"])) for s in o["subscriptions"]])
    if o.get("snapprobes"):
        sp = o["snapprobes"]
        print("  snapprobes: n=%d bytes max=%d ms p50=%.1f max=%.1f streaming max=%d chars max=%d" % (
            len(sp), max(x["bytes"] for x in sp), pct([x["ms"] for x in sp], 50), max(x["ms"] for x in sp),
            max(x["streaming"] for x in sp), max(x["text_chars"] for x in sp)))
    if o.get("kills"):
        print("  kills:", o["kills"])


if __name__ == "__main__":
    for tag in sys.argv[1:]:
        show(analyze(tag))
