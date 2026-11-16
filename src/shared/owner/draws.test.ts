// Who draws a session's to-human view (the UX wave, U2b: docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md,
// Interfaces §A and §G; decisions 1 to 5): an installation's declaration, the advertisement a launch carries, what the
// stored reservation says of the running launch, and the published `drawnBy`, each table case by case.
import { describe, expect, it } from 'vitest';
import { TO_HUMAN_CONTRACT_VERSION, TO_HUMAN_MIRROR_VERSION, TO_HUMAN_MOD_ROUTE } from './contract';
import { advertisementFor, advertisementOf, declaresDrawing, drawnBy, type Known, type Reservation } from './draws';

const AT = '2026-11-16T10:00:00.000Z';
const reservation = (over: Partial<Reservation> = {}): Reservation => ({ launchId: null, number: 9, plugin: true, at: AT, ...over });

describe('the numbers and the switch', () => {
  it('advertise 9 where the mod draws and 8 where MAWS does; the mod route is off until the cutover', () => {
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

describe('advertisementOf: what the stored row says of the running launch', () => {
  const row = (launchId: string | null, advertised: Reservation | null, desired: 'off' | 'external-style-plus-supplement' | null = 'external-style-plus-supplement') => ({ launchId, desired, advertised });
  it.each<[string, Parameters<typeof advertisementOf>[0], Known]>([
    ['its reservation bound to the running launch', row('l2', reservation({ launchId: 'l2', number: 9, plugin: true })), { known: true, number: 9, plugin: true }],
    ['bound to the running launch, at 8', row('l2', reservation({ launchId: 'l2', number: 8, plugin: false })), { known: true, number: 8, plugin: false }],
    ['bound to the running launch, none', row('l2', reservation({ launchId: 'l2', number: null, plugin: true }), 'off'), { known: true, number: null, plugin: true }],
    ['unbound, the running launch not the row’s launch_id (the bind was never written)', row('l1', reservation({ number: 9 })), { known: true, number: 9, plugin: true }],
    ['unbound, the row never bound a launch', row(null, reservation({ number: null, plugin: false })), { known: true, number: null, plugin: false }],
    ['the running launch is the row’s, no reservation: an earlier build’s launch at 8', row('l2', null), { known: true, number: 8, plugin: null }],
    ['the running launch is the row’s, no reservation, desired off', row('l2', null, 'off'), { known: true, number: null, plugin: null }],
    ['the running launch is the row’s, the reservation unbound (an earlier build launched after it)', row('l2', reservation({ number: 9 })), { known: true, number: 8, plugin: null }],
    ['the running launch is the row’s, the reservation bound to another launch', row('l2', reservation({ launchId: 'l1', number: 9 })), { known: true, number: 8, plugin: null }],
    ['bound to another launch, the running launch not the row’s', row('l1', reservation({ launchId: 'l1', number: 9 })), { known: false }],
    ['no reservation, the running launch not the row’s', row('l1', null), { known: false }],
    ['no reservation and nothing launched', row(null, null, null), { known: false }],
    ['no row (none, or one that cannot be read)', null, { known: false }],
  ])('%s', (_, given, known) => {
    expect(advertisementOf(given, 'l2')).toEqual(known);
  });
});

describe('drawnBy: who draws, from the advertisement, the engine and the loaded plugin', () => {
  const live = { launchId: 'l2', process: 'ready' as const };
  const DECLARING = { present: true, declares: true };
  const UNDECLARING = { present: true, declares: false };
  const ABSENT = { present: false, declares: false };
  const k = (number: 9 | 8 | null, plugin: boolean | null = null): Known => ({ known: true, number, plugin });
  const UNKNOWN: Known = { known: false };

  it('is MAWS for a session at rest: no status, or a process exiting or exited, whatever was advertised', () => {
    for (const advertisement of [k(9, true), k(8), k(null, true), UNKNOWN]) {
      expect(drawnBy(advertisement, null, DECLARING)).toBe('maws');
      expect(drawnBy(advertisement, { ...live, process: 'exiting' }, DECLARING)).toBe('maws');
      expect(drawnBy(advertisement, { ...live, process: 'exited' }, null)).toBe('maws');
    }
  });
  it.each<[string, Known, typeof DECLARING | null, 'mod' | 'maws']>([
    ['8, live, plugins not yet reported', k(8), null, 'maws'],
    ['8, the mod loaded and declaring', k(8), DECLARING, 'maws'],
    ['9, live, plugins not yet reported', k(9, true), null, 'mod'],
    ['9, the mod loaded and declaring', k(9, true), DECLARING, 'mod'],
    ['9, the mod loaded without the declaration (a reload to an older installation)', k(9, true), UNDECLARING, 'maws'],
    ['9, the mod not loaded', k(9, true), ABSENT, 'maws'],
    ['none, not yet reported, the reservation found the plugin', k(null, true), null, 'mod'],
    ['none, not yet reported, the reservation found none', k(null, false), null, 'maws'],
    ['none, not yet reported, whether it found one unknown', k(null, null), null, 'maws'],
    ['none, the mod loaded (older or newer)', k(null, false), UNDECLARING, 'mod'],
    ['none, the mod loaded and declaring', k(null, null), DECLARING, 'mod'],
    ['none, the mod not loaded', k(null, true), ABSENT, 'maws'],
    ['not known, not yet reported (decision 4)', UNKNOWN, null, 'mod'],
    ['not known, the mod loaded', UNKNOWN, UNDECLARING, 'mod'],
    ['not known, reported, the mod not loaded', UNKNOWN, ABSENT, 'maws'],
  ])('%s: %s', (_, advertisement, loaded, who) => {
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
