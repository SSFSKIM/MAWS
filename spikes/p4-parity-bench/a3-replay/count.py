# Token cost of the always-loaded maws tools: count_tokens on the first request's tools with and without them.
import json, os, sys, urllib.request
snap = json.load(open(sys.argv[1]))
s = json.load(open(os.path.expanduser('~/.claude/settings.json')))
tok = s['env']['ANTHROPIC_AUTH_TOKEN']


def api_tool(t):
    return {'name': 'mcp__maws__' + t['name'], 'description': t['description'], 'input_schema': t['inputSchema']}


def count(tools):
    body = {'model': 'claude-opus-5-5', 'messages': [{'role': 'user', 'content': 'x'}], 'tools': tools}
    req = urllib.request.Request('http://127.0.0.1:8641/v1/messages/count_tokens', data=json.dumps(body).encode(), method='POST', headers={
        'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'authorization': 'Bearer ' + tok,
        'anthropic-beta': 'claude-code-20250219', 'x-app': 'cli', 'user-agent': 'claude-cli/2.1.306 (external, cli)'})
    return json.load(urllib.request.urlopen(req, timeout=60))['input_tokens']


always = [t for t in snap['tools'] if (t.get('_meta') or {}).get('anthropic/alwaysLoad')]
base = count([{'name': 'Noop', 'description': 'x', 'input_schema': {'type': 'object', 'properties': {}}}])
for t in always:
    print(t['name'], count([{'name': 'Noop', 'description': 'x', 'input_schema': {'type': 'object', 'properties': {}}}, api_tool(t)]) - base)
print('all four (A3)', count([{'name': 'Noop', 'description': 'x', 'input_schema': {'type': 'object', 'properties': {}}}] + [api_tool(t) for t in always if t['name'] != 'message']) - base)
