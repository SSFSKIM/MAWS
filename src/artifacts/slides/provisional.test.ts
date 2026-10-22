// P4-A2 G2.2 (docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md, G-R2): a publish's slide file as far as it
// parses, merged over the live slide and compared with it element by element. Over every cut of a recorded slide file:
// nothing counted removed while the file is open, nothing counted changed or new that the whole file does not change or
// add, the open element unchanged while its text is a prefix of the live text, and an unchanged copy drawing nothing;
// then a table's cells, a group's children, ids left out, a held file, a new slide and a new slide's place.
import { describe, expect, it } from 'vitest';
import { newDoc, type Doc } from '../yjs';
import { DECK_PATH, slidePath } from './deck';
import { readSlide, slideFile } from './model';
import { loadSlide } from './parse';
import { cellOf, provisionalOrder, provisionalSlide, type ProvisionalSlide } from './provisional';
import { publishDeck } from './publish';

const SOURCE = `<section id="s1" style="background:#ffffff; padding:128px; display:flex; flex-direction:column; gap:32px">
<h1 id="title" style="font-size:96px">Launch <b>review</b> &amp; plan</h1>
<p id="date" style="font-size:40px; color:#6a7179">Friday, 24 October</p>
<ul id="points" style="font-size:32px"><li>Scope is <i>frozen</i></li><li>Hiring on track</li><li>Budget at 92%</li></ul>
<div id="cards" style="display:flex; gap:32px"><div id="c1" style="flex:1; padding:24px"><h3 id="c1h" style="font-size:36px">Revenue</h3><p id="c1p" style="font-size:28px">Up 12%</p></div><div id="c2" style="flex:1; padding:24px"><h3 id="c2h" style="font-size:36px">Churn</h3><p id="c2p" style="font-size:28px">Down 3%</p></div></div>
<table id="tbl" style="font-size:24px"><tr id="r1"><th>Region</th><th>Q3</th></tr><tr id="r2"><td>EMEA</td><td>41</td></tr><tr id="r3"><td>APAC</td><td>37</td></tr></table>
<svg id="art" style="position:absolute; right:64px; top:64px" width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="#2b7a78"/></svg>
<x-shape id="badge" kind="rounded" style="position:absolute; left:64px; bottom:64px; width:200px; height:60px; background:#eef2f1"></x-shape>
<aside>Mention the date change.</aside>
</section>`;

/** A deck holding the slide, as the agent's create makes it; the live slide and the file `artifact_read` returns. */
function deck(source = SOURCE): { doc: Doc; live: ReturnType<typeof readSlide>; file: string } {
  const doc = newDoc();
  const out = publishDeck(doc, {}, { [DECK_PATH]: JSON.stringify({ order: ['s1'] }), [slidePath('s1')]: source }, false);
  expect(out.conflicts).toEqual([]);
  return { doc, live: readSlide(doc, 's1'), file: slideFile(doc, 's1') };
}

const sets = (p: ProvisionalSlide | null) => (p ? { changed: [...p.changed].sort(), added: [...p.added].sort(), removed: [...p.removed].sort() } : null);
const replace = (text: string, from: string, to: string) => {
  expect(text, `the recorded file holds ${from}`).toContain(from);
  return text.replace(from, to);
};

