# Variants of MAWS's B3 edit request (maws-B3-r3, request 2), each one component swapped. exec'd by replay.py.
import os
import json as _json, copy as _copy, re as _re

_D_PATH = os.path.join(os.environ.get('A3_RECORDS', '/tmp/p4-a3/rec'), 'desktop-B3-r1.jsonl')  # the record's transcripts, copied from the mini


def _desktop():
    return request_body(_D_PATH, 2)


def _read_result(body):
    for m in body['messages']:
        if m['role'] == 'user' and isinstance(m['content'], list):
            for b in m['content']:
                if b.get('type') == 'tool_result':
                    c = b['content']
                    txt = c if isinstance(c, str) else ''.join(x.get('text', '') for x in c)
                    if '"status": "read"' in txt:
                        return b, txt
    raise KeyError('no read result')


def _tool(body, name):
    return next(t for t in body['tools'] if t['name'] == name)


@variant('sysD')
def _sysD(body, betas):
    d, _ = _desktop()
    body['system'] = d['system']
    return body, betas


@variant('readplain')
def _readplain(body, betas):
    b, txt = _read_result(body)
    r = _json.loads(txt)
    plain = 'Document "%s" (%s), revision %s, tab %s (%s blocks). Block ids follow each block as ^id.\n\n%s' % (
        r['title'], r['artifactId'], r['revision'], r['tab'], r['tabs'][0]['blocks'], r['markdown'])
    b['content'] = [{'type': 'text', 'text': plain}]
    return body, betas


@variant('editshort')
def _editshort(body, betas):
    t = _tool(body, 'mcp__maws__artifact_edit')
    t['description'] = 'Edit a MAWS document. Read it first (artifact_read): blocks carry ids (^id) and baseRevision is the revision that read returned. ops: replace_text {block?, old, new}, replace_block {id, markdown}, insert {after | before, markdown}, delete {id}. Returns the new revision.'
    return body, betas


@variant('count')
def _count(body, betas):
    t = _tool(body, 'mcp__maws__artifact_edit')
    t['description'] = t['description'].replace('Returns the new revision, one line per op with the ids of the blocks it made,',
                                                  'Returns the new revision, one line per op with the ids of the blocks it made and the word count of each block it replaced, before and after,')
    assert 'word count' in t['description']
    return body, betas


_SUP2 = ('# Messages to the human (MAWS to-human supplement 2)\n\nThis session runs in MAWS, whose human reads a report of it: only the messages you send reach them, so everything you want them to read, your answers included, is a message. '
         'A message you send before another tool call goes through `mcp__maws__message` (its `text` the message, in Markdown), called in the same response as that tool call: written as text there, it comes back as a paraphrase that never reaches them. '
         'Every other message goes inside `<message>…</message>`, the one mark here too. `mcp__to-human__message` is not available here. ')


@variant('master')
def _master(body, betas):
    s = body['system'][-1]
    i = s['text'].index('# Messages to the human (MAWS to-human supplement 1)')
    rest = s['text'][i:]
    j = rest.index('Ask the human with')
    s['text'] = s['text'][:i] + _SUP2 + rest[j:]
    body['tools'].insert(len(body['tools']) - 3, {
        'name': 'mcp__maws__message', 'eager_input_streaming': True,
        'description': "Send the user a message now, word for word, shown in the session's report in MAWS where this call sits; without this tool, write the message inside <message>…</message>. Use it for a message you send before another tool call, called in the same response as that call: text written there comes back as a paraphrase that never reaches the user. A message at the end of your turn stays a <message> span.",
        'input_schema': {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'type': 'object', 'properties': {'text': {'type': 'string', 'description': 'The message, in Markdown: what you would write inside <message>…</message>.'}}, 'required': ['text'], 'additionalProperties': False}})
    return body, betas


@variant('master_count')
def _master_count(body, betas):
    return _count(*_master(body, betas))


