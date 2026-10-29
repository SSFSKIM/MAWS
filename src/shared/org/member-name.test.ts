// A member's first name from the email the signed org state carries (P5 O8 M5, docs/doperpowers/plans/2026-10-28-p5-o8-
// org-interface.md, M5's "Names"; Interfaces §L): the derivation's cases, and the names of a head's members when two collide.
import { describe, expect, it } from 'vitest';
import { memberName, memberNames } from './member-name';

describe('memberName', () => {
  it('reads the local part’s first run of letters, capitalized', () => {
    expect(memberName('ana.lopez@example.com')).toBe('Ana');
    expect(memberName('ben@example.com')).toBe('Ben');
    expect(memberName('Chris_Doe@example.com')).toBe('Chris');
    expect(memberName('dee-dee@example.com')).toBe('Dee');
    expect(memberName('eve+maws@example.com')).toBe('Eve');
    expect(memberName('frank2@example.com')).toBe('Frank');
    expect(memberName('GINA@example.com')).toBe('Gina');
  });

  it('skips separators and digits before the first run, and reads letters beyond ASCII', () => {
    expect(memberName('42hal@example.com')).toBe('Hal');
    expect(memberName('.ivy@example.com')).toBe('Ivy');
    expect(memberName('élodie.martin@example.com')).toBe('Élodie');
  });

  it('falls back to the whole local part when it holds no letter, and to the whole text without an @', () => {
    expect(memberName('1234@example.com')).toBe('1234');
    expect(memberName('jo')).toBe('Jo');
  });
});

describe('memberNames', () => {
  it('names each member by its first name', () => {
    const names = memberNames([
      { id: 'a', email: 'ana.lopez@example.com' },
      { id: 'b', email: 'ben@example.com' },
    ]);
    expect(names).toEqual(new Map([['a', 'Ana'], ['b', 'Ben']]));
  });

  it('gives both members of a collision their whole local part, whatever its case', () => {
    const names = memberNames([
      { id: 'a', email: 'ana.lopez@example.com' },
      { id: 'b', email: 'Ana.Ruiz@example.com' },
      { id: 'c', email: 'ben@example.com' },
    ]);
    expect(names).toEqual(new Map([['a', 'ana.lopez'], ['b', 'Ana.Ruiz'], ['c', 'Ben']]));
  });

  it('gives members whose local parts collide too their whole email', () => {
    const names = memberNames([
      { id: 'a', email: 'ana@example.com' },
      { id: 'b', email: 'ana@other.example' },
      { id: 'c', email: 'ana.ruiz@example.com' },
    ]);
    expect(names).toEqual(new Map([['a', 'ana@example.com'], ['b', 'ana@other.example'], ['c', 'ana.ruiz']]));
  });
});
