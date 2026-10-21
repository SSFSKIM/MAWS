# Dump a transcript's request N as readable text: system blocks, tool names and sizes, messages.
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from req import load


def text_of(content):
    if isinstance(content, str):
        return content
    parts = []
    for b in content:
        t = b.get('type')
        if t == 'text':
            parts.append(b['text'])
        elif t == 'tool_use':
            parts.append('[tool_use %s] %s' % (b['name'], json.dumps(b['input'], ensure_ascii=False)))
        elif t == 'tool_result':
            c = b.get('content')
            parts.append('[tool_result] ' + (text_of(c) if c is not None else ''))
        elif t == 'tool_reference':
            parts.append('[tool_reference %s]' % b.get('tool_name'))
        elif t == 'thinking':
            parts.append('[thinking]')
        else:
            parts.append('[%s] %s' % (t, json.dumps(b, ensure_ascii=False)[:2000]))
    return '\n'.join(parts)


path, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
j, reqs = load(path)
r = reqs[n]
with open(out, 'w') as f:
    f.write('=== PARAMS\n%s\n' % json.dumps(r['params'], indent=1))
    for i, b in enumerate(r['shape']['system']):
        f.write('=== SYSTEM %d (%d chars) %s\n%s\n' % (i, len(b['text']), json.dumps({k: v for k, v in b.items() if k != 'text'}), b['text']))
    f.write('=== TOOLS\n')
    for t in r['shape']['tools']:
        f.write('- %s desc=%d schema=%d %s\n' % (t.get('name'), len(t.get('description', '')), len(json.dumps(t.get('input_schema', {}))),
                                                json.dumps({k: v for k, v in t.items() if k not in ('name', 'description', 'input_schema')})[:300]))
    for t in r['shape']['tools']:
        f.write('=== TOOL %s\n%s\n' % (t.get('name'), t.get('description', '')))
    for i, m in enumerate(r['messages']):
        f.write('=== MESSAGE %d %s\n%s\n' % (i, m.get('role'), text_of(m.get('content'))))
print(out)
