// Posting follows `sminos say` (smns §4): only the leading run of tags addresses anyone; untagged is a record to `*`;
// `@alias` delivers to that member; `@all` stands alone and is the members live at submission, with `wake`. The text
// is sent as typed, tags included, as sminos records it.
import { describe, expect, it } from 'vitest';
import { address, leadingTags, type Addressable } from './address';

const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const S2 = '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a';
const S3 = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const S4 = 'e0ad139c-18bc-45bd-9489-be8653145f80';
const members: Addressable[] = [
  { session: S1, alias: 'maws-45', member: true, live: true },
  { session: S2, alias: 'maws-fe', member: true, live: true },
  { session: S3, alias: 'cua repl', member: true, live: false },
  { session: S4, alias: 'doperpowers-1e', member: false, live: false },
];

describe('leadingTags', () => {
  it('reads only the run of tags that opens the text, with trailing ,:; and quoted names', () => {
    expect(leadingTags('@maws-45, @"cua repl": look at this @maws-fe').map((t) => t.name)).toEqual(['maws-45', 'cua repl']);
    expect(leadingTags('look @maws-45')).toEqual([]);
    expect(leadingTags('@maws-45#67646a hi')[0]).toMatchObject({ name: 'maws-45', short: '67646a' });
    expect(leadingTags('@maws-45x')[0].name).toBe('maws-45x');
    expect(leadingTags('@maws-45!')).toEqual([]); // a tag must end at a space or the end
  });
});

describe('address', () => {
  it('records untagged text to everyone, delivering to no one', () => {
    expect(address('status: green', members)).toEqual({ ok: true, to: '*', wake: false });
  });

  it('delivers to each tagged member once, by alias, short id, or session id', () => {
    expect(address('@maws-45 @9b2e4c6d @maws-45 keep user_id', members)).toEqual({
      ok: true,
      to: [
        { session: S1, alias: 'maws-45' },
        { session: S2, alias: 'maws-fe' },
      ],
      wake: false,
    });
    expect(address('@"cua repl" hi', members)).toMatchObject({ ok: true, to: [{ session: S3, alias: 'cua repl' }] });
  });

  it('sends @all to the members live now, with wake, and refuses it beside other tags', () => {
    expect(address('@all stop and rebase', members)).toEqual({
      ok: true,
      to: [
        { session: S1, alias: 'maws-45' },
        { session: S2, alias: 'maws-fe' },
      ],
      wake: true,
    });
    expect(address('@all @maws-45 hi', members)).toEqual({ ok: false, reason: '@all stands alone' });
  });

  it('refuses a tag no member answers to, naming a retired one as such, and an ambiguous one', () => {
    expect(address('@nobody hi', members)).toEqual({ ok: false, reason: 'no member @nobody in this project' });
    expect(address('@doperpowers-1e hi', members)).toEqual({ ok: false, reason: '@doperpowers-1e is retired; say it untagged to leave a note, or resume it' });
    const twins: Addressable[] = [...members, { session: '67aaaaaa-0000-4000-8000-000000000000', alias: 'maws-45', member: true, live: true }];
    expect(address('@maws-45 hi', twins)).toEqual({ ok: false, reason: 'ambiguous @maws-45 matches: maws-45#67646a1b, maws-45#67aaaaaa' });
    expect(address('@maws-45#67a hi', twins)).toMatchObject({ ok: true, to: [{ session: '67aaaaaa-0000-4000-8000-000000000000' }] });
  });

  it('refuses a tag naming another project, and takes one naming this project', () => {
    const project = { id: '6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f', name: 'MAWS' };
    expect(address('@arkho/maws-45 hi', members, project)).toEqual({ ok: false, reason: 'the desk sends to this project only: @arkho/maws-45' });
    expect(address('@MAWS/maws-45 hi', members, project)).toEqual({ ok: true, to: [{ session: S1, alias: 'maws-45' }], wake: false });
    expect(address(`@${project.id}/maws-fe hi`, members, project)).toMatchObject({ ok: true, to: [{ session: S2 }] });
  });
});
