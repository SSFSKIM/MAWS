// Who draws a session's to-human view (the UX wave, U2b: docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md,
// Interfaces §A and §G; decisions 1 to 5): an installation's declaration, the advertisement a launch carries, what the
// stored reservation says of the running launch, and the published `drawnBy`, each table case by case.
import { describe, expect, it } from 'vitest';
import { TO_HUMAN_CONTRACT_VERSION, TO_HUMAN_MIRROR_VERSION, TO_HUMAN_MOD_ROUTE } from './contract';
import { advertisementFor, advertisementOf, declaresDrawing, drawnBy, type Known, type Reservation } from './draws';

const AT = '2026-11-16T10:00:00.000Z';
const reservation = (over: Partial<Reservation> = {}): Reservation => ({ launchId: null, number: 9, plugin: true, at: AT, ...over });

describe('the numbers and the switch', () => {
  it('advertise 9 where the mod draws and 8 where MAWS does; the mod route is off again since board ticket 850', () => {
    expect([TO_HUMAN_CONTRACT_VERSION, TO_HUMAN_MIRROR_VERSION]).toEqual([9, 8]);
    expect(TO_HUMAN_MOD_ROUTE).toBe(false);
  });
});

describe('declaresDrawing: an installation’s declaration, never its version', () => {
  it.each([
    ['drawsFrom 9 at 9', { toHumanView: { drawsFrom: 9 } }, true],
    ['drawsFrom 8 at 9 (not above the number)', { toHumanView: { drawsFrom: 8 } }, true],
    ['drawsFrom 10 at 9', { toHumanView: { drawsFrom: 10 } }, false],
    ['drawsFrom 9.5', { toHumanView: { drawsFrom: 9.5 } }, false],
    ['drawsFrom "9"', { toHumanView: { drawsFrom: '9' } }, false],
    ['no drawsFrom', { toHumanView: {} }, false],
    ['toHumanView null', { toHumanView: null }, false],
    ['no toHumanView', { version: '9.9.9' }, false],
    ['an array', [9], false],
    ['a string', '{"toHumanView":{"drawsFrom":9}}', false],
    ['null (no file, or one that does not parse)', null, false],
  ] as const)('%s', (_, file, declares) => {
    expect(declaresDrawing(file, 9)).toBe(declares);
  });
});

describe('advertisementFor: the number a launch carries', () => {
  const NEWER = { declares: true };
  const OLDER = { declares: false };
  it('carries nothing when the lane carries nothing, whatever is installed', () => {
    for (const installations of [[], [NEWER], [OLDER]]) {
      expect(advertisementFor(false, installations, true)).toBeNull();
      expect(advertisementFor(false, installations, false)).toBeNull();
    }
  });
  it('carries 9 only with the switch on and every applicable installation declaring', () => {
    expect(advertisementFor(true, [NEWER], true)).toBe(9);
    expect(advertisementFor(true, [NEWER, NEWER], true)).toBe(9);
    expect(advertisementFor(true, [NEWER, OLDER], true)).toBe(8); // two apply, one older
    expect(advertisementFor(true, [OLDER], true)).toBe(8);
    expect(advertisementFor(true, [], true)).toBe(8); // the list is empty
  });
  it('carries 8 with the switch off, a declaring installation included; the switch defaults to the contract’s', () => {
    expect(advertisementFor(true, [NEWER], false)).toBe(8);
    expect(advertisementFor(true, [NEWER])).toBe(TO_HUMAN_MOD_ROUTE ? 9 : 8);
  });
});

