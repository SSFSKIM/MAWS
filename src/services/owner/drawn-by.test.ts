// What the owner service publishes as `drawnBy` (the UX wave, U2b: docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-
// human-view.md, Interfaces §A; M4's sequences): the session's running launch from the engine host's statuses, the
// advertisement its stored row says that launch carried, and the declaration read at the loaded plugin's reported path.
// Each sequence holds its order open and reads the value at the instant before and after the step it stages.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { Reservation } from '@shared/owner/draws';
import { WhoDraws, type DrawRow } from './drawn-by';

const APP = 'app-draws' as AppSessionId;
const AT = '2026-11-16T10:00:00.000Z';
const NEWER = '/cfg/plugins/cache/doperpowers/to-human/0.9.0';
const OLDER = '/cfg/plugins/cache/doperpowers/to-human/0.8.2';
type Status = Pick<EngineSessionStatus, 'appSessionId' | 'launchId' | 'process' | 'plugins' | 'pluginsObservedAt'>;
const status = (over: Partial<Status> = {}): Status => ({ appSessionId: APP, launchId: 'l1', process: 'ready', plugins: [], pluginsObservedAt: null, ...over });
const withPlugin = (path: string | null, observedAt: string, over: Partial<Status> = {}): Status =>
  status({ plugins: [{ name: 'other', path: '/cfg/other', source: 'other@x', version: '1' }, ...(path === null ? [] : [{ name: 'to-human', path, source: 'to-human@doperpowers', version: '0' }])], pluginsObservedAt: observedAt, ...over });
const reservation = (over: Partial<Reservation> = {}): Reservation => ({ launchId: null, number: 9, plugin: true, at: AT, ...over });

