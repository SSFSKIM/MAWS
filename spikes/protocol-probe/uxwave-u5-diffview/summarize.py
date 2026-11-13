import json, collections, sys
rows = [json.loads(l) for l in open(sys.argv[1])]
agg = collections.defaultdict(collections.Counter)
for r in rows:
    if 'kind' in r:
        a, b = r['after'], r['before']
        card = a['card']
        if card is None:
            s = 'card gone'
        else:
            s = ('same node' if card['mount'] == b['card']['mount'] else 'new node') + (', focused' if card['focused'] else ', not focused') + ', value=%r, sel=%s' % (card['value'], card['selection'])
        same = [e['mount'] for e in a['extend']] == [e['mount'] for e in b['extend']]
        ext = 'extend same nodes' if same else 'extend remounted (%d rows: %s)' % (len(a['extend']), [e['text'] for e in a['extend']])
        agg[(r['mode'], r['variant'], r['kind'])][s + ' | widget=' + json.dumps(a['widget']) + ' | ' + ext] += 1
    elif 'ime' in r:
        mid, aft = r['mid'], r['after']
        agg[(r['mode'], r['variant'], 'ime-' + r['ime'])][json.dumps({'mid': mid and (mid['value'], mid['mount']), 'after': aft and (aft['value'], aft['mount'], aft['focused']), 'log': r['log']})] += 1
    else:
        print(json.dumps(r))
for k in sorted(agg):
    for s, n in agg[k].items():
        print(n, k, s)