describe('provisionalSlide over every cut of a recorded slide file', () => {
  it('draws nothing for an unchanged copy at any cut: an open element whose text is a prefix of the live text is unchanged', () => {
    const { live, file } = deck();
    for (let cut = 0; cut <= file.length; cut++) expect(provisionalSlide('s1', live, file.slice(0, cut), true), JSON.stringify(file.slice(Math.max(0, cut - 40), cut))).toBeNull();
    expect(provisionalSlide('s1', live, file, false)).toBeNull();
  });

  it('counts nothing removed while the file is open, and nothing changed or new that the whole file does not change or add', () => {
    const { live, file } = deck();
    let edited = replace(file, 'Friday, 24 October', 'Monday, 27 October');
    edited = replace(edited, 'Down 3%', 'Down 3.5%');
    edited = replace(edited, '<td>37</td>', '<td>39</td>');
    edited = replace(edited, /<p id="c1p"[^>]*>Up 12%<\/p>\s*/.exec(edited)![0], ''); // a group's child left out
    edited = replace(edited, '</table>', '<tr id="r4"><td>LATAM</td><td>12</td></tr></table>\n<p id="note" style="font-size:24px">Figures &amp; dates as of Monday</p>\n<p style="font-size:20px">Draft</p>');
    const whole = provisionalSlide('s1', live, edited, false);
    const minted = [...whole!.added].find((key) => !['note', 'r4', 'r4#0', 'r4#1'].includes(key));
    expect(sets(whole)).toEqual({ changed: ['c2p', 'date', 'r3#1'], added: [minted, 'note', 'r4', 'r4#0', 'r4#1'].sort(), removed: ['c1p'] });
    expect(minted, 'an element the agent left without an id is new, under a minted id').toMatch(/^e\d+-[0-9a-z]{4}$/);

    const sectionEnds = edited.indexOf('</section>');
    let drawn = 0;
    for (let cut = 0; cut <= edited.length; cut++) {
      const p = provisionalSlide('s1', live, edited.slice(0, cut), true);
      const at = JSON.stringify(edited.slice(Math.max(0, cut - 40), cut));
      if (!p) {
        expect(drawn, `a layer once drawn is never withdrawn by a later cut (${at})`).toBe(0);
        continue;
      }
      drawn++;
      if (cut < sectionEnds) expect(p.removed.size, at).toBe(0);
      for (const key of p.changed) expect(whole!.changed.has(key), `${key} changed at ${at}`).toBe(true);
      for (const key of p.added) expect(whole!.added.has(key), `${key} new at ${at}`).toBe(true);
      expect(loadSlide(p.file, { fileId: 's1' }).ok, `the file to draw loads at ${at}`).toBe(true);
    }
    expect(drawn).toBeGreaterThan(0);
  });

  it('keeps the open element the live one until its text diverges, then draws it as far as it streamed', () => {
    const { live, file } = deck();
    const edited = replace(file, 'Down 3%', 'Down 3.5%');
    const upTo = (s: string) => edited.slice(0, edited.indexOf(s) + s.length);
    expect(provisionalSlide('s1', live, upTo('Down 3'), true)).toBeNull();
    const diverged = provisionalSlide('s1', live, upTo('Down 3.'), true)!;
    expect(sets(diverged)).toEqual({ changed: ['c2p'], added: [], removed: [] });
    expect(diverged.file).toContain('>Down 3.</p>');
    expect(diverged.file, 'the tail the text has not reached is the live slide’s').toContain('<td>APAC</td>');
  });
});

