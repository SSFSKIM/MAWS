// A snapshot's pages (O10 M8; RL3): its JSON text cut so each `snap` message fits a page, never inside a character.
import { describe, expect, it } from 'vitest';
import { pagesOf, SNAP_PAGE_BYTES } from '../../src/endpoint/subscriptions';

const snap = (body: string, page: number, last: boolean) => ({ t: 'snap', sub: 's1', page, last, body });
const size = (m: unknown) => Buffer.byteLength(JSON.stringify(m));

describe('a snapshot’s pages', () => {
  it('is one last page when the snapshot is small, and one empty page when it is empty', () => {
    expect(pagesOf('{"a":1}', snap)).toEqual([snap('{"a":1}', 0, true)]);
    expect(pagesOf('', snap)).toEqual([snap('', 0, true)]);
  });

  it('cuts a large snapshot into pages that each fit, numbered in order, the last one marked, which join back to it', () => {
    // Quotes and backslashes double in the page's JSON, and multibyte characters (a surrogate pair among them) weigh more
    // bytes than characters: the cut is by the message's bytes, not the text's length.
    const text = JSON.stringify({ rows: Array.from({ length: 40_000 }, (_, i) => ({ i, text: `"quoted\\" 한글 𝄞 ${i}` })) });
    const pages = pagesOf(text, snap);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.every((m) => size(m) <= SNAP_PAGE_BYTES)).toBe(true);
    expect(pages.map((m) => m.page)).toEqual(pages.map((_, i) => i));
    expect(pages.map((m) => m.last)).toEqual(pages.map((_, i) => i === pages.length - 1));
    expect(pages.map((m) => m.body).join('')).toBe(text);
    // No page ends inside a surrogate pair.
    expect(pages.every((m) => !/[\uD800-\uDBFF]$/.test(m.body))).toBe(true);
    expect(JSON.parse(pages.map((m) => m.body).join(''))).toEqual(JSON.parse(text));
  });
});
