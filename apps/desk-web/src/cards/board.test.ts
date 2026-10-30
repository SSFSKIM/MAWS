// The cards list's rows (P5 O13 M5): per cut-over machine its name and whether its endpoint is online, and per session
// of the member's waiting on it the count the hub's presence gives, the title and lane its verified listing gives.
import type { Listing, Signed } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import { boardOf, movedToMaws, waitingOn, type Presences } from './board';
import type { CutOverMachine } from './machines';

const ME = 'member-me';
const machines: CutOverMachine[] = [
  { ref: 'ref-mini', name: 'mini', source: 'entry', until: null },
  { ref: 'ref-vm', name: 'vm-one', source: 'certificate', until: '2026-11-01T00:00:00.000Z' },
];
const listing = (machine: string, session: string, fields: Partial<Listing['fields']> = {}): Signed<Listing> => ({
  body: { org: 'o', machine, session, revision: 1, issued: '2026-10-28T00:00:00.000Z', fields: { owners: [ME], project: 'p', lane: 'A', state: 'waiting', title: `title ${session}`, ...fields } },
  sig: { kid: 'k', value: 'v' },
});
const listings = new Map([
  ['ref-mini/la-1', listing('ref-mini', 'la-1')],
  ['ref-mini/app-1', listing('ref-mini', 'app-1', { lane: 'B', title: 'a lane B session' })],
  ['ref-mini/la-b', listing('ref-mini', 'la-b', { owners: ['member-b'] })],
  ['ref-vm/vm-s', listing('ref-vm', 'vm-s', { lane: 'B' })],
] as const);
const pending = (n: number) => ({ project: 'p', kind: 'waiting' as const, pending: n });

describe('the cards board', () => {
  it("lists each machine's sessions of the member's waiting, with their listing's title and lane and the presence's count", () => {
    const presences: Presences = new Map();
    presences.set('ref-mini', { online: true, pending: { 'la-1': pending(2), 'app-1': pending(1), 'la-b': pending(1), unlisted: pending(1), idle: pending(0) } });
    presences.set('ref-vm', { online: false, pending: { 'vm-s': pending(1) } });
    const board = boardOf(machines, presences, new Map(listings), ME);
    expect(board).toEqual([
      {
        ref: 'ref-mini',
        name: 'mini',
        online: true,
        sessions: [
          { session: 'app-1', title: 'a lane B session', lane: 'B', project: 'p', pending: 1 },
          { session: 'la-1', title: 'title la-1', lane: 'A', project: 'p', pending: 2 },
        ],
      },
      // Offline, its rows stay as the hub last gave them.
      { ref: 'ref-vm', name: 'vm-one', online: false, sessions: [{ session: 'vm-s', title: 'title vm-s', lane: 'B', project: 'p', pending: 1 }] },
    ]);
    expect(waitingOn(board)).toBe(4);
  });

  it('draws a machine with no presence yet as not known, and nothing waiting', () => {
    const board = boardOf(machines, new Map(), new Map(listings), ME);
    expect(board.map((m) => [m.name, m.online, m.sessions.length])).toEqual([
      ['mini', null, 0],
      ['vm-one', null, 0],
    ]);
    expect(waitingOn(board)).toBe(0);
  });
});

// The freeze's seam (P5 O13 M6): a DX session's machine, by the name its log gives, is one of the cut-over machines when a
// name of theirs is the same without regard to case, as the hub and the org state compare names (`machineNameKey`).
describe('a machine moved to MAWS', () => {
  it("is a cut-over machine's name, compared without regard to case", () => {
    const names = machines.map((m) => m.name);
    expect(movedToMaws('mini', names)).toBe(true);
    expect(movedToMaws('MINI', names)).toBe(true);
    expect(movedToMaws('Vm-One', names)).toBe(true);
    expect(movedToMaws('SK.local', names)).toBe(false);
    expect(movedToMaws('min', names)).toBe(false);
    expect(movedToMaws('mini', [])).toBe(false);
  });
});
