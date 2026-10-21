#!/usr/bin/env python3
"""The Desktop arm's non-GUI half (P4-A1): lays each repetition's pristine files, says the exact prompt the driver
types, and after the turn finds Desktop's own records, copies or rebuilds the edited artifact, runs the checker and
writes the manifest the parser reads (parse.py report). The GUI half (open a session, pick model, effort and mode, type,
send, wait) is desktop-driver.js through cua. Nothing here writes outside the run directory and the arm's folder;
Desktop's records are only read.

  python3 -I desktop-prep.py before <task> <rep> --out RUN [--surface code|cowork] [--seed next|<id>] [--ref TEXT]
  python3 -I desktop-prep.py after  <task> <rep> --out RUN --permissions-answered N [--transcript FILE|newest] ...
  python3 -I desktop-prep.py deck   <transcript> <out dir>     a Cowork deck rebuilt from a session's records, its url,
                                                               `same` against the bench's, and the turns' permission modes
  python3 -I desktop-prep.py kinds  <transcript.jsonl | audit.jsonl> ...   the artifact kinds a session was offered and
                                                               the permission mode its records carry
  python3 -I desktop-prep.py seed-prompt                       the untimed prompt that makes a Cowork seed deck
  python3 -I desktop-prep.py seed-add <transcript|newest> --out RUN   a seed session's deck checked and entered in RUN/seeds.json

Cloud Cowork (Desktop 3.1623.0, findings §7b): the Claude tab's Cowork runs in Anthropic's cloud (entrypoint
remote_cowork, a Linux VM, engine 2.1.305) and keeps its transcript in the VM. After the turn, an untimed follow-up in
the same session has it send that file (desktop-driver.js `bench.handOver()`), and Desktop saves it under ~/Downloads.
`after --transcript newest` (or a path) and `seed-add newest` take the newest .jsonl there, copy it into the run and
read it like any transcript; the follow-up's own records come after the timed turn's and the turn window leaves them
out. A fresh session is told by the records' session id, not the file: two hand-overs of one session are one session.

Seeds (§7a): a Cowork deck's timed turn runs in a fresh session of its own, on a deck an untimed Cowork session made
beforehand from seed/maws-deck (`seed-prompt`). `seed-add` rebuilds that deck from the seed session's records, checks it
`same` against the bench's, reads its url and the seed turn's permission mode, and enters it in the run's seeds ledger
(good only when the session created the deck itself and no other entry names the same Artifact); `before --seed next`
takes the next good seed not yet used (a seed is used once, even by an attempt that is then redone), names its deck in
the prompt by its url, and keeps its transcript for `after`. `after` stops, before any rebuild, when the timed turn's
successful calls create an Artifact or publish or read_file another than the seed's, and records the seed and whether
the timed turn ran in another session than the seed's (`seedId`, `freshSession`; the parser excludes a Cowork deck
repetition without either).

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
import contextlib
import glob
import importlib.util
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import unicodedata
from datetime import datetime, timezone

sys.dont_write_bytecode = True  # parse.py is loaded beside this file; no __pycache__ in the spike

HERE = os.path.dirname(os.path.abspath(__file__))
ARM_DIR = os.environ.get('MAWS_BENCH_DESKTOP_DIR', '/tmp/maws-parity-bench/MAWS parity bench')
CLAUDE_APP = os.environ.get('MAWS_BENCH_CLAUDE_APP') or os.path.expanduser('~/Library/Application Support/Claude')  # overridable for a dry run
CONFIG_HOME = os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')
CLAUDE_USAGE = os.path.expanduser('~/Library/Application Support/ClaudeUsage')
# Where Desktop saves a file a cloud Cowork session hands over (bench.handOver() in desktop-driver.js).
DOWNLOADS = os.environ.get('MAWS_BENCH_DOWNLOADS') or os.path.expanduser('~/Downloads')
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
            why = 'aborted: laid by before and never closed by after (the attempt was redone)'
            if p.get('afterStopped'):
                why += '; after had stopped on: %s' % p['afterStopped']
            aborted = dict(arm='desktop', task=p['task'], rep=p['rep'], attempt=n, kind=p['kind'], surface=p['surface'], host=p['host'], startedAt=p['startedAt'],
                           prompt=p['prompt'], promptMatch=p['promptMatch'], transcript=None, humanStop=None, pin=None, measurementOnly=False,
                           check={'pass': False, 'detail': why})
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

# ---- a cloud session's handed-over transcript ------------------------------------------------------------------------

def handed_over(arg, since, dest):
    """The handed-over transcript `arg` (a path, or 'newest': the newest .jsonl in DOWNLOADS saved since `since`), copied
    to `dest`, so the run keeps its own copy."""
    if arg == 'newest':
        found = sorted((os.path.getmtime(p), p) for p in glob.glob(os.path.join(DOWNLOADS, '*.jsonl'))
                       if since is None or os.path.getmtime(p) + 5 >= since)
        if not found:
            sys.exit('no .jsonl in %s saved since %s: hand the transcript over first (bench.handOver())' % (DOWNLOADS, since))
        arg = found[-1][1]
    if not os.path.isfile(arg):
        sys.exit('no transcript at %s' % arg)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copyfile(arg, dest)
    return dest


def session_id(transcript):
    return bench_parse().parse_transcript(transcript)[0]['sessionId']


def transcript_session(path):
    """A session known only by its transcript (a cloud Cowork hand-over): what Desktop's local records would have said."""
    meta, _, turns = bench_parse().parse_transcript(path)
    return dict(transcript=path, audit=None, local=None, cliVersion=meta['version'],
                meta=dict(sessionId=meta['sessionId'], entrypoint=meta['entrypoint'], version=meta['version'],
                          permissionMode=turns[0]['permissionMode'] if turns else None))