// §A, table A: what the row says the running launch `l2` carried. "Recorded" is the row's `launch_id`.
describe('advertisementOf: what the stored row says of the running launch (§A, table A)', () => {
  const row = (launchId: string | null, advertised: Reservation | null, desired: 'off' | 'external-style-plus-supplement' | null = 'external-style-plus-supplement') => ({ launchId, desired, advertised });
  const prior = (launchId: string, number: 9 | 8 | null, plugin = true) => ({ launchId, number, plugin });
  it.each<[string, Parameters<typeof advertisementOf>[0], Known]>([
    ['A1 · no row (none, or one that cannot be read)', null, { known: false }],
    ['A2 · the bound reservation bound to the running launch, at 9', row('l2', reservation({ launchId: 'l2', number: 9, plugin: true })), { known: true, number: 9, plugin: true }],
    ['A2 · the bound reservation bound to the running launch, at 8', row('l2', reservation({ launchId: 'l2', number: 8, plugin: false })), { known: true, number: 8, plugin: false }],
    ['A2 · the bound reservation bound to the running launch, none', row('l2', reservation({ launchId: 'l2', number: null, plugin: true }), 'off'), { known: true, number: null, plugin: true }],
    ['A2 · bound to the running launch, which the row has not recorded (an earlier build launched after it)', row('l1', reservation({ launchId: 'l2', number: 9 })), { known: true, number: 9, plugin: true }],
    ['A2 · the unbound reservation’s prior bound to the running launch (a relaunch reserved and refused)', row('l2', reservation({ number: 8, prior: prior('l2', 9) })), { known: true, number: 9, plugin: true }],
    ['A2 · the prior bound to the running launch, desired off', row('l2', reservation({ number: 9, prior: prior('l2', null, false) }), 'off'), { known: true, number: null, plugin: false }],
    ['A3 · the running launch recorded, no reservation: an earlier build’s launch at 8', row('l2', null), { known: true, number: 8, plugin: null }],
    ['A3 · the running launch recorded, no reservation, desired off', row('l2', null, 'off'), { known: true, number: null, plugin: null }],
    ['A3 · the running launch recorded, the reservation unbound with no prior (an earlier build launched after it)', row('l2', reservation({ number: 9 })), { known: true, number: 8, plugin: null }],
    ['A3 · the running launch recorded, the reservation bound to another launch', row('l2', reservation({ launchId: 'l1', number: 9 })), { known: true, number: 8, plugin: null }],
    ['A3 · the running launch recorded, the prior another launch’s', row('l2', reservation({ number: 9, prior: prior('l1', 9) }), 'off'), { known: true, number: null, plugin: null }],
    ['A4 · unbound at 9, the running launch not recorded (the bind never written, or another launch after it)', row('l1', reservation({ number: 9 })), { known: false }],
    ['A4 · unbound at 8, the running launch not recorded', row('l1', reservation({ number: 8 })), { known: false }],
    ['A4 · unbound with none, the row never recorded a launch', row(null, reservation({ number: null, plugin: false })), { known: false }],
    ['A4 · unbound, its prior another launch’s, the running launch not recorded', row('l1', reservation({ number: 9, prior: prior('l1', 8) })), { known: false }],
    ['A4 · bound to another launch, the running launch not recorded', row('l1', reservation({ launchId: 'l1', number: 9 })), { known: false }],
    ['A4 · no reservation, the running launch not recorded', row('l1', null), { known: false }],
    ['A4 · no reservation and nothing recorded', row(null, null, null), { known: false }],
    ['A5 · the running launch recorded, nothing bound to it, desired null', row('l2', null, null), { known: false }],
  ])('%s', (_, given, known) => {
    expect(advertisementOf(given, 'l2')).toEqual(known);
  });

  it('A2 and A4 · a relaunch that ran reads its own, and nothing reads the launch before it', () => {
    const accepted = row('l3', reservation({ launchId: 'l3', number: 9 }));
    expect(advertisementOf(accepted, 'l3')).toEqual({ known: true, number: 9, plugin: true });
    expect(advertisementOf(accepted, 'l2')).toEqual({ known: false });
  });
});

