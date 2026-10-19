"""Per-turn split of wall time into API wait (first byte), API streaming, tool time and local remainder,
joining a transcript with ClaudeUsage relay logs by requestID. Aggregates only.
Usage: python3 -I p4-bench-split.py <transcript.jsonl> <relay-log>...
"""
import json, sys, collections
from datetime import datetime
def ts(s): return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
tr, logs = sys.argv[1], sys.argv[2:]
recs = [json.loads(l) for l in open(tr)]
sid = next(r['sessionId'] for r in recs if r.get('sessionId'))
relay = {}
for f in logs:
    for l in open(f):
        if sid in l:
            o = json.loads(l)
            if o.get('session') == sid and o.get('requestID'): relay[o['requestID']] = o
turns = []; cur = None
for r in recs:
    t = r.get('type')
    if t == 'user' and r.get('turnOrigin') == 'human':
        cur = dict(idx=r['turnPosition']['turnIndex'], start=ts(r['timestamp']), last=None, req=[], uses={}, res={}); turns.append(cur); continue
    if cur is None: continue
    if t == 'assistant':
        cur['last'] = ts(r['timestamp'])
        if r.get('requestId') and r['requestId'] not in cur['req']: cur['req'].append(r['requestId'])
        for b in r['message'].get('content', []):
            if b.get('type') == 'tool_use': cur['uses'][b['id']] = (b['name'], ts(r['timestamp']))
    if t == 'user' and isinstance(r['message']['content'], list):
        for b in r['message']['content']:
            if b.get('type') == 'tool_result': cur['res'][b['tool_use_id']] = ts(r['timestamp'])
def union(iv):
    tot = 0; end = None
    for a, b in sorted(iv):
        if end is None or a > end: tot += b - a; end = b
        elif b > end: tot += b - end; end = b
    return tot
print('turn  wall | calls  wait  stream | tools | local | out-tok | edit-kind')
agg = collections.defaultdict(float)
for T in turns:
    if not T['last']: continue
    wall = T['last'] - T['start']
    rr = [relay[q] for q in T['req'] if q in relay]
    wait = sum(r.get('firstByteSeconds') or 0 for r in rr)
    stream = sum((r.get('totalSeconds') or 0) - (r.get('firstByteSeconds') or 0) for r in rr)
    out = sum((r.get('usage') or {}).get('output', 0) for r in rr)
    tools = union([(t0, T['res'][k]) for k, (n, t0) in T['uses'].items() if k in T['res']])
    names = collections.Counter(n.replace('mcp__maws__', '') for n, _ in T['uses'].values())
    kind = 'publish' if names.get('artifact_publish') else 'edit' if names.get('artifact_edit') else 'create' if names.get('artifact_create') else '-'
    local = wall - wait - stream - tools
    print('%3d %6.1f | %3d %6.1f %6.1f | %5.1f | %5.1f | %6d | %s' % (T['idx'], wall, len(rr), wait, stream, tools, local, out, kind))
    if kind in ('edit', 'publish'):
        for k, v in (('wall', wall), ('wait', wait), ('stream', stream), ('tools', tools), ('local', local), ('calls', len(rr)), ('n', 1)):
            agg[kind + '.' + k] += v
for kind in ('edit', 'publish'):
    n = agg[kind + '.n']
    if n:
        print('%s turns n=%d: mean wall %.1f = wait %.1f + stream %.1f + tools %.1f + local %.1f; mean API calls %.1f' % (
            kind, n, agg[kind + '.wall'] / n, agg[kind + '.wait'] / n, agg[kind + '.stream'] / n, agg[kind + '.tools'] / n, agg[kind + '.local'] / n, agg[kind + '.calls'] / n))