@variant('desk')
def _desk(body, betas):
    return _desktop()


@variant('D_sysM')
def _D_sysM(body, betas):
    # Desktop's request with MAWS's system prompt in place of Desktop's
    d, dbetas = _desktop()
    d['system'] = body['system']
    return d, dbetas


@variant('D_flowM')
def _D_flowM(body, betas):
    # Desktop's system, tools and context; the turn as MAWS's: the prompt's maws-artifact link, one artifact_read (its JSON
    # result), the read and edit tools loaded beside Desktop's
    d, dbetas = _desktop()
    msgs = body['messages']
    u0 = _copy.deepcopy(d['messages'][0])
    last = u0['content'][-1]
    link = _re.search(r'In the document (\[[^\]]*\]\(maws-artifact:[^)]*\))', msgs[0]['content'][-1]['text']).group(1)
    last['text'] = last['text'].replace('In the document doc.md', 'In the document ' + link)
    assert 'maws-artifact:' in last['text']
    read_use = next(b for m in msgs if m['role'] == 'assistant' for b in m['content'] if b.get('type') == 'tool_use' and b['name'] == 'mcp__maws__artifact_read')
    read_res, _ = _read_result(body)
    tools = [t for t in d['tools'] if t['name'] != 'advisor']
    extra = [dict(t) for t in body['tools'] if t['name'] in ('mcp__maws__artifact_read', 'mcp__maws__artifact_edit')]
    for t in extra:
        t.pop('defer_loading', None)
    d['tools'] = tools[:-2] + extra + tools[-2:]
    d['messages'] = [u0, d['messages'][1], {'role': 'assistant', 'content': [read_use]}, {'role': 'user', 'content': [read_res]}, d['messages'][-1]]
    return d, dbetas


_ENV_1M = 'You are powered by the model named Opus 5.5 (1M context). The exact model ID is claude-opus-5-5[1m].'
_ENV_PLAIN = 'You are powered by the model named Opus 5.5. The exact model ID is claude-opus-5-5.'


def _swap_text(body, old, new):
    n = 0
    for m in body['messages']:
        if isinstance(m['content'], list):
            for b in m['content']:
                if b.get('type') == 'text' and old in b['text']:
                    b['text'] = b['text'].replace(old, new)
                    n += 1
    assert n, old
    return body


@variant('no1m')
def _no1m(body, betas):
    # the plain variant Desktop requests: no context-1m beta, the environment line as the engine writes it for it
    return _swap_text(body, _ENV_1M, _ENV_PLAIN), [b for b in betas if not b.startswith('context-1m')]


@variant('no1m_beta')
def _no1m_beta(body, betas):
    return body, [b for b in betas if not b.startswith('context-1m')]


@variant('D_1m')
def _D_1m(body, betas):
    d, dbetas = _desktop()
    return _swap_text(d, _ENV_PLAIN, _ENV_1M), dbetas[:1] + ['context-1m-2025-08-07'] + dbetas[1:]


def _block_words(markdown):
    out = {}
    for para in markdown.split('\n\n'):
        m = _re.search(r'\^([a-z0-9]{8})\s*$', para.strip())
        if m:
            text = _re.sub(r'\^[a-z0-9]{8}', '', para)
            out[m.group(1)] = len(_re.findall(r'\S+', text.replace('#', ' ').replace('|', ' ').replace('-', ' ').strip())) if not para.startswith('|') else None
    return {k: v for k, v in out.items() if v}


@variant('readcount')
def _readcount(body, betas):
    # the read answers each block's word count beside the markdown
    b, txt = _read_result(body)
    r = _json.loads(txt)
    keys = list(r.keys())
    r2 = {}
    for k in keys:
        r2[k] = r[k]
        if k == 'markdown':
            r2['words'] = _block_words(r['markdown'])
    t = _tool(body, 'mcp__maws__artifact_read')
    t['description'] = t['description'].replace("a document's structure,", "a document's structure (with each block's word count),")
    assert 'word count' in t['description']
    b['content'] = [{'type': 'text', 'text': _json.dumps(r2, indent=2)}]
    return body, betas


