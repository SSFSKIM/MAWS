#!/usr/bin/env python3
"""Writes the per-area tables of the word cut from items.json in this directory.

Run from anywhere: python3 docs/doperpowers/specs/2026-11-16-word-cut/render.py
items.json is the record; the .md files beside it are its rendering and are never edited by hand."""
import collections, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(HERE, 'items.json')))
items, pin = data['items'], data['pin']

AREAS = [
    ('session', 'The conversation and the message box'),
    ('beside', 'Panels beside the conversation'),
    ('window', 'Window, sidebar, sheets and overview'),
    ('typed', 'Dialogs opened by typed commands'),
    ('settings', 'Settings'),
    ('customize', 'Customize'),
    ('artifacts', 'Artifacts: the library and an opened artifact'),
    ('editors', 'Artifact editors'),
]
LEGEND = (
    "Columns: **Id** is the item's id in `items.json`. **Where** is the place on the surface. **Today** is the text at "
    f"the pin `{pin}` (an example value where the text is built from data). **Decision** is `cut` (the text leaves the "
    "resting surface), `reword` (it changes) or `stays` (today's text is kept; the row is here so that nobody proposes "
    "it again). **After** says what the surface shows afterwards, as it was built on the scratch branch and shown in "
    "the pictures. **Basis** is how firm the decision is, in the words of the root document's \"How firm each decision "
    "is\". **Source** is the file and line at the pin.\n"
)


def cell(text):
    return text.replace('|', '\\|') or '—'


for key, title in AREAS:
    rows = [x for x in items if x['area'] == key]
    by_decision = collections.Counter(x['decision'] for x in rows)
    by_basis = collections.Counter(x['basis'] for x in rows if x['decision'] != 'stays')
    changing = by_decision['cut'] + by_decision['reword']
    known = by_basis['seen'] + by_basis['brought back'] + by_basis['ruled']
    out = [
        f'# Word cut: {title}', '',
        '> Part of `docs/doperpowers/specs/2026-11-16-word-cut-design.md`; read that first. This file is written by '
        '`render.py` from `items.json` beside it; a decision changes there and in the root document\'s Decision Log.', '',
        f'{len(rows)} items: {by_decision["cut"]} cut, {by_decision["reword"]} reworded, {by_decision["stays"]} stay. '
        f'Of the {changing} that change, the owner saw {known} in a picture or ruled on them; {by_basis["pattern"]} '
        'follow the pattern and were not seen.', '', LEGEND,
    ]
    places = collections.OrderedDict()
    for x in rows:
        places.setdefault(x['place'], collections.OrderedDict()).setdefault(x['surface'], []).append(x)
    for place, surfaces in places.items():
        out += [f'## {place}', '']
        for surface, group in surfaces.items():
            if surface != place:
                out += [f'### {surface}', '']
            out += ['| Id | Where | Today | Decision | After | Basis | Source |', '|---|---|---|---|---|---|---|']
            for x in group:
                after = x['after'] if x['decision'] != 'stays' else ('Stays. ' + x['why'] if x['why'] else 'Stays.')
                if x.get('pending'):
                    after += ' **Open with the owner; see the root document.**'
                out.append(f"| {x['id']} | {cell(x['where'])} | {cell(x['today'])} | {x['decision']} | {cell(after)} | {x['basis']} | `{x['source']}` |")
            out.append('')
    with open(os.path.join(HERE, f'{key}.md'), 'w') as fh:
        fh.write('\n'.join(out))
    print(key, len(rows), dict(by_decision))
