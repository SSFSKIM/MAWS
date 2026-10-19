"""Stream tail after a tool_use block (the server-side auto-mode check hold), per tool, across transcripts.
Joins transcripts with ClaudeUsage relay logs by requestID. Aggregates only.
Usage: python3 -I p4-bench-tail.py --logs <relay-log>... --tr <transcript>...
"""
import json, sys, collections, statistics as st
from datetime import datetime
def ts(s): return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
a = sys.argv[1:]; logs = a[a.index('--logs') + 1:a.index('--tr')]; trs = a[a.index('--tr') + 1:]
sids = {}
recsets = []
for t in trs:
    recs = [json.loads(l) for l in open(t)]
    sid = next((r['sessionId'] for r in recs if r.get('sessionId')), None)
    if sid: sids[sid] = recs
relay = {}
for f in logs:
    for l in open(f):
        for sid in sids:
            if sid in l:
                o = json.loads(l)
                if o.get('requestID'): relay[o['requestID']] = o
                break
tails = collections.defaultdict(list); sizes = collections.defaultdict(list); n = 0
for sid, recs in sids.items():
    reqt = {r['id']: ts(r['timestamp']) for r in recs if r.get('type') == 'api-request'}
    seen = set()
    for r in recs:
        if r.get('type') != 'assistant' or not r.get('requestId'): continue
        for b in r['message'].get('content', []):
            if b.get('type') != 'tool_use' or r['requestId'] in seen: continue
            o = relay.get(r['requestId']); t0 = reqt.get(r.get('requestRef'))
            if not o or t0 is None or 'totalSeconds' not in o: continue
            seen.add(r['requestId']); n += 1
            tail = t0 + o['totalSeconds'] - ts(r['timestamp'])
            name = b['name'].replace('mcp__maws__', 'maws.')
            tails[name].append(tail); sizes[name].append(len(json.dumps(b.get('input', {}))))
print('sessions', len(sids), 'tool-calling requests joined', n)
allt = sorted(x for v in tails.values() for x in v)
print('all: med %.2f p90 %.2f p99 %.2f; share > 3 s: %.1f%%' % (st.median(allt), allt[int(.9 * (len(allt) - 1))], allt[int(.99 * (len(allt) - 1))], 100 * sum(x > 3 for x in allt) / len(allt)))
for k in sorted(tails, key=lambda k: -len(tails[k])):
    v = tails[k]
    if len(v) < 2: continue
    big = [(round(t, 1), s) for t, s in zip(v, sizes[k]) if t > 3]
    print('%-34s n=%3d med %.2f max %5.1f  >3s: %s' % (k, len(v), st.median(v), max(v), big[:6]))
