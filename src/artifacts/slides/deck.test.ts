// P3-C M1 (D1): the deck's index, project/deck.json v4: every key kept, the known ones checked, one canonical file.
import { describe, expect, it } from 'vitest';
import { DECK_PATH, parseDeckJson, serializeDeckJson, slideIdOf, slidePath, type DeckJson } from './deck';

function parse(json: unknown): { deck: DeckJson; messages: string[] } {
  const r = parseDeckJson(typeof json === 'string' ? json : JSON.stringify(json));
  if (!r.ok) throw new Error(r.problems.join('; '));
  return { deck: r.deck, messages: r.diagnostics.map((d) => `${d.severity} ${d.property}: ${d.message}`) };
}

// Claude's own example index (T/slides/SKILL.md:29) with an unknown key and MAWS's overrides
const CLAUDE_INDEX = {
  zeta: { kept: true },
  dsOverrides: { '--ds-color-accent': '#c00' },
  designSystems: [],
  faces: { 'source-serif-4': { family: 'Source Serif 4', href: 'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@300..700&display=swap' } },
  sections: { s1: { description: 'Numbers', start: 'cover' } },
  order: ['cover', 'plan'],
  title: 'Q3',
  lists: 'css',
  createdOnFiles: { v: 1, at: '2026-09-14T18:20:00Z' },
  v: 4,
  alpha: 1,
};

describe('deck.json', () => {
  it('writes Claude’s keys in Claude’s order, then dsOverrides, then every other key sorted, and reaches a fixed point', () => {
    const { deck, messages } = parse(CLAUDE_INDEX);
    expect(messages).toEqual([]);
    const text = serializeDeckJson(deck);
    expect(Object.keys(JSON.parse(text))).toEqual(['v', 'createdOnFiles', 'lists', 'title', 'order', 'sections', 'faces', 'designSystems', 'dsOverrides', 'alpha', 'zeta']);
    expect(JSON.parse(text).zeta).toEqual({ kept: true });
    expect(serializeDeckJson(parse(text).deck)).toBe(text);
  });

  it('writes the maps by key and their entries’ fields in one order, so equal meaning is equal bytes', () => {
    const a = parse({ order: [], faces: { b: { href: 'https://fonts.googleapis.com/css2?family=B', family: 'B' }, a: { family: 'A', src: 'assets/a.woff2' } }, sections: { z: { start: 'x', description: 'Z' }, a: { description: 'A', before: 'y' } } });
    const b = parse({ sections: { a: { before: 'y', description: 'A' }, z: { description: 'Z', start: 'x' } }, faces: { a: { src: 'assets/a.woff2', family: 'A' }, b: { family: 'B', href: 'https://fonts.googleapis.com/css2?family=B' } }, order: [] });
    expect(serializeDeckJson(a.deck)).toBe(serializeDeckJson(b.deck));
  });

  it('refuses text that is not an index: not JSON, not an object, an order that is not a list, too many slides', () => {
    expect(parseDeckJson('{')).toMatchObject({ ok: false, problems: [expect.stringMatching(/^project\/deck\.json is not JSON/)] });
    expect(parseDeckJson('[]')).toEqual({ ok: false, problems: ['project/deck.json is not a JSON object'] });
    expect(parseDeckJson('{"order": "a"}')).toEqual({ ok: false, problems: ["project/deck.json's order is not a list of slide ids"] });
    expect(parseDeckJson(JSON.stringify({ order: Array.from({ length: 501 }, (_, i) => `s${i}`) }))).toEqual({ ok: false, problems: ["project/deck.json's order lists 501 slides (over 500)"] });
  });

  it('drops, with a warning, an entry that breaks its rule and keeps the rest', () => {
    const { deck, messages } = parse({
      order: ['a', 'a', 'b c', 7, 'b'],
      title: 3,
      cover: '../x',
      sections: { ok: { description: 'Fine', start: 'a' }, both: { description: 'Two', start: 'a', before: 'b' }, none: { description: 'None' } },
      faces: {
        lora: { family: 'Lora', href: 'https://fonts.googleapis.com/css2?family=Lora' },
        url: { family: 'Url', href: 'https://example.com/font.css' },
        data: { family: 'Data', src: 'data:font/woff2;base64,AAAA' },
        'My Face': { family: 'My Face', src: '/_blob/abc' },
        ds: { family: 'Ds', src: 'project/ds/maws/fonts/Ds.woff2' },
        extra: { family: 'Extra', src: 'assets/extra.woff2' },
        five: { family: 'Five', src: 'assets/five.woff2' },
      },
      designSystems: [1, 2, 3, 4, 5],
      dsOverrides: { '--ds-color-accent': '#c00', '--ds-page-width': '10in', color: 'red', '--ds-space-1': 4 },
    });
    expect(deck.order).toEqual(['a', 'b']);
    expect(deck.title).toBeUndefined();
    expect(deck.cover).toBeUndefined();
    expect(Object.keys(deck.sections!)).toEqual(['ok']);
    expect(Object.keys(deck.faces!)).toEqual(['lora', 'My Face', 'ds', 'extra']);
    expect(deck.designSystems).toEqual([1, 2, 3, 4]);
    expect(deck.dsOverrides).toEqual({ '--ds-color-accent': '#c00' });
    expect(messages).toEqual([
      'warning order: slide a is listed twice; the second dropped',
      'warning order: "b c" is not a slide id; dropped',
      'warning order: 7 is not a slide id; dropped',
      'warning title: title is not a string; dropped',
      'warning cover: cover "../x" is not a slide id; dropped',
      'warning sections.both: a section is {description, start} (or {description, before} when empty) with a slide id; dropped',
      'warning sections.none: a section is {description, start} (or {description, before} when empty) with a slide id; dropped',
      'warning faces.url: a face takes either href (a https://fonts.googleapis.com/css2?… link) or src (assets/<name>, /_blob/<id> or project/ds/<folder>/<file>); dropped',
      'warning faces.data: a face takes either href (a https://fonts.googleapis.com/css2?… link) or src (assets/<name>, /_blob/<id> or project/ds/<folder>/<file>); dropped',
      'note faces.My Face: a face is keyed by its family lowercased with spaces as -: "my-face"',
      'warning faces.five: more than 4 faces; dropped',
      'warning designSystems: 5 design-system records (over 4); the ones after the fourth dropped',
      'warning dsOverrides.--ds-page-width: an override is a --ds-* name (not --ds-page-*) to a CSS value; dropped',
      'warning dsOverrides.color: an override is a --ds-* name (not --ds-page-*) to a CSS value; dropped',
      'warning dsOverrides.--ds-space-1: an override is a --ds-* name (not --ds-page-*) to a CSS value; dropped',
    ]);
  });

  it('reads an index without an order as an empty deck', () => {
    expect(parse({ v: 4, title: 'New' }).deck.order).toEqual([]);
  });
});

describe('paths', () => {
  it('names the index and the slide files, and reads a slide id back from its path', () => {
    expect(DECK_PATH).toBe('project/deck.json');
    expect(slidePath('cover')).toBe('project/slides/cover.html');
    expect(slideIdOf('project/slides/cover.html')).toBe('cover');
    for (const path of ['project/slides/a b.html', 'project/slides/x/y.html', 'project/deck.json', 'slides/a.html', 'project/slides/.html']) expect(slideIdOf(path), path).toBeNull();
  });
});
