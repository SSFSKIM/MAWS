import { describe, expect, it } from 'vitest';
import { address, type Addressable } from './address';
import { complete, completionAt } from './completion';

const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const S2 = '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a';
const S3 = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const S4 = 'e0ad139c-18bc-45bd-9489-be8653145f80';
const sessions: Addressable[] = [
  { session: S1, alias: 'maws-45', member: true, live: true },
  { session: S2, alias: 'maws-hub', member: true, live: true },
  { session: S3, alias: 'maws-hub', member: true, live: true },
  { session: S4, alias: 'maws-old', member: false, live: false },
  { session: 'f1f2f3f4-0000-4000-8000-000000000000', alias: 'cua repl', member: true, live: true },
];

describe('completionAt', () => {
  it('completes the @-tag being typed among the tags that open the text', () => {
    expect(completionAt('@ma', 3)).toEqual({ start: 0, query: 'ma' });
    expect(completionAt('@maws-45 @hu', 12)).toEqual({ start: 9, query: 'hu' });
    expect(completionAt('@', 1)).toEqual({ start: 0, query: '' });
  });

  it('offers nothing past the opening tags, where an @ is only text', () => {
    expect(completionAt('hello @ma', 9)).toBeNull();
    expect(completionAt('@maws-45 thanks @ma', 19)).toBeNull();
    expect(completionAt('@ma', 1)).toBeNull(); // the caret is inside the tag, not at its end
  });
});

describe('complete', () => {
  it("offers the project's live members whose alias starts with what is typed, and @all", () => {
    expect(complete('ma', sessions).map((c) => c.tag)).toEqual(['@maws-45', `@maws-hub#${S3.slice(0, 8)}`, `@maws-hub#${S2.slice(0, 8)}`]);
    expect(complete('', sessions).map((c) => c.tag)).toContain('@all');
    expect(complete('a', sessions).map((c) => c.tag)).toEqual(['@all']);
    expect(complete('cua', sessions).map((c) => c.tag)).toEqual(['@"cua repl"']);
  });

  it('finds a member by its title or a word of it, lists the title, and still inserts the tag of its alias', () => {
    const titled: Addressable[] = [
      { session: S1, alias: 'maws-4d', member: true, live: true, title: 'cua_repl' },
      { session: S2, alias: 'maws-e3', member: true, live: true, title: 'GUI AI agent workspace charter' },
      { session: S3, alias: 'maws-45', member: true, live: true },
    ];
    expect(complete('cua', titled)).toEqual([{ tag: '@maws-4d', alias: 'maws-4d', session: S1, title: 'cua_repl' }]);
    expect(complete('REPL', titled).map((c) => c.tag)).toEqual(['@maws-4d']);
    expect(complete('work', titled).map((c) => c.tag)).toEqual(['@maws-e3']);
    expect(complete('maws', titled).map((c) => [c.tag, c.title])).toEqual([
      ['@maws-45', null],
      ['@maws-4d', 'cua_repl'],
      ['@maws-e3', 'GUI AI agent workspace charter'],
    ]);
    expect(complete('ent', titled)).toEqual([]); // inside a word is not a match
  });

  it('never offers a member that left, and every tag it offers addresses exactly its session', () => {
    expect(complete('maws-o', sessions)).toEqual([]);
    for (const candidate of complete('', sessions).filter((c) => c.session)) {
      const addressed = address(`${candidate.tag} hi`, sessions);
      expect(addressed).toEqual({ ok: true, to: [{ session: candidate.session, alias: candidate.alias }], wake: false });
    }
  });

  it('disambiguates a live member against every member a tag reaches, an ended one that has not retired included', () => {
    const ended: Addressable[] = [
      { session: S2, alias: 'maws-hub', member: true, live: true },
      { session: S3, alias: 'maws-hub', member: true, live: false }, // ended, still a member: @maws-hub would be ambiguous
      { session: S4, alias: 'maws-hub', member: false, live: false }, // retired: addresses no one, so no clash
      { session: S1, alias: 'maws-45', member: true, live: true },
    ];
    expect(complete('maws', ended).map((c) => c.tag)).toEqual(['@maws-45', `@maws-hub#${S2.slice(0, 8)}`]);
    for (const candidate of complete('', ended).filter((c) => c.session)) {
      expect(address(`${candidate.tag} hi`, ended)).toEqual({ ok: true, to: [{ session: candidate.session, alias: candidate.alias }], wake: false });
    }
  });
});
