#!/usr/bin/env python3
"""desktop-prep.py against a fake Desktop store: attempts never overwrite, the folder's settings start pristine, a human
stop is recorded, and a Cowork deck is rebuilt from the records (or the rebuild fails loudly).
Run: python3 -I spikes/p4-parity-bench/prep_test.py"""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.dont_write_bytecode = True  # no __pycache__ beside the spike

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('desktop_prep', os.path.join(HERE, 'desktop-prep.py'))
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)

DESKTOP_T = os.path.join(HERE, 'fixtures', 'desktop-B1.jsonl')
DECK = os.path.join(HERE, 'seed', 'maws-deck')
B5 = "In the slide deck \"Autumn Workshops 2026\", on slide 2, change the session lead's date to 21 October. Change nothing else."


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def records(path, recs):
    write(path, ''.join(json.dumps(r) + '\n' for r in recs))
    return path


class Recorder:
    """A transcript in the engine's shape: human turns, tool calls and their results, one second apart."""

    def __init__(self, cwd, start=0):
        self.cwd, self.t, self.recs, self.n = cwd, start, [], 0

    def at(self):
        self.t += 1
        return '2026-10-19T12:%02d:%02d.000Z' % divmod(self.t, 60)

    def human(self, text):
        self.recs.append(dict(type='user', timestamp=self.at(), turnOrigin='human', permissionMode='auto', cwd=self.cwd, sessionId='s', message={'role': 'user', 'content': text}))

    def call(self, name, inp, ok=True):
        self.n += 1
        tid = 'toolu_%d' % self.n
        self.recs.append(dict(type='assistant', timestamp=self.at(), cwd=self.cwd, sessionId='s', requestId='q%d' % self.n,
                              message={'id': 'm%d' % self.n, 'model': 'claude-opus-5-5', 'content': [{'type': 'tool_use', 'id': tid, 'name': name, 'input': inp}], 'usage': {'output_tokens': 5}}))
        self.recs.append(dict(type='user', timestamp=self.at(), cwd=self.cwd, sessionId='s', message={'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': tid, 'content': 'ok', 'is_error': not ok}]}))


