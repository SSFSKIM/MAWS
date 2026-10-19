#!/usr/bin/env python3
"""The Desktop arm's non-GUI half (P4-A1): lays each repetition's pristine files, says the exact prompt the driver
types, and after the turn finds Desktop's own records, copies or rebuilds the edited artifact, runs the checker and
writes the manifest the parser reads (parse.py report). The GUI half (open a session, pick model, effort and mode, type,
send, wait) is desktop-driver.js through cua. Nothing here writes outside the run directory and the arm's folder;
Desktop's records are only read.

  python3 -I desktop-prep.py before <task> <rep> --out RUN [--surface code|cowork]
  python3 -I desktop-prep.py after  <task> <rep> --out RUN --permissions-answered N [--seed-transcript T] ...
  python3 -I desktop-prep.py deck   <transcript> <out dir>     a Cowork deck rebuilt from a session's records
  python3 -I desktop-prep.py kinds  <transcript.jsonl | audit.jsonl> ...   the artifact kinds a session was offered

Attempts: a repetition's records live in RUN/desktop-<task>-r<rep>, a later attempt at the same repetition in
…-a2, …-a3: nothing is overwritten. `before` opens the first attempt without a manifest; an attempt it finds laid but
never closed by `after` (the driver stopped) is closed with a manifest saying so, and the next one opened.

The surfaces:
  code    a Code session in the folder ARM_DIR ("MAWS parity bench", X39's project for this arm), on the owner's user
          scope, editing the plain files doc.md and deck.html (the same-engine kinds a Code session has while the
          owner's `enableArtifact: false` keeps the `Artifact` tool off). Records: Desktop's
          claude-code-sessions/<account>/<org>/local_<id>.json (cwd, cliSessionId, model, effort, permissionMode) and
          the transcript ~/.claude/projects/<slug>/<cliSessionId>.jsonl.
  cowork  a Cowork session (the home of Desktop's Slides artifacts when Code sessions lack them), its records under
          local-agent-mode-sessions/<account>/<org>/local_<id>/ (audit.jsonl, .claude/projects/<slug>/<id>.jsonl). The
          deck before and after the turn is rebuilt from the records (`rebuild`); ARM_DIR/bench-after/, the files the
          driver's untimed follow-up has the model write, is the last resort and the manifest says when it was used.
"""
import argparse
import glob
import importlib.util
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from datetime import datetime, timezone

sys.dont_write_bytecode = True  # parse.py is loaded beside this file; no __pycache__ in the spike

HERE = os.path.dirname(os.path.abspath(__file__))
ARM_DIR = os.environ.get('MAWS_BENCH_DESKTOP_DIR', '/tmp/maws-parity-bench/MAWS parity bench')
CLAUDE_APP = os.environ.get('MAWS_BENCH_CLAUDE_APP') or os.path.expanduser('~/Library/Application Support/Claude')  # overridable for a dry run
CONFIG_HOME = os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')
CLAUDE_USAGE = os.path.expanduser('~/Library/Application Support/ClaudeUsage')
SEED_DECK = os.path.join(HERE, 'seed', 'maws-deck')
FILES = {'document': 'doc.md', 'presentation': 'deck.html'}
# The landing calls: a plain file's edit tools (counted only on the artifact's file, `landingFiles`), or the publish of
# Cowork's deck (the engine's `Artifact` publishes when its `action` is 'publish' or omitted; a local Edit before it has
# not landed anything).
LANDING_FILE = ['Edit', 'Write', 'MultiEdit']
LANDING_DECK = ['Artifact', 'mcp__cowork__update_artifact']


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def jsonl(path):
    with open(path, encoding='utf-8') as f:
        return [json.loads(line) for line in f if line.strip()]


