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
# The deck's url in the engine's two spellings (2.1.302 spells its own url either way): the short id is the uuid's
# base58, the pair made by the engine's own encoder (cli.pretty.js `g`, its decoder `CW`).
URL = 'https://claude.ai/artifact/CVsiKk2utAxFxm8aNrwmaA'
URL_UUID = 'https://claude.ai/code/artifact/5d1c9a7e-3b2f-4e8a-9c61-0f4d2b7a8e13'
OTHER = 'https://claude.ai/artifact/LWvigD6DBBdof4qCcTGaKU'  # another Artifact, as a same-titled deck would be
SLIDES = 'https://claude.ai/artifact-type/slides'
NO_SEED = 'no seed: a Cowork deck repetition of the record takes before --seed (§7a)'


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

    def __init__(self, cwd, start=0, session=None):
        self.cwd, self.t, self.recs, self.n = cwd, start, [], 0
        self.session = session or 'session-of-' + cwd  # a seed's and a timed turn's sessions differ unless told otherwise

    def at(self):
        self.t += 1
        return '2026-10-19T12:%02d:%02d.000Z' % divmod(self.t, 60)

    def human(self, text):
        self.recs.append(dict(type='user', timestamp=self.at(), turnOrigin='human', permissionMode='auto', cwd=self.cwd, sessionId=self.session, message={'role': 'user', 'content': text}))

    def call(self, name, inp, ok=True, result='ok'):
        self.n += 1
        tid = 'toolu_%d' % self.n
        self.recs.append(dict(type='assistant', timestamp=self.at(), cwd=self.cwd, sessionId=self.session, requestId='q%d' % self.n,
                              message={'id': 'm%d' % self.n, 'model': 'claude-opus-5-5', 'content': [{'type': 'tool_use', 'id': tid, 'name': name, 'input': inp}], 'usage': {'output_tokens': 5}}))
        self.recs.append(dict(type='user', timestamp=self.at(), cwd=self.cwd, sessionId=self.session, message={'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': tid, 'content': result, 'is_error': not ok}]}))

    def reply(self, text):
        self.n += 1
        self.recs.append(dict(type='assistant', timestamp=self.at(), cwd=self.cwd, sessionId=self.session, requestId='q%d' % self.n,
                              message={'id': 'm%d' % self.n, 'model': 'claude-opus-5-5', 'content': [{'type': 'text', 'text': text}], 'usage': {'output_tokens': 5}}))


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

    def seed_slides(self, url=URL, name='seed.jsonl', create='ok'):
        """A seed session in the Slides flow; `create` 'ok', 'failed' or None (the files published to `url` with no create)."""
        r = Recorder(self.SEED_MNT, session='seed-session-' + name)
        r.human('Make a slide deck titled "Autumn Workshops 2026" from the files in deck/.')
        r.call('Artifact', {'action': 'quickstart', 'intent': 'slides'})
        if create:
            r.call('Artifact', {'type_url': SLIDES, 'title': 'Autumn Workshops 2026', 'auto_open': 'after_first_write'}, ok=create == 'ok')
        put = lambda rel: r.call('Write', {'file_path': '%s/%s' % (self.SCRATCH, rel), 'content': read(os.path.join(DECK, rel))})
        slides = ['project/slides/%s.html' % sid for sid in json.loads(read(os.path.join(DECK, 'project', 'deck.json')))['order']]
        put('project/deck.json')
        put(slides[0])
        # the list form: each file published at its own spelling, read from it under root
        r.call('Artifact', {'url': url, 'root': self.SCRATCH, 'file_path': self.SCRATCH + '/project/deck.json', 'files': [{'path': slides[0], 'contentType': 'text/html'}]})
        for rel in slides[1:]:
            put(rel)
        # the map form, a plain source and a {from, contentType} one
        files = {rel: rel for rel in slides[2:-1]}
        files[slides[-1]] = {'from': slides[-1], 'contentType': 'text/html'}
        r.call('Artifact', {'url': url, 'root': self.SCRATCH, 'file_path': '%s/%s' % (self.SCRATCH, slides[1]), 'files': files})
        r.call('Artifact', {'action': 'verify', 'url': url})
        return records(os.path.join(self.dir, name), r.recs)

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
        # valid but for its seed, which no `before --seed` took: the record's Cowork decks run on the seeds ledger's
        self.assertEqual((out['afterSource'], out['valid'], out['permissionMode']), ("rebuilt from the records' calls", [NO_SEED], 'auto'))
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
        r.apply(call({'action': 'read_file', 'url': URL_UUID + '?v=2', 'path': 'project/deck.json'}))  # another spelling of it
        r.apply(call({'type_url': SLIDES, 'root': 'd', 'file_path': 'd/project/deck.json'}))  # the seed made another deck
        with self.assertRaisesRegex(prep.RebuildError, 'replaced'):
            r.apply(call({'url': URL, 'root': 'd', 'file_path': 'd/project/deck.json'}))
        r.timed(same_session=False)  # another session remembers none of the seed's files' urls
        with self.assertRaisesRegex(prep.RebuildError, 'naming no url'):
            r.apply(call({'root': 'd', 'file_path': 'd/project/deck.json'}))

    def test_a_url_less_publish_follows_only_the_decks_latest_file(self):
        """The engine keeps one file_path per Artifact, the one last published to it (2.1.302's publish drops the
        Artifact's other frameUrls entries): a file published to the deck before another goes, with no url, to a new
        standalone page; so does one whose create failed after making its Artifact."""
        call = lambda inp, ok=True: dict(name='Artifact', input=inp, cwd='/w', ok=ok, id='t')
        r = prep.Replay()
        for name in ('a', 'b'):
            r.apply(dict(call({}), name='Write', input={'file_path': '/w/%s.html' % name, 'content': '<p>%s</p>' % name}))
            r.apply(call({'url': URL, 'file_path': '%s.html' % name}))
        r.apply(call({'file_path': 'b.html'}))  # the deck's latest file follows
        with self.assertRaisesRegex(prep.RebuildError, 'naming no url of /w/a.html'):
            r.apply(call({'file_path': 'a.html'}))
        r.apply(call({'type_url': SLIDES, 'file_path': 'b.html'}, ok=False))
        with self.assertRaisesRegex(prep.RebuildError, 'naming no url of /w/b.html'):
            r.apply(call({'file_path': 'b.html'}))

    def test_a_url_less_publish_in_the_seeds_own_session(self):
        """The timed turn in the seed's session: slide 2, edited and published with no url, reaches the deck only when
        it was the last file the seed published to it; otherwise the rebuild fails loudly rather than pass B5."""
        slides = ['project/slides/%s.html' % sid for sid in json.loads(read(os.path.join(DECK, 'project', 'deck.json')))['order']]
        slide = self.SCRATCH + '/project/slides/sessions.html'
        for rep, order in ((1, ['project/deck.json'] + slides), (2, ['project/deck.json'] + [s for s in slides if 'sessions' not in s] + [slides[1]])):
            with self.subTest(last=order[-1]):
                r = Recorder(self.SEED_MNT)
                r.human('Make a slide deck titled "Autumn Workshops 2026" from the files in deck/.')
                r.call('Artifact', {'type_url': SLIDES, 'title': 'Autumn Workshops 2026'})
                for rel in order:
                    r.call('Write', {'file_path': '%s/%s' % (self.SCRATCH, rel), 'content': read(os.path.join(DECK, rel))})
                    r.call('Artifact', {'url': URL, 'root': self.SCRATCH, 'file_path': '%s/%s' % (self.SCRATCH, rel)})
                r.human(B5)
                r.call('Edit', {'file_path': slide, 'old_string': 'Grace Okafor, 14 October', 'new_string': 'Grace Okafor, 21 October'})
                r.call('Artifact', {'root': self.SCRATCH, 'file_path': slide})
                self.main('before', 'B5', str(rep), '--out', self.run_dir, '--surface', 'cowork')
                session = self.cowork_session(r)
                argv = ['after', 'B5', str(rep), '--out', self.run_dir, '--permissions-answered', '0', '--seed-transcript', session]
                if rep == 1:
                    with self.assertRaises(SystemExit) as stopped:
                        prep.main(argv)
                    self.assertIn('naming no url of %s' % slide, str(stopped.exception))
                else:
                    out = self.main(*argv)
                    self.assertTrue(out['seedCheck']['pass'], out['seedCheck'])
                    self.assertTrue(out['check']['pass'], out['check'])

    def test_the_engines_url_grammar(self):
        """Both spellings of one Artifact name it (2.1.302's `Yt`; the pairs and verdicts are the engine's own, its
        functions run on the same inputs); a url the engine does not read as an Artifact's is equal only to itself."""
        for short, uuid in (('CVsiKk2utAxFxm8aNrwmaA', '5d1c9a7e-3b2f-4e8a-9c61-0f4d2b7a8e13'), ('LWvigD6DBBdof4qCcTGaKU', '9e0b4f21-6a3c-4d5e-8b7f-1c2d3e4f5a6b'),
                            ('1111111111111111111111', '00000000-0000-0000-0000-000000000000'), ('11112FTvFtEEuCBPrANzJj', '0000000f-0000-0000-0000-000000000100'),
                            ('YcVfxkQb6JRzqk5kF2tNLv', 'ffffffff-ffff-ffff-ffff-ffffffffffff'), ('YcVfxkQb6JRzqk5kF2tNLw', None), ('zzzzzzzzzzzzzzzzzzzzzz', None)):
            self.assertEqual(prep.short_id_uuid(short), uuid, short)
        deck = ('artifact', '5d1c9a7e-3b2f-4e8a-9c61-0f4d2b7a8e13')
        for url in (URL, URL_UUID, URL + '/', URL + '?v=2', URL_UUID + '/project/deck.json#x', 'https://claude.ai/code/artifact/CVsiKk2utAxFxm8aNrwmaA',
                    'https://claude.ai/artifact/5d1c9a7e-3b2f-4e8a-9c61-0f4d2b7a8e13', 'https://claude.ai/code/frame/5d1c9a7e-3b2f-4e8a-9c61-0f4d2b7a8e13',
                    'https://claude.ai/artifact/autumn-workshops-2026-CVsiKk2utAxFxm8aNrwmaA', 'https://claude.ai/code/artifact/my-deck-5d1c9a7e-3b2f-4e8a-9c61-0f4d2b7a8e13',
                    'https://claude.ai/artifact/-CVsiKk2utAxFxm8aNrwmaA', 'https://preview.claude.ai/artifact/CVsiKk2utAxFxm8aNrwmaA',
                    'https://5d1c9a7e-3b2f-4e8a-9c61-0f4d2b7a8e13.frame.claudeusercontent.com/'):
            self.assertEqual(prep.artifact_id(url), deck, url)
        # the vanity is the longest prefix ending in `-` before an id: here the id is OTHER's
        self.assertEqual(prep.artifact_id('https://claude.ai/artifact/CVsiKk2utAxFxm8aNrwmaA-LWvigD6DBBdof4qCcTGaKU'), prep.artifact_id(OTHER))
        self.assertNotEqual(prep.artifact_id(OTHER), deck)
        for url in ('https://claude.ai/artifact/5d1c9a7e', 'https://claude.ai/artifact/zzzzzzzzzzzzzzzzzzzzzz', 'http://claude.ai/artifact/CVsiKk2utAxFxm8aNrwmaA',
                    'https://claude.ai/artifact/5D1C9A7E-3B2F-4E8A-9C61-0F4D2B7A8E13', 'https://claude.ai/artifact/CVsiKk2utAxFxm8aNrwmaAx',
                    'https://a.b.claude.ai/artifact/CVsiKk2utAxFxm8aNrwmaA', URL + '\n', 'https://claude.ai:443/artifact/CVsiKk2utAxFxm8aNrwmaA',
                    'https://claude.ai/code/frames/5d1c9a7e-3b2f-4e8a-9c61-0f4d2b7a8e13', '5d1c9a7e-3b2f-4e8a-9c61-0f4d2b7a8e13'):
            self.assertEqual(prep.artifact_id(url), ('url', url), url)
        # the timed turn names the seed's deck by its other spelling: the same deck, rebuilt and checked
        seed = self.seed_slides()
        self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork')
        self.cowork_session(self.timed_b5(read_url=URL_UUID, url=URL_UUID))
        out = self.main('after', 'B5', '1', '--out', self.run_dir, '--permissions-answered', '0', '--seed-transcript', seed)
        self.assertTrue(out['check']['pass'], out['check'])
        self.assertEqual(out['deckUrl'], URL)

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