# ---- the seeds ledger ------------------------------------------------------------------------------------------------

def ledger_path(out):
    return os.path.join(out, 'seeds.json')


def ledger(out):
    p = ledger_path(out)
    return json.loads(read(p)) if os.path.isfile(p) else {'seeds': []}


def save_ledger(out, led):
    os.makedirs(out, exist_ok=True)
    tmp = ledger_path(out) + '.tmp'
    write(tmp, json.dumps(led, indent=2) + '\n')
    os.replace(tmp, ledger_path(out))


def take_seed(out, which, used_by):
    led = ledger(out)
    good = [s for s in led['seeds'] if s['ok'] and s['usedBy'] is None]
    pick = good[0] if which == 'next' and good else next((s for s in led['seeds'] if s['id'] == which), None)
    if pick is None:
        sys.exit('no good unused seed in %s (%d seeds, %d good and unused)' % (ledger_path(out), len(led['seeds']), len(good)) if which == 'next'
                 else 'no seed %s in %s' % (which, ledger_path(out)))
    if not pick['ok'] or pick['usedBy'] is not None:
        sys.exit('seed %s is %s' % (pick['id'], 'used by %s' % pick['usedBy'] if pick['usedBy'] else 'not good: %s' % pick['why']))
    pick['usedBy'] = used_by
    save_ledger(out, led)
    return pick


def before(args):
    t = tasks()['tasks'][args.task]
    kind = t['kind']
    if args.seed and not (kind == 'presentation' and args.surface == 'cowork'):
        sys.exit('--seed is for a Cowork deck; %s on %s takes none' % (args.task, args.surface))
    attempt, d = open_attempt(args.out, args.task, args.rep)
    os.makedirs(ARM_DIR, exist_ok=True)
    name = FILES[kind]
    for k, f in FILES.items():  # every repetition starts from the pristine files and the folder's settings as they began
        write(os.path.join(ARM_DIR, f), pristine(k))
    shutil.rmtree(os.path.join(ARM_DIR, 'bench-after'), ignore_errors=True)
    shutil.rmtree(os.path.join(ARM_DIR, '.claude'), ignore_errors=True)  # a permission answered "always" lands here
    shutil.copyfile(os.path.join(ARM_DIR, name), os.path.join(d, 'before-' + name))
    seed = take_seed(args.out, args.seed, dict(task=args.task, rep=args.rep, attempt=attempt, at=datetime.now(timezone.utc).isoformat())) if args.seed else None
    ref = args.ref or (seed['url'] if seed else name if args.surface == 'code' else '"%s"' % tasks()['titles'][kind])
    prompt = t['text'].replace('{ref}', ref)
    pending = dict(arm='desktop', task=args.task, rep=args.rep, attempt=attempt, kind=kind, surface=args.surface, host=socket.gethostname(), armDir=ARM_DIR,
                   prompt=prompt, promptMatch=t['text'][t['text'].index('{ref}') + len('{ref}'):], startedAt=datetime.now(timezone.utc).isoformat(), loadBefore=load(),
                   seedId=seed and seed['id'], seedTranscript=seed and seed['transcript'], seedUrl=seed and seed['url'])
    write(os.path.join(d, 'pending.json'), json.dumps(pending, indent=2) + '\n')
    note = 'no seed: a Cowork deck repetition of the record takes --seed (§7a)' if kind == 'presentation' and args.surface == 'cowork' and not seed else None
    print(json.dumps({'prompt': prompt, 'folder': ARM_DIR, 'file': name, 'attempt': attempt, 'seed': seed and seed['id'], 'seedUrl': seed and seed['url'],
                      'note': note, 'pending': os.path.join(d, 'pending.json')}, indent=2))


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
    try:
        m = json.loads(read(d + '.json'))
        meta = {k: m.get(k) for k in ('model', 'effort', 'effortOverride', 'permissionMode', 'createdAt', 'title') if k in m}
    except (OSError, ValueError, AttributeError):  # Desktop's own file, absent or mid-write: the records still carry the turn
        pass
    return dict(transcript=transcripts[-1] if transcripts else None, audit=os.path.join(d, 'audit.jsonl'), local=d, meta=meta, cliVersion=None)


def relay_logs(since):
    return sorted(p for p in glob.glob(os.path.join(CLAUDE_USAGE, 'gateway-requests*.jsonl')) if os.path.getmtime(p) >= since - 60)


