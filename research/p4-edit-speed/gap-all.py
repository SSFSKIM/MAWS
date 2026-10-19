"""Across every session in ClaudeUsage relay logs: first byte against idle gap and context size (Opus 5.5, served).
Usage: python3 -I p4-bench-gap-all.py <relay-log>...
"""
import json, sys, collections, statistics as st
from datetime import datetime
def ts(s): return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
by = collections.defaultdict(list); apps = collections.Counter()
for f in sys.argv[1:]:
    for l in open(f):
        try: o = json.loads(l)
        except Exception: continue
        if o.get('model') != 'claude-opus-5-5' or 'usage' not in o or 'firstByteSeconds' not in o or not o.get('session'): continue
        by[o['session']].append(o); apps[o.get('app')] += 1
rows = []
for sid, rs in by.items():
    rs.sort(key=lambda o: o['startedAt']); prev = None
    for o in rs:
        s0 = ts(o['startedAt']); u = o['usage']
        rows.append(dict(gap=(s0 - prev) if prev else None, fb=o['firstByteSeconds'], ctx=u['input'] + u['cacheRead'] + u['cacheWrite'], cr=u['cacheRead'], cw=u['cacheWrite'],
                         out=u['output'], tot=o['totalSeconds'], gapmax=o.get('upstreamLongestGapSeconds')))
        prev = s0 + o['totalSeconds']
print('opus-5-5 requests', len(rows), 'sessions', len(by), 'apps', dict(apps))
def b(name, sel):
    v = sorted(r['fb'] for r in rows if sel(r))
    if len(v) >= 5: print('%-50s n=%5d first-byte med %5.1f p75 %5.1f p90 %5.1f' % (name, len(v), st.median(v), v[3 * len(v) // 4], v[int(.9 * (len(v) - 1))]))
for clo, chi in ((0, 100e3), (100e3, 200e3), (200e3, 450e3), (450e3, 2e6)):
    for lo, hi in ((0, 300), (300, 600), (600, 3600), (3600, 1e9)):
        b('ctx %4dk-%4dk gap %5ds-%5ds (cache read>90%%)' % (clo / 1e3, chi / 1e3, lo, min(hi, 99999)), lambda r: r['gap'] is not None and lo <= r['gap'] < hi and clo <= r['ctx'] < chi and r['cr'] > 0.9 * r['ctx'])
    b('ctx %4dk-%4dk cache write > 50%% (cold)' % (clo / 1e3, chi / 1e3), lambda r: clo <= r['ctx'] < chi and r['cw'] > 0.5 * r['ctx'])
rate = sorted(r['out'] / (r['tot'] - r['fb']) for r in rows if r['out'] > 800 and r['tot'] - r['fb'] > 2 and (r['gapmax'] or 0) < 2)
print('output tok/s after first byte (out>800, no gap>2s): n=%d med %.0f p25 %.0f p75 %.0f' % (len(rate), st.median(rate), rate[len(rate) // 4], rate[3 * len(rate) // 4]))
