#!/usr/bin/env python3
"""The Desktop arm's non-GUI half (P4-A1): lays each repetition's pristine files, says the exact prompt the driver
types, and after the turn finds Desktop's own records, copies the edited artifact, runs the checker and writes the
manifest the parser reads (parse.py report). The GUI half (open a session, pick model, effort and mode, type, send,
wait) is desktop-driver.js through cua. Nothing here writes outside the run directory and the arm's folder; Desktop's
records are only read.

  python3 -I desktop-prep.py before <task> <rep> --out RUN [--surface code|cowork]
  python3 -I desktop-prep.py after  <task> <rep> --out RUN
  python3 -I desktop-prep.py kinds  <transcript.jsonl | audit.jsonl> ...   the artifact kinds a session was offered

The surfaces:
  code    a Code session in the folder ARM_DIR ("MAWS parity bench", X39's project for this arm), on the owner's user
          scope, editing the plain files doc.md and deck.html (the same-engine kinds a Code session has while the
          owner's `enableArtifact: false` keeps the `Artifact` tool off). Records: Desktop's
          claude-code-sessions/<account>/<org>/local_<id>.json (cwd, cliSessionId, model, effort, permissionMode) and
          the transcript ~/.claude/projects/<slug>/<cliSessionId>.jsonl.
  cowork  a Cowork session (the home of Desktop's Slides artifacts when Code sessions lack them), its records under
          local-agent-mode-sessions/<account>/<org>/local_<id>/ (audit.jsonl, .claude/projects/<slug>/<id>.jsonl). The
          deck after the turn is read from files the driver's untimed follow-up writes to ARM_DIR/bench-after/, else
          rebuilt from the turn's `Artifact` calls that carry whole `files` (checked at the record run's first step).
"""
import argparse
import glob
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ARM_DIR = os.environ.get('MAWS_BENCH_DESKTOP_DIR', '/tmp/maws-parity-bench/MAWS parity bench')
CLAUDE_APP = os.environ.get('MAWS_BENCH_CLAUDE_APP') or os.path.expanduser('~/Library/Application Support/Claude')  # overridable for a dry run
CONFIG_HOME = os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')
CLAUDE_USAGE = os.path.expanduser('~/Library/Application Support/ClaudeUsage')
FILES = {'document': 'doc.md', 'presentation': 'deck.html'}
LANDING = {'code': ['Edit', 'Write', 'MultiEdit'], 'cowork': ['Artifact', 'mcp__cowork__update_artifact', 'Edit', 'Write']}


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def tasks():
    return json.loads(read(os.path.join(HERE, 'tasks.json')))


def deck_html():
    """The MAWS seed deck as one HTML file: the same six sections, in order, ids kept."""
    index = json.loads(read(os.path.join(HERE, 'seed', 'maws-deck', 'project', 'deck.json')))
    sections = [read(os.path.join(HERE, 'seed', 'maws-deck', 'project', 'slides', sid + '.html')).strip() for sid in index['order']]
    return ('<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>%s</title></head>\n<body>\n%s\n</body>\n</html>\n'
            % (index['title'], '\n'.join(sections)))


def pristine(kind):
    return read(os.path.join(HERE, 'seed', 'document.md')) if kind == 'document' else deck_html()


def rep_dir(out, task, rep):
    return os.path.join(out, 'desktop-%s-r%s' % (task, rep))


def load():
    return [round(x, 2) for x in os.getloadavg()]


def before(args):
    t = tasks()['tasks'][args.task]
    kind = t['kind']
    d = rep_dir(args.out, args.task, args.rep)
    os.makedirs(d, exist_ok=True)
    os.makedirs(ARM_DIR, exist_ok=True)
    name = FILES[kind]
    for k, f in FILES.items():  # every repetition starts from the pristine files; nothing else in the folder changes
        write(os.path.join(ARM_DIR, f), pristine(k))
    shutil.rmtree(os.path.join(ARM_DIR, 'bench-after'), ignore_errors=True)
    shutil.copyfile(os.path.join(ARM_DIR, name), os.path.join(d, 'before-' + name))
    ref = name if args.surface == 'code' else '"%s"' % tasks()['titles'][kind]
    prompt = t['text'].replace('{ref}', ref)
    pending = dict(arm='desktop', task=args.task, rep=args.rep, kind=kind, surface=args.surface, host=socket.gethostname(), armDir=ARM_DIR,
                   prompt=prompt, promptMatch=t['text'][t['text'].index('{ref}') + len('{ref}'):], startedAt=datetime.now(timezone.utc).isoformat(), loadBefore=load())
    write(os.path.join(d, 'pending.json'), json.dumps(pending, indent=2) + '\n')
    print(json.dumps({'prompt': prompt, 'folder': ARM_DIR, 'file': name, 'pending': os.path.join(d, 'pending.json')}, indent=2))


