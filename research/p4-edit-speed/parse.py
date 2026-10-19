"""Per-turn timing aggregates from a Claude Code transcript (no message content printed).

Usage: python3 -I p4-bench-parse.py <transcript.jsonl> [--from ISO] [--to ISO]
"""
import json, sys, collections
from datetime import datetime

def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() if s else None

def union(iv):
    iv = sorted(iv); tot = 0; cur = None
    for a, b in iv:
        if cur is None or a > cur[1]:
            if cur: tot += cur[1] - cur[0]
            cur = [a, b]
        else:
            cur[1] = max(cur[1], b)
    if cur: tot += cur[1] - cur[0]
    return tot

path = sys.argv[1]
recs = [json.loads(l) for l in open(path)]
turns = []; cur = None; pending_enq = None
for r in recs:
    t = r.get('type')
    if t == 'queue-operation' and r.get('operation') == 'enqueue':
        pending_enq = ts(r['timestamp'])
    if t == 'user' and r.get('turnOrigin') == 'human':
        cur = dict(idx=r['turnPosition']['turnIndex'], start=ts(r['timestamp']), enq=pending_enq,
                   plen=len(json.dumps(r['message']['content'])), reqs=[], asst=[], results={}, uses={},
                   stop_hooks=0, errors=0, end=None)
        turns.append(cur); pending_enq = None; continue
    if cur is None: continue
    if t == 'api-request':
        cur['reqs'].append((ts(r['timestamp']), r['id']))
    elif t == 'assistant':
        m = r['message']; u = m.get('usage') or {}
        cur['asst'].append(dict(t=ts(r['timestamp']), mid=m.get('id'), ref=r.get('requestRef'), u=u,
                                blocks=[b.get('type') for b in m.get('content', [])], thinkms=r.get('thinkingDurationMs'),
                                stop=m.get('stop_reason')))
        for b in m.get('content', []):
            if b.get('type') == 'tool_use':
                cur['uses'][b['id']] = dict(name=b['name'], t=ts(r['timestamp']), insize=len(json.dumps(b.get('input', {}))))
    elif t == 'user':
        c = r['message']['content']
        if isinstance(c, list):
            for b in c:
                if b.get('type') == 'tool_result':
                    cur['results'][b['tool_use_id']] = ts(r['timestamp'])
    elif t == 'system' and r.get('subtype') == 'stop_hook_summary':
        cur['stop_hooks'] = max((h.get('durationMs') or 0) for h in r.get('hookInfos', [])) / 1000
        cur['end'] = ts(r['timestamp'])
    elif t == 'system' and r.get('subtype') == 'api_error':
        cur['errors'] += 1

rows = []
for T in turns:
    if not T['asst']: continue
    first = T['asst'][0]['t']; last = T['asst'][-1]['t']
    first_vis = next((a['t'] for a in T['asst'] if any(b in ('text', 'tool_use') for b in a['blocks'])), None)
    msgs = {}
    for a in T['asst']:
        k = a['mid']
        if k not in msgs or (a['u'].get('output_tokens') or 0) >= (msgs[k]['u'].get('output_tokens') or 0):
            msgs[k] = a
    out = sum(m['u'].get('output_tokens') or 0 for m in msgs.values())
    think = sum((m['u'].get('output_tokens_details') or {}).get('thinking_tokens') or 0 for m in msgs.values())
    cread = sum(m['u'].get('cache_read_input_tokens') or 0 for m in msgs.values())
    cwrite = sum(m['u'].get('cache_creation_input_tokens') or 0 for m in msgs.values())
    thinkms = sum(a['thinkms'] or 0 for a in T['asst']) / 1000
    iv = []; tools = collections.Counter(); tdur = collections.defaultdict(float); insz = collections.defaultdict(int)
    for uid, u in T['uses'].items():
        tools[u['name']] += 1; insz[u['name']] += u['insize']
        if uid in T['results']:
            d = T['results'][uid] - u['t']; iv.append((u['t'], T['results'][uid])); tdur[u['name']] += d
    tool_t = union(iv)
    end = last
    wall = end - T['start']
    rows.append(dict(idx=T['idx'], start=T['start'], plen=T['plen'], ttfo=first - T['start'],
                     ttvis=(first_vis - T['start']) if first_vis else None, wall=wall, tool=tool_t, model=wall - tool_t,
                     rt=len(msgs), reqs=len(T['reqs']), out=out, think=think, cread=cread, cwrite=cwrite, thinkms=thinkms,
                     tools=dict(tools), tdur=dict(tdur), insz=dict(insz), stoph=T['stop_hooks'], err=T['errors'],
                     enqlag=(T['start'] - T['enq']) if T['enq'] else None))

def hm(x): return datetime.utcfromtimestamp(x).strftime('%H:%M:%S')
def short(n): return n.replace('mcp__maws__', 'm.').replace('mcp__plugin_', 'p.').replace('mcp__notion__', 'n.')
print('turn start(Z) plen | first-out first-vis | wall tool model | api-calls out think(tok) | cache-read cache-write | stophook | tools (count, dur s, input chars)')
for r in rows:
    tl = ' '.join('%s x%d %.1fs %dc' % (short(k), v, r['tdur'].get(k, 0), r['insz'].get(k, 0)) for k, v in r['tools'].items())
    print('%2d %s %5d | %5.1f %5s | %5.1f %5.1f %5.1f | %2d %6d %6d | %8d %6d | %4.1f | %s' % (
        r['idx'], hm(r['start']), r['plen'], r['ttfo'], ('%.1f' % r['ttvis']) if r['ttvis'] is not None else '-',
        r['wall'], r['tool'], r['model'], r['rt'], r['out'], r['think'], r['cread'], r['cwrite'], r['stoph'], tl))
json.dump(rows, open('/tmp/maws-review/p4-bench-turns.json', 'w'), indent=1)