describe('WhoDraws', () => {
  let row: DrawRow | null;
  let changed: string[];
  let reads: { path: string; resolve: (declares: boolean) => void }[];
  let draws: WhoDraws;
  beforeEach(() => {
    row = { launchId: null, desired: 'external-style-plus-supplement', advertised: reservation() };
    changed = [];
    reads = [];
    draws = new WhoDraws({
      row: () => row,
      declares: (path) => new Promise((resolve) => reads.push({ path, resolve })),
      changed: (appSessionId) => void changed.push(`${appSessionId}:${draws.drawnBy(appSessionId)}`),
    });
  });
  afterEach(() => draws.stop());
  // one read answers; the others stay in flight (so the wait is for that answer's continuation, not for every read)
  const answer = async (n: number, declares: boolean) => {
    reads[n]!.resolve(declares);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  describe('before the live statuses were read once', () => {
    it('reads the row’s newest launch as live and unreported: never MAWS where the mod may draw', () => {
      expect(draws.drawnBy(APP)).toBe('mod'); // unbound at 9
      row = { launchId: 'l1', desired: 'external-style-plus-supplement', advertised: reservation({ launchId: 'l1', number: 8 }) };
      expect(draws.drawnBy(APP)).toBe('maws');
      row = { launchId: 'l1', desired: 'off', advertised: reservation({ launchId: 'l1', number: null, plugin: true }) };
      expect(draws.drawnBy(APP)).toBe('mod');
      row = { launchId: 'l1', desired: 'external-style-plus-supplement', advertised: null }; // an earlier build's launch at 8
      expect(draws.drawnBy(APP)).toBe('maws');
      row = null;
      expect(draws.drawnBy(APP)).toBe('maws');
    });
    it('reads a session with no status as at rest once they were read', () => {
      draws.primed();
      expect(draws.drawnBy(APP)).toBe('maws');
    });
  });

  describe('with the statuses read', () => {
    beforeEach(() => draws.primed());

    it('a reserved 9, live and not yet reported: mod; reported with the declaring mod: mod; the change published once', async () => {
      expect(draws.drawnBy(APP)).toBe('maws');
      draws.status(status({ process: 'starting' }));
      expect(draws.drawnBy(APP)).toBe('mod');
      expect(changed).toEqual([`${APP}:mod`]);
      draws.status(withPlugin(NEWER, AT));
      expect(reads.map((r) => r.path)).toEqual([NEWER]);
      expect(draws.drawnBy(APP)).toBe('mod'); // the read in flight: nothing reported yet stands
      await answer(0, true);
      expect(draws.drawnBy(APP)).toBe('mod');
      expect(changed).toEqual([`${APP}:mod`]);
    });

    it('reported with the mod loaded without the declaration: MAWS, once the read answers', async () => {
      draws.status(withPlugin(OLDER, AT));
      expect(draws.drawnBy(APP)).toBe('mod');
      await answer(0, false);
      expect(draws.drawnBy(APP)).toBe('maws');
      expect(changed).toEqual([`${APP}:mod`, `${APP}:maws`]);
    });

    it('reported without the mod: MAWS at once, with no read', () => {
      draws.status(withPlugin(null, AT));
      expect(reads).toEqual([]);
      expect(draws.drawnBy(APP)).toBe('maws');
    });

    it('after a reload the declaration is read at the newly reported path; until it answers the earlier fact stands', async () => {
      draws.status(withPlugin(NEWER, AT));
      await answer(0, true);
      draws.status(withPlugin(NEWER, AT)); // the same observation again: no new read
      expect(reads).toHaveLength(1);
      draws.status(withPlugin(OLDER, '2026-11-16T10:05:00.000Z'));
      expect(reads.map((r) => r.path)).toEqual([NEWER, OLDER]);
      expect(draws.drawnBy(APP)).toBe('mod');
      await answer(1, false);
      expect(draws.drawnBy(APP)).toBe('maws');
      draws.status(withPlugin(null, '2026-11-16T10:06:00.000Z')); // reloaded with none
      expect(draws.drawnBy(APP)).toBe('maws');
      draws.status(withPlugin(NEWER, '2026-11-16T10:07:00.000Z'));
      await answer(2, true);
      expect(draws.drawnBy(APP)).toBe('mod');
    });

    it('drops a read in flight when a later observation arrives', async () => {
      draws.status(withPlugin(NEWER, AT));
      draws.status(withPlugin(OLDER, '2026-11-16T10:05:00.000Z'));
      await answer(1, false);
      expect(draws.drawnBy(APP)).toBe('maws');
      await answer(0, true); // the earlier read answers last: dropped
      expect(draws.drawnBy(APP)).toBe('maws');
      expect(changed).toEqual([`${APP}:mod`, `${APP}:maws`]);
    });

    it('the process exits while a declaration’s read is in flight: the exit wins', async () => {
      draws.status(withPlugin(NEWER, AT));
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(withPlugin(NEWER, AT, { process: 'exiting' }));
      expect(draws.drawnBy(APP)).toBe('maws');
      draws.status(withPlugin(NEWER, AT, { process: 'exited' }));
      await answer(0, true);
      expect(draws.drawnBy(APP)).toBe('maws');
      expect(changed).toEqual([`${APP}:mod`, `${APP}:maws`]);
    });

    it('ignores a status of an older launch that arrives after a newer launch was bound', () => {
      row = { launchId: 'l1', desired: 'external-style-plus-supplement', advertised: reservation({ launchId: 'l1', number: 8 }) };
      draws.status(status({ launchId: 'l1' }));
      expect(draws.drawnBy(APP)).toBe('maws');
      row = { launchId: 'l2', desired: 'external-style-plus-supplement', advertised: reservation({ launchId: 'l2', number: 9 }) };
      draws.bound(APP, 'l2');
      draws.status(status({ launchId: 'l2', process: 'starting' }));
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(status({ launchId: 'l1', process: 'ready' })); // late, from the launch before
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(status({ launchId: 'l1', process: 'exited' }));
      expect(draws.drawnBy(APP)).toBe('mod');
    });

    it('the row cannot be read while a launch is live: mod while the mod is loaded or not reported, MAWS once reported without it', async () => {
      row = null;
      draws.status(status());
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(withPlugin(OLDER, AT));
      await answer(0, false);
      expect(draws.drawnBy(APP)).toBe('mod'); // loaded, whatever it declares: the unknown number may be none or 9
      draws.status(withPlugin(null, '2026-11-16T10:05:00.000Z'));
      expect(draws.drawnBy(APP)).toBe('maws');
      draws.status(withPlugin(OLDER, '2026-11-16T10:06:00.000Z'));
      row = { launchId: 'l1', desired: 'external-style-plus-supplement', advertised: reservation({ launchId: 'l1', number: 8 }) }; // read again at the next status
      await answer(1, false);
      expect(draws.drawnBy(APP)).toBe('maws');
    });

    it('an earlier build’s launch follows a reservation this build left unbound: read from that row’s desired', () => {
      row = { launchId: 'l-earlier', desired: 'external-style-plus-supplement', advertised: reservation({ number: 9 }) };
      draws.status(status({ launchId: 'l-earlier' }));
      expect(draws.drawnBy(APP)).toBe('maws');
      row = { ...row, desired: 'off' };
      draws.status(withPlugin(OLDER, AT, { launchId: 'l-earlier' }));
      expect(draws.drawnBy(APP)).toBe('maws'); // none, not yet reported (the read in flight), plugin unknown
    });

    it('no advertisement with the plugin loaded: mod, as in a terminal; with none applicable: MAWS', async () => {
      row = { launchId: null, desired: 'off', advertised: reservation({ number: null, plugin: true }) };
      draws.status(status());
      expect(draws.drawnBy(APP)).toBe('mod');
      row = { launchId: null, desired: 'off', advertised: reservation({ number: null, plugin: false }) };
      draws.status(status({ launchId: 'l2' }));
      expect(draws.drawnBy(APP)).toBe('maws');
      draws.status(withPlugin(OLDER, AT, { launchId: 'l2' }));
      await answer(0, false);
      expect(draws.drawnBy(APP)).toBe('mod');
    });

    it('keeps one session’s facts apart from another’s', () => {
      const other = 'app-other' as AppSessionId;
      draws.status(status());
      draws.status(status({ appSessionId: other, launchId: 'l9', process: 'exited' }));
      expect([draws.drawnBy(APP), draws.drawnBy(other)]).toEqual(['mod', 'maws']);
    });
  });
});