# ---- a Cowork deck rebuilt from the records -------------------------------------------------------------------------
#
# The engine's `Artifact` tool publishes local files (2.1.302's schema): `file_path` the page or, on an Artifact made
# from a type (the Slides deck is one), one of its data files, served at its path relative to `root`, else to the
# working directory, and refused if it lies outside (cli.pretty.js `bg()`); `edits` old_str/new_str pairs applied to
# `file_path` on disk, then published; `files` beside it, a map {published path: source path | {from, contentType} |
# null} or a list [{path, contentType}] (each file published at its own spelling, read from it); `root` the folder
# relative sources resolve against, which never changes a `files` key. A `type_url` publish creates a new Artifact from
# a type (the Slides flow: quickstart, the create, then the deck's files written and published to its url); a publish
# naming no `url` goes where its `file_path` was last published in the session (the engine's `frameUrls`), else makes
# a new Artifact. The content therefore lives in the transcript's own writes (`Write`, `Edit`, `MultiEdit`), the
# publish's `edits` and the published files `read_file` saves locally; the rebuild replays them in order, successful
# calls only, follows one deck (its url learned from the records) and fails loudly on anything it cannot follow.

class RebuildError(Exception):
    pass


@contextlib.contextmanager
def rebuilding():
    """Any error while rebuilding is the rebuild's own, so `after`'s fallback and exits apply to it."""
    try:
        yield
    except RebuildError:
        raise
    except Exception as e:
        raise RebuildError('an unexpected %s in the rebuild: %s' % (type(e).__name__, e)) from e


# The engine's Artifact actions (2.1.302: every action its schema can offer, cli.pretty.js `Qe()`), by what each does to
# the artifact. A publish is replayed and a read_file followed (it saves a published file locally, where an edit then
# finds it); these leave the artifact's files as they were; the unfollowed change the artifact in ways its records do
# not carry (its sync, store, assets, existence or endpoints) and fail loudly, as does any action outside the list.
ARTIFACT_KEEPS = frozenset((
    'list', 'read', 'list_types', 'describe_type', 'quickstart', 'comments', 'reply', 'resolve', 'watch', 'unwatch', 'status',
    'resume_replies', 'read_page_data', 'verify', 'read_db', 'room_send', 'list_assets', 'read_asset', 'list_files', 'preview',
    'open', 'get_endpoints', 'pin', 'unpin', 'share'))
ARTIFACT_UNFOLLOWED = frozenset(('sync', 'write_db', 'upload_asset', 'delete_asset', 'copy_from', 'delete', 'call_endpoint', 'run_script'))
# The split tools some sessions get instead of those actions (2.1.302's ArtifactComments, ArtifactCheck, ArtifactData):
# only ArtifactData writes, with these operations.
ARTIFACT_DATA_WRITES = frozenset(('set', 'update', 'str_replace', 'delete', 'batch'))


def artifact_action(inp):
    """The call's action by its canonical name: the engine's consolidated spellings (publish with `asset: true`, read with
    a file `path` or `paths`, delete with an asset id as `path`; 2.1.302's `NRe`) mapped back."""
    action = inp.get('action') or 'publish'
    path = inp.get('path')
    if action == 'publish' and inp.get('asset') is True:
        return 'copy_from' if isinstance(inp.get('from_url'), str) or isinstance(inp.get('asset_ids'), list) else 'upload_asset'
    if action == 'read' and (isinstance(path, str) or isinstance(inp.get('paths'), list)):
        return 'read_asset' if isinstance(path, str) and re.fullmatch(r'[0-9a-f]{32}', path) else 'read_file'
    if action == 'delete' and isinstance(path, str):
        return 'delete_asset'
    return action


def shape(x):
    return sorted(x) if isinstance(x, dict) else type(x).__name__


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


# The engine's Artifact url grammar (2.1.302's cli.pretty.js `Yt`, `J`, `T`; `al` compares urls by the uuid it yields):
# https://[<one label>.]claude.ai/ then artifact/, code/artifact/ or code/frame/, an optional vanity `<name>-`, and the
# Artifact's uuid or its 22-character short id (`CW`: base58 of the uuid's 128 bits, big-endian, Bitcoin's alphabet;
# the engine spells its own url either way, `zNr`); or https://<uuid>.frame.[staging.]claudeusercontent.com.
UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
ARTIFACT_URL = re.compile(r'https://(?:[a-z0-9-]+\.)?claude\.ai/(?:artifact|code/(?:artifact|frame))/(?:[A-Za-z0-9_-]*-)?'
                          r'(%s|[%s]{22})(?:[/?#]|\Z)' % (UUID, BASE58))
FRAME_URL = re.compile(r'https://(%s)\.frame\.(?:staging\.)?claudeusercontent\.com(?:[/?#]|\Z)' % UUID)


def short_id_uuid(s):
    """A 22-character short id's uuid (`CW`), or None past 128 bits."""
    n = 0
    for c in s:
        n = n * 58 + BASE58.index(c)
    if n >= 1 << 128:
        return None
    h = '%032x' % n
    return '%s-%s-%s-%s-%s' % (h[:8], h[8:12], h[12:16], h[16:20], h[20:])


def artifact_id(url):
    """The Artifact a url names, as the engine compares urls: its uuid, so a short-id and a uuid spelling of one
    Artifact (with or without a vanity prefix, a path, query or fragment after the id) compare equal. A url the
    engine does not read as an Artifact's is only ever equal to itself."""
    m = ARTIFACT_URL.match(url)
    uuid = (m.group(1) if len(m.group(1)) != 22 else short_id_uuid(m.group(1))) if m else None
    if uuid is None:
        m = FRAME_URL.match(url)
        uuid = m.group(1) if m else None
    return ('artifact', uuid) if uuid is not None else ('url', url)