@variant('readcount_count')
def _readcount_count(body, betas):
    return _count(*_readcount(body, betas))


@variant('attached')
def _attached(body, betas):
    # the first request, with the linked artifact's read attached to the user's message and the read and edit tools
    # always loaded: does the model edit at once, and with what thinking
    b, txt = _read_result(body)
    msgs = body['messages']
    u0 = _copy.deepcopy(msgs[0])
    link = _re.search(r'\[([^\]]*)\]\(maws-artifact:([^)]*)\)', u0['content'][-1]['text'])
    u0['content'].insert(len(u0['content']) - 1, {'type': 'text', 'text': '<system-reminder>\nThe user\'s message links the MAWS artifact [%s](maws-artifact:%s). Its content as mcp__maws__artifact_read returns it, read when the message was sent:\n%s\n</system-reminder>' % (link.group(1), link.group(2), txt)})
    for t in body['tools']:
        if t['name'].startswith('mcp__maws__'):
            t.pop('defer_loading', None)
    ctx = _copy.deepcopy(msgs[1])
    for c in ctx['content']:
        if c.get('type') == 'text':
            c['text'] = c['text'].replace('mcp__maws__artifact_edit\n', '').replace('mcp__maws__artifact_read\n', '')
    body['messages'] = [u0, ctx]
    return body, betas


@variant('alwaysload_first')
def _alwaysload_first(body, betas):
    # the first request with the read and edit tools always loaded (the lever): the model's first call
    msgs = body['messages']
    for t in body['tools']:
        if t['name'].startswith('mcp__maws__'):
            t.pop('defer_loading', None)
    ctx = _copy.deepcopy(msgs[1])
    for c in ctx['content']:
        if c.get('type') == 'text':
            c['text'] = c['text'].replace('mcp__maws__artifact_edit\n', '').replace('mcp__maws__artifact_read\n', '')
    body['messages'] = [msgs[0], ctx]
    return body, betas


def _summarized(body):
    body['thinking'] = dict(body['thinking'], display='summarized')
    return body


@variant('asis_sum')
def _asis_sum(body, betas):
    return _summarized(body), betas


@variant('desk_sum')
def _desk_sum(body, betas):
    d, dbetas = _desktop()
    return _summarized(d), dbetas


def _desktop_read():
    j = [_json.loads(l) for l in open(_D_PATH)]
    use = next(b for x in j if x.get('type') == 'assistant' for b in x['message']['content'] if b['type'] == 'tool_use' and b['name'] == 'Read')
    res = next(b for x in j if x.get('type') == 'user' and isinstance(x['message']['content'], list) for b in x['message']['content'] if b.get('type') == 'tool_result' and b['tool_use_id'] == use['id'])
    return {k: v for k, v in use.items() if k != 'caller'}, res


@variant('flowD')
def _flowD(body, betas):
    # MAWS's system, tools and context; the turn as a file edit: the prompt names doc.md, one Read of it (Desktop's result)
    use, res = _desktop_read()
    use = _copy.deepcopy(use)
    use['input']['file_path'] = '/private/tmp/maws-parity-bench/maws-arm/doc.md'  # the session's own working directory
    msgs = body['messages']
    u0 = _copy.deepcopy(msgs[0])
    last = u0['content'][-1]
    last['text'] = _re.sub(r'In the document \[[^\]]*\]\(maws-artifact:[^)]*\)', 'In the document doc.md', last['text'])
    assert 'In the document doc.md' in last['text']
    body['messages'] = [u0, msgs[1], {'role': 'assistant', 'content': [use]}, {'role': 'user', 'content': [res]}, msgs[-1]]
    return body, betas
