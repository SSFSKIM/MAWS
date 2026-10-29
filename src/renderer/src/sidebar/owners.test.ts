// What a row says of its session's owners (P5 O8 M5, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The
// label"; Q2): nothing for your own alone, "you" first, two shown and "+N" past them, former members by that name.
import { describe, expect, it } from 'vitest';
import type { OrgMember } from '@shared/ipc/schema/org';
import { ownerEntries, ownersLabel } from './owners';

const ME = 'me';
const members = new Map<string, OrgMember>(
  [
    { id: ME, email: 'sam@example.com', name: 'Sam' },
    { id: 'ana', email: 'ana.lopez@example.com', name: 'Ana' },
    { id: 'ben', email: 'ben@example.com', name: 'Ben' },
    { id: 'cy', email: 'cy@example.com', name: 'Cy' },
    { id: 'dee', email: 'dee@example.com', name: 'Dee' },
    { id: 'eve', email: 'eve@example.com', name: 'Eve' },
    { id: 'gone', email: null, name: 'former member' },
  ].map((m) => [m.id, m]),
);

describe('ownersLabel', () => {
  it('is null for a session you own alone, and for one that names no owner', () => {
    expect(ownersLabel([ME], ME, members)).toBeNull();
    expect(ownersLabel([ME, ME], ME, members)).toBeNull();
    expect(ownersLabel([], ME, members)).toBeNull();
  });

  it('names you first, then the others in the listing’s order', () => {
    expect(ownersLabel(['ana', ME], ME, members)).toBe('you, Ana');
    expect(ownersLabel(['ana'], ME, members)).toBe('Ana');
    expect(ownersLabel(['ben', 'ana'], ME, members)).toBe('Ben, Ana');
  });

  it('shows two and counts the rest', () => {
    expect(ownersLabel(['ana', 'ben', 'cy', 'dee', 'eve'], ME, members)).toBe('Ana, Ben +3');
    expect(ownersLabel(['ana', 'ben', ME], ME, members)).toBe('you, Ana +1');
  });

  it('reads an owner the head doesn’t list, or the rows don’t name, as a former member', () => {
    expect(ownersLabel(['gone', 'ana'], ME, members)).toBe('former member, Ana');
    expect(ownersLabel(['unknown'], ME, members)).toBe('former member');
  });

  it('reads every owner by name signed out, when no one is you', () => {
    expect(ownersLabel([ME], null, members)).toBe('Sam');
  });
});

describe('ownerEntries', () => {
  it('lists every owner once, you first, each with its email', () => {
    expect(ownerEntries(['ana', ME, 'gone', 'ana'], ME, members)).toEqual([
      { id: ME, name: 'you', email: 'sam@example.com' },
      { id: 'ana', name: 'Ana', email: 'ana.lopez@example.com' },
      { id: 'gone', name: 'former member', email: null },
    ]);
  });
});