class Replay:
    """Local files and the published deck, as the calls leave them. The deck is one Artifact: a create (`type_url`) is
    the seed's alone, and every publish and read_file goes to the deck's url, learned from the first of them that names
    one (after the seed's last create); a publish naming none goes where the engine's frameUrls sends its file_path,
    which must be the deck: the engine keeps one file_path per Artifact, the one last published to it in the session
    (2.1.302's publish drops the Artifact's other entries), so only that file follows to the deck without a url."""

    def __init__(self, published=None):
        self.disk = {}
        self.published = dict(published or {})
        self.fetched = {}  # published path -> its text when a read_file saved it locally
        self.seeding = True  # replaying the seed's calls, the only place a create belongs
        self.url = None  # the deck's url, once a call names it
        self.url_from = None  # 'seed' or 'timed': whose call named it first
        self.replaced = set()  # the ids of decks a later create in the seed replaced
        self.sent = set()  # the deck's entry in the engine's frameUrls: the file_path last published to it in this session

    def timed(self, same_session):
        """The timed turn's calls follow; another session than the seed's remembers none of its files' urls."""
        self.seeding = False
        if not same_session:
            self.sent = set()

    def path(self, call, p, root=None):
        if not isinstance(p, str) or not p:
            raise RebuildError('%s: a path that is not a string: %r' % (call['name'], p))
        if root is not None and not isinstance(root, str):
            raise RebuildError('%s: a root that is not a string: %r' % (call['name'], root))
        base = os.path.join(call['cwd'], root) if root else call['cwd']
        return os.path.normpath(os.path.join(base, p))

    @staticmethod
    def served(call, p):
        """A published path as the engine keys it (2.1.302's `xe()`): NFC, relative, no empty, "." or ".." segment."""
        if not isinstance(p, str) or not p:
            raise RebuildError('%s: a published path that is not a string: %r' % (call['name'], p))
        k = unicodedata.normalize('NFC', p)
        if k.startswith('/') or '\\' in k or any(s in ('', '.', '..') for s in k.split('/')):
            raise RebuildError('%s: %r is not a published path the engine accepts' % (call['name'], p))
        return k

    def data_file(self, call, fp, root):
        """Where the engine serves a data `file_path` (2.1.302's `bg()`): at its path relative to `root` (resolved against
        the working directory), else to the working directory; one outside it is refused."""
        base = self.path(call, root) if root else os.path.normpath(call['cwd'])
        rel = os.path.relpath(fp, base)
        if rel in ('.', '..') or rel.startswith('../'):
            raise RebuildError('Artifact publish: file_path %s is not inside %s, which a data file is served relative to' % (fp, base))
        return self.served(call, rel)

    def target(self, call, fp=None):
        """A publish (of the local file fp) or a read_file goes to the deck; the first that names a url names the deck's."""
        action, url = artifact_action(call['input']), call['input'].get('url')
        if url is None:
            if fp is not None and fp in self.sent:
                return
            raise RebuildError('Artifact %s naming no url%s: its target is not in the records (a publish goes to the Artifact whose '
                               'latest file_path in the session it is, else makes a new Artifact; a read_file needs a url)' % (action, ' of %s' % fp if fp else ''))
        if not isinstance(url, str) or not url:
            raise RebuildError('Artifact %s: a url that is not a string: %r' % (action, url))
        if self.url is None:
            if artifact_id(url) in self.replaced:
                raise RebuildError('Artifact %s to %s: a deck the seed replaced by creating another' % (action, url))
            self.url, self.url_from = url, 'seed' if self.seeding else 'timed'
        elif artifact_id(url) != artifact_id(self.url):
            raise RebuildError('Artifact %s to %s: another Artifact than the deck (%s)' % (action, url, self.url))

    def text(self, call, p):
        if p in self.disk:
            return self.disk[p]
        # A published file a read_file saved: it lands under its published path (in the scratchpad, or out_dir), so a
        # local path ending in a fetched published path is that copy.
        hits = [k for k in self.fetched if p.endswith('/' + k)]
        if hits:
            return self.fetched[max(hits, key=len)]
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

    def apply(self, call):
        name, inp = call['name'], call['input']
        if not call['ok']:
            # A create that fails may still have made its Artifact and pointed its file_path there (2.1.302's `LR` runs
            # before the publish's own steps), so that file no longer follows to the deck without a url.
            if name == 'Artifact' and isinstance(inp.get('type_url'), str) and isinstance(inp.get('file_path'), str) and inp['file_path']:
                self.sent.discard(self.path(call, inp['file_path']))
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
        elif name == 'ArtifactData' and inp.get('action') in ARTIFACT_DATA_WRITES:
            raise RebuildError('ArtifactData %s: it writes the artifact\'s store, which the records do not carry' % inp.get('action'))

    def artifact(self, call):
        inp = call['input']
        action = artifact_action(inp)
        if action in ARTIFACT_KEEPS or (action == 'run_script' and inp.get('mode') == 'query'):  # a query runs read verbs only
            return
        if action == 'read_file':
            self.target(call)
            paths = [inp.get('path')] + (inp.get('paths') if isinstance(inp.get('paths'), list) else [])
            for k in (self.served(call, p) for p in paths if isinstance(p, str) and p):
                if k in self.published:
                    self.fetched[k] = self.published[k]
            return
        if action in ARTIFACT_UNFOLLOWED:
            raise RebuildError('Artifact %s: it changes the artifact in a way the records do not carry' % action)
        if action != 'publish':
            raise RebuildError('Artifact %r: not an action of the engine\'s Artifact tool (2.1.302)' % action)
        if inp.get('from_url'):
            raise RebuildError('Artifact publish with from_url: not a publish this rebuild can follow')
        root = inp.get('root')
        fp = self.path(call, inp['file_path']) if inp.get('file_path') else None
        files = self.files(call, inp.get('files'), root)
        if isinstance(inp.get('type_url'), str):  # a create: a new Artifact from a type, none of the files published before its own
            if not self.seeding:
                raise RebuildError('Artifact publish with type_url in the timed turn: it creates a new Artifact rather than edit the deck')
            if self.url is not None:
                self.replaced.add(artifact_id(self.url))
            self.published, self.url, self.url_from, self.sent = {}, None, None, set()
            if fp is None and not files:
                return  # an empty deck; its files are published to its url next
        elif fp is not None:
            self.target(call, fp)
        if fp is None:
            raise RebuildError('Artifact publish with no file_path (the engine publishes none without one)')
        for e in inp.get('edits') or []:
            if not isinstance(e, dict) or set(e) - {'old_str', 'new_str', 'path', 'file_path', 'replace_all'}:
                raise RebuildError('Artifact publish: an edit of an unknown shape %r' % shape(e))
            target = self.path(call, e.get('path') or e.get('file_path')) if (e.get('path') or e.get('file_path')) else fp
            self.replace(call, target, e.get('old_str'), e.get('new_str'), bool(e.get('replace_all')))
        self.published[self.data_file(call, fp, root)] = self.text(call, fp)
        for pub, src in files:
            if src is None:
                self.published.pop(pub, None)
            else:
                self.published[pub] = self.text(call, src)
        self.sent = {fp}  # the engine repoints fp at the deck and forgets the deck's earlier file_path

    def files(self, call, files, root):
        """A publish's `files` as (published path, local source or None) pairs. The map form {published path: source |
        {from, contentType} | null}; the list form [{path, contentType}], each file published at its own spelling and read
        from it. Sources resolve against `root`, else the working directory; a published path is as spelled. Anything
        else (a copy from another artifact's files, a live file) is not in the records."""
        if files is None:
            return []
        source = lambda src: self.path(call, src, root)
        if isinstance(files, list):
            out = []
            for e in files:
                if not (isinstance(e, dict) and isinstance(e.get('path'), str) and e['path'] and set(e) <= {'path', 'contentType'}):
                    raise RebuildError('Artifact publish: a files list entry of an unknown shape %r' % shape(e))
                out.append((self.served(call, e['path']), source(e['path'])))
            return out
        if isinstance(files, dict):
            out = []
            for pub, src in files.items():
                if src is None:
                    out.append((self.served(call, pub), None))
                elif isinstance(src, str):
                    out.append((self.served(call, pub), source(src)))
                elif isinstance(src, dict) and isinstance(src.get('from'), str) and set(src) <= {'from', 'contentType'}:
                    out.append((self.served(call, pub), source(src['from'])))
                else:
                    raise RebuildError('Artifact publish: the files entry for %s is of an unknown shape %r' % (pub, shape(src)))
            return out
        raise RebuildError('Artifact publish: files of type %s' % type(files).__name__)


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