describe('provisionalSlide: containers, ids and holds', () => {
  it('merges an open row’s cells with the live row’s by position, and keys a cell by its row and column', () => {
    const { live, file } = deck();
    const upTo = (text: string, s: string) => text.slice(0, text.indexOf(s) + s.length);
    expect(provisionalSlide('s1', live, upTo(file, '<td>EMEA</td>'), true), 'the row’s other cells stand while it streams').toBeNull();
    const changed = provisionalSlide('s1', live, upTo(replace(file, '<td>41</td>', '<td>44</td>'), '<td>44'), true);
    expect(sets(changed)).toEqual({ changed: ['r2#1'], added: [], removed: [] });
    expect([cellOf('r2#1'), cellOf('r2')]).toEqual([{ row: 'r2', column: 1 }, null]);
    const grown = provisionalSlide('s1', live, upTo(replace(file, '<td>41</td>', '<td>41</td><td>9'), '<td>9'), true);
    expect(sets(grown)).toEqual({ changed: [], added: ['r2#2'], removed: [] });
    const shrunk = provisionalSlide('s1', live, replace(file, '<td>41</td>', ''), false);
    expect(sets(shrunk), 'a whole file’s row that leaves out a cell').toEqual({ changed: [], added: [], removed: ['r2#1'] });
  });

  it('merges a group’s children with the live group’s by id, never doubling an element moved out of it', () => {
    const { live, file } = deck();
    const c2p = /\s*<p id="c2p"[^>]*>Down 3%<\/p>/.exec(file)![0];
    // the agent moves c2p out of its group to the end of the slide
    const moved = replace(replace(file, c2p, ''), '<aside>', `${c2p.trim()}\n  <aside>`);
    const beforeMove = moved.slice(0, moved.indexOf('<p id="c2p"'));
    expect(provisionalSlide('s1', live, beforeMove, true), 'not yet written elsewhere: still the group’s, in its live place').toBeNull();
    const after = provisionalSlide('s1', live, moved.slice(0, moved.indexOf('Down 3%') + 4), true)!;
    expect(sets(after)).toEqual({ changed: [], added: [], removed: [] });
    expect(after.file.match(/id="c2p"/g)).toHaveLength(1);
    expect(after.file.indexOf('id="c2p"'), 'at its new place, after the table (the pinned elements are written last)').toBeGreaterThan(after.file.indexOf('id="tbl"'));
    // moved up, ahead of a group the text has not reached: the unreached group stands without it
    const up = replace(replace(file, c2p, ''), '<ul id="points"', `${c2p.trim()}\n  <ul id="points"`);
    const early = provisionalSlide('s1', live, up.slice(0, up.indexOf('Down 3%') + 7), true)!;
    expect(early.file.match(/id="c2p"/g)).toHaveLength(1);
    expect(early.file.indexOf('id="c2p"')).toBeLessThan(early.file.indexOf('id="points"'));
    // a group restyled while it streams: the group changed, its children the live ones until written
    const restyled = replace(file, '<div id="c1" style="flex:1; padding:24px">', '<div id="c1" style="flex:1; padding:32px">');
    const open = provisionalSlide('s1', live, restyled.slice(0, restyled.indexOf('padding:32px">') + 'padding:32px">'.length), true)!;
    expect(sets(open)).toEqual({ changed: ['c1'], added: [], removed: [] });
    expect(open.file).toContain('Up 12%');
  });

  it('keys an element left without an id by a minted id, the same at every cut', () => {
    const { live, file } = deck();
    const edited = replace(file, '<aside>', '<p style="font-size:20px">Draft notice</p>\n  <aside>');
    const at = (s: string) => provisionalSlide('s1', live, edited.slice(0, edited.indexOf(s) + s.length), true)!;
    const first = [...at('>Dr').added];
    expect(first).toHaveLength(1);
    expect([...at('Draft notice').added]).toEqual(first);
    expect([...provisionalSlide('s1', live, edited, false)!.added]).toEqual(first);
  });

  it('draws nothing for a file the loader would hold, or one whose section names another slide', () => {
    const { live, file } = deck();
    expect(provisionalSlide('s1', live, replace(file, '<aside>', '<iframe src="x"></iframe>\n  <aside>'), false)).toBeNull();
    expect(provisionalSlide('s1', live, replace(file, '<aside>', '<img id="pic" src="https://example.com/a.png">\n  <aside>'), false)).toBeNull();
    expect(provisionalSlide('s1', live, replace(file, 'id="s1"', 'id="s9"'), false)).toBeNull();
    expect(provisionalSlide('s1', live, '<sect', true), 'no section yet').toBeNull();
  });

  it('keeps the live slide’s own style, attributes and notes: they show at the swap', () => {
    const { live, file } = deck();
    const edited = replace(replace(file, 'background:#ffffff', 'background:#000000'), 'Mention the date change.', 'Other notes');
    expect(provisionalSlide('s1', live, edited, false)).toBeNull();
    const p = provisionalSlide('s1', live, replace(edited, 'Friday', 'Monday'), false)!;
    expect(p.file).toContain('background:#ffffff');
    expect(p.file).toContain('Mention the date change.');
  });

  it('draws a new slide whole, every element new, with its own section style', () => {
    const p = provisionalSlide('s2', null, '<section id="s2" style="background:#0f2a3d"><h2 id="t2" style="font-size:64px">Next st', true)!;
    expect(sets(p)).toEqual({ changed: [], added: ['t2'], removed: [] });
    expect(p.file).toContain('background:#0f2a3d');
    expect(p.file).toContain('>Next st</h2>');
    expect(sets(provisionalSlide('s2', null, '<section id="s2">', true))).toEqual({ changed: [], added: [], removed: [] });
  });
});

describe('provisionalOrder: a new slide’s place from a partial deck.json', () => {
  const live = ['s1', 's2', 's3'];
  it('places a new slide after the slide the streamed order names before it, and after the last slide until the order names it', () => {
    expect(provisionalOrder(live, ['n1'], undefined, false)).toEqual(['s1', 's2', 's3', 'n1']);
    const index = JSON.stringify({ title: 'Q3', order: ['s1', 'n1', 's2', 's3', 'n2'] });
    expect(provisionalOrder(live, ['n1', 'n2'], index, false)).toEqual(['s1', 'n1', 's2', 's3', 'n2']);
    expect(provisionalOrder(live, ['n2', 'n1'], index.slice(0, index.indexOf('"n1"') + 3), true), 'a cut id is not yet a name').toEqual(['s1', 's2', 's3', 'n2', 'n1']);
    expect(provisionalOrder(live, ['n2', 'n1'], index.slice(0, index.indexOf('"n1"') + 4), true)).toEqual(['s1', 'n1', 's2', 's3', 'n2']);
    expect(provisionalOrder(live, ['n1'], JSON.stringify({ order: ['n1', 's3', 's1'] }), false), 'first when nothing precedes it').toEqual(['n1', 's1', 's2', 's3']);
    expect(provisionalOrder(live, ['n1'], '{"title":"Q3","or', true)).toEqual(['s1', 's2', 's3', 'n1']);
    expect(provisionalOrder(live, [], index, false), 'the live slides keep their order').toEqual(live);
  });
});
