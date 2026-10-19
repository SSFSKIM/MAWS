"""Per-turn split: API wait (first byte) + generation + post-tool-call hold (stream open after the tool_use block,
the server-side auto-mode check) + MAWS/engine tool execution (stream end -> tool_result) + local remainder.
Joins a transcript with ClaudeUsage relay logs by requestID. Aggregates only, no content.
Usage: python3 -I p4-bench-split2.py <transcript.jsonl> <relay-log>...
"""
import json, sys, collections, statistics as st
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
            if o.get('session') == sid and o.get('requestID') and 'totalSeconds' in o: relay[o['requestID']] = o
reqt = {r['id']: ts(r['timestamp']) for r in recs if r.get('type') == 'api-request'}
turns = []; cur = None
for r in recs:
    t = r.get('type')
    if t == 'user' and r.get('turnOrigin') == 'human':
        cur = dict(idx=r['turnPosition']['turnIndex'], start=ts(r['timestamp']), hh=r['timestamp'][11:19], last=None, calls=collections.OrderedDict(), res={}); turns.append(cur); continue
    if cur is None: continue
    if t == 'assistant' and r.get('requestId'):
        cur['last'] = ts(r['timestamp'])
        c = cur['calls'].setdefault(r['requestId'], dict(ref=r.get('requestRef'), tools=[], firstblk=ts(r['timestamp'])))
        for b in r['message'].get('content', []):
            if b.get('type') == 'tool_use': c['tools'].append((b['id'], b['name'].replace('mcp__maws__', ''), ts(r['timestamp'])))
    if t == 'user' and isinstance(r['message']['content'], list):
        for b in r['message']['content']:
            if b.get('type') == 'tool_result': cur['res'][b['tool_use_id']] = ts(r['timestamp'])
hdr = 'turn time(Z)  kind     wall first-out | calls  wait   gen  hold | exec | local | out  think'
print(hdr)
out_rows = []
for T in turns:
    if not T['last']: continue
    wall = T['last'] - T['start']; wait = gen = hold = exe = 0; out = think = 0; names = collections.Counter()
    first_out = min(c['firstblk'] for c in T['calls'].values()) - T['start']
    for rid, c in T['calls'].items():
        o = relay.get(rid); t0 = reqt.get(c['ref'])
        if not o or t0 is None: continue
        end = t0 + o['totalSeconds']; fb = o['firstByteSeconds']
        h = 0
        if c['tools']:
            h = max(0, end - c['tools'][0][2])
            ends = [T['res'][tid] for tid, _, _ in c['tools'] if tid in T['res']]
            if ends: exe += max(0, max(ends) - end)
        wait += fb; hold += h; gen += o['totalSeconds'] - fb - h
        out += o['usage']['output']
        for _, n, _ in c['tools']: names[n] += 1
    for r in recs: pass
    kind = 'publish' if names.get('artifact_publish') else 'edit' if names.get('artifact_edit') else 'create' if names.get('artifact_create') else '-'
    local = wall - wait - gen - hold - exe
    row = dict(idx=T['idx'], hh=T['hh'], kind=kind, wall=wall, first=first_out, calls=len(T['calls']), wait=wait, gen=gen, hold=hold, exe=exe, local=local, out=out)
    out_rows.append(row)
    print('%3d  %s  %-7s %6.1f %6.1f | %3d %6.1f %5.1f %5.1f | %4.1f | %5.1f | %5d' % (row['idx'], row['hh'], kind, wall, first_out, row['calls'], wait, gen, hold, exe, local, out))
for kind in ('edit', 'publish'):
    s = [r for r in out_rows if r['kind'] == kind]
    if s:
        m = lambda k: sum(r[k] for r in s) / len(s)
        print('%-7s n=%d mean: wall %.1f = wait %.1f + gen %.1f + hold %.1f + exec %.1f + local %.1f; calls %.1f; out %.0f' % (kind, len(s), m('wall'), m('wait'), m('gen'), m('hold'), m('exe'), m('local'), m('calls'), m('out')))
