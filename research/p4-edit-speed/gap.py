"""First-call first byte (relay) against the idle gap since the session's previous API activity and the context size.
Usage: python3 -I p4-bench-gap.py <relay-log>... --tr <transcript>...
"""
import json, sys, collections, statistics as st
from datetime import datetime
def ts(s): return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
a = sys.argv[1:]; logs = a[:a.index('--tr')]; trs = a[a.index('--tr') + 1:]
rows = []
relay = collections.defaultdict(list)
sids = set()
for t in trs:
    for l in open(t):
        o = json.loads(l)
        if o.get('sessionId'): sids.add(o['sessionId']); break
for f in logs:
    for l in open(f):
        for sid in sids:
            if sid in l:
                o = json.loads(l)
                if o.get('session') == sid and 'totalSeconds' in o and 'usage' in o and 'opus' in (o.get('model') or ''):
                    relay[sid].append(o)
                break
for sid, rs in relay.items():
    rs.sort(key=lambda o: o['startedAt']); prev_end = None
    for o in rs:
        st0 = ts(o['startedAt'])
        gap = (st0 - prev_end) if prev_end else None
        ctx = o['usage']['input'] + o['usage']['cacheRead'] + o['usage']['cacheWrite']
        rows.append(dict(gap=gap, fb=o['firstByteSeconds'], ctx=ctx, cw=o['usage']['cacheWrite']))
        prev_end = st0 + o['totalSeconds']
print('opus requests', len(rows))
def b(name, sel):
    v = sorted(r['fb'] for r in rows if sel(r))
    if v: print('%-46s n=%3d first-byte med %5.1f p90 %5.1f max %5.1f' % (name, len(v), st.median(v), v[int(.9 * (len(v) - 1))], v[-1]))
for lo, hi in ((0, 60), (60, 300), (300, 600), (600, 3600), (3600, 1e9)):
    for clo, chi in ((0, 200e3), (200e3, 450e3), (450e3, 2e6)):
        b('gap %5ds-%5ds ctx %4dk-%4dk' % (lo, min(hi, 99999), clo / 1e3, chi / 1e3), lambda r: r['gap'] is not None and lo <= r['gap'] < hi and clo <= r['ctx'] < chi)
