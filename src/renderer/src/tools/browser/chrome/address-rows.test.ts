// E4a (Task 3.3): the address field's rows (Design §4 "Address field", §14): the typed address first (Go to, or Search
// for), a search for a URL-looking text second, then the partition's history rows, parsed and without the typed URL
// again; the default row is the typed address, none for a refused scheme or an empty field; the arrows clamp.
import { describe, expect, it } from 'vitest';
import { addressRows, defaultRow, moveRow } from './address-rows';

const SEARCH = 'https://search.test/?q=%s';
const history = (...urls: string[]) => urls.map((url) => ({ url, title: `T ${url}` }));

describe('addressRows', () => {
  it('a URL-looking text: Go to its parsed URL, then a search for the text, then history without the same URL', () => {
    expect(addressRows('wikipedia.org', history('https://wikipedia.org/', 'https://en.wikipedia.org/wiki/A'), SEARCH)).toEqual([
      { kind: 'go', url: 'https://wikipedia.org/' },
      { kind: 'search', url: 'https://search.test/?q=wikipedia.org', query: 'wikipedia.org' },
      { kind: 'history', url: 'https://en.wikipedia.org/wiki/A', title: 'T https://en.wikipedia.org/wiki/A' },
    ]);
  });

  it('a search text: Search for it, then history', () => {
    expect(addressRows('what is 2+2', history('https://a.test/x'), SEARCH)).toEqual([
      { kind: 'search', url: 'https://search.test/?q=what%20is%202%2B2', query: 'what is 2+2' },
      { kind: 'history', url: 'https://a.test/x', title: 'T https://a.test/x' },
    ]);
  });

  it('a refused scheme offers no row of its own; an empty field offers only history', () => {
    expect(addressRows('file:///etc/hosts', [], SEARCH)).toEqual([]);
    expect(addressRows('  ', history('https://a.test/'), SEARCH)).toEqual([{ kind: 'history', url: 'https://a.test/', title: 'T https://a.test/' }]);
  });

  it('a history row that is not an http(s) URL is dropped; one that is goes out parsed', () => {
    expect(addressRows('', [...history('javascript:alert(1)', 'not a url'), { url: 'https://A.test', title: null }], SEARCH)).toEqual([
      { kind: 'history', url: 'https://a.test/', title: null },
    ]);
  });
});

describe('the highlighted row', () => {
  it('defaults to the typed address, and to none when the list starts with history', () => {
    expect(defaultRow(addressRows('a.test', [], SEARCH))).toBe(0);
    expect(defaultRow(addressRows('', history('https://a.test/'), SEARCH))).toBe(-1);
    expect(defaultRow([])).toBe(-1);
  });

  it('moves with the arrows within the list', () => {
    expect(moveRow(-1, 1, 3)).toBe(0);
    expect(moveRow(0, 1, 3)).toBe(1);
    expect(moveRow(2, 1, 3)).toBe(2);
    expect(moveRow(1, -1, 3)).toBe(0);
    expect(moveRow(0, -1, 3)).toBe(0);
    expect(moveRow(-1, -1, 3)).toBe(-1);
    expect(moveRow(-1, 1, 0)).toBe(-1);
  });
});

// cua #90: an imported profile's bookmarks, which main sends first (at most 3 of 8), drawn with the bookmark glyph
describe('addressRows: bookmark rows', () => {
  const bookmark = (url: string, title: string | null) => ({ url, title, kind: 'bookmark' as const });
  it('keeps main\'s bookmark rows after the typed address and before history, as bookmarks', () => {
    expect(addressRows('f1', [bookmark('https://b.test/F1', 'F1'), { url: 'https://h.test/f1', title: 'H', kind: 'history' as const }], SEARCH)).toEqual([
      { kind: 'search', url: 'https://search.test/?q=f1', query: 'f1' },
      { kind: 'bookmark', url: 'https://b.test/F1', title: 'F1' },
      { kind: 'history', url: 'https://h.test/f1', title: 'H' },
    ]);
  });

  it('never defaults to a bookmark row: Enter runs the typed address, or nothing until an arrow moves', () => {
    expect(defaultRow(addressRows('', [bookmark('https://b.test/', 'B')], SEARCH))).toBe(-1);
    expect(defaultRow(addressRows('b.test', [bookmark('https://b.test/x', 'B')], SEARCH))).toBe(0);
  });

  it('drops a bookmark row that is not http(s) or that repeats the typed URL', () => {
    expect(addressRows('b.test', [bookmark('https://b.test/', 'B'), bookmark('javascript:x', 'J')], SEARCH).map((row) => row.kind)).toEqual(['go', 'search']);
  });
});

