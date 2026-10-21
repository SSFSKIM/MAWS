# Reconstruct an engine transcript's API requests from its api-request, -shape and -blob records.
import json, sys


def load(path):
    j = [json.loads(l) for l in open(path)]
    shapes = {x['shapeHash']: x['shape'] for x in j if x.get('type') == 'api-request-shape'}
    blobs = {x['hash']: x['message'] for x in j if x.get('type') == 'api-request-blob'}
    reqs = [x for x in j if x.get('type') == 'api-request']
    out = []
    for r in reqs:
        msgs = []
        if 'base' in r:
            base = next(o for o in out if o['id'] == r['base'])
            msgs = base['messages'][:r['keep']]
        msgs = msgs + [blobs.get(h, {'role': 'assistant', 'content': '<not blobbed: %s>' % h[:8]}) for h in r['tail']]
        out.append({'id': r['id'], 'ts': r['timestamp'], 'params': r['params'], 'shape': shapes[r['shapeHash']],
                    'messages': msgs, 'cacheControl': r.get('cacheControl'), 'querySource': r.get('querySource')})
    return j, out


if __name__ == '__main__':
    j, out = load(sys.argv[1])
    for i, o in enumerate(out):
        print(i, o['ts'], o['querySource'], 'msgs', len(o['messages']), 'sys', len(json.dumps(o['shape']['system'])),
              'tools', len(o['shape']['tools']))