class Prep(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.saved = {k: getattr(prep, k) for k in ('ARM_DIR', 'CLAUDE_APP', 'CONFIG_HOME', 'CLAUDE_USAGE')}
        prep.ARM_DIR = os.path.join(self.dir, 'arm')
        prep.CLAUDE_APP = os.path.join(self.dir, 'app')
        prep.CONFIG_HOME = os.path.join(self.dir, 'config')
        prep.CLAUDE_USAGE = os.path.join(self.dir, 'usage')
        self.run_dir = os.path.join(self.dir, 'run')

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(prep, k, v)
        shutil.rmtree(self.dir)

    def main(self, *argv):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            prep.main(list(argv))
        return json.loads(out.getvalue())

    def code_session(self, transcript):
        """Desktop's record of a Code session in the arm's folder, made now, and its transcript."""
        os.makedirs(os.path.join(prep.CONFIG_HOME, 'projects', 'x'))
        shutil.copyfile(transcript, os.path.join(prep.CONFIG_HOME, 'projects', 'x', 'cli-id.jsonl'))
        write(os.path.join(prep.CLAUDE_APP, 'claude-code-sessions', 'acct', 'org', 'local_x.json'),
              json.dumps(dict(cwd=prep.ARM_DIR, cliSessionId='cli-id', model='claude-opus-5-5', effort='xhigh', permissionMode='auto', createdAt=int(time.time() * 1000))))

    def cowork_session(self, recorder):
        d = os.path.join(prep.CLAUDE_APP, 'local-agent-mode-sessions', 'acct', 'org', 'local_c')
        write(os.path.join(d, 'audit.jsonl'), '')
        return records(os.path.join(d, '.claude', 'projects', 'slug', 's.jsonl'), recorder.recs)


class Attempts(Prep):
    def test_attempts_never_overwrite_and_the_folder_starts_pristine(self):
        write(os.path.join(prep.ARM_DIR, '.claude', 'settings.local.json'), '{"permissions": {"allow": ["Edit"]}}')
        first = self.main('before', 'B1', '3', '--out', self.run_dir)
        self.assertFalse(os.path.exists(os.path.join(prep.ARM_DIR, '.claude')), 'the folder\'s local settings removed')
        self.assertEqual(first['attempt'], 1)
        second = self.main('before', 'B1', '3', '--out', self.run_dir)  # the driver stopped; the repetition redone
        self.assertEqual(second['attempt'], 2)
        with open(os.path.join(self.run_dir, 'desktop-B1-r3', 'manifest.json'), encoding='utf-8') as f:
            aborted = json.load(f)
        self.assertTrue(aborted['check']['detail'].startswith('aborted'))
        self.code_session(DESKTOP_T)
        with open(os.path.join(prep.ARM_DIR, 'doc.md'), encoding='utf-8') as f:
            text = f.read()
        write(os.path.join(prep.ARM_DIR, 'doc.md'), text.replace('Thursday', 'Friday'))
        out = self.main('after', 'B1', '3', '--out', self.run_dir, '--permissions-answered', '1')
        self.assertTrue(out['manifest'].endswith('desktop-B1-r3-a2/manifest.json'))
        self.assertTrue(out['check']['pass'], out['check'])
        self.assertEqual(out['valid'], ['a human stop: 1 permission card answered in the turn'])
        self.assertEqual(out['permissionMode'], 'auto')
        with open(out['manifest'], encoding='utf-8') as f:
            m = json.load(f)
        self.assertEqual((m['attempt'], m['landingFiles'], m['permissionsAnswered']), (2, ['doc.md'], 1))
        self.assertEqual(self.main('before', 'B1', '3', '--out', self.run_dir)['attempt'], 3)

    def test_after_needs_the_permission_count(self):
        self.main('before', 'B1', '1', '--out', self.run_dir)
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            prep.main(['after', 'B1', '1', '--out', self.run_dir])


class CoworkDeck(Prep):
    SEED_MNT = '/sessions/seed/mnt/MAWS parity bench'
    TIMED_MNT = '/sessions/timed/mnt/MAWS parity bench'

    def seed(self):
        """A seed session: the deck's files written into the folder and published, one call per data file."""
        r = Recorder(self.SEED_MNT)
        r.human('Publish the deck in deck/ as a Slides artifact titled "Autumn Workshops 2026".')
        files = sorted(os.path.relpath(os.path.join(root, n), DECK) for root, _, names in os.walk(DECK) for n in names)
        for rel in files:
            with open(os.path.join(DECK, rel), encoding='utf-8') as f:
                r.call('Write', {'file_path': '%s/deck/%s' % (self.SEED_MNT, rel), 'content': f.read()})
        r.call('Artifact', {'file_path': 'deck/project/deck.json', 'files': {rel: 'deck/' + rel for rel in files if rel != 'project/deck.json'}})
        return records(os.path.join(self.dir, 'seed.jsonl'), r.recs)

    def test_after_rebuilds_before_and_after_from_the_records(self):
        seed = self.seed()
        self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork')
        r = Recorder(self.TIMED_MNT, start=600)
        r.human(B5)
        r.call('Artifact', {'action': 'read', 'url': 'https://claude.ai/x'})
        r.call('Artifact', {'file_path': 'deck/project/slides/sessions.html', 'edits': [{'old_str': '14 October', 'new_str': '21 October'}]}, ok=False)
        r.call('Artifact', {'file_path': 'deck/project/slides/sessions.html', 'edits': [{'old_str': 'Grace Okafor, 14 October', 'new_str': 'Grace Okafor, 21 October'}]})
        self.cowork_session(r)
        out = self.main('after', 'B5', '1', '--out', self.run_dir, '--permissions-answered', '0', '--seed-transcript', seed)
        self.assertEqual(out['seedCheck']['pass'], True, out['seedCheck'])
        self.assertTrue(out['check']['pass'], out['check'])
        self.assertEqual(out['afterSource'], "rebuilt from the records' calls")
        with open(out['manifest'], encoding='utf-8') as f:
            m = json.load(f)
        self.assertEqual((m['landing'], m['landingFiles'], m['landingActions']), (['Artifact', 'mcp__cowork__update_artifact'], None, {'Artifact': ['publish', None]}))

    def test_the_rebuild_fails_loudly(self):
        r = prep.Replay()
        call = lambda name, inp: dict(name=name, input=inp, cwd='/w', ok=True, id='t')
        with self.assertRaisesRegex(prep.RebuildError, 'not in the records'):
            r.apply(call('Edit', {'file_path': '/w/deck/project/slides/a.html', 'old_string': 'x', 'new_string': 'y'}))
        with self.assertRaisesRegex(prep.RebuildError, 'not a publish'):
            r.apply(call('Artifact', {'action': 'sync', 'url': 'u'}))
        r.apply(call('Write', {'file_path': '/w/p.html', 'content': '<section><h2>A</h2></section>'}))
        with self.assertRaisesRegex(prep.RebuildError, 'unknown shape'):
            r.apply(call('Artifact', {'file_path': '/w/p.html', 'edits': [{'find': 'A', 'replace': 'B'}]}))
        with self.assertRaisesRegex(prep.RebuildError, 'occurs 0 times'):
            r.apply(call('Artifact', {'file_path': '/w/p.html', 'edits': [{'old_str': 'Z', 'new_str': 'B'}]}))
        r.apply(call('Artifact', {'file_path': '/w/p.html', 'edits': [{'old_str': '>A<', 'new_str': '>B<'}]}))
        self.assertEqual(r.published, {'p.html': '<section><h2>B</h2></section>'})


if __name__ == '__main__':
    unittest.main()
