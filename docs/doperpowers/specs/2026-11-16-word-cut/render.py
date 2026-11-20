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
    "is\". **Source** is the file and line at the pin. **M0** is what the re-reading against master found (see the root "
    "document's \"M0's record\"): `unchanged`, `moved`, `rewritten by the wave`, `gone` or `moot`, with the file and line "
    "on master, and for a rewritten row the text master shows and the row decided again by the five rules. **Build** is "
    "the milestone that builds the row and the scene whose before and after pictures show it.\n"
)
M0_LEGEND = (
    "Rows added by M0 for text the UX wave added after the pin. **Today** here is the text on master "
    f"`{data.get('master', '')}`, every row's basis is `pattern`, and **Source** is the file and line on master.\n"
)
MILESTONE = {'settings': 'M1', 'session': 'M2', 'beside': 'M3', 'window': 'M4', 'typed': 'M4', 'customize': 'M4', 'artifacts': 'M5', 'editors': 'M5'}


def cell(text):
    return text.replace('|', '\\|') or '—'


def m0_cell(x):
    m = x.get('m0')
    if not m:
        return '—'
    out = m['status']
    if m.get('source'):
        out += f" `{m['source']}`"
    if m['status'] == 'rewritten by the wave' and m.get('text'):
        out += f": now \"{m['text']}\""
        if m.get('decision'):
            out += f"; decided again ({m.get('basis') or 'pattern'}): {m['decision']}"
            if m.get('after'):
                out += f", {m['after']}"
            elif m.get('why'):
                out += f", {m['why']}"
    if m['status'] in ('gone', 'moot') and m.get('why'):
        out += f": {m['why']}"
    if m.get('owner'):
        out += f" **For the owner, not built: {m['owner']}**"
    if m.get('hold'):
        out += f" **Not built: {m['hold']}**"
    return out


def build_cell(x):
    m = x.get('m0') or {}
    if not m.get('milestone'):
        return '—'
    if m.get('scene'):
        return f"{m['milestone']} · `{m['scene']}`"
    return f"{m['milestone']} · no scene: {m.get('no_scene') or 'none recorded'}"


def table(group):
    out = ['| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |', '|---|---|---|---|---|---|---|---|---|']
    for x in group:
        after = x['after'] if x['decision'] != 'stays' else ('Stays. ' + x['why'] if x['why'] else 'Stays.')
        if x.get('pending'):
            after += ' **Open with the owner; see the root document.**'
        out.append(f"| {x['id']} | {cell(x['where'])} | {cell(x['today'])} | {x['decision']} | {cell(after)} | {x['basis']} | `{x['source']}` | {cell(m0_cell(x))} | {cell(build_cell(x))} |")
    out.append('')
    return out


def grouped(rows, h_place, h_surface):
    out = []
    places = collections.OrderedDict()
    for x in rows:
        places.setdefault(x['place'], collections.OrderedDict()).setdefault(x['surface'], []).append(x)
    for place, surfaces in places.items():
        out += [f'{h_place} {place}', '']
        for surface, group in surfaces.items():
            if surface != place:
                out += [f'{h_surface} {surface}', '']
            out += table(group)
    return out


for key, title in AREAS:
    rows = [x for x in items if x['area'] == key and (x.get('m0') or {}).get('status') != 'new']
    added = [x for x in items if x['area'] == key and (x.get('m0') or {}).get('status') == 'new']
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
        'follow the pattern and were not seen.', '',
    ]
    statuses = collections.Counter((x.get('m0') or {}).get('status', 'not read') for x in rows)
    if any(x.get('m0') for x in rows):
        owner = sum(1 for x in rows if (x.get('m0') or {}).get('owner'))
        new_by = collections.Counter(x['decision'] for x in added)
        out += [
            'Against master (M0): ' + ', '.join(f'{n} {s}' for s, n in statuses.most_common()) + f'; {owner} recorded for the owner. '
            f'M0 added {len(added)} rows for the UX wave\'s new text ({new_by["cut"]} cut, {new_by["reword"]} reworded, {new_by["stays"]} stay), '
            'listed at the end.', '',
        ]
    out += [LEGEND]
    out += grouped(rows, '##', '###')
    if added:
        out += ["## The UX wave's new text (M0)", '', M0_LEGEND]
        out += grouped(added, '###', '####')
    with open(os.path.join(HERE, f'{key}.md'), 'w') as fh:
        fh.write('\n'.join(out))
    print(key, len(rows), dict(by_decision), dict(statuses), 'new', len(added))

