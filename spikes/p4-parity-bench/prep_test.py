#!/usr/bin/env python3
"""desktop-prep.py against a fake Desktop store: attempts never overwrite, the folder's settings start pristine, a human
stop is recorded, and a Cowork deck is rebuilt from the records, the engine's own Slides flow (2.1.302) included, or the
rebuild fails loudly, never with an error of its own escaping `after`.
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
from unittest import mock

sys.dont_write_bytecode = True  # no __pycache__ beside the spike

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('desktop_prep', os.path.join(HERE, 'desktop-prep.py'))
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)

DESKTOP_T = os.path.join(HERE, 'fixtures', 'desktop-B1.jsonl')
DECK = os.path.join(HERE, 'seed', 'maws-deck')
B5 = "In the slide deck \"Autumn Workshops 2026\", on slide 2, change the session lead's date to 21 October. Change nothing else."
URL = 'https://claude.ai/artifact/5d1c9a7e'
OTHER = 'https://claude.ai/artifact/9e0b4f21'  # another Artifact, as a same-titled deck would be
SLIDES = 'https://claude.ai/artifact-type/slides'


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


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
        """A seed session: the deck's files written into the folder, then created and published in one call (`root` the
        deck's folder, `file_path` relative to the working directory, `files` sources relative to `root`); the deck's url
        is only in the call's result, never in the records' inputs."""
        r = Recorder(self.SEED_MNT)
        r.human('Publish the deck in deck/ as a Slides artifact titled "Autumn Workshops 2026".')
        files = sorted(os.path.relpath(os.path.join(root, n), DECK) for root, _, names in os.walk(DECK) for n in names)
        for rel in files:
            with open(os.path.join(DECK, rel), encoding='utf-8') as f:
                r.call('Write', {'file_path': '%s/deck/%s' % (self.SEED_MNT, rel), 'content': f.read()})
        r.call('Artifact', {'type_url': SLIDES, 'title': 'Autumn Workshops 2026', 'root': 'deck', 'file_path': 'deck/project/deck.json',
                            'files': {rel: rel for rel in files if rel != 'project/deck.json'}})
        return records(os.path.join(self.dir, 'seed.jsonl'), r.recs)

    def test_after_rebuilds_before_and_after_from_the_records(self):
        seed = self.seed()
        self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork')
        r = Recorder(self.TIMED_MNT, start=600)
        r.human(B5)
        r.call('Artifact', {'action': 'read', 'url': 'https://claude.ai/artifact/0ther'})  # a read names no deck
        edit = {'url': URL, 'root': 'deck', 'file_path': 'deck/project/slides/sessions.html'}
        r.call('Artifact', dict(edit, edits=[{'old_str': '14 October', 'new_str': '21 October'}]), ok=False)
        r.call('Artifact', dict(edit, edits=[{'old_str': 'Grace Okafor, 14 October', 'new_str': 'Grace Okafor, 21 October'}]))
        self.cowork_session(r)
        out = self.main('after', 'B5', '1', '--out', self.run_dir, '--permissions-answered', '0', '--seed-transcript', seed)
        self.assertEqual(out['seedCheck']['pass'], True, out['seedCheck'])
        self.assertTrue(out['check']['pass'], out['check'])
        self.assertEqual(out['afterSource'], "rebuilt from the records' calls")
        with open(out['manifest'], encoding='utf-8') as f:
            m = json.load(f)
        self.assertEqual((m['landing'], m['landingFiles'], m['landingActions']), (['Artifact', 'mcp__cowork__update_artifact'], None, {'Artifact': ['publish', None]}))
        # the seed's records name no url, so the timed turn's is the deck's, and the manifest says so
        self.assertEqual(m['deckUrl'], URL)
        self.assertIn("the seed's records name none", m['deckUrlFrom'])

    # The Slides flow as 2.1.302 prescribes it: a quickstart, a `type_url` publish that creates the deck, its files written
    # under one folder (the index first, then the cover) and published to the url with `root` (`file_path` one file's
    # absolute path, `files` the others by their project/ paths), then the remaining slides the same way.
    SCRATCH = '/sessions/seed/scratchpad/autumn-workshops'
    # read_file saves a published file under its published path in the scratchpad (the folder itself is the engine's).
    SAVED = '/sessions/timed/scratchpad/artifact-files/autumn-workshops-2026'

    def seed_slides(self):
        r = Recorder(self.SEED_MNT)
        r.human('Make a slide deck titled "Autumn Workshops 2026" from the files in deck/.')
        r.call('Artifact', {'action': 'quickstart', 'intent': 'slides'})
        r.call('Artifact', {'type_url': SLIDES, 'title': 'Autumn Workshops 2026', 'auto_open': 'after_first_write'})
        put = lambda rel: r.call('Write', {'file_path': '%s/%s' % (self.SCRATCH, rel), 'content': read(os.path.join(DECK, rel))})
        slides = ['project/slides/%s.html' % sid for sid in json.loads(read(os.path.join(DECK, 'project', 'deck.json')))['order']]
        put('project/deck.json')
        put(slides[0])
        # the list form: each file published at its own spelling, read from it under root
        r.call('Artifact', {'url': URL, 'root': self.SCRATCH, 'file_path': self.SCRATCH + '/project/deck.json', 'files': [{'path': slides[0], 'contentType': 'text/html'}]})
        for rel in slides[1:]:
            put(rel)
        # the map form, a plain source and a {from, contentType} one
        files = {rel: rel for rel in slides[2:-1]}
        files[slides[-1]] = {'from': slides[-1], 'contentType': 'text/html'}
        r.call('Artifact', {'url': URL, 'root': self.SCRATCH, 'file_path': '%s/%s' % (self.SCRATCH, slides[1]), 'files': files})
        r.call('Artifact', {'action': 'verify', 'url': URL})
        return records(os.path.join(self.dir, 'seed.jsonl'), r.recs)

    def timed_b5(self, read_url=URL, **publish):
        """A fresh session's B5 edit: the deck read, slide 2's file saved by read_file, edited there and published
        (`publish` overrides the publish's input; None drops a key)."""
        r = Recorder(self.TIMED_MNT, start=600)
        r.human(B5)
        r.call('Artifact', {'action': 'list'})
        r.call('Artifact', {'action': 'read', 'url': URL})
        r.call('Artifact', {'action': 'read_file', 'url': read_url, 'path': 'project/slides/sessions.html'})
        r.call('Edit', {'file_path': self.SAVED + '/project/slides/sessions.html', 'old_string': 'Grace Okafor, 14 October', 'new_string': 'Grace Okafor, 21 October'})
        inp = dict({'url': URL, 'root': self.SAVED, 'file_path': self.SAVED + '/project/slides/sessions.html'}, **publish)
        r.call('Artifact', {k: v for k, v in inp.items() if v is not None})
        return r

    def stopped(self, rep, timed, seed):
        """`after` on a timed turn the rebuild must refuse: it stops with its reason and writes no manifest."""
        self.main('before', 'B5', str(rep), '--out', self.run_dir, '--surface', 'cowork')
        self.cowork_session(timed)
        with self.assertRaises(SystemExit) as stopped:
            prep.main(['after', 'B5', str(rep), '--out', self.run_dir, '--permissions-answered', '0', '--seed-transcript', seed])
        self.assertFalse(os.path.exists(os.path.join(self.run_dir, 'desktop-B5-r%d' % rep, 'manifest.json')))
        return str(stopped.exception)

    def test_the_slides_flow_of_2_1_302(self):
        seed = self.seed_slides()
        self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork')
        self.cowork_session(self.timed_b5())
        out = self.main('after', 'B5', '1', '--out', self.run_dir, '--permissions-answered', '0', '--seed-transcript', seed)
        self.assertTrue(out['seedCheck']['pass'], out['seedCheck'])
        self.assertTrue(out['check']['pass'], out['check'])
        self.assertEqual((out['afterSource'], out['valid'], out['permissionMode']), ("rebuilt from the records' calls", 'yes', 'auto'))
        self.assertEqual((out['deckUrl'], out['deckUrlFrom']), (URL, "the seed's records"))
        # the hold's first read of the same seed: the rebuilt deck is the bench's, its url and the seed turn's mode printed
        first = self.main('deck', seed, os.path.join(self.dir, 'cowork-seed'))
        self.assertTrue(first['same']['pass'], first['same'])
        self.assertEqual((first['url'], first['permissionModes']), (URL, ['auto']))

    def test_a_publish_off_the_decks_paths_fails_loudly(self):
        """The engine serves a data file_path at its path relative to `root`: `root` at the slide's own folder serves a
        stray top-level sessions.html, `root` a level too high serves it under the saved folder's name. Neither edits
        slide 2, so neither may pass B5."""
        seed = self.seed_slides()
        for rep, root in ((1, self.SAVED + '/project/slides'), (2, os.path.dirname(self.SAVED))):
            with self.subTest(root=root):
                why = self.stopped(rep, self.timed_b5(root=root), seed)
                self.assertIn("published files outside the deck's project/ layout", why)

    def test_the_timed_turn_edits_the_seeds_deck_only(self):
        """A create in the timed turn, a publish or read_file to another Artifact's url, and a publish naming no url of a
        file never published in the session (the engine would make it a new Artifact) each fail loudly."""
        seed = self.seed_slides()
        cases = [
            (dict(type_url=SLIDES, title='Autumn Workshops 2026', url=None), 'type_url in the timed turn'),
            (dict(url=OTHER), 'another Artifact than the deck'),
            (dict(read_url=OTHER), 'another Artifact than the deck'),
            (dict(url=None), 'naming no url'),
        ]
        for rep, (change, why) in enumerate(cases, 1):
            with self.subTest(change=change):
                self.assertIn(why, self.stopped(rep, self.timed_b5(**change), seed))

    def test_the_deck_is_one_artifact_through_the_seed(self):
        call = lambda inp, cwd='/w': dict(name='Artifact', input=inp, cwd=cwd, ok=True, id='t')
        r = prep.Replay()
        r.apply(dict(call({}), name='Write', input={'file_path': '/w/d/project/deck.json', 'content': '{}'}))
        r.apply(call({'type_url': SLIDES, 'root': 'd', 'file_path': 'd/project/deck.json'}))
        r.apply(call({'root': 'd', 'file_path': 'd/project/deck.json'}))  # no url: where this file went, the new deck
        self.assertEqual((r.published, r.url), ({'project/deck.json': '{}'}, None))
        r.apply(call({'url': URL + '/', 'root': 'd', 'file_path': 'd/project/deck.json'}))  # its url, learned from the seed
        self.assertEqual((r.url, r.url_from), (URL + '/', 'seed'))
        r.apply(call({'action': 'read_file', 'url': URL + '?v=2', 'path': 'project/deck.json'}))  # another spelling of it
        r.apply(call({'type_url': SLIDES, 'root': 'd', 'file_path': 'd/project/deck.json'}))  # the seed made another deck
        with self.assertRaisesRegex(prep.RebuildError, 'replaced'):
            r.apply(call({'url': URL, 'root': 'd', 'file_path': 'd/project/deck.json'}))
        r.timed(same_session=False)  # another session remembers none of the seed's files' urls
        with self.assertRaisesRegex(prep.RebuildError, 'naming no url'):
            r.apply(call({'root': 'd', 'file_path': 'd/project/deck.json'}))

    def test_read_file_carries_the_published_text_to_the_edit(self):
        """With no seed records (the deck before is the bench's), only read_file can give the edited copy its text."""
        r = prep.Replay(prep.seed_files())
        r.timed(same_session=False)
        for c in self.timed_b5().recs:
            for b in (c.get('message') or {}).get('content') or []:
                if isinstance(b, dict) and b.get('type') == 'tool_use':
                    r.apply(dict(name=b['name'], input=b['input'], cwd=self.TIMED_MNT, ok=True, id=b['id']))
        after = prep.write_deck(r.published, os.path.join(self.dir, 'after-deck'))
        self.assertTrue(prep.check('B5', DECK, after)['pass'])

    def test_kinds_prints_the_recorded_permission_mode(self):
        audit = records(os.path.join(self.dir, 'audit.jsonl'), [{'type': 'system', 'subtype': 'init', 'permissionMode': 'default', 'tools': ['Artifact', 'Write']}])
        self.assertEqual(self.main('kinds', audit)['permissionModes'], ['default'])
        self.assertEqual(self.main('kinds', self.seed_slides())['permissionModes'], ['auto'])

    def test_an_unexpected_error_leaves_the_attempt_open_with_its_reason(self):
        seed = self.seed_slides()
        self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork')
        self.cowork_session(self.timed_b5())
        with mock.patch.object(prep, 'calls', side_effect=TypeError('boom')), self.assertRaises(SystemExit) as stopped:
            prep.main(['after', 'B5', '1', '--out', self.run_dir, '--permissions-answered', '0', '--seed-transcript', seed])
        self.assertIn('unexpected TypeError in the rebuild: boom', str(stopped.exception))
        self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork')  # the repetition redone instead
        aborted = json.loads(read(os.path.join(self.run_dir, 'desktop-B5-r1', 'manifest.json')))
        self.assertIn('after had stopped on: the deck before the turn could not be rebuilt', aborted['check']['detail'])

    def test_an_unexpected_error_after_the_turn_falls_back_to_bench_after(self):
        seed = self.seed_slides()
        self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork')
        self.cowork_session(self.timed_b5())
        shutil.copytree(DECK, os.path.join(prep.ARM_DIR, 'bench-after'))
        real = prep.write_deck
        broken = lambda published, out: (_ for _ in ()).throw(TypeError('boom')) if out.endswith('after-deck') else real(published, out)
        with mock.patch.object(prep, 'write_deck', broken):
            out = self.main('after', 'B5', '1', '--out', self.run_dir, '--permissions-answered', '0', '--seed-transcript', seed)
        m = json.loads(read(out['manifest']))
        self.assertTrue(m['afterSource'].startswith('bench-after/'))
        self.assertIn('unexpected TypeError', m['rebuildError'])

    def test_the_rebuild_fails_loudly(self):
        r = prep.Replay()
        call = lambda name, inp: dict(name=name, input=inp, cwd='/w', ok=True, id='t')
        with self.assertRaisesRegex(prep.RebuildError, 'not in the records'):
            r.apply(call('Edit', {'file_path': '/w/deck/project/slides/a.html', 'old_string': 'x', 'new_string': 'y'}))
        for inp in ({'action': 'sync', 'url': 'u'}, {'action': 'write_db', 'url': 'u'}, {'action': 'delete', 'url': 'u'},
                    {'action': 'upload_asset', 'url': 'u', 'file_path': 'a.png'}, {'url': 'u', 'asset': True, 'file_path': 'a.png'},
                    {'url': 'u', 'asset': True, 'from_url': 'v', 'asset_ids': ['x']}, {'action': 'delete', 'url': 'u', 'path': 'f' * 32},
                    {'action': 'run_script', 'url': 'u', 'mode': 'mutation'}):
            with self.assertRaisesRegex(prep.RebuildError, 'records do not carry'):
                r.apply(call('Artifact', inp))
        with self.assertRaisesRegex(prep.RebuildError, 'not an action'):
            r.apply(call('Artifact', {'action': 'frobnicate', 'url': 'u'}))
        with self.assertRaisesRegex(prep.RebuildError, 'store'):
            r.apply(call('ArtifactData', {'action': 'set', 'url': 'u', 'collection': 'c', 'doc_id': 'd', 'data': {}}))
        for action in prep.ARTIFACT_KEEPS:  # every action that leaves the files as they were
            r.apply(call('Artifact', {'action': action, 'url': 'u'}))
        r.apply(call('Artifact', {'action': 'run_script', 'url': 'u', 'mode': 'query'}))
        r.apply(call('Write', {'file_path': '/w/p.html', 'content': '<section><h2>A</h2></section>'}))
        with self.assertRaisesRegex(prep.RebuildError, 'unknown shape'):
            r.apply(call('Artifact', {'url': 'u', 'file_path': '/w/p.html', 'edits': [{'find': 'A', 'replace': 'B'}]}))
        # files of shapes the schema does not have or the records cannot follow, each the rebuild's own error (the
        # engine's list form, objects, was a TypeError before; seed_slides publishes it), and published paths the
        # engine refuses (absolute, "..", empty segments)
        for files in (['p.html'], [{'path': 'p.html', 'live': True}], {'q.html': {'artifact': 'v', 'path': 'q.html'}}, {'q.html': 3}, 'p.html',
                      [{'path': '/w/p.html'}], {'../p.html': 'p.html'}, {'a//p.html': 'p.html'}):
            with self.assertRaises(prep.RebuildError):
                r.apply(call('Artifact', {'url': 'u', 'file_path': '/w/p.html', 'files': files}))
        with self.assertRaisesRegex(prep.RebuildError, 'no file_path'):
            r.apply(call('Artifact', {'url': 'u', 'files': {'q.html': 'p.html'}}))
        # a data file outside `root` (or the working directory) is refused by the engine, never served under it
        with self.assertRaisesRegex(prep.RebuildError, 'not inside /w/b'):
            r.apply(call('Artifact', {'url': 'u', 'root': 'b', 'file_path': '/w/p.html'}))
        with self.assertRaisesRegex(prep.RebuildError, 'occurs 0 times'):
            r.apply(call('Artifact', {'url': 'u', 'file_path': '/w/p.html', 'edits': [{'old_str': 'Z', 'new_str': 'B'}]}))
        r.apply(call('Artifact', {'url': 'u', 'file_path': '/w/p.html', 'edits': [{'old_str': '>A<', 'new_str': '>B<'}]}))
        self.assertEqual(r.published, {'p.html': '<section><h2>B</h2></section>'})


if __name__ == '__main__':
    unittest.main()