def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


def code_session(started):
    """The newest Code session Desktop recorded in ARM_DIR since the repetition began."""
    best = None
    for path in glob.glob(os.path.join(CLAUDE_APP, 'claude-code-sessions', '*', '*', 'local_*.json')):
        try:
            meta = json.loads(read(path))
        except (OSError, ValueError):
            continue
        cwd = meta.get('cwd') or ''
        if not cwd or os.path.realpath(cwd) != os.path.realpath(ARM_DIR):
            continue
        created = meta.get('createdAt')
        created = created / 1000 if isinstance(created, (int, float)) else ts(created) if created else os.path.getmtime(path)
        if created + 5 < started:
            continue
        if best is None or created > best[0]:
            best = (created, path, meta)
    if best is None:
        return None
    _, path, meta = best
    sid = meta.get('cliSessionId')
    found = glob.glob(os.path.join(CONFIG_HOME, 'projects', '*', '%s.jsonl' % sid)) if sid else []
    keep = ('cliSessionId', 'cwd', 'model', 'effort', 'effortInherited', 'permissionMode', 'createdAt', 'latestUserFrameAt', 'completedTurns')
    return dict(transcript=found[0] if found else None, audit=None, local=path, meta={k: meta.get(k) for k in keep},
                cliVersion=(meta.get('toolSurfaceSnapshot') or {}).get('cliVersion'))


def cowork_session(started):
    """The newest Cowork session since the repetition began: its audit log and its engine transcript."""
    best = None
    for d in glob.glob(os.path.join(CLAUDE_APP, 'local-agent-mode-sessions', '*', '*', 'local_*')):
        audit = os.path.join(d, 'audit.jsonl')
        if os.path.isfile(audit) and os.path.getmtime(audit) + 5 >= started and (best is None or os.path.getmtime(audit) > best[0]):
            best = (os.path.getmtime(audit), d)
    if best is None:
        return None
    d = best[1]
    transcripts = sorted(glob.glob(os.path.join(d, '.claude', 'projects', '*', '*.jsonl')), key=os.path.getmtime)
    meta = {}
    if os.path.isfile(d + '.json'):
        m = json.loads(read(d + '.json'))
        meta = {k: m.get(k) for k in ('model', 'effort', 'effortOverride', 'permissionMode', 'createdAt', 'title') if k in m}
    return dict(transcript=transcripts[-1] if transcripts else None, audit=os.path.join(d, 'audit.jsonl'), local=d, meta=meta, cliVersion=None)


def deck_from_artifact_calls(transcript, base_html, out_dir):
    """The deck after a Cowork turn, rebuilt from its `Artifact` calls that carried whole files (`files`: path -> text),
    over the seed's files. Returns the directory, or None when no call carried files (then the driver's follow-up must
    have written ARM_DIR/bench-after/)."""
    files = {}
    seed = os.path.join(HERE, 'seed', 'maws-deck')
    for root, _, names in os.walk(seed):
        for n in names:
            p = os.path.join(root, n)
            files[os.path.relpath(p, seed)] = read(p)
    changed = False
    with open(transcript, encoding='utf-8') as f:
        for line in f:
            r = json.loads(line)
            if r.get('type') != 'assistant':
                continue
            for b in (r.get('message') or {}).get('content') or []:
                if b.get('type') == 'tool_use' and b.get('name') == 'Artifact' and isinstance((b.get('input') or {}).get('files'), dict):
                    for path, text in b['input']['files'].items():
                        key = path if path.startswith('project/') else 'project/' + path.lstrip('/')
                        if text is None:
                            files.pop(key, None)
                        else:
                            files[key] = text
                        changed = True
    if not changed:
        return None
    for path, text in files.items():
        write(os.path.join(out_dir, path), text)
    return out_dir


def relay_logs(since):
    return sorted(p for p in glob.glob(os.path.join(CLAUDE_USAGE, 'gateway-requests*.jsonl')) if os.path.getmtime(p) >= since - 60)


def landing_actions(args):
    """For a tool that also reads (Cowork's `Artifact`), the operations that land an edit, named at the hold's first
    step from the tool's real input (`--landing-actions Artifact=publish,deploy`); the parser then skips its reads."""
    out = {}
    for spec in getattr(args, 'landing_actions', None) or []:
        tool, _, actions = spec.partition('=')
        out[tool] = [a for a in actions.split(',') if a]
    return out or None


