#!/usr/bin/env python3
"""The parser's rule on synthesized records: fixtures/ holds one B1 turn as MAWS's engine records it (with `api-request`
records) and as Desktop's 2.1.299 records it (the transcript alone), with identical timings.
Run: python3 -I spikes/p4-parity-bench/parse_test.py"""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True  # no __pycache__ beside the spike

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('parse', os.path.join(HERE, 'parse.py'))
parse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parse)

MAWS_T = os.path.join(HERE, 'fixtures', 'maws-B1.jsonl')
DESKTOP_T = os.path.join(HERE, 'fixtures', 'desktop-B1.jsonl')
MATCH = ', change "Thursday" to "Friday" in the schedule paragraph. Change nothing else.'
PASS = {'pass': True, 'detail': 'block 3: Thursday -> Friday, nothing else changed'}


class Bench(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.dir)

    def manifest(self, name, arm, transcript, **extra):
        d = os.path.join(self.dir, name)
        os.makedirs(d, exist_ok=True)
        m = dict(arm=arm, task='B1', rep=int(name.rsplit('r', 1)[-1].split('-')[0]) if 'r' in name else 1, kind='document', transcript=transcript,
                 promptMatch=MATCH, startedAt='2026-10-19T11:59:59Z', check=PASS, pin=None, measurementOnly=False)
        if arm == 'desktop':
            m.update(surface='code', landing=['Edit', 'Write', 'MultiEdit'], landingFiles=['doc.md'])
        m.update(extra)
        path = os.path.join(d, 'manifest.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(m, f)
        return path

    def variant(self, src, name, change):
        """A copy of a fixture transcript with `change(record)` applied to every record."""
        path = os.path.join(self.dir, name)
        with open(src, encoding='utf-8') as f, open(path, 'w', encoding='utf-8') as out:
            for line in f:
                r = json.loads(line)
                change(r)
                out.write(json.dumps(r) + '\n')
        return path

    def run_cells(self, judge=None, n=5, desktop=DESKTOP_T, surfaces=('code',)):
        for i in range(1, n + 1):
            self.manifest('maws-B1-r%d' % i, 'maws', MAWS_T)
            for s in surfaces:
                self.manifest('desktop-%s-B1-r%d' % (s, i), 'desktop', desktop, surface=s)
        rows = [parse.edit_row(p) for p in parse.collect([self.dir])]
        cs = parse.cells(rows)
        return rows, cs, {v['task']: v for v in parse.verdicts(cs, judge)}['B1']


class Verdict(Bench):
    def test_transcript_only_desktop_is_judged(self):
        """Desktop's engine writes no api-request records, so its thinking type is unrecorded: the verdict stands."""
        rows, cs, v = self.run_cells()
        self.assertEqual([r['measured']['sendToEditLanded'] for r in rows], [5.2] * 10)
        self.assertEqual(cs[('B1', 'maws', 'maws')]['controls']['thinking'], ['adaptive'])
        self.assertEqual(cs[('B1', 'desktop', 'code')]['controls']['thinking'], [])
        self.assertEqual((v['verdict'], v['ratio'], v['why']), ('parity', 1.0, []))
        self.assertIn("thinking not in Desktop's records (thinking seen in 5 of 5 repetitions)", v['beside'])

    def test_a_control_both_record_still_voids(self):
        high = self.variant(DESKTOP_T, 'high.jsonl', lambda r: r.update(effort='high') if r.get('type') == 'assistant' else None)
        _, _, v = self.run_cells(desktop=high)
        self.assertEqual(v['verdict'], 'no verdict: the controls did not hold')
        self.assertIn("controls differ on effort: MAWS ['xhigh'], Desktop ['high']", v['why'])

    def test_advisor_and_iterations_are_reported_not_voiding(self):
        def advise(r):
            if r.get('type') == 'assistant':
                r['message']['usage']['iterations'].append({'type': 'advisor_message', 'output_tokens': 10})
        _, cs, v = self.run_cells(desktop=self.variant(DESKTOP_T, 'advisor.jsonl', advise))
        c = cs[('B1', 'desktop', 'code')]['controls']
        self.assertEqual((c['advisorModels'], c['iterationTypes']), (['claude-opus-5-5'], ['advisor_message']))
        self.assertEqual(v['verdict'], 'parity')
        self.assertIn("advisor model: MAWS [], Desktop ['claude-opus-5-5'] (not voiding)", v['beside'])

    def test_two_desktop_surfaces_need_a_judged_one(self):
        _, cs, v = self.run_cells(surfaces=('code', 'cowork'))
        self.assertIn(('B1', 'desktop', 'cowork'), cs)
        self.assertTrue(v['verdict'].startswith('no verdict: Desktop ran on more than one surface'), v['verdict'])
        _, _, v = self.run_cells(judge={'B1': 'code'}, surfaces=('code', 'cowork'))
        self.assertEqual((v['verdict'], v['surface']), ('parity', 'code'))
        self.assertTrue(any(b.startswith('Desktop on cowork, not judged') for b in v['beside']), v['beside'])

    def test_fewer_than_five_is_no_verdict(self):
        _, _, v = self.run_cells(n=4)
        self.assertTrue(v['verdict'].startswith('no verdict yet'), v['verdict'])

    def test_maws_variants_need_a_judged_one(self):
        """P4-A3: MAWS arms that differ by a lever are cells of their own; with more than one, the judged one is named,
        and the others are reported beside it against the same Desktop cell."""
        for i in range(1, 6):
            self.manifest('maws-B1-r%d' % i, 'maws', MAWS_T, variant='base')
            self.manifest('maws-alwaysLoad-B1-r%d' % i, 'maws', MAWS_T, variant='alwaysLoad')
            self.manifest('desktop-B1-r%d' % i, 'desktop', DESKTOP_T)
        rows = [parse.edit_row(p) for p in parse.collect([self.dir])]
        cs = parse.cells(rows)
        self.assertIn(('B1', 'maws', 'maws/alwaysLoad'), cs)
        self.assertIn(('B1', 'maws', 'maws/base'), cs)
        v = {x['task']: x for x in parse.verdicts(cs)}['B1']
        self.assertTrue(v['verdict'].startswith('no verdict: MAWS ran more than one variant (alwaysLoad, base)'), v['verdict'])
        v = {x['task']: x for x in parse.verdicts(cs, maws={'B1': 'alwaysLoad'})}['B1']
        self.assertEqual((v['verdict'], v['ratio'], v['maws']), ('parity', 1.0, 'alwaysLoad'))
        self.assertIn('MAWS base, not judged: median 5.2 over 5 valid (that/Desktop 1.0)', v['beside'])
        # a variant named that did not run is no verdict, even beside one cell that did: never the other arm's
        only_base = {k: c for k, c in cs.items() if k[2] != 'maws/alwaysLoad'}
        v = {x['task']: x for x in parse.verdicts(only_base, maws={'B1': 'alwaysLoad'})}['B1']
        self.assertEqual((v['verdict'], v['ratio']), ('no verdict: the judged MAWS variant alwaysLoad has no repetitions (MAWS ran base)', None))

    def test_the_requested_model_is_beside(self):
        """A1's residue: the requested variant (MAWS the 1M one, Desktop the plain one) is named beside the verdict, never
        voiding it, since the served model is compared and is the same."""
        plain = self.variant(DESKTOP_T, 'plain.jsonl', lambda r: r.update(requestedModel='claude-opus-5-5') if r.get('type') == 'assistant' else None)
        wide = self.variant(MAWS_T, 'wide.jsonl', lambda r: r.update(requestedModel='claude-opus-5-5[1m]') if r.get('type') == 'assistant' else None)
        for i in range(1, 6):
            self.manifest('maws-B1-r%d' % i, 'maws', wide)
            self.manifest('desktop-B1-r%d' % i, 'desktop', plain)
        cs = parse.cells([parse.edit_row(p) for p in parse.collect([self.dir])])
        v = {x['task']: x for x in parse.verdicts(cs)}['B1']
        self.assertEqual(v['verdict'], 'parity')
        self.assertIn("requested model: MAWS ['claude-opus-5-5[1m]'], Desktop ['claude-opus-5-5'] (not voiding)", v['beside'])

    def test_the_breakdown_to_the_landing(self):
        """The cause is read over the requests up to the one that made the landing call (findings §7c): their count and
        sums, and the turn's last landing beside the first."""
        x = parse.edit_row(self.manifest('maws-B1-r1', 'maws', MAWS_T))['measured']
        upto = x['perRequest'][:x['toLanding']['requests']]
        self.assertEqual(x['toLanding']['requests'], 2)
        self.assertEqual(x['toLanding']['thinkingTokens'], sum(r['think'] for r in upto))
        self.assertAlmostEqual(x['toLanding']['generation'], sum(r['gen'] for r in upto), places=2)
        self.assertEqual(x['sendToLastLanding'], x['sendToEditLanded'])  # one landing call
        cs = parse.cells([parse.edit_row(self.manifest('maws-B1-r%d' % i, 'maws', MAWS_T)) for i in range(2, 4)])
        self.assertEqual(cs[('B1', 'maws', 'maws')]['measures']['landingRequests']['median'], 2)


class Bootstrap(unittest.TestCase):
    RECORD = os.path.join(HERE, 'record-2026-10-21', 'run', 'report.json')

    def test_reproduces_the_records_b3_interval(self):
        """The interval A1 computed by hand for B3 (findings §7c: 0.79 to 1.93 at 95 %, 66 % of resamples above 1.2)
        from the same five and five landings, 20,000 resamples within each arm."""
        with open(self.RECORD, encoding='utf-8') as f:
            rows = json.load(f)['rows']
        arm = lambda a: [r['measured']['sendToEditLanded'] for r in rows if r['task'] == 'B3' and r['arm'] == a]
        b = parse.bootstrap(arm('maws'), arm('desktop'))
        self.assertEqual((b['resamples'], b['level']), (20000, 0.95))
        self.assertAlmostEqual(b['low'], 0.79, delta=0.02)
        self.assertAlmostEqual(b['high'], 1.93, delta=0.02)
        self.assertAlmostEqual(b['aboveThreshold'], 0.66, delta=0.02)
        self.assertEqual(parse.bootstrap(arm('maws'), arm('desktop')), b)  # seeded: the same record gives the same interval


class Validity(Bench):
    def test_missing_records_exclude_without_stopping_the_report(self):
        rows = [parse.edit_row(self.manifest('maws-B1-r1', 'maws', None)),
                parse.edit_row(self.manifest('maws-B1-r2', 'maws', os.path.join(self.dir, 'gone.jsonl'))),
                parse.edit_row(self.manifest('maws-B1-r3', 'maws', MAWS_T, journal=os.path.join(self.dir, 'gone-journal.jsonl')))]
        self.assertEqual([r['measured'] for r in rows], [None] * 3)
        self.assertEqual(parse.valid(rows[0])[0], 'no transcript in the manifest')
        self.assertIn('transcript', parse.valid(rows[1])[0])
        self.assertIn('journal', parse.valid(rows[2])[0])
        with contextlib.redirect_stdout(io.StringIO()) as out:
            parse.main(['report', self.dir])
        self.assertIn('records missing', out.getvalue())

    def test_human_stop_mode_and_seed_exclude(self):
        accept = self.variant(DESKTOP_T, 'accept.jsonl', lambda r: r.update(permissionMode='acceptEdits') if r.get('turnOrigin') == 'human' else None)
        rows = {name: parse.edit_row(p) for name, p in (
            ('stop', self.manifest('desktop-B1-r1', 'desktop', DESKTOP_T, humanStop='1 permission card answered')),
            ('mode', self.manifest('desktop-B1-r2', 'desktop', accept)),
            ('seed', self.manifest('desktop-B1-r3', 'desktop', DESKTOP_T, seedCheck={'pass': False, 'detail': 'slide 2 differs'})),
            ('ok', self.manifest('desktop-B1-r4', 'desktop', DESKTOP_T)))}
        self.assertEqual(parse.valid(rows['stop']), ['a human stop: 1 permission card answered'])
        self.assertEqual(parse.valid(rows['mode']), ['permission mode acceptEdits, not auto'])
        self.assertEqual(parse.valid(rows['seed']), ["the seed was not the bench's: slide 2 differs"])
        self.assertEqual(parse.valid(rows['ok']), [])

    def test_a_cowork_deck_runs_on_a_seed(self):
        """§7a: a Cowork deck repetition of the record runs on a seed `before --seed` took; one without is excluded, and
        a seed is no rule for the other surfaces or kinds."""
        deck = dict(task='B5', kind='presentation', surface='cowork')
        rows = [parse.edit_row(self.manifest(name, 'desktop', DESKTOP_T, **dict(deck, **extra))) for name, extra in (
            ('desktop-B5-r1', {}), ('desktop-B5-r2', dict(seedId='seed-01', freshSession=True)), ('desktop-B5-r3', dict(surface='code')),
            ('desktop-B1-r4', dict(task='B1', kind='document')))]
        self.assertEqual(rows[1]['seedId'], 'seed-01')
        self.assertEqual([parse.valid(r) for r in rows], [['no seed: a Cowork deck repetition of the record takes before --seed (§7a)'], [], [], []])

    def test_the_timed_turn_is_its_sessions_first(self):
        """A prompt that went into an existing session (the driver's New having failed) carries that session's context
        and cache: an earlier unrelated turn before the task's excludes the repetition, in either arm."""
        def earlier(src, name):
            path = os.path.join(self.dir, name)
            with open(src, encoding='utf-8') as f:
                recs = [json.loads(line) for line in f]
            asst = next(r for r in recs if r.get('type') == 'assistant')
            prior = [dict(recs[0], uuid='p1', timestamp='2026-10-19T11:58:00.000Z', turnPosition={'turnIndex': 1}, message={'role': 'user', 'content': 'List the tools available to you.'}),
                     dict(asst, uuid='p2', timestamp='2026-10-19T11:58:05.000Z', requestId='req_prior', requestRef=None,
                          message=dict(asst['message'], id='msg_prior', content=[{'type': 'text', 'text': 'Read, Edit, Write.'}]))]
            with open(path, 'w', encoding='utf-8') as out:
                out.write(''.join(json.dumps(r) + '\n' for r in prior + recs))
            return path
        rows = {name: parse.edit_row(p) for name, p in (
            ('desktop', self.manifest('desktop-B1-r1', 'desktop', earlier(DESKTOP_T, 'desktop-prior.jsonl'))),
            ('maws', self.manifest('maws-B1-r1', 'maws', earlier(MAWS_T, 'maws-prior.jsonl'))),
            ('plain', self.manifest('desktop-B1-r2', 'desktop', DESKTOP_T)))}
        for arm in ('desktop', 'maws'):
            self.assertEqual(rows[arm]['measured']['sendToEditLanded'], 5.2, 'the task\'s turn is the one measured')
            self.assertEqual((rows[arm]['priorTurns'], parse.valid(rows[arm])), (1, ["the timed turn was not its session's first: 1 earlier turn"]))
        self.assertEqual((rows['plain']['priorTurns'], parse.valid(rows['plain'])), (0, []))

    def test_landing_counts_only_the_artifacts_file(self):
        def other_file_first(r):  # the Read becomes an Edit of another file, landing before doc.md's
            for b in (r.get('message') or {}).get('content') or []:
                if isinstance(b, dict) and b.get('type') == 'tool_use' and b['name'] == 'Read':
                    b.update(name='Edit', input={'file_path': '/tmp/notes.md', 'old_string': 'a', 'new_string': 'b'})
        t = self.variant(DESKTOP_T, 'other.jsonl', other_file_first)
        self.assertEqual(parse.edit_row(self.manifest('desktop-B1-r1', 'desktop', t))['measured']['sendToEditLanded'], 5.2)
        self.assertEqual(parse.edit_row(self.manifest('desktop-B1-r2', 'desktop', t, landingFiles=None))['measured']['sendToEditLanded'], 2.1)

    def test_attempts_are_kept_apart(self):
        r = parse.edit_row(self.manifest('maws-B1-r3-a2', 'maws', MAWS_T, rep=3, attempt=2))
        self.assertEqual(parse.label(r), 'r3a2')


class Audit(Bench):
    def test_the_result_after_the_turns_send(self):
        audit = os.path.join(self.dir, 'audit.jsonl')
        sid = '00000000-0000-4000-8000-000000000002'
        with open(audit, 'w', encoding='utf-8') as f:
            f.write(json.dumps({'type': 'result', 'session_id': sid, '_audit_timestamp': '2026-10-19T11:59:00.000Z', 'ttft_ms': 9000}) + '\n')
            f.write(json.dumps({'type': 'result', 'session_id': sid, '_audit_timestamp': '2026-10-19T12:00:07.500Z', 'ttft_ms': 1500}) + '\n')
        r = parse.edit_row(self.manifest('desktop-B1-r1', 'desktop', DESKTOP_T, audit=audit, surface='cowork'))
        self.assertEqual((r['measured']['sendToFirstToken'], r['measured']['firstTokenSrc']), (1.5, 'audit result.ttft_ms'))


if __name__ == '__main__':
    unittest.main()