class Seeds(CoworkDeck):
    """§7a: a Cowork deck's timed turn runs in a fresh session on a seed deck an untimed session made beforehand; the
    seeds ledger checks each seed, hands each out once, and the timed prompt names the deck by its url."""

    def ledger(self):
        return json.loads(read(os.path.join(self.run_dir, 'seeds.json')))

    def test_the_seed_prompt_carries_every_seed_file(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            prep.main(['seed-prompt'])
        text = out.getvalue()
        self.assertIn('"Autumn Workshops 2026"', text)
        for root, _, names in os.walk(DECK):
            for n in names:
                rel = os.path.relpath(os.path.join(root, n), DECK)
                self.assertIn('----- %s -----\n%s' % (rel, read(os.path.join(root, n)).strip()), text)

    def test_a_seed_is_checked_handed_out_once_and_named_by_its_url(self):
        entry = self.main('seed-add', self.seed_slides(), '--out', self.run_dir)
        self.assertEqual((entry['id'], entry['ok'], entry['url'], entry['urlFrom'], entry['permissionModes']), ('seed-01', True, URL, "the seed's calls", ['auto']))
        self.assertTrue(entry['same']['pass'], entry['same'])
        out = self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork', '--seed', 'next')
        self.assertEqual(out['seed'], 'seed-01')
        self.assertIn('In the slide deck %s, on slide 2' % URL, out['prompt'])
        self.assertEqual(self.ledger()['seeds'][0]['usedBy']['task'], 'B5')
        self.cowork_session(self.timed_b5())
        after = self.main('after', 'B5', '1', '--out', self.run_dir, '--permissions-answered', '0')  # the seed's transcript from before
        self.assertEqual((after['valid'], after['freshSession'], after['deckUrl']), ('yes', True, URL), after)
        with self.assertRaises(SystemExit) as none_left:
            self.main('before', 'B7', '1', '--out', self.run_dir, '--surface', 'cowork', '--seed', 'next')
        self.assertIn('no good unused seed', str(none_left.exception))

    def test_a_timed_turn_in_its_seeds_session_is_invalid(self):
        session = self.cowork_session(Recorder(self.SEED_MNT))  # the session's transcript, the seed's records first
        shutil.copyfile(self.seed_slides(), session)
        self.assertTrue(self.main('seed-add', session, '--out', self.run_dir)['ok'])
        self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork', '--seed', 'next')
        timed = self.timed_b5()
        with open(session, 'a', encoding='utf-8') as f:  # the same session carries on with the timed turn
            f.write(''.join(json.dumps(r) + '\n' for r in timed.recs))
        after = self.main('after', 'B5', '1', '--out', self.run_dir, '--permissions-answered', '0')
        self.assertTrue(after['check']['pass'], after['check'])
        self.assertFalse(after['freshSession'])
        self.assertIn("the timed turn ran in its seed's session, not a fresh one", after['valid'])

    def test_a_seed_off_the_bench_or_out_of_auto_is_never_handed_out(self):
        seed = self.seed_slides()
        recs = [json.loads(line) for line in read(seed).splitlines()]
        for r in recs:
            if r.get('turnOrigin') == 'human':
                r['permissionMode'] = 'default'
        entry = self.main('seed-add', records(os.path.join(self.dir, 'default.jsonl'), recs), '--out', self.run_dir)
        self.assertFalse(entry['ok'])
        self.assertIn('a turn not in auto', entry['why'])
        off = Recorder(self.SEED_MNT)
        off.human('Make the deck.')
        off.call('Artifact', {'type_url': SLIDES, 'title': 'Autumn Workshops 2026', 'file_path': '/s/project/deck.json'})
        off.call('Write', {'file_path': '/s/project/deck.json', 'content': '{"order": []}'})
        self.assertFalse(self.main('seed-add', records(os.path.join(self.dir, 'off.jsonl'), off.recs), '--out', self.run_dir)['ok'])
        with self.assertRaises(SystemExit) as refused:
            self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork', '--seed', 'next')
        self.assertIn('no good unused seed', str(refused.exception))
        with self.assertRaises(SystemExit) as again:  # one transcript is entered once
            self.main('seed-add', seed, '--out', self.run_dir)
            self.main('seed-add', seed, '--out', self.run_dir)
        self.assertIn('already in', str(again.exception))

    def test_a_seed_whose_calls_name_no_url_takes_the_creates_result(self):
        r = Recorder(self.SEED_MNT)
        r.human('Make the deck.')
        rels = []
        for root, _, names in os.walk(DECK):
            for n in sorted(names):
                rels.append(os.path.relpath(os.path.join(root, n), DECK))
                r.call('Write', {'file_path': os.path.join('/s', rels[-1]), 'content': read(os.path.join(root, n))})
        # a create that publishes its files at once: the new deck's url is only in the call's result
        r.call('Artifact', {'type_url': SLIDES, 'title': 'Autumn Workshops 2026', 'root': '/s', 'file_path': '/s/project/deck.json',
                            'files': [{'path': rel} for rel in rels if rel != 'project/deck.json']}, result='Created %s' % URL_UUID)
        r.reply('Done: %s' % OTHER)
        entry = self.main('seed-add', records(os.path.join(self.dir, 'url.jsonl'), r.recs), '--out', self.run_dir)
        self.assertEqual((entry['url'], entry['urlFrom']), (URL_UUID, "the create's result"))

    def test_after_refuses_another_seed_than_the_one_before_took(self):
        self.main('seed-add', self.seed_slides(), '--out', self.run_dir)
        self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork', '--seed', 'next')
        self.cowork_session(self.timed_b5())
        with self.assertRaises(SystemExit) as refused:
            self.main('after', 'B5', '1', '--out', self.run_dir, '--permissions-answered', '0', '--seed-transcript', DESKTOP_T)
        self.assertIn('is not the seed seed-01 took', str(refused.exception))

    def test_a_turn_off_the_seeds_deck_stops_before_any_fallback(self):
        """The seed's own publishes name its url: a timed turn that creates an Artifact, or publishes or read_files
        another one, stops with the attempt open and its reason kept, and bench-after/ (here the deck with B5's edit,
        which would pass) is never taken for it, since the parser would time a publish to another deck."""
        edited = os.path.join(self.dir, 'edited')
        shutil.copytree(DECK, edited)
        slide = os.path.join(edited, 'project', 'slides', 'sessions.html')
        write(slide, read(slide).replace('Grace Okafor, 14 October', 'Grace Okafor, 21 October'))
        cases = [(dict(url=OTHER), 'it published to %s' % OTHER), (dict(read_url=OTHER), 'it read a file of %s' % OTHER),
                 (dict(type_url=SLIDES, title='Autumn Workshops 2026', url=None), 'it created a new Artifact (a publish with type_url %s)' % SLIDES)]
        for n, (change, why) in enumerate(cases, 1):
            with self.subTest(change=change):
                run = os.path.join(self.dir, 'run-%d' % n)
                self.main('seed-add', self.seed_slides(), '--out', run)
                self.main('before', 'B5', '1', '--out', run, '--surface', 'cowork', '--seed', 'next')
                shutil.copytree(edited, os.path.join(prep.ARM_DIR, 'bench-after'))
                self.cowork_session(self.timed_b5(**change))
                with self.assertRaises(SystemExit) as stopped:
                    prep.main(['after', 'B5', '1', '--out', run, '--permissions-answered', '0'])
                self.assertIn("the timed turn left the seed's deck: %s, and the seed seed-01 took is %s" % (why, URL), str(stopped.exception))
                d = os.path.join(run, 'desktop-B5-r1')
                self.assertFalse(os.path.exists(os.path.join(d, 'manifest.json')))
                self.assertIn(why, json.loads(read(os.path.join(d, 'pending.json')))['afterStopped'])

    def test_the_seed_check_reads_successful_publishes_and_read_files_only(self):
        call = lambda inp, ok=True: dict(name='Artifact', input=inp, cwd='/w', ok=ok, id='t')
        on = [call({'action': 'read', 'url': OTHER}), call({'url': OTHER, 'file_path': 'a.html'}, ok=False), call({'action': 'list', 'type_url': SLIDES}),
              call({'action': 'read', 'type_url': SLIDES}), call({'action': 'read_file', 'url': URL_UUID, 'path': 'project/deck.json'}),
              call({'url': URL + '/', 'file_path': 'a.html'}), dict(call({'file_path': '/w/a.html', 'content': ''}), name='Write')]
        self.assertIsNone(prep.off_seed(on, URL))
        # read with a file path is read_file in the engine's consolidated spelling; an asset's publish is a publish the
        # parser counts as a landing
        self.assertEqual(prep.off_seed(on + [call({'action': 'read', 'url': OTHER, 'path': 'project/deck.json'})], URL), 'read a file of %s' % OTHER)
        self.assertEqual(prep.off_seed(on + [call({'url': OTHER, 'asset': True, 'file_path': 'a.png'})], URL), 'published to %s' % OTHER)

    def test_a_seed_makes_its_own_deck(self):
        """A seed session that made no deck (it published the bench's files to an Artifact it did not create, or its
        create failed) is not good, nor is one whose deck is an earlier entry's, in either spelling of its url."""
        self.assertTrue(self.main('seed-add', self.seed_slides(), '--out', self.run_dir)['ok'])
        twin = self.main('seed-add', self.seed_slides(url=URL_UUID, name='twin.jsonl'), '--out', self.run_dir)
        self.assertEqual((twin['ok'], twin['why']), (False, 'the deck of seed-01'))
        for url, name, create in (('https://claude.ai/artifact/11112FTvFtEEuCBPrANzJj', 'none.jsonl', None),
                                  ('https://claude.ai/artifact/1111111111111111111111', 'failed.jsonl', 'failed')):
            with self.subTest(create=create):
                entry = self.main('seed-add', self.seed_slides(url=url, name=name, create=create), '--out', self.run_dir)
                self.assertTrue(entry['same']['pass'], entry['same'])
                self.assertEqual((entry['ok'], entry['why']), (False, 'the session made no new deck (no successful create)'))
        self.assertEqual(self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork', '--seed', 'next')['seed'], 'seed-01')
        with self.assertRaises(SystemExit) as none_left:
            self.main('before', 'B7', '1', '--out', self.run_dir, '--surface', 'cowork', '--seed', 'next')
        self.assertIn('no good unused seed', str(none_left.exception))

    def test_a_seed_is_only_for_a_cowork_deck(self):
        self.main('seed-add', self.seed_slides(), '--out', self.run_dir)
        with self.assertRaises(SystemExit) as refused:
            self.main('before', 'B1', '1', '--out', self.run_dir, '--seed', 'next')
        self.assertIn('--seed is for a Cowork deck', str(refused.exception))
        self.assertIsNone(self.ledger()['seeds'][0]['usedBy'])


class CloudCowork(CoworkDeck):
    """Desktop 3.1623.0's Cowork runs in the cloud: each session's transcript reaches the mini only when an untimed
    follow-up has the session send it, saved under ~/Downloads; the follow-up's own records come after the turn."""
    HAND_OVER = "Send me this session's own transcript file with SendUserFile."

    def setUp(self):
        super().setUp()
        self.saved['DOWNLOADS'] = prep.DOWNLOADS
        prep.DOWNLOADS = os.path.join(self.dir, 'Downloads')
        os.makedirs(prep.DOWNLOADS)

    def handed_over(self, path, session, name, start=900):
        """The session's records with the hand-over turn after them, as Desktop saves the sent file."""
        recs = [dict(json.loads(line), sessionId=session) for line in read(path).splitlines()]
        r = Recorder('/home/claude', start=start, session=session)
        r.human(self.HAND_OVER)
        r.call('Bash', {'command': 'ls -t ~/.claude/projects/*/*.jsonl | head -1'})
        r.call('SendUserFile', {'path': '/root/.claude/projects/-home-claude/%s.jsonl' % session})
        out = records(os.path.join(prep.DOWNLOADS, name), recs + r.recs)
        time.sleep(0.01)
        return out

    def test_the_hand_over_end_to_end(self):
        self.handed_over(self.seed_slides(), 'cloud-seed', 'seed.jsonl')
        entry = self.main('seed-add', 'newest', '--out', self.run_dir)
        self.assertTrue(entry['ok'], entry)
        self.assertEqual((entry['sessionId'], entry['transcript']), ('cloud-seed', os.path.join(self.run_dir, 'seeds', 'seed-01.jsonl')))
        self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork', '--seed', 'next')
        self.handed_over(records(os.path.join(self.dir, 'timed.jsonl'), self.timed_b5().recs), 'cloud-timed', 'timed.jsonl')
        out = self.main('after', 'B5', '1', '--out', self.run_dir, '--permissions-answered', '0', '--transcript', 'newest')
        self.assertEqual((out['valid'], out['freshSession'], out['check']['pass'], out['permissionMode']), ('yes', True, True, 'auto'), out)
        self.assertEqual(out['transcript'], os.path.join(self.run_dir, 'desktop-B5-r1', 'transcript.jsonl'))
        with open(out['manifest'], encoding='utf-8') as f:
            m = json.load(f)
        self.assertEqual(m['desktop']['meta']['sessionId'], 'cloud-timed')
        row = prep.bench_parse().edit_row(out['manifest'])
        self.assertEqual([t['name'] for t in row['measured']['tools']], ['Artifact', 'Artifact', 'Artifact', 'Edit', 'Artifact'], 'the hand-over is not in the timed turn')

    def test_two_hand_overs_of_one_session_are_one_session(self):
        self.handed_over(self.seed_slides(), 'one-session', 'seed.jsonl')
        self.assertTrue(self.main('seed-add', 'newest', '--out', self.run_dir)['ok'])
        self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork', '--seed', 'next')
        self.handed_over(records(os.path.join(self.dir, 'timed.jsonl'), self.timed_b5().recs), 'one-session', 'again.jsonl')
        out = self.main('after', 'B5', '1', '--out', self.run_dir, '--permissions-answered', '0', '--transcript', 'newest')
        self.assertFalse(out['freshSession'])
        self.assertIn("the timed turn ran in its seed's session, not a fresh one", out['valid'])
        with self.assertRaises(SystemExit) as again:  # the same session handed over twice is one seed
            self.main('seed-add', os.path.join(prep.DOWNLOADS, 'seed.jsonl'), '--out', self.run_dir)
        self.assertIn('already in', str(again.exception))

    def test_the_timed_turn_in_an_existing_session_is_invalid(self):
        """The driver's New failing silently sends the timed prompt into whatever session is showing (here the probe's):
        another session than the seed's, so fresh by session id, but not its session's first turn."""
        self.handed_over(self.seed_slides(), 'cloud-seed', 'seed.jsonl')
        self.assertTrue(self.main('seed-add', 'newest', '--out', self.run_dir)['ok'])
        self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork', '--seed', 'next')
        probe = Recorder('/home/claude', session='cloud-probe')
        probe.human('List the tools available to you.')
        probe.reply('Artifact, Bash, Read.')
        self.handed_over(records(os.path.join(self.dir, 'probe.jsonl'), probe.recs + self.timed_b5().recs), 'cloud-probe', 'probe.jsonl')
        out = self.main('after', 'B5', '1', '--out', self.run_dir, '--permissions-answered', '0', '--transcript', 'newest')
        self.assertEqual((out['check']['pass'], out['freshSession'], out['priorTurns']), (True, True, 1), out)
        self.assertEqual(out['valid'], ["the timed turn was not its session's first: 1 earlier turn"])

    def test_two_hand_overs_of_one_session_rebuild_as_one(self):
        """The timed turn in its seed's session, handed over a second time: the replay keeps the seed's url for its
        latest file, so a publish naming no url follows to the deck as the engine sends it, and the row is the seed's
        session's (not fresh, and not its first turn)."""
        first = self.handed_over(self.seed_slides(), 'one-session', 'seed.jsonl')
        self.assertTrue(self.main('seed-add', 'newest', '--out', self.run_dir)['ok'])
        self.main('before', 'B5', '1', '--out', self.run_dir, '--surface', 'cowork', '--seed', 'next')
        slide = self.SCRATCH + '/project/slides/sessions.html'  # the last file the seed published to the deck
        timed = Recorder(self.SEED_MNT, start=1000, session='one-session')
        timed.human(B5)
        timed.call('Edit', {'file_path': slide, 'old_string': 'Grace Okafor, 14 October', 'new_string': 'Grace Okafor, 21 October'})
        timed.call('Artifact', {'root': self.SCRATCH, 'file_path': slide})
        both = records(os.path.join(self.dir, 'both.jsonl'), [json.loads(line) for line in read(first).splitlines()] + timed.recs)
        self.handed_over(both, 'one-session', 'again.jsonl', start=1100)
        out = self.main('after', 'B5', '1', '--out', self.run_dir, '--permissions-answered', '0', '--transcript', 'newest')
        self.assertEqual((out['afterSource'], out['check']['pass'], out['freshSession'], out['priorTurns']), ("rebuilt from the records' calls", True, False, 2), out)
        self.assertEqual(out['valid'], ["the timed turn was not its session's first: 2 earlier turns", "the timed turn ran in its seed's session, not a fresh one"])

    def test_a_relative_out_resolves(self):
        """--out relative to the working directory: the manifest's paths are absolute, so the parser finds the records
        wherever it runs from."""
        cwd = os.getcwd()
        os.chdir(self.dir)
        try:
            self.handed_over(self.seed_slides(), 'cloud-seed', 'seed.jsonl')
            self.assertTrue(self.main('seed-add', 'newest', '--out', 'run')['ok'])
            self.main('before', 'B5', '1', '--out', 'run', '--surface', 'cowork', '--seed', 'next')
            self.handed_over(records(os.path.join(self.dir, 'timed.jsonl'), self.timed_b5().recs), 'cloud-timed', 'timed.jsonl')
            out = self.main('after', 'B5', '1', '--out', 'run', '--permissions-answered', '0', '--transcript', 'newest')
        finally:
            os.chdir(cwd)
        self.assertEqual(out['valid'], 'yes', out)
        m = json.loads(read(out['manifest']))
        self.assertTrue(all(os.path.isabs(m[k]) for k in ('transcript', 'seedTranscript', 'before', 'after')), m)
        row = prep.bench_parse().edit_row(out['manifest'])
        self.assertEqual((row['error'], row['measured'] is not None), (None, True))

    def test_newest_takes_only_a_hand_over_saved_since_before(self):
        old = self.handed_over(self.seed_slides(), 'cloud-seed', 'old.jsonl')
        os.utime(old, (time.time() - 3600, time.time() - 3600))
        self.main('before', 'B1', '1', '--out', self.run_dir)
        with self.assertRaises(SystemExit) as none:
            self.main('after', 'B1', '1', '--out', self.run_dir, '--permissions-answered', '0', '--transcript', 'newest')
        self.assertIn('hand the transcript over first', str(none.exception))


if __name__ == '__main__':
    unittest.main()
