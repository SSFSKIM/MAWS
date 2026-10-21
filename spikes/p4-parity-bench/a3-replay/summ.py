# Per variant: thinking tokens (median, mean, every value), generation's median, the rewrite's word count, the tools
# called. Reads results.jsonl (this directory's compact rows) or replay.py's own output.
#   python3 -I -B summ.py results.jsonl
import json, statistics as st, collections, sys, re

rows = [json.loads(l) for f in sys.argv[1:] for l in open(f)]
by = collections.defaultdict(list)
for r in rows:
    if 'error' in r:
        continue
    if 'thinkingTokens' in r:  # a compact row
        by[r['variant']].append(dict(th=r['thinkingTokens'], gen=r['generation'], tools=tuple(r['tools']), words=r['words']))
        continue
    u = r['usage']
    words = None
    for b in r['blocks']:
        if b['type'] == 'tool_use' and b['name'] in ('mcp__maws__artifact_edit', 'Edit'):
            try:
                inp = json.loads(b['text'])
                words = len(re.findall(r"\S+", inp.get('new_string') or ' '.join(o.get('markdown') or o.get('new') or '' for o in inp.get('ops', []))))
            except ValueError:
                pass
    by[r['variant']].append(dict(th=u.get('output_tokens_details', {}).get('thinking_tokens'), gen=round(r['end'] - r['firstByte'], 1),
                                 tools=tuple(b['name'] for b in r['blocks'] if b['type'] == 'tool_use'), words=words))
for v, xs in sorted(by.items()):
    ths = [x['th'] for x in xs]
    ws = [x['words'] for x in xs if x['words']]
    print('%-18s n=%2d thinking median %6s mean %5d | generation median %5.1f s | words %s | %s' % (
        v, len(xs), st.median(ths), st.mean(ths), st.median([x['gen'] for x in xs]), '%d to %d' % (min(ws), max(ws)) if ws else '-',
        collections.Counter(x['tools'] for x in xs).most_common(2)))