def creates(call):
    """A successful create: a publish (the action omitted or 'publish', not an asset's) with `type_url`, which makes a new
    Artifact from a type. A read or list naming a type_url only reads the type."""
    return call['name'] == 'Artifact' and call['ok'] and artifact_action(call['input']) == 'publish' and isinstance(call['input'].get('type_url'), str)


def off_seed(timed, seed_url):
    """How the timed turn's successful calls leave the seed's deck, or None: a create, or a publish or read_file naming
    another Artifact than the seed's (compared the engine's way). Checked before anything is rebuilt, since the replay's
    refusals of the same calls fall back to bench-after/ and the parser would time a publish to another deck."""
    for c in timed:
        if c['name'] != 'Artifact' or not c['ok']:
            continue
        if creates(c):
            return 'created a new Artifact (a publish with type_url %s)' % c['input']['type_url']
        url = c['input'].get('url')
        publish = (c['input'].get('action') or 'publish') == 'publish'  # every spelling the parser counts as a landing, an asset's too
        if (publish or artifact_action(c['input']) == 'read_file') and isinstance(url, str) and artifact_id(url) != artifact_id(seed_url):
            return '%s %s' % ('published to' if publish else 'read a file of', url)
    return None


def check(*args):
    res = subprocess.run(['/usr/bin/python3', '-I', os.path.join(HERE, 'check.py'), *args], capture_output=True, text=True)
    try:
        return json.loads(res.stdout)
    except ValueError:
        return {'pass': False, 'detail': 'check.py gave no verdict: %s' % (res.stderr.strip() or res.stdout.strip())[-300:]}


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


def stop(d, p, why):
    """`after` cannot close the attempt: it stays open for `after` again (a wrong --seed-transcript, bench-after/ still to
    be written), and the reason is kept in its pending.json, so that an attempt redone instead is closed saying why."""
    p['afterStopped'] = why
    write(os.path.join(d, 'pending.json'), json.dumps(p, indent=2) + '\n')
    sys.exit(why)