// §A, table B. B5 (a declaration outstanding or failed) is the tracker's: it passes such a plugin as declaring
// (./drawn-by.test.ts in src/services/owner); here `declares` is what the tracker passes.
describe('drawnBy: who draws, from the advertisement, the engine and the loaded plugin (§A, table B)', () => {
  const live = { launchId: 'l2', process: 'ready' as const };
  const DECLARING = { present: true, declares: true };
  const UNDECLARING = { present: true, declares: false };
  const ABSENT = { present: false, declares: false };
  const k = (number: 9 | 8 | null, plugin: boolean | null = null): Known => ({ known: true, number, plugin });
  const UNKNOWN: Known = { known: false };

  it('B1 · MAWS for a session at rest: no status, or a process exiting or exited, whatever was advertised and loaded', () => {
    for (const advertisement of [k(9, true), k(8), k(null, true), k(null, null), UNKNOWN]) {
      for (const loaded of [null, DECLARING, UNDECLARING, ABSENT]) {
        expect(drawnBy(advertisement, null, loaded)).toBe('maws');
        expect(drawnBy(advertisement, { ...live, process: 'exiting' }, loaded)).toBe('maws');
        expect(drawnBy(advertisement, { ...live, process: 'exited' }, loaded)).toBe('maws');
      }
    }
  });
  it.each<[string, Known, typeof DECLARING | null, 'mod' | 'maws']>([
    ['B2 · 8, plugins not yet reported', k(8), null, 'maws'],
    ['B2 · 8, reported, the mod loaded and declaring', k(8, true), DECLARING, 'maws'],
    ['B2 · 8, reported, the mod loaded without the declaration', k(8), UNDECLARING, 'maws'],
    ['B2 · 8, reported, the mod not loaded', k(8), ABSENT, 'maws'],
    ['B3 · 9, plugins not yet reported', k(9, true), null, 'mod'],
    ['B4 · 9, reported, the mod loaded, declaration yes', k(9, true), DECLARING, 'mod'],
    ['B6 · 9, reported, the mod loaded, declaration no (a reload to an older installation)', k(9, true), UNDECLARING, 'maws'],
    ['B7 · 9, reported, the mod not loaded', k(9, true), ABSENT, 'maws'],
    ['B8 · nothing, not yet reported, the launch found the plugin', k(null, true), null, 'mod'],
    ['B8 · nothing, not yet reported, whether it found one unknown (an earlier build’s lane-off launch)', k(null, null), null, 'mod'],
    ['B9 · nothing, not yet reported, the launch found none whose hooks load', k(null, false), null, 'maws'],
    ['B10 · nothing, reported, the mod loaded (older or newer)', k(null, false), UNDECLARING, 'mod'],
    ['B10 · nothing, reported, the mod loaded and declaring', k(null, null), DECLARING, 'mod'],
    ['B11 · nothing, reported, the mod not loaded', k(null, true), ABSENT, 'maws'],
    ['B12 · not known, not yet reported (decision 4)', UNKNOWN, null, 'mod'],
    ['B13 · not known, reported, the mod loaded without the declaration', UNKNOWN, UNDECLARING, 'mod'],
    ['B13 · not known, reported, the mod loaded and declaring', UNKNOWN, DECLARING, 'mod'],
    ['B14 · not known, reported, the mod not loaded', UNKNOWN, ABSENT, 'maws'],
  ])('%s', (_, advertisement, loaded, who) => {
    for (const process of ['starting', 'initializing', 'ready'] as const) expect(drawnBy(advertisement, { ...live, process }, loaded), process).toBe(who);
  });
});

// §G, the second table: under a launch that has advertised, after a reload, read through the two functions together.
describe('§G after a reload: the advertisement the launch reserved, and the installation now loaded', () => {
  const bound = (number: 9 | 8 | null) => ({ launchId: 'l2', desired: number === null ? ('off' as const) : ('external-style-plus-supplement' as const), advertised: reservation({ launchId: 'l2', number }) });
  const after = (number: 9 | 8 | null, loaded: { present: boolean; declares: boolean }) => drawnBy(advertisementOf(bound(number), 'l2'), { launchId: 'l2', process: 'ready' }, loaded);
  it.each([
    [8, { present: true, declares: true }, 'maws'],
    [8, { present: true, declares: false }, 'maws'],
    [8, { present: false, declares: false }, 'maws'],
    [9, { present: true, declares: true }, 'mod'],
    [9, { present: true, declares: false }, 'maws'],
    [9, { present: false, declares: false }, 'maws'],
    [null, { present: true, declares: false }, 'mod'],
    [null, { present: true, declares: true }, 'mod'],
    [null, { present: false, declares: false }, 'maws'],
  ] as const)('advertised %s, loaded %j: %s', (number, loaded, who) => {
    expect(after(number, loaded)).toBe(who);
  });
});
