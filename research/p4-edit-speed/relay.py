"""Join ClaudeUsage relay request logs with a transcript's API calls (aggregates only, no content).
Usage: python3 -I p4-bench-relay.py <transcript.jsonl> <session-id> <relay-log>...
"""
import json, sys, statistics as st, collections
tr, sid, logs = sys.argv[1], sys.argv[2], sys.argv[3:]
reqids = {}
for l in open(tr):
    o = json.loads(l)
    if o.get('type') == 'assistant' and o.get('requestId'):
        u = o['message'].get('usage') or {}
        reqids[o['requestId']] = max(reqids.get(o['requestId'], 0), u.get('output_tokens') or 0)
rows = []; C = collections.Counter()
for f in logs:
    for l in open(f):
        if sid not in l: continue
        o = json.loads(l)
        if o.get('session') != sid: continue
        rows.append(o)
        for k in ('app', 'userAgent', 'routingReason', 'endpoint', 'outcome', 'model', 'stopReason'):
            C['%s=%s' % (k, o.get(k))] += 1
        C['attempts=%s' % o.get('attempts')] += 1; C['transportRetries=%s' % o.get('transportRetries')] += 1
print('relay rows for session', len(rows), '| transcript requestIds', len(reqids), '| joined', sum(1 for r in rows if r.get('requestID') in reqids))
for k, v in sorted(C.items()): print('  ', v, k)
main = [r for r in rows if 'opus' in (r.get('model') or '') and 'usage' in r]
def d(name, vals):
    v = sorted(x for x in vals if x is not None)
    if v: print('%-38s n=%3d med %6.2f p25 %6.2f p75 %6.2f p90 %6.2f max %6.2f' % (name, len(v), st.median(v), v[len(v)//4], v[3*len(v)//4], v[int(.9*(len(v)-1))], v[-1]))
print('opus calls through the relay:')
for k in ('clientWaitSeconds', 'headSeconds', 'firstByteSeconds', 'totalSeconds', 'longestGapSeconds', 'upstreamLongestGapSeconds'):
    d(k, [r.get(k) for r in main])
d('output tok/s after first byte (out>500)', [r['usage']['output'] / (r['totalSeconds'] - r['firstByteSeconds']) for r in main if r['usage']['output'] > 500 and r['totalSeconds'] - r['firstByteSeconds'] > 1])
d('toolCount', [r.get('toolCount') for r in main]); d('systemBytes', [r.get('systemBytes') for r in main]); d('messageCount', [r.get('messageCount') for r in main])
ctx = lambda r: r['usage']['input'] + r['usage']['cacheRead'] + r['usage']['cacheWrite']
for lo, hi in ((0, 200e3), (200e3, 450e3), (450e3, 2e6)):
    d('headSeconds ctx %dk-%dk' % (lo / 1e3, hi / 1e3), [r.get('headSeconds') for r in main if lo <= ctx(r) < hi])
d('headSeconds cache write > 100k', [r.get('headSeconds') for r in main if r['usage']['cacheWrite'] > 100e3])
others = collections.Counter(r.get('model') for r in rows if r not in main)
print('non-opus calls in the session:', dict(others))