def after(args):
    d = rep_dir(args.out, args.task, args.rep)
    p = json.loads(read(os.path.join(d, 'pending.json')))
    started = ts(p['startedAt'])
    load_after = load()
    s = code_session(started) if p['surface'] == 'code' else cowork_session(started)
    if s is None:
        sys.exit('no Desktop %s session found since %s in %s' % (p['surface'], p['startedAt'], ARM_DIR))
    name = FILES[p['kind']]
    before_path = os.path.join(d, 'before-' + name)
    if p['surface'] == 'code':
        after_path = os.path.join(d, 'after-' + name)
        shutil.copyfile(os.path.join(ARM_DIR, name), after_path)
    else:
        before_path = os.path.join(HERE, 'seed', 'maws-deck') if p['kind'] == 'presentation' else before_path
        folder = os.path.join(ARM_DIR, 'bench-after')
        after_path = os.path.join(d, 'after-deck')
        if os.path.isfile(os.path.join(folder, 'project', 'deck.json')):
            shutil.copytree(folder, after_path, dirs_exist_ok=True)
        elif not s['transcript'] or deck_from_artifact_calls(s['transcript'], before_path, after_path) is None:
            sys.exit('no deck after the turn: neither %s nor an Artifact call with files' % folder)
    res = subprocess.run(['/usr/bin/python3', '-I', os.path.join(HERE, 'check.py'), p['task'], before_path, after_path], capture_output=True, text=True)
    check = json.loads(res.stdout) if res.stdout.strip() else {'pass': False, 'detail': res.stderr.strip()[-300:]}
    manifest = dict(arm='desktop', task=p['task'], rep=p['rep'], kind=p['kind'], surface=p['surface'], host=p['host'], startedAt=p['startedAt'],
                    prompt=p['prompt'], promptMatch=p['promptMatch'], transcript=s['transcript'], audit=s['audit'], relay=relay_logs(started),
                    landing=LANDING[p['surface']], landingActions=landing_actions(args), load={'before': p['loadBefore'], 'after': load_after}, check=check,
                    pin=None, measurementOnly=bool(getattr(args, 'measurement_only', False)), desktop=dict(local=s['local'], meta=s['meta'], cliVersion=s['cliVersion']))
    write(os.path.join(d, 'manifest.json'), json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'manifest': os.path.join(d, 'manifest.json'), 'check': check, 'transcript': s['transcript'], 'meta': s['meta']}, indent=2))


KIND_TOOLS = {
    'server-hosted Slides/Design/Docs/Dashboard (Artifact)': lambda n: n == 'Artifact',
    'Cowork local HTML artifacts': lambda n: n in ('mcp__cowork__create_artifact', 'mcp__cowork__update_artifact'),
    # the hosted Docs connector is a claude.ai MCP server named by a uuid, with Docs' verbs
    'Claude Docs connector': lambda n: re.fullmatch(r'mcp__[0-9a-f]{8}-[0-9a-f-]{27}__(batch|guide|create|read|query|export|update|delete)', n) is not None,
    'show_widget': lambda n: n.endswith('__show_widget'),
}


def kinds(args):
    """The record run's first read (R-6): which kinds a session was offered, from the names its records carry: a Cowork
    audit's system/init tools; a Code transcript's deferred-tool lists, its tool calls, and the tool names a probe turn
    was asked to list (its assistant text)."""
    for path in args.paths:
        names = set()
        listed = ''
        for line in open(path, encoding='utf-8'):
            r = json.loads(line)
            if r.get('type') == 'system' and r.get('subtype') == 'init':
                names.update(r.get('tools') or [])
            a = r.get('attachment') or {}
            if a.get('type') in ('deferred_tools_delta', 'deferred_tools_record'):
                names.update(x if isinstance(x, str) else (x or {}).get('name', '') for x in (a.get('addedNames') or a.get('entries') or []))
            if r.get('type') == 'assistant':
                for b in (r.get('message') or {}).get('content') or []:
                    if b.get('type') == 'tool_use':
                        names.add(b.get('name'))
                    if b.get('type') == 'text':
                        listed += '\n' + b.get('text', '')
        names.update(w.strip(' -*`') for w in listed.split() if w.strip(' -*`'))
        print(json.dumps({'records': path, 'tools': len(names), 'kinds': {k: sorted(n for n in names if f(n)) for k, f in KIND_TOOLS.items()}}, indent=2))


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name in ('before', 'after'):
        a = sub.add_parser(name)
        a.add_argument('task', choices=('B1', 'B3', 'B5', 'B7'))
        a.add_argument('rep', type=int)
        a.add_argument('--out', required=True)
        if name == 'before':
            a.add_argument('--surface', choices=('code', 'cowork'), default='code')
        else:
            a.add_argument('--measurement-only', action='store_true', help='the cell ran at Desktop\'s own setting, MAWS pinned to it')
            a.add_argument('--landing-actions', action='append', help='TOOL=op,op: the operations of TOOL that land an edit')
    k = sub.add_parser('kinds')
    k.add_argument('paths', nargs='+')
    args = ap.parse_args(argv)
    {'before': before, 'after': after, 'kinds': kinds}[args.cmd](args)


if __name__ == '__main__':
    main(sys.argv[1:])
