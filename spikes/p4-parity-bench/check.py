#!/usr/bin/env python3
"""The parity bench's one checker (P4-A1): a repetition counts only if its edit is correct, read from the artifact
before and after the turn in each app's native form, and the same rules judge both apps.

  python3 -I check.py <task> <before> <after>      prints {"pass": bool, "detail": "..."} and exits 0 or 1
  python3 -I check.py same <seed> <made>           a seeded artifact carries its seed: a document the same words in
                                                   order; a deck (a directory or .html) the same slides with the same
                                                   texts in order

A document is a markdown file (MAWS's `md` export; Desktop's file). A deck is a directory in the Slides shape
(`project/deck.json` with `order`, `project/slides/<id>.html`, as MAWS and Claude's Slides type keep it) or one HTML
file with a `<section>` per slide. Text is compared after normalising whitespace, MAWS's `^id` block markers and
comment milestones, and typographic quotes; nothing else is forgiven.
"""
import html.parser
import json
import os
import re
import sys

BULLETS = ('Bus 14 stops at the gate', 'Bike racks stand by the tool shed', 'Parking is on Mill Lane')


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def norm(text):
    text = re.sub(r'</?c:[A-Za-z0-9_-]+>', '', text)
    text = re.sub(r'(^|\s)\^[A-Za-z0-9_-]+\s*$', '', text.strip())
    text = text.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"').replace(' ', ' ')
    return re.sub(r'\s+', ' ', text).strip()


def blocks(path):
    text = read(path)
    out = [norm(b) for b in re.split(r'\n\s*\n', text)]
    return [b for b in out if b and not re.fullmatch(r'\^[A-Za-z0-9_-]+', b)]


