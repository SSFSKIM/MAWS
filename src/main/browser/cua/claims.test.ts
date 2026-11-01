import { describe, expect, it } from 'vitest';
import { TabClaims } from './claims';

// The orphan policy (P5 O17 M4, D1; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M4's Decisions): a tab no live
// connection reserves, its creator's closed among them. The app's `'person'`: the tab is the person's, never an orphan.
// The render host's `'session'`: there is no person, so the tab is an orphan until a connection of its own session takes
// it at its first lease or close.
describe('TabClaims: the orphan policy', () => {
  it("'person' (the app's, the default): a closed creator's tabs are nobody's reservation and never orphans", () => {
    const claims = new TabClaims<string>();
    claims.reserve('t1', 'creator');
    claims.dropReservations('creator');
    expect(claims.reservedTo('t1')).toBeUndefined();
    expect(claims.isOrphan('t1')).toBe(false);
    expect(claims.adoptOrphan('t1', 'next')).toBe(false);
    expect(claims.reservedTo('t1')).toBeUndefined();
  });

  it("'session': a closed creator's tab is an orphan until one holder adopts it, which reserves it to that holder", () => {
    const claims = new TabClaims<string>('session');
    claims.reserve('t1', 'creator');
    claims.reserve('t2', 'other');
    claims.dropReservations('creator');
    expect(claims.isOrphan('t1')).toBe(true);
    expect(claims.isOrphan('t2')).toBe(false); // another holder's reservation stands
    expect(claims.adoptOrphan('t1', 'next')).toBe(true);
    expect(claims.reservedTo('t1')).toBe('next');
    expect(claims.isOrphan('t1')).toBe(false);
    expect(claims.adoptOrphan('t1', 'third')).toBe(false); // adopted once
    claims.dropReservations('next');
    expect(claims.isOrphan('t1')).toBe(true); // its adopter's close orphans it again
  });

  it("'session': a tab no connection ever reserved (a popup no lease adopted) is an orphan too; a reservation ends it", () => {
    const claims = new TabClaims<string>('session');
    expect(claims.isOrphan('popup')).toBe(true);
    claims.reserve('popup', 'again');
    expect(claims.isOrphan('popup')).toBe(false);
  });
});