def bench_parse():
    spec = importlib.util.spec_from_file_location('bench_parse', os.path.join(HERE, 'parse.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def tasks():
    return json.loads(read(os.path.join(HERE, 'tasks.json')))


def deck_html():
    """The MAWS seed deck as one HTML file: the same six sections, in order, ids kept."""
    index = json.loads(read(os.path.join(SEED_DECK, 'project', 'deck.json')))
    sections = [read(os.path.join(SEED_DECK, 'project', 'slides', sid + '.html')).strip() for sid in index['order']]
    return ('<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>%s</title></head>\n<body>\n%s\n</body>\n</html>\n'
            % (index['title'], '\n'.join(sections)))


def pristine(kind):
    return read(os.path.join(HERE, 'seed', 'document.md')) if kind == 'document' else deck_html()


def load():
    return [round(x, 2) for x in os.getloadavg()]


def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


# ---- attempts -------------------------------------------------------------------------------------------------------

def attempts(out, task, rep):
    base = os.path.join(out, 'desktop-%s-r%s' % (task, rep))
    n = 1
    while True:
        yield n, base if n == 1 else '%s-a%d' % (base, n)
        n += 1


def open_attempt(out, task, rep):
    for n, d in attempts(out, task, rep):
        if os.path.isfile(os.path.join(d, 'manifest.json')):
            continue
        if os.path.isfile(os.path.join(d, 'pending.json')):  # laid, never closed: recorded as aborted, never reused
            p = json.loads(read(os.path.join(d, 'pending.json')))
            aborted = dict(arm='desktop', task=p['task'], rep=p['rep'], attempt=n, kind=p['kind'], surface=p['surface'], host=p['host'], startedAt=p['startedAt'],
                           prompt=p['prompt'], promptMatch=p['promptMatch'], transcript=None, humanStop=None, pin=None, measurementOnly=False,
                           check={'pass': False, 'detail': 'aborted: laid by before and never closed by after (the attempt was redone)'})
            write(os.path.join(d, 'manifest.json'), json.dumps(aborted, indent=2) + '\n')
            continue
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)
        return n, d


def pending_attempt(out, task, rep):
    found = None
    for n, d in attempts(out, task, rep):
        if not os.path.isdir(d):
            return found
        if os.path.isfile(os.path.join(d, 'pending.json')) and not os.path.isfile(os.path.join(d, 'manifest.json')):
            found = (n, d)


# ---- before ---------------------------------------------------------------------------------------------------------

def before(args):
    t = tasks()['tasks'][args.task]
    kind = t['kind']
    attempt, d = open_attempt(args.out, args.task, args.rep)
    os.makedirs(ARM_DIR, exist_ok=True)
    name = FILES[kind]
    for k, f in FILES.items():  # every repetition starts from the pristine files and the folder's settings as they began
        write(os.path.join(ARM_DIR, f), pristine(k))
    shutil.rmtree(os.path.join(ARM_DIR, 'bench-after'), ignore_errors=True)
    shutil.rmtree(os.path.join(ARM_DIR, '.claude'), ignore_errors=True)  # a permission answered "always" lands here
    shutil.copyfile(os.path.join(ARM_DIR, name), os.path.join(d, 'before-' + name))
    ref = name if args.surface == 'code' else '"%s"' % tasks()['titles'][kind]
    prompt = t['text'].replace('{ref}', ref)
    pending = dict(arm='desktop', task=args.task, rep=args.rep, attempt=attempt, kind=kind, surface=args.surface, host=socket.gethostname(), armDir=ARM_DIR,
                   prompt=prompt, promptMatch=t['text'][t['text'].index('{ref}') + len('{ref}'):], startedAt=datetime.now(timezone.utc).isoformat(), loadBefore=load())
    write(os.path.join(d, 'pending.json'), json.dumps(pending, indent=2) + '\n')
    print(json.dumps({'prompt': prompt, 'folder': ARM_DIR, 'file': name, 'attempt': attempt, 'pending': os.path.join(d, 'pending.json')}, indent=2))


# ---- Desktop's records ----------------------------------------------------------------------------------------------

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


def relay_logs(since):
    return sorted(p for p in glob.glob(os.path.join(CLAUDE_USAGE, 'gateway-requests*.jsonl')) if os.path.getmtime(p) >= since - 60)


# ---- a Cowork deck rebuilt from the records -------------------------------------------------------------------------
#
# The engine's `Artifact` tool publishes local files (2.1.302's schema): `file_path` the page or, on an Artifact made
# from a type, one of its data files; `edits` old_str/new_str pairs applied to `file_path` on disk, then published;
# `files` {published path: source path | {from} | null} beside it. The content therefore lives in the transcript's own
# writes (`Write`, `Edit`, `MultiEdit`) and the publish's `edits`; the rebuild replays them in order, successful calls
# only, and fails loudly on anything it cannot follow.

class RebuildError(Exception):
    pass


ARTIFACT_READS = ('list', 'read', 'read_page_data', 'open', 'pin', 'unpin', 'get_endpoints')


def calls(transcript, since=None, until=None):
    """The main thread's tool calls in order, with their inputs, the record's cwd and whether the call succeeded."""
    out, ok = [], {}
    for r in jsonl(transcript):
        if r.get('isSidechain'):
            continue
        content = (r.get('message') or {}).get('content')
        if not isinstance(content, list):
            continue
        for b in content:
            if not isinstance(b, dict):
                continue
            if r.get('type') == 'assistant' and b.get('type') == 'tool_use':
                t = ts(r['timestamp'])
                if (since is None or t >= since) and (until is None or t < until):
                    out.append(dict(id=b.get('id'), name=b.get('name'), input=b.get('input') or {}, cwd=r.get('cwd') or '/', t=t))
            elif r.get('type') == 'user' and b.get('type') == 'tool_result':
                ok[b.get('tool_use_id')] = not b.get('is_error')
    return [dict(c, ok=ok.get(c['id'], False)) for c in out]


class Replay:
    """Local files and the published deck, as the calls leave them."""

    def __init__(self, published=None):
        self.disk = {}
        self.published = dict(published or {})

    def path(self, call, p, root=None):
        if not isinstance(p, str) or not p:
            raise RebuildError('%s: a path that is not a string: %r' % (call['name'], p))
        base = os.path.join(call['cwd'], root) if root else call['cwd']
        return os.path.normpath(os.path.join(base, p))

    def text(self, call, p):
        if p in self.disk:
            return self.disk[p]
        # The same file under another session's mount of the folder: the longest unique match of trailing components.
        parts = p.split('/')
        for n in range(len(parts) - 1, 1, -1):
            tail = '/' + '/'.join(parts[-n:])
            hits = [k for k in self.disk if k.endswith(tail)]
            if len(hits) == 1:
                return self.disk[hits[0]]
            if len(hits) > 1:
                break
        raise RebuildError('%s on %s: the file\'s content is not in the records (no Write of it, here or in the seed\'s records)' % (call['name'], p))

    def replace(self, call, p, old, new, every=False):
        text = self.text(call, p)
        if not isinstance(old, str) or not old or not isinstance(new, str):
            raise RebuildError('%s on %s: an edit without old and new text' % (call['name'], p))
        n = text.count(old)
        if n == 0 or (n > 1 and not every):
            raise RebuildError('%s on %s: its old text occurs %d times in the file as the records give it' % (call['name'], p, n))
        self.disk[p] = text.replace(old, new) if every else text.replace(old, new, 1)

    @staticmethod
    def key(p, root=None):
        """A path as the deck publishes it: from its last `project/` component on, else relative to `root`, else (a local
        file) its name or (a published path) itself."""
        parts = p.strip('/').split('/')
        if 'project' in parts:
            return '/'.join(parts[len(parts) - 1 - parts[::-1].index('project'):])
        if root and p.startswith(root.rstrip('/') + '/'):
            return p[len(root.rstrip('/')) + 1:]
        return parts[-1] if p.startswith('/') else '/'.join(parts)

    def apply(self, call):
        name, inp = call['name'], call['input']
        if not call['ok']:
            return
        if name == 'Write':
            if not isinstance(inp.get('content'), str):
                raise RebuildError('Write of %s without content' % inp.get('file_path'))
            self.disk[self.path(call, inp.get('file_path'))] = inp['content']
        elif name == 'Edit':
            self.replace(call, self.path(call, inp.get('file_path')), inp.get('old_string'), inp.get('new_string'), bool(inp.get('replace_all')))
        elif name == 'MultiEdit':
            p = self.path(call, inp.get('file_path'))
            for e in inp.get('edits') or []:
                self.replace(call, p, e.get('old_string'), e.get('new_string'), bool(e.get('replace_all')))
        elif name == 'Artifact':
            self.artifact(call)

    def artifact(self, call):
        inp = call['input']
        action = inp.get('action') or 'publish'
        if action in ARTIFACT_READS:
            return
        if action != 'publish' or inp.get('asset') or inp.get('type_url') or inp.get('from_url'):
            raise RebuildError('Artifact %s with %s: not a publish this rebuild can follow' % (action, sorted(k for k in inp if k != 'description')))
        root = inp.get('root')
        root_abs = self.path(call, root) if root else None
        fp = self.path(call, inp['file_path']) if inp.get('file_path') else None
        for e in inp.get('edits') or []:
            if not isinstance(e, dict) or set(e) - {'old_str', 'new_str', 'path', 'file_path', 'replace_all'}:
                raise RebuildError('Artifact publish: an edit of an unknown shape %r' % (sorted(e) if isinstance(e, dict) else type(e).__name__))
            target = self.path(call, e.get('path') or e.get('file_path')) if (e.get('path') or e.get('file_path')) else fp
            if target is None:
                raise RebuildError('Artifact publish: edits with no file_path')
            self.replace(call, target, e.get('old_str'), e.get('new_str'), bool(e.get('replace_all')))
        if fp:
            self.published[self.key(fp, root_abs)] = self.text(call, fp)
        files = inp.get('files')
        if isinstance(files, list):
            files = {f: f for f in files}
        if files is not None and not isinstance(files, dict):
            raise RebuildError('Artifact publish: files of type %s' % type(files).__name__)
        for pub, src in (files or {}).items():
            if src is None:
                self.published.pop(self.key(pub), None)
            elif isinstance(src, str):
                self.published[self.key(pub)] = self.text(call, self.path(call, src, root))
            elif isinstance(src, dict) and isinstance(src.get('from'), str):
                self.published[self.key(pub)] = self.text(call, self.path(call, src['from'], root))
            else:
                raise RebuildError('Artifact publish: a files entry of an unknown shape for %s' % pub)
        if not fp and not files:
            raise RebuildError('Artifact publish with neither file_path nor files')


def seed_files():
    out = {}
    for root, _, names in os.walk(SEED_DECK):
        for n in names:
            p = os.path.join(root, n)
            out[os.path.relpath(p, SEED_DECK)] = read(p)
    return out


def write_deck(published, out_dir):
    """The published deck as check.py reads it: the Slides layout when it has project/deck.json, else its one HTML page."""
    shutil.rmtree(out_dir, ignore_errors=True)
    if 'project/deck.json' in published:
        stray = sorted(p for p in published if not p.startswith('project/'))
        if stray:
            raise RebuildError('published files outside the deck\'s project/ layout: %s' % stray)
        for path, text in published.items():
            write(os.path.join(out_dir, path), text)
        return out_dir
    pages = [p for p in published if p.lower().endswith(('.html', '.htm'))]
    if len(pages) != 1:
        raise RebuildError('the published files are not a deck (no project/deck.json and %d HTML pages): %s' % (len(pages), sorted(published)))
    write(out_dir + '.html', published[pages[0]])
    return out_dir + '.html'


def turn_window(transcript, match):
    """The timed turn's send and the next human turn's (or None): the turn matched by the task's words."""
    turns = bench_parse().parse_transcript(transcript)[2]
    text = lambda t: t['prompt'] if isinstance(t['prompt'], str) else ' '.join(b.get('text', '') for b in t['prompt'] or [] if isinstance(b, dict))
    for i, t in enumerate(turns):
        if match in text(t):
            return t['send'], turns[i + 1]['send'] if i + 1 < len(turns) else None
    raise RebuildError('no turn in %s matched the task' % transcript)


def check(*args):
    res = subprocess.run(['/usr/bin/python3', '-I', os.path.join(HERE, 'check.py'), *args], capture_output=True, text=True)
    return json.loads(res.stdout) if res.stdout.strip() else {'pass': False, 'detail': res.stderr.strip()[-300:]}


# ---- after ----------------------------------------------------------------------------------------------------------

def landing_actions(args, default):
    """For a tool that also reads (Cowork's `Artifact`), the operations that land an edit; the parser skips the rest. The
    engine's `Artifact` publishes when its action is omitted, so 'publish' also counts the calls that name none."""
    out = {}
    for spec in getattr(args, 'landing_actions', None) or []:
        tool, _, actions = spec.partition('=')
        out[tool] = [a for a in actions.split(',') if a]
    out = out or default
    if out and 'publish' in out.get('Artifact', []) and None not in out['Artifact']:
        out['Artifact'] = out['Artifact'] + [None]
    return out


def after(args):
    found = pending_attempt(args.out, args.task, args.rep)
    if found is None:
        sys.exit('no attempt at %s repetition %s laid by before and still open in %s' % (args.task, args.rep, args.out))
    attempt, d = found
    p = json.loads(read(os.path.join(d, 'pending.json')))
    started = ts(p['startedAt'])
    load_after = load()
    s = code_session(started) if p['surface'] == 'code' else cowork_session(started)
    if s is None:
        sys.exit('no Desktop %s session found since %s in %s' % (p['surface'], p['startedAt'], ARM_DIR))
    name = FILES[p['kind']]
    deck = p['kind'] == 'presentation' and p['surface'] == 'cowork'
    if args.seed_transcript and not deck:
        sys.exit('--seed-transcript is for a Cowork deck; this attempt is a %s on %s' % (p['kind'], p['surface']))
    seed_check, after_source, rebuild_error = None, None, None
    if not deck:  # a plain file in the folder, both surfaces
        before_path, after_path = os.path.join(d, 'before-' + name), os.path.join(d, 'after-' + name)
        shutil.copyfile(os.path.join(ARM_DIR, name), after_path)
        after_source = 'the file in the folder'
    else:
        if not s['transcript']:
            sys.exit('no transcript for the Cowork session %s' % s['local'])
        # Before: the seed's calls up to the timed turn's send (the seed transcript may be the timed one), else the
        # bench's seed deck. After: the same replay carried on through the timed turn's calls.
        try:
            send, until = turn_window(s['transcript'], p['promptMatch'])
            r = Replay(None if args.seed_transcript else seed_files())
            for c in calls(args.seed_transcript, until=send) if args.seed_transcript else []:
                r.apply(c)
            before_path = write_deck(r.published, os.path.join(d, 'before-deck')) if args.seed_transcript else SEED_DECK
        except RebuildError as e:
            sys.exit('the deck before the turn could not be rebuilt from the records: %s' % e)
        try:
            for c in calls(s['transcript'], since=send, until=until):
                r.apply(c)
            after_path = write_deck(r.published, os.path.join(d, 'after-deck'))
            after_source = "rebuilt from the records' calls"
        except RebuildError as e:
            rebuild_error = str(e)
            folder = os.path.join(ARM_DIR, 'bench-after')
            if not os.path.isfile(os.path.join(folder, 'project', 'deck.json')):
                sys.exit('the deck after the turn could not be rebuilt from the records (%s), and there is no %s' % (e, folder))
            after_path = os.path.join(d, 'after-deck')
            shutil.rmtree(after_path, ignore_errors=True)
            shutil.copytree(folder, after_path)
            after_source = 'bench-after/ (the model transcribed the deck; the last resort)'
        if args.seed_transcript:
            seed_check = check('same', SEED_DECK, before_path)
    result = check(p['task'], before_path, after_path)
    answered = args.permissions_answered
    plain = not deck
    manifest = dict(arm='desktop', task=p['task'], rep=p['rep'], attempt=attempt, kind=p['kind'], surface=p['surface'], host=p['host'], startedAt=p['startedAt'],
                    prompt=p['prompt'], promptMatch=p['promptMatch'], transcript=s['transcript'], audit=s['audit'], relay=relay_logs(started),
                    landing=LANDING_FILE if plain else LANDING_DECK, landingFiles=[name] if plain else None,
                    landingActions=landing_actions(args, None if plain else {'Artifact': ['publish']}),
                    load={'before': p['loadBefore'], 'after': load_after}, check=result, before=before_path, after=after_path, afterSource=after_source,
                    rebuildError=rebuild_error, seedTranscript=args.seed_transcript, seedCheck=seed_check, permissionsAnswered=answered,
                    humanStop='%d permission card%s answered in the turn' % (answered, '' if answered == 1 else 's') if answered else None,
                    pin=None, measurementOnly=bool(args.measurement_only), desktop=dict(local=s['local'], meta=s['meta'], cliVersion=s['cliVersion']))
    mpath = os.path.join(d, 'manifest.json')
    write(mpath, json.dumps(manifest, indent=2) + '\n')
    parse = bench_parse()
    row = parse.edit_row(mpath)
    print(json.dumps({'manifest': mpath, 'attempt': attempt, 'valid': parse.valid(row) or 'yes', 'check': result, 'afterSource': after_source,
                      'permissionMode': (row['measured'] or {}).get('permissionMode'), 'pickerPermissionMode': s['meta'].get('permissionMode'),
                      'seedCheck': seed_check, 'transcript': s['transcript'], 'meta': s['meta']}, indent=2))


def deck(args):
    """The hold's first read of a Cowork seed: the deck a session's records leave, written to OUT, and `same` against the
    bench's seed deck."""
    r = Replay()
    for c in calls(args.transcript):
        r.apply(c)
    out = write_deck(r.published, os.path.abspath(args.out))
    print(json.dumps({'deck': out, 'same': check('same', SEED_DECK, out)}, indent=2))


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
        for r in jsonl(path):
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
            a.add_argument('--permissions-answered', type=int, required=True, metavar='N',
                           help="the permission cards the driver answered in the turn (bench.rep()'s permissionsAnswered); more than 0 is a human stop")
            a.add_argument('--seed-transcript', metavar='T', help="a Cowork deck's seed session's transcript (it may be the timed one): the deck before the turn is rebuilt from it")
            a.add_argument('--measurement-only', action='store_true', help='the cell ran at Desktop\'s own setting, MAWS pinned to it')
            a.add_argument('--landing-actions', action='append', help='TOOL=op,op: the operations of TOOL that land an edit')
    dk = sub.add_parser('deck')
    dk.add_argument('transcript')
    dk.add_argument('out')
    k = sub.add_parser('kinds')
    k.add_argument('paths', nargs='+')
    args = ap.parse_args(argv)
    {'before': before, 'after': after, 'deck': deck, 'kinds': kinds}[args.cmd](args)


if __name__ == '__main__':
    main(sys.argv[1:])
