"""The sitting's edit turns as one markdown table: transcript + ClaudeUsage relay log, joined by requestID.
Columns: send -> first block, send -> edit landed (edit/publish tool_result), send -> turn end; API calls;
first-byte wait, generation, post-tool hold (stream open after the tool_use block), MAWS+engine tool execution
(stream end -> tool_result); output and thinking tokens; context per request. Aggregates only, no content.
Usage: python3 -I p4-bench-sitting.py <transcript.jsonl> <relay-log>...
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
            if o.get('session') == sid and o.get('requestID') and 'totalSeconds' in o: relay[o['requestID']] = o
reqt = {r['id']: ts(r['timestamp']) for r in recs if r.get('type') == 'api-request'}
turns = []; cur = None
for r in recs:
    t = r.get('type')
    if t == 'user' and r.get('turnOrigin') == 'human':
        cur = dict(idx=r['turnPosition']['turnIndex'], start=ts(r['timestamp']), hh=r['timestamp'][11:19], last=None, calls=collections.OrderedDict(), res={}, edit=None, think=collections.defaultdict(int)); turns.append(cur); continue
    if cur is None: continue
    if t == 'assistant' and r.get('requestId'):
        cur['last'] = ts(r['timestamp'])
        u = r['message'].get('usage') or {}
        cur['think'][r['requestId']] = max(cur['think'][r['requestId']], (u.get('output_tokens_details') or {}).get('thinking_tokens') or 0)
        c = cur['calls'].setdefault(r['requestId'], dict(ref=r.get('requestRef'), tools=[], first=ts(r['timestamp'])))
        for b in r['message'].get('content', []):
            if b.get('type') == 'tool_use':
                n = b['name'].replace('mcp__maws__', '')
                c['tools'].append((b['id'], n, ts(r['timestamp'])))
                if n in ('artifact_edit', 'artifact_publish') and cur['edit'] is None: cur['edit'] = (b['id'], n)
    if t == 'user' and isinstance(r['message']['content'], list):
        for b in r['message']['content']:
            if b.get('type') == 'tool_result': cur['res'][b['tool_use_id']] = ts(r['timestamp'])
print('| turn (UTC) | edit | send→first block | send→edit landed | send→turn end | API calls | first-byte wait | generation | post-tool hold | tool exec | output tok | thinking tok | context (k tok) | tool sequence |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for T in turns:
    if not T['edit'] or not T['last']: continue
    wait = gen = hold = exe = 0; out = 0; ctx = []; seq = []
    for rid, c in T['calls'].items():
        o = relay.get(rid); t0 = reqt.get(c['ref'])
        if not o or t0 is None: continue
        end = t0 + o['totalSeconds']; h = 0
        if c['tools']:
            h = max(0, end - c['tools'][0][2])
            ends = [T['res'][tid] for tid, _, _ in c['tools'] if tid in T['res']]
            if ends: exe += max(0, max(ends) - end)
        wait += o['firstByteSeconds']; hold += h; gen += o['totalSeconds'] - o['firstByteSeconds'] - h
        out += o['usage']['output']; u = o['usage']; ctx.append((u['input'] + u['cacheRead'] + u['cacheWrite']) / 1000)
        seq += [n.replace('artifact_', '') for _, n, _ in c['tools']]
    first = min(c['first'] for c in T['calls'].values()) - T['start']
    land = T['res'].get(T['edit'][0]); land = (land - T['start']) if land else float('nan')
    print('| %d (%s) | %s | %.1f | %.1f | %.1f | %d | %.1f | %.1f | %.1f | %.1f | %d | %d | %d-%d | %s |' % (
        T['idx'], T['hh'][:5], T['edit'][1].replace('artifact_', ''), first, land, T['last'] - T['start'], len(T['calls']), wait, gen, hold, exe, out, sum(T['think'].values()), min(ctx), max(ctx), ' → '.join(seq)))
