#!/usr/bin/env python3
"""The checker against the seeds, each task's correct edit and the near misses a model makes.
Run: python3 -I spikes/p4-parity-bench/check_test.py"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True  # no __pycache__ beside the spike

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('check', os.path.join(HERE, 'check.py'))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)
read = check.read


def write(path, text):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


DOC = read(os.path.join(HERE, 'seed', 'document.md'))
DECK = os.path.join(HERE, 'seed', 'maws-deck')
INTRO = DOC.split('\n\n')[1]


class Doc(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.dir)

    def run_doc(self, task, after):
        a, b = os.path.join(self.dir, 'a.md'), os.path.join(self.dir, 'b.md')
        write(a, DOC)
        write(b, after)
        return check.check(task, a, b)

    def test_b1(self):
        self.assertTrue(self.run_doc('B1', DOC.replace('Thursday', 'Friday'))[0])
        self.assertTrue(self.run_doc('B1', DOC.replace('Thursday', 'Friday').replace('\n\n', '\n^b1\n\n', 1))[0], 'a block id marker is not a change')
        self.assertFalse(self.run_doc('B1', DOC)[0], 'no change')
        self.assertFalse(self.run_doc('B1', DOC.replace('Thursday evenings', 'Friday nights'))[0], 'more than the word')
        self.assertFalse(self.run_doc('B1', DOC.replace('Thursday', 'Friday').replace('ten in the morning', '10am'))[0], 'the same block changed elsewhere')
        self.assertFalse(self.run_doc('B1', DOC.replace('Thursday', 'Friday').replace('Twelve new', 'Ten new'))[0], 'another block changed')

    def test_same(self):
        a, b = os.path.join(self.dir, 'a.md'), os.path.join(self.dir, 'b.md')
        write(a, DOC)
        write(b, DOC.replace('|---|---|---|', '| --- | :--- | --- |').replace('- [ ] ', '* [ ] ').replace('\n\n', '\n^x1\n\n'))
        self.assertTrue(check.same(a, b)[0], 'markdown syntax and block ids aside')
        write(b, DOC.replace('three posts', 'four posts'))
        self.assertFalse(check.same(a, b)[0])

    def test_b3(self):
        warmer = 'We are so glad you are here for the spring season at Riverside Community Garden. ' + ' '.join(INTRO.split()[13:])
        self.assertTrue(self.run_doc('B3', DOC.replace(INTRO, warmer))[0])
        self.assertFalse(self.run_doc('B3', DOC.replace(INTRO, 'Welcome, friends!'))[0], 'far shorter')
        self.assertFalse(self.run_doc('B3', DOC.replace(INTRO, warmer).replace('Thursday', 'Friday'))[0], 'another block changed')


class Deck(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.before = os.path.join(self.dir, 'before')
        self.after = os.path.join(self.dir, 'after')
        shutil.copytree(DECK, self.before)
        shutil.copytree(DECK, self.after)

    def tearDown(self):
        shutil.rmtree(self.dir)

    def edit(self, sid, old, new):
        p = os.path.join(self.after, 'project', 'slides', sid + '.html')
        text = read(p)
        self.assertIn(old, text)
        write(p, text.replace(old, new))

    def add_after_sessions(self, html):
        write(os.path.join(self.after, 'project', 'slides', 'there.html'), html)
        p = os.path.join(self.after, 'project', 'deck.json')
        d = json.loads(read(p))
        d['order'].insert(2, 'there')
        write(p, json.dumps(d))

    def test_b5(self):
        self.edit('sessions', '14 October', '21 October')
        self.assertTrue(check.check('B5', self.before, self.after)[0])
        self.edit('sessions', 'Grace Okafor', 'G. Okafor')
        self.assertFalse(check.check('B5', self.before, self.after)[0], 'the lead line changed beyond the date')

    def test_b5_wrong_slide(self):
        self.edit('topics', 'garlic', 'onions')
        self.assertFalse(check.check('B5', self.before, self.after)[0])

    def test_b7(self):
        self.add_after_sessions('<section id="there"><h2 id="title">Getting there</h2><ul id="l"><li>Bus 14 stops at the gate.</li><li>Bike racks stand by the tool shed</li><li>Parking is on Mill Lane</li></ul></section>')
        self.assertTrue(check.check('B7', self.before, self.after)[0])

    def test_b7_misses(self):
        self.add_after_sessions('<section id="there"><h2 id="title">Getting there</h2><ul id="l"><li>Bus 14 stops at the gate</li><li>Parking is on Mill Lane</li></ul></section>')
        self.assertFalse(check.check('B7', self.before, self.after)[0], 'two bullets')

    def test_same_deck(self):
        self.assertTrue(check.same(DECK, self.after)[0], 'a copy')
        html = ''.join(read(os.path.join(DECK, 'project', 'slides', s + '.html')) for s in json.loads(read(os.path.join(DECK, 'project', 'deck.json')))['order'])
        one = os.path.join(self.dir, 'one.html')
        write(one, '<html><body>' + html.replace('<h2', '<h1').replace('</h2>', '</h1>') + '</body></html>')
        self.assertTrue(check.same(DECK, one)[0], 'one HTML file, other title tags: the same slides and texts')
        self.edit('sessions', 'Grace Okafor', 'G. Okafor')
        ok, detail = check.same(DECK, self.after)
        self.assertFalse(ok)
        self.assertIn('slide 2', detail)
        write(one, '<html><body>' + html.rsplit('<section', 1)[0] + '</body></html>')
        self.assertFalse(check.same(DECK, one)[0], 'a slide missing')

    def test_single_file_deck(self):
        html = ''.join(read(os.path.join(DECK, 'project', 'slides', s + '.html')) for s in json.loads(read(os.path.join(DECK, 'project', 'deck.json')))['order'])
        a, b = os.path.join(self.dir, 'a.html'), os.path.join(self.dir, 'b.html')
        write(a, '<html><body>' + html + '</body></html>')
        write(b, '<html><body>' + html.replace('14 October', '21 October') + '</body></html>')
        self.assertTrue(check.check('B5', a, b)[0])
        self.assertEqual(len(check.deck(a)), 6)


if __name__ == '__main__':
    unittest.main()