def after(args):
    found = pending_attempt(args.out, args.task, args.rep)
    if found is None:
        sys.exit('no attempt at %s repetition %s laid by before and still open in %s' % (args.task, args.rep, args.out))
    attempt, d = found
    p = json.loads(read(os.path.join(d, 'pending.json')))
    started = ts(p['startedAt'])
    load_after = load()
    if args.transcript:  # a cloud Cowork session: its records are the handed-over transcript
        s = transcript_session(handed_over(args.transcript, started, os.path.join(d, 'transcript.jsonl')))
    else:
        s = code_session(started) if p['surface'] == 'code' else cowork_session(started)
    if s is None:
        stop(d, p, 'no Desktop %s session found since %s in %s' % (p['surface'], p['startedAt'], ARM_DIR))
    name = FILES[p['kind']]
    deck = p['kind'] == 'presentation' and p['surface'] == 'cowork'
    if p.get('seedTranscript'):  # the seed `before --seed` took; an explicit --seed-transcript must name the same one
        if args.seed_transcript and os.path.realpath(args.seed_transcript) != os.path.realpath(p['seedTranscript']):
            sys.exit('--seed-transcript %s is not the seed %s took (%s)' % (args.seed_transcript, p['seedId'], p['seedTranscript']))
        args.seed_transcript = p['seedTranscript']
    if args.seed_transcript and not deck:
        sys.exit('--seed-transcript is for a Cowork deck; this attempt is a %s on %s' % (p['kind'], p['surface']))
    seed_check, after_source, rebuild_error, deck_url, deck_url_from, fresh = None, None, None, None, None, None
    if not deck:  # a plain file in the folder, both surfaces
        before_path, after_path = os.path.join(d, 'before-' + name), os.path.join(d, 'after-' + name)
        try:
            shutil.copyfile(os.path.join(ARM_DIR, name), after_path)
            after_source = 'the file in the folder'
        except OSError as e:  # the turn removed it: the checker fails on the missing file
            after_source = 'no file in the folder: %s' % e
    else:
        if not s['transcript']:
            stop(d, p, 'no transcript for the Cowork session %s' % s['local'])
        # First, for a seed `before --seed` took, the timed turn's calls must stay on its deck (`off_seed`): a turn that
        # left it stops here, before any rebuild and never falling back to bench-after/. Before: the seed's calls up to
        # the timed turn's send (the seed transcript may be the timed one), else the bench's seed deck. After: the same
        # replay carried on through the timed turn's calls, on the same deck (no create, no other url). Any error on the
        # way is the rebuild's (`rebuilding`): the deck after falls back to bench-after/, else the attempt stays open.
        try:
            with rebuilding():
                send, until = turn_window(s['transcript'], p['promptMatch'])
                timed = calls(s['transcript'], since=send, until=until)
                off = off_seed(timed, p['seedUrl']) if p.get('seedUrl') else None
                # the timed turn in its seed's session: the same transcript, or the same session id (two hand-overs of a
                # session); decided once, for the replay and for freshSession
                seed_sid = session_id(args.seed_transcript) if args.seed_transcript else None
                same = bool(args.seed_transcript) and (os.path.realpath(args.seed_transcript) == os.path.realpath(s['transcript'])
                                                       or bool(seed_sid and seed_sid == session_id(s['transcript'])))
                if off is None:
                    r = Replay(None if args.seed_transcript else seed_files())
                    for c in calls(args.seed_transcript, until=send) if args.seed_transcript else []:
                        r.apply(c)
                    before_path = write_deck(r.published, os.path.join(d, 'before-deck')) if args.seed_transcript else SEED_DECK
        except RebuildError as e:
            stop(d, p, 'the deck before the turn could not be rebuilt from the records: %s' % e)
        if off:
            stop(d, p, "the timed turn left the seed's deck: it %s, and the seed %s took is %s (redo the repetition on another seed)" % (off, p['seedId'], p['seedUrl']))
        try:
            with rebuilding():
                r.timed(same)
                for c in timed:
                    r.apply(c)
                after_path = write_deck(r.published, os.path.join(d, 'after-deck'))
            after_source = "rebuilt from the records' calls"
        except RebuildError as e:
            rebuild_error = str(e)
            folder = os.path.join(ARM_DIR, 'bench-after')
            if not os.path.isfile(os.path.join(folder, 'project', 'deck.json')):
                stop(d, p, 'the deck after the turn could not be rebuilt from the records (%s), and there is no %s' % (e, folder))
            after_path = os.path.join(d, 'after-deck')
            shutil.rmtree(after_path, ignore_errors=True)
            shutil.copytree(folder, after_path)
            after_source = 'bench-after/ (the model transcribed the deck; the last resort)'
        if args.seed_transcript:
            seed_check = check('same', SEED_DECK, before_path)
            fresh = not same
        if p.get('seedUrl') and r.url and artifact_id(r.url) != artifact_id(p['seedUrl']):
            stop(d, p, 'the turn edited %s, not the seed %s took (%s)' % (r.url, p['seedId'], p['seedUrl']))
        deck_url = r.url
        if r.url_from == 'seed':
            deck_url_from = "the seed's records"
        elif r.url_from == 'timed':  # the seed names none: the timed turn's first url is trusted as the deck's
            deck_url_from = "the timed turn's first publish or read_file naming a url (%s)" % (
                "the seed's records name none" if args.seed_transcript else 'no seed records')
    result = check(p['task'], before_path, after_path)
    answered = args.permissions_answered
    plain = not deck
    manifest = dict(arm='desktop', task=p['task'], rep=p['rep'], attempt=attempt, kind=p['kind'], surface=p['surface'], host=p['host'], startedAt=p['startedAt'],
                    prompt=p['prompt'], promptMatch=p['promptMatch'], transcript=s['transcript'], audit=s['audit'], relay=relay_logs(started),
                    landing=LANDING_FILE if plain else LANDING_DECK, landingFiles=[name] if plain else None,
                    landingActions=landing_actions(args, None if plain else {'Artifact': ['publish']}),
                    load={'before': p['loadBefore'], 'after': load_after}, check=result, before=before_path, after=after_path, afterSource=after_source,
                    rebuildError=rebuild_error, deckUrl=deck_url, deckUrlFrom=deck_url_from, seedId=p.get('seedId'), seedTranscript=args.seed_transcript, seedCheck=seed_check,
                    freshSession=fresh, permissionsAnswered=answered,
                    humanStop='%d permission card%s answered in the turn' % (answered, '' if answered == 1 else 's') if answered else None,
                    pin=None, measurementOnly=bool(args.measurement_only), desktop=dict(local=s['local'], meta=s['meta'], cliVersion=s['cliVersion']))
    mpath = os.path.join(d, 'manifest.json')
    write(mpath, json.dumps(manifest, indent=2) + '\n')
    parse = bench_parse()
    row = parse.edit_row(mpath)
    print(json.dumps({'manifest': mpath, 'attempt': attempt, 'valid': parse.valid(row) or 'yes', 'check': result, 'afterSource': after_source,
                      'permissionMode': (row['measured'] or {}).get('permissionMode'), 'pickerPermissionMode': s['meta'].get('permissionMode'),
                      'seedCheck': seed_check, 'freshSession': fresh, 'priorTurns': row['priorTurns'], 'deckUrl': deck_url, 'deckUrlFrom': deck_url_from, 'transcript': s['transcript'], 'meta': s['meta']}, indent=2))