class Slides(html.parser.HTMLParser):
    """Per <section>: its texts in order, each tagged with the element that holds it (h1-h3 title, li item, p para)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.slides = []
        self.stack = []
        self.buf = None

    def handle_starttag(self, tag, attrs):
        if tag == 'section':
            self.slides.append([])
        if tag in ('h1', 'h2', 'h3', 'p', 'li') and self.slides:
            self.flush()
            self.buf = [tag, '']
        if tag == 'br' and self.buf:
            self.buf[1] += ' '
        if tag == 'aside':
            self.flush()
            self.buf = ['notes', '']

    def handle_endtag(self, tag):
        if tag in ('h1', 'h2', 'h3', 'p', 'li', 'aside'):
            self.flush()

    def handle_data(self, data):
        if self.buf is not None:
            self.buf[1] += data

    def flush(self):
        if self.buf is not None and self.slides and norm(self.buf[1]):
            kind = 'title' if self.buf[0] in ('h1', 'h2', 'h3') else {'li': 'item', 'p': 'para'}.get(self.buf[0], self.buf[0])
            self.slides[-1].append((kind, norm(self.buf[1])))
        self.buf = None


def deck(path):
    p = Slides()
    if os.path.isdir(path):
        index = json.loads(read(os.path.join(path, 'project', 'deck.json')))
        slides_dir = os.path.join(path, 'project', 'slides')
        ids = list(index.get('order') or [])
        ids += sorted(f[:-5] for f in os.listdir(slides_dir) if f.endswith('.html') and f[:-5] not in ids)  # a file the order leaves out shows last
        for sid in ids:
            p.feed(read(os.path.join(slides_dir, sid + '.html')))
            p.flush()
    else:
        p.feed(read(path))
        p.flush()
    return p.slides


def diff_indexes(a, b):
    return [i for i in range(max(len(a), len(b))) if i >= len(a) or i >= len(b) or a[i] != b[i]]


def check(task, before, after):
    if task in ('B1', 'B3'):
        a, b = blocks(before), blocks(after)
        if len(a) != len(b):
            return False, 'block count %d -> %d' % (len(a), len(b))
        changed = diff_indexes(a, b)
        if task == 'B1':
            if len(changed) != 1:
                return False, '%d blocks changed, not one' % len(changed)
            i = changed[0]
            if 'Thursday' not in a[i]:
                return False, 'the changed block did not hold "Thursday"'
            if b[i] != a[i].replace('Thursday', 'Friday'):
                return False, 'the schedule paragraph changed beyond Thursday -> Friday'
            return True, 'block %d: Thursday -> Friday, nothing else changed' % i
        intro = next((i for i, x in enumerate(a) if x.startswith('Welcome to the spring season')), None)
        if changed != [intro]:
            return False, 'changed blocks %s, not the introduction (%s)' % (changed, intro)
        ratio = len(b[intro].split()) / len(a[intro].split())
        if not 0.6 <= ratio <= 1.4:
            return False, 'the introduction went from %d to %d words' % (len(a[intro].split()), len(b[intro].split()))
        return True, 'the introduction rewritten (%d -> %d words), nothing else changed' % (len(a[intro].split()), len(b[intro].split()))
    a, b = deck(before), deck(after)
    if task == 'B5':
        if len(a) != len(b):
            return False, 'slide count %d -> %d' % (len(a), len(b))
        changed = diff_indexes(a, b)
        if changed != [1]:
            return False, 'changed slides %s, not slide 2' % [i + 1 for i in changed]
        lines = diff_indexes(a[1], b[1])
        if len(a[1]) != len(b[1]) or len(lines) != 1:
            return False, 'slide 2 changed in %d texts' % len(lines)
        old, new = a[1][lines[0]][1], b[1][lines[0]][1]
        if 'Session lead' not in old or '21 October' not in new or '14 October' in new or old.replace('14 October', '21 October') != new:
            return False, 'the session lead line became %r' % new
        return True, 'slide 2: the session lead date -> 21 October, nothing else changed'
    if task == 'B7':
        if len(b) != len(a) + 1:
            return False, 'slide count %d -> %d' % (len(a), len(b))
        if b[:2] != a[:2] or b[3:] != a[2:]:
            return False, 'the other slides changed or moved'
        new = b[2]
        titles = [t for k, t in new if k == 'title']
        items = [t.rstrip('.').lower() for k, t in new if k == 'item']
        want = [x.lower() for x in BULLETS]
        if not titles or 'getting there' not in titles[0].lower():
            return False, 'the new slide 3 has no "Getting there" title'
        if items != want:
            return False, 'the new slide 3 has items %s' % items
        return True, 'a slide "Getting there" with the three bullets after slide 2, nothing else changed'
    return False, 'unknown task %s' % task


def words(path):
    """A document's words in order, its markdown syntax aside (heading marks, list and task markers, table rules, block
    ids): what a seed must carry over whatever form an app's writer gives it."""
    return re.findall(r"[A-Za-z0-9']+", ' '.join(re.sub(r'\[[ xX]\]', ' ', b) for b in blocks(path)))


def is_deck(path):
    return os.path.isdir(path) or path.lower().endswith(('.html', '.htm'))


def same(seed, made):
    if is_deck(seed) or is_deck(made):  # a deck: the same slides with the same texts in order, whatever its form
        a, b = deck(seed), deck(made)
        if a == b:
            return True, 'the same %d slides with the same texts in order' % len(a)
        i = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), None)
        if i is None:
            return False, 'slide count %d and %d' % (len(a), len(b))
        j = next((k for k in range(min(len(a[i]), len(b[i]))) if a[i][k] != b[i][k]), min(len(a[i]), len(b[i])))
        text = lambda s: s[j][1] if j < len(s) else None
        return False, 'slide %d differs at text %d: seed %r, made %r' % (i + 1, j + 1, text(a[i]), text(b[i]))
    a, b = words(seed), words(made)
    if a == b:
        return True, 'the same %d words in order' % len(a)
    i = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), min(len(a), len(b)))
    return False, 'differs at word %d: seed %r, made %r (%d and %d words)' % (i, ' '.join(a[i:i + 6]), ' '.join(b[i:i + 6]), len(a), len(b))


def main(argv):
    if len(argv) != 3:
        print(__doc__)
        return 2
    ok, detail = same(argv[1], argv[2]) if argv[0] == 'same' else check(*argv)
    print(json.dumps({'pass': ok, 'detail': detail}))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
