# Replay one recorded API request (or a variant of it) through the owner's relay, streaming, and report what the model
# did: first byte, the time to each block, the end, usage (thinking tokens included), the tool it called and the edit's
# new text length. The diagnostic for P4-A3's thinking gap: the same request, n times, then one component swapped.
#
#   python3 -I replay.py <transcript> <request index> <variant> <n> <out.jsonl>
import json, os, sys, time, urllib.request, re, copy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from req import load

RELAY = 'http://127.0.0.1:8641/v1/messages'


def token():
    s = json.load(open(os.path.expanduser('~/.claude/settings.json')))
    return s['env']['ANTHROPIC_AUTH_TOKEN']


def strip_block(b):
    b = {k: v for k, v in b.items() if k not in ('caller',)}
    return b


def request_body(path, k):
    j, reqs = load(path)
    r = reqs[k]
    # fill the messages the records did not blob: the assistant response of each earlier request and its tool results
    by_ref = {}
    for x in j:
        if x.get('type') == 'assistant' and x.get('requestRef'):
            by_ref.setdefault(x['requestRef'], []).append(x)
    results = {}
    for x in j:
        if x.get('type') == 'user' and isinstance(x['message']['content'], list):
            for b in x['message']['content']:
                if b.get('type') == 'tool_result':
                    results[b['tool_use_id']] = b
    out = [None if isinstance(m.get('content'), str) and m['content'].startswith('<not blobbed') else m for m in r['messages']]
    # the j-th assistant message is the response of the j-th request; a gap after an assistant message is its tool results
    n_assistant = 0
    for i, m in enumerate(out):
        prev = out[i - 1] if i else None
        if m is None and (prev is None or prev['role'] != 'assistant'):
            ref = reqs[n_assistant]['id']
            out[i] = {'role': 'assistant', 'content': [strip_block(b) for x in by_ref[ref] for b in x['message']['content']]}
        elif m is None:
            ids = [b['id'] for b in prev['content'] if b['type'] == 'tool_use']
            out[i] = {'role': 'user', 'content': [results[t] for t in ids]}
        if out[i]['role'] == 'assistant':
            n_assistant += 1
    p = r['params']
    body = {'model': p['model'], 'max_tokens': p['max_tokens'], 'thinking': p['thinking'], 'output_config': p['output_config'],
            'system': copy.deepcopy(r['shape']['system']), 'tools': copy.deepcopy(r['shape']['tools']), 'messages': out, 'stream': True}
    if 'context_management' in p:
        body['context_management'] = p['context_management']
    return body, p['betas']


def with_cache(body):
    # one cache breakpoint on the last block of the last user message, so the n replays of a variant read its prefix
    body = copy.deepcopy(body)
    for m in reversed(body['messages']):
        if m['role'] == 'user' and isinstance(m['content'], list) and m['content']:
            m['content'][-1]['cache_control'] = {'type': 'ephemeral'}
            break
    return body


def run(body, betas):
    data = json.dumps(with_cache(body)).encode()
    req = urllib.request.Request(RELAY, data=data, method='POST', headers={
        'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'anthropic-beta': ','.join(betas),
        'authorization': 'Bearer ' + token(), 'x-app': 'cli', 'user-agent': 'claude-cli/2.1.306 (external, cli)'})
    t0 = time.time()
    first = None
    blocks = []
    usage = {}
    cur = None
    stop = None
    with urllib.request.urlopen(req, timeout=600) as resp:
        for raw in resp:
            line = raw.decode('utf-8', 'replace').strip()
            if not line.startswith('data:'):
                continue
            ev = json.loads(line[5:])
            t = time.time() - t0
            if first is None:
                first = t
            ty = ev.get('type')
            if ty == 'message_start':
                usage.update(ev['message'].get('usage') or {})
            elif ty == 'content_block_start':
                cur = {'type': ev['content_block']['type'], 'start': t, 'name': ev['content_block'].get('name'), 'text': ''}
                blocks.append(cur)
            elif ty == 'content_block_delta':
                d = ev['delta']
                cur['text'] += d.get('text') or d.get('partial_json') or d.get('thinking') or ''
            elif ty == 'content_block_stop':
                cur['stop'] = t
            elif ty == 'message_delta':
                usage.update(ev.get('usage') or {})
                stop = (ev.get('delta') or {}).get('stop_reason')
            elif ty == 'error':
                raise RuntimeError(json.dumps(ev))
    end = time.time() - t0
    return {'firstByte': round(first, 3), 'end': round(end, 3), 'stop': stop, 'usage': usage,
            'blocks': [{'type': b['type'], 'name': b['name'], 'start': round(b['start'], 3), 'stop': round(b.get('stop', end), 3), 'chars': len(b['text']), 'text': b['text'] if b['type'] != 'thinking' else b['text'][:4000]} for b in blocks]}


VARIANTS = {}


def variant(name):
    def deco(f):
        VARIANTS[name] = f
        return f
    return deco


@variant('asis')
def _asis(body, betas):
    return body, betas


if __name__ == '__main__':
    path, k, var, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4]), sys.argv[5]
    exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'variants.py')).read())
    body, betas = request_body(path, k)
    body, betas = VARIANTS[var](body, betas)
    for i in range(n):
        try:
            res = run(body, betas)
        except Exception as e:
            res = {'error': repr(e)[:2000]}
        res.update(variant=var, source=os.path.basename(path), request=k, i=i, at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
        with open(out, 'a') as f:
            f.write(json.dumps(res) + '\n')
        u = res.get('usage', {})
        print(var, i, res.get('error') or '', 'fb', res.get('firstByte'), 'end', res.get('end'), 'out', u.get('output_tokens'), 'usage', {k2: v for k2, v in u.items() if k2 not in ('server_tool_use',)}, [(b['type'], b['name'], b['chars']) for b in res.get('blocks', [])], flush=True)