def deck(args):
    """The hold's first read of a Cowork seed: the deck a session's records leave, written to OUT, and `same` against the
    bench's seed deck; beside it the permission mode each human turn was recorded in (a timed turn not in auto is
    invalid, so a seed recorded in another mode says Cowork's timed turns will be too)."""
    modes = [t['permissionMode'] for t in bench_parse().parse_transcript(args.transcript)[2]]
    try:
        with rebuilding():
            r = Replay()
            for c in calls(args.transcript):
                r.apply(c)
            out = write_deck(r.published, args.out)
    except RebuildError as e:
        print(json.dumps({'deck': None, 'rebuildError': str(e), 'permissionModes': modes}, indent=2))
        sys.exit(1)
    print(json.dumps({'deck': out, 'url': r.url, 'same': check('same', SEED_DECK, out), 'permissionModes': modes}, indent=2))


def seed_prompt(args):
    """The untimed prompt that has a Cowork session make one seed deck: the bench's deck, file for file, as Desktop's own
    Slides deck, and its url as the reply (`seed-add` reads the url from the records, the reply its last resort)."""
    index = read(os.path.join(SEED_DECK, 'project', 'deck.json')).strip()
    order = json.loads(index)['order']
    parts = ['----- %s -----\n%s' % (rel, read(os.path.join(SEED_DECK, rel)).strip())
             for rel in ['project/deck.json'] + ['project/slides/%s.html' % sid for sid in order]]
    print('Make a new slide deck with the Artifact tool, as a Slides deck titled "%s", from exactly the files below: write each '
          'file under its path, character for character, publish the deck with every file, and change, add or drop nothing. '
          'When it is published, reply with the deck\'s URL and nothing else.\n\n%s\n----- end -----'
          % (tasks()['titles']['presentation'], '\n\n'.join(parts)))


def urls_in(transcript):
    """The Artifact urls a session's records show outside its calls: a successful create's tool result, then its replies."""
    made, results, replies = set(), [], []
    for r in jsonl(transcript):
        for b in (r.get('message') or {}).get('content') or [] if isinstance((r.get('message') or {}).get('content'), list) else []:
            if not isinstance(b, dict):
                continue
            if r.get('type') == 'assistant' and b.get('type') == 'tool_use' and creates(dict(name=b.get('name'), input=b.get('input') or {}, ok=True)):
                made.add(b.get('id'))
            elif r.get('type') == 'user' and b.get('type') == 'tool_result' and b.get('tool_use_id') in made and not b.get('is_error'):
                results += [m.group(0) for m in ARTIFACT_URL_ANY.finditer(json.dumps(b.get('content')))]
            elif r.get('type') == 'assistant' and b.get('type') == 'text':
                replies += [m.group(0) for m in ARTIFACT_URL_ANY.finditer(b.get('text', ''))]
    return results, replies


ARTIFACT_URL_ANY = re.compile(r'https://(?:[a-z0-9-]+\.)?claude\.ai/(?:artifact|code/(?:artifact|frame))/[A-Za-z0-9_-]+')


