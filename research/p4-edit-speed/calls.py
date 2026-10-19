"""Per-API-call aggregates (no content): context size, time to first block, duration, output and thinking tokens."""
import json, sys, statistics as st
from datetime import datetime
def ts(s): return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
recs = [json.loads(l) for l in open(sys.argv[1])]
lo = sys.argv[2] if len(sys.argv) > 2 else None
reqs = {}; order = []
for r in recs:
    if r.get('type') == 'api-request':
        reqs[r['id']] = dict(t=ts(r['timestamp']), blocks=[], src=r.get('querySource'), model=r['params'].get('model')); order.append(r['id'])
    elif r.get('type') == 'assistant':
        ref = r.get('requestRef')
        if ref in reqs:
            m = r['message']; reqs[ref]['blocks'].append((ts(r['timestamp']), [b.get('type') for b in m.get('content', [])], m.get('usage') or {}, r.get('thinkingDurationMs')))
linked = [k for k in order if reqs[k]['blocks']]
print('api-requests', len(order), 'linked to assistant records', len(linked))
rows = []
for k in linked:
    q = reqs[k]; b = q['blocks']
    u = max((x[2] for x in b), key=lambda u: u.get('output_tokens') or 0)
    ctx = (u.get('input_tokens') or 0) + (u.get('cache_read_input_tokens') or 0) + (u.get('cache_creation_input_tokens') or 0)
    out = u.get('output_tokens') or 0; th = (u.get('output_tokens_details') or {}).get('thinking_tokens') or 0
    first = b[0][0] - q['t']; dur = b[-1][0] - q['t']
    thinkms = sum((x[3] or 0) for x in b) / 1000
    rows.append(dict(t=q['t'], ctx=ctx, cw=u.get('cache_creation_input_tokens') or 0, out=out, th=th, first=first, dur=dur, thinkms=thinkms,
                     kinds=[t for x in b for t in x[1]]))
def q(v, p): v = sorted(v); return v[min(len(v) - 1, int(p * len(v)))]
def summ(name, sel):
    s = [r for r in rows if sel(r)]
    if not s: return
    rate = [r['out'] / r['dur'] for r in s if r['dur'] > 1 and r['out'] > 200]
    print('%-34s n=%3d ctx med %7d | first-block med %5.1f p90 %5.1f | dur med %5.1f p90 %5.1f | out med %5d p90 %5d | think med %5d | out tok/s med %5.1f (n=%d)' % (
        name, len(s), st.median(r['ctx'] for r in s), st.median(r['first'] for r in s), q([r['first'] for r in s], .9),
        st.median(r['dur'] for r in s), q([r['dur'] for r in s], .9), st.median(r['out'] for r in s), q([r['out'] for r in s], .9),
        st.median(r['th'] for r in s), st.median(rate) if rate else float('nan'), len(rate)))
summ('all calls', lambda r: True)
summ('ctx < 200k', lambda r: r['ctx'] < 200000)
summ('ctx 200k-450k', lambda r: 200000 <= r['ctx'] < 450000)
summ('ctx >= 450k', lambda r: r['ctx'] >= 450000)
summ('cold cache (write > 100k)', lambda r: r['cw'] > 100000)
summ('warm (write < 20k), ctx>=450k', lambda r: r['cw'] < 20000 and r['ctx'] >= 450000)
summ('warm (write < 20k), ctx<200k', lambda r: r['cw'] < 20000 and r['ctx'] < 200000)
big = [r for r in rows if r['out'] > 1500 and r['dur'] > 5]
print('calls with >1500 output tokens: n=%d, output tok/s each:' % len(big), sorted(round(r['out'] / r['dur'], 1) for r in big))
print('context size over the session (first, 25%%, 50%%, 75%%, last):', [rows[int(i * (len(rows) - 1))]['ctx'] for i in (0, .25, .5, .75, 1)])
cold = [(datetime.utcfromtimestamp(r['t']).strftime('%H:%M:%S'), r['cw'], round(r['first'], 1)) for r in rows if r['cw'] > 100000]
print('cold-cache calls (time, cache write tokens, first-block s):', cold)
