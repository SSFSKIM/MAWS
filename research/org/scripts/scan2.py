# Renderer call sites of X2 commands whose input names a machine-local thing (rerunnable).
# Usage: python3 -I scan2.py <checkout> <registry.json>
# registry.json: every command's input property names, from z.toJSONSchema over src/shared/ipc/schema.ts (introspect.ts).
import json, os, re, sys, collections
root, reg = sys.argv[1], sys.argv[2]
d = json.load(open(reg)); cmds = d['commands']; events = set(d['events'])
SESSION = {'appSessionId', 'sessionId', 'sessionIds', 'engineSessionIds', 'launchId'}
PROJECT = {'projectId', 'project'}
PATHS = {'path', 'paths', 'cwd', 'directory', 'directories', 'additionalDirectories', 'repoRoot', 'root', 'projectPath', 'linkedDir', 'binaryPath', 'files', 'filename', 'location'}
def dims(n):
    if n.startswith('browser.') or n == 'settings.set': return set()  # the app's own Chromium profiles/tabs; settings.set's one path is an optional engine binary setting
    k = set(cmds[n]['inputKeys']); o = set()
    if k & SESSION: o.add('session')
    if k & PROJECT: o.add('project')
    if 'ptyId' in k: o.add('pty')
    if k & PATHS: o.add('path')
    return o
def strip_comments(t):
    t = re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), t, flags=re.S)
    return re.sub(r'(^|[\s;,{}()])//[^\n]*', r'\1', t)
lit = re.compile(r"""(['"`])([a-zA-Z]+(?:\.[a-zA-Z]+)+)\1""")
TYPE_BEFORE = re.compile(r'(?:Command(?:Input|Output|Result)|EventPayload|QueryCommand|Extract|Exclude)\s*<\s*$|extends\s+$|\|\s*$|:\s*$')
KEY_BEFORE = re.compile(r"queryKey\s*:\s*\[\s*(?:'maws'\s*,\s*)?$|\[\s*'maws'\s*,\s*$")
sites, other = [], collections.Counter()
for dp, _, fs in os.walk(os.path.join(root, 'src/renderer/src')):
    for f in fs:
        if not re.search(r'\.tsx?$', f) or re.search(r'\.test(-d)?\.tsx?$', f): continue
        p = os.path.join(dp, f); rel = os.path.relpath(p, root)
        if '/test-support/' in rel or rel.endswith('ipc/query.ts'): continue  # query.ts: the QUERY_COMMANDS list itself
        t = strip_comments(open(p, encoding='utf-8').read())
        for m in lit.finditer(t):
            n = m.group(2)
            if n not in cmds: continue
            b = t[max(0, m.start() - 80):m.start()]; a = t[m.end():m.end() + 3]
            if TYPE_BEFORE.search(b) or re.match(r'\s*[|>]', a): other['type position'] += 1; continue
            if KEY_BEFORE.search(b): other['query key'] += 1; continue
            if n in events and re.search(r'\bon\s*\(\s*$', b): other['event subscription'] += 1; continue
            w = re.search(r'([A-Za-z_$][\w$]*)\s*\((?:[^()]*,)?\s*$', b)
            if not w: other['bare literal (a list or comparison)'] += 1; continue
            sites.append((rel, t.count('\n', 0, m.start()) + 1, n, w.group(1), '/harness/' in rel))
def report(rows, label):
    md = [r for r in rows if dims(r[2])]
    print(f'== {label}: {len(rows)} command call sites in {len({r[0] for r in rows})} files; '
          f'machine dimension: {len(md)} sites in {len({r[0] for r in md})} files, {len({r[2] for r in md})} distinct commands')
    by = collections.Counter(k for r in md for k in dims(r[2])); print('   by dimension:', dict(by))
    return md
prod = [s for s in sites if not s[4]]
md = report(prod, 'production renderer (src/renderer/src minus tests, test-support, harness)')
report(sites, 'including harness pages')
strict = [s for s in prod if s[3] in ('invoke', 'useCommand')]
report(strict, 'production, strict (ipc.invoke / client.invoke / useCommand only)')
print('excluded literals:', dict(other))
print('wrappers (production, machine dimension):', collections.Counter(r[3] for r in md).most_common(12))
print('top commands:', collections.Counter(r[2] for r in md).most_common(25))
print('by namespace:', collections.Counter(r[2].split('.')[0] for r in md).most_common())
print('by owner:', collections.Counter(cmds[r[2]]['owner'] for r in md).most_common())
print('top files:', collections.Counter(r[0] for r in md).most_common(12))
print('registry: machine-dimension commands', sum(1 for n in cmds if dims(n)), 'of', len(cmds))
if '--list' in sys.argv:
    for r in md: print(*r[:4], sep='\t')