def seed_add(args):
    """A seed session's deck rebuilt from its records and entered in the run's ledger: good when it is the bench's
    (`same`), every human turn of the seed session ran in auto, the session made the deck itself (a successful create),
    its url is known, and no other entry's url names the same Artifact (a deck is one seed's)."""
    led = ledger(args.out)
    sid = 'seed-%02d' % (len(led['seeds']) + 1)
    source = args.transcript if args.transcript == 'newest' else os.path.abspath(args.transcript)
    if source != 'newest' and any(os.path.realpath(s.get('source') or s['transcript']) == os.path.realpath(source) for s in led['seeds']):
        sys.exit('%s is already in %s' % (source, ledger_path(args.out)))
    # the run's own copy (a hand-over lands in ~/Downloads among other files)
    transcript = handed_over(source, time.time() - 900 if source == 'newest' else None, os.path.join(args.out, 'seeds', sid + '.jsonl'))
    this_session = session_id(transcript)
    if this_session and any(s.get('sessionId') == this_session for s in led['seeds']):
        os.remove(transcript)
        sys.exit('session %s is already in %s' % (this_session, ledger_path(args.out)))
    modes = [t['permissionMode'] for t in bench_parse().parse_transcript(transcript)[2]]
    entry = dict(id=sid, transcript=transcript, source=source, sessionId=this_session, url=None, urlFrom=None, same=None, permissionModes=modes, ok=False, why=None, usedBy=None,
                 addedAt=datetime.now(timezone.utc).isoformat())
    try:
        with rebuilding():
            seed_calls = calls(transcript)
            made = any(creates(c) for c in seed_calls)
            r = Replay()
            for c in seed_calls:
                r.apply(c)
            out = write_deck(r.published, os.path.join(args.out, 'seeds', sid))
        entry['same'] = check('same', SEED_DECK, out)
        results, replies = urls_in(transcript)
        entry['url'], entry['urlFrom'] = ((r.url, "the seed's calls") if r.url else (results[0], "the create's result") if results
                                          else (replies[-1], "the session's reply") if replies else (None, None))
    except RebuildError as e:
        entry['why'] = 'the deck could not be rebuilt from the records: %s' % e
    if entry['why'] is None:
        twin = next((s['id'] for s in led['seeds'] if entry['url'] and s.get('url') and artifact_id(s['url']) == artifact_id(entry['url'])), None)
        reasons = [w for w, bad in (("not the bench's deck: %s" % (entry['same'] or {}).get('detail'), not (entry['same'] or {}).get('pass')),
                                    ('a turn not in auto: %s' % modes, not modes or any(m != 'auto' for m in modes)),
                                    ('the session made no new deck (no successful create)', not made),
                                    ('no url in the records', entry['url'] is None),
                                    ('the deck of %s' % twin, twin is not None)) if bad]
        entry['why'] = '; '.join(reasons) or None
    entry['ok'] = entry['why'] is None
    led['seeds'].append(entry)
    save_ledger(args.out, led)
    print(json.dumps(entry, indent=2))


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
    is_human = bench_parse().is_human
    for path in args.paths:
        names = set()
        listed = ''
        modes = []  # the permission modes the records carry: a Cowork audit's system/init, a transcript's human records
        for r in jsonl(path):
            if 'permissionMode' in r and ((r.get('type') == 'system' and r.get('subtype') == 'init') or is_human(r)):
                modes.append(r['permissionMode'])
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
        print(json.dumps({'records': path, 'tools': len(names), 'kinds': {k: sorted(n for n in names if f(n)) for k, f in KIND_TOOLS.items()},
                          'permissionModes': modes}, indent=2))


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
            a.add_argument('--seed', metavar='next|ID', help="a Cowork deck's seed from RUN/seeds.json: its deck named in the prompt by its url, its transcript kept for after")
            a.add_argument('--ref', metavar='TEXT', help="the artifact's handle in the prompt, in place of the surface's own")
        else:
            a.add_argument('--permissions-answered', type=int, required=True, metavar='N',
                           help="the permission cards the driver answered in the turn (bench.rep()'s permissionsAnswered); more than 0 is a human stop")
            a.add_argument('--transcript', metavar='FILE|newest', help="a cloud Cowork session's handed-over transcript (newest: the newest .jsonl saved in ~/Downloads since before)")
            a.add_argument('--seed-transcript', metavar='T', help="a Cowork deck's seed session's transcript (it may be the timed one): the deck before the turn is rebuilt from it")
            a.add_argument('--measurement-only', action='store_true', help='the cell ran at Desktop\'s own setting, MAWS pinned to it')
            a.add_argument('--landing-actions', action='append', help='TOOL=op,op: the operations of TOOL that land an edit')
    dk = sub.add_parser('deck')
    dk.add_argument('transcript')
    dk.add_argument('out')
    k = sub.add_parser('kinds')
    k.add_argument('paths', nargs='+')
    sub.add_parser('seed-prompt')
    sa = sub.add_parser('seed-add')
    sa.add_argument('transcript')
    sa.add_argument('--out', required=True)
    args = ap.parse_args(argv)
    if getattr(args, 'out', None):  # every path the run's files record, a manifest's included, is absolute from here
        args.out = os.path.abspath(args.out)
    {'before': before, 'after': after, 'deck': deck, 'kinds': kinds, 'seed-prompt': seed_prompt, 'seed-add': seed_add}[args.cmd](args)


if __name__ == '__main__':
    main(sys.argv[1:])
