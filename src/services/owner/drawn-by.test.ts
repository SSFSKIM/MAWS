// What the owner service publishes as `drawnBy` (the UX wave, U2b: docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-
// human-view.md, Interfaces §A, "Who draws: the table the code and its tests are checked against"): the session's
// running launch by table C, the advertisement the stored row says it carried (table A, @shared/owner/draws), the
// engine's state of it and the declaration read at the loaded plugin's reported path (table B). Each case names the
// cells it pins; each sequence holds its order open and reads the value before and after the step it stages.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { Reservation } from '@shared/owner/draws';
import { WhoDraws, type DrawRow, type DrawStatus } from './drawn-by';

const APP = 'app-draws' as AppSessionId;
const AT = '2026-11-16T10:00:00.000Z';
const NEWER = '/cfg/plugins/cache/doperpowers/to-human/0.9.0';
const OLDER = '/cfg/plugins/cache/doperpowers/to-human/0.8.2';
const T = (minute: number) => `2026-11-16T10:${String(minute).padStart(2, '0')}:00.000Z`;
const status = (over: Partial<DrawStatus> = {}): DrawStatus => ({ appSessionId: APP, launchId: 'l1', launchedAt: T(0), process: 'ready', plugins: [], pluginsObservedAt: null, ...over });
const withPlugin = (path: string | null, observedAt: string, over: Partial<DrawStatus> = {}): DrawStatus =>
  status({ plugins: [{ name: 'other', path: '/cfg/other', source: 'other@x', version: '1' }, ...(path === null ? [] : [{ name: 'to-human', path, source: 'to-human@doperpowers', version: '0' }])], pluginsObservedAt: observedAt, ...over });
const reservation = (over: Partial<Reservation> = {}): Reservation => ({ launchId: null, number: 9, plugin: true, at: AT, ...over });
const bound = (launchId: string, number: 9 | 8 | null, over: Partial<DrawRow> = {}): DrawRow => ({ launchId, desired: number === null ? 'off' : 'external-style-plus-supplement', advertised: reservation({ launchId, number }), ...over });

describe('WhoDraws', () => {
  let row: DrawRow | null;
  let changed: string[];
  let reads: { path: string; resolve: (declares: boolean | null) => void; reject: (error: Error) => void }[];
  let draws: WhoDraws;
  beforeEach(() => {
    row = bound('l1', 9);
    changed = [];
    reads = [];
    draws = new WhoDraws({
      row: () => row, // null: no row, or one that cannot be read (the owner service's wiring catches the read)
      declares: (path) => new Promise((resolve, reject) => reads.push({ path, resolve, reject })),
      changed: (appSessionId) => void changed.push(`${appSessionId}:${draws.drawnBy(appSessionId)}`),
    });
  });
  afterEach(() => draws.stop());
  // one read answers; the others stay in flight (so the wait is for that answer's continuation, not for every read)
  const answer = async (n: number, declares: boolean | null) => {
    reads[n]!.resolve(declares);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const list = (statuses: DrawStatus[] = []) => draws.listed(statuses, draws.mark());

  describe('before the first read of the live statuses (not yet discovered: live, plugins not reported)', () => {
    it('A1, B12 · a row that cannot be read is not known: mod', () => {
      row = null;
      expect(draws.drawnBy(APP)).toBe('mod');
    });
    it('A2, B3 and B2 · the recorded launch’s bound reservation: 9 mod, 8 MAWS', () => {
      expect(draws.drawnBy(APP)).toBe('mod');
      row = bound('l1', 8);
      expect(draws.drawnBy(APP)).toBe('maws');
    });
    it('A3, B8 · the recorded launch an earlier build’s lane-off launch after an obsolete reservation at 8: mod, never the older launch’s 8', () => {
      row = { launchId: 'l-earlier', desired: 'off', advertised: reservation({ launchId: 'l0', number: 8 }) };
      expect(draws.drawnBy(APP)).toBe('mod');
      row = { launchId: 'l-earlier', desired: 'external-style-plus-supplement', advertised: reservation({ launchId: 'l0', number: 9 }) }; // an earlier build's lane-on launch: 8
      expect(draws.drawnBy(APP)).toBe('maws');
    });
    it('A4, B12 · a reservation not yet bound: the launch running may be the one it was made for, not recorded: mod', () => {
      row = { launchId: null, desired: 'external-style-plus-supplement', advertised: reservation({ number: 8 }) };
      expect(draws.drawnBy(APP)).toBe('mod');
      row = { launchId: 'l1', desired: 'external-style-plus-supplement', advertised: reservation({ number: 9, prior: { launchId: 'l1', number: 8, plugin: true } }) };
      expect(draws.drawnBy(APP)).toBe('mod'); // the recorded launch's prior says 8, but an accepted relaunch may run
    });
    it('A4, B12 · nothing recorded and nothing reserved: not known, mod (a window with no surface draws the mirror)', () => {
      row = { launchId: null, desired: null, advertised: null };
      expect(draws.drawnBy(APP)).toBe('mod');
    });
  });

  describe('with the statuses read', () => {
    it('B1 · a session the read did not list is at rest: MAWS', () => {
      list();
      expect(draws.drawnBy(APP)).toBe('maws');
    });

    it('C1, B3, B5, B4 · a reserved 9, live and not reported: mod; reported with the mod, its read outstanding: mod; declaring: mod; published once', async () => {
      list();
      expect(draws.drawnBy(APP)).toBe('maws');
      draws.status(status({ process: 'starting' }));
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(withPlugin(NEWER, AT));
      expect(reads.map((r) => r.path)).toEqual([NEWER]);
      expect(draws.drawnBy(APP)).toBe('mod'); // outstanding
      await answer(0, true);
      expect(draws.drawnBy(APP)).toBe('mod');
      expect(changed).toEqual([`${APP}:mod`]);
    });

    it('B5, B6 · at 9 the mod loaded without the declaration: mod while its read is outstanding, MAWS once it answers no', async () => {
      list();
      draws.status(withPlugin(OLDER, AT));
      expect(draws.drawnBy(APP)).toBe('mod');
      await answer(0, false);
      expect(draws.drawnBy(APP)).toBe('maws');
      expect(changed).toEqual([`${APP}:mod`, `${APP}:maws`]);
    });

    it('B5 · a declaration whose read failed (an I/O error, not a missing file) is unknown: mod, until the next observation', async () => {
      list();
      draws.status(withPlugin(NEWER, AT));
      await answer(0, null);
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(withPlugin(NEWER, T(5)));
      reads[1]!.reject(new Error('EIO'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(withPlugin(NEWER, T(6)));
      await answer(2, false);
      expect(draws.drawnBy(APP)).toBe('maws');
    });

    it('B7 · at 9 reported without the mod: MAWS at once, with no read', () => {
      list();
      draws.status(withPlugin(null, AT));
      expect(reads).toEqual([]);
      expect(draws.drawnBy(APP)).toBe('maws');
    });

    it('C1, B5 · after a reload the newly loaded plugin counts as declaring until its read answers (never MAWS on a guess)', async () => {
      list();
      draws.status(withPlugin(OLDER, AT));
      await answer(0, false);
      expect(draws.drawnBy(APP)).toBe('maws');
      draws.status(withPlugin(OLDER, AT)); // the same observation again: no new read
      expect(reads).toHaveLength(1);
      draws.status(withPlugin(NEWER, T(5))); // reloaded to a declaring installation, its read held open
      expect(reads.map((r) => r.path)).toEqual([OLDER, NEWER]);
      expect(draws.drawnBy(APP)).toBe('mod');
      await answer(1, true);
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(withPlugin(null, T(6))); // reloaded with none
      expect(draws.drawnBy(APP)).toBe('maws');
      draws.status(withPlugin(OLDER, T(7)));
      expect(draws.drawnBy(APP)).toBe('mod'); // outstanding again
      await answer(2, false);
      expect(draws.drawnBy(APP)).toBe('maws');
      expect(changed).toEqual([`${APP}:mod`, `${APP}:maws`, `${APP}:mod`, `${APP}:maws`, `${APP}:mod`, `${APP}:maws`]);
    });

    it('C1 · a new observation replaces the outstanding read: the earlier answer is dropped', async () => {
      list();
      draws.status(withPlugin(NEWER, AT));
      draws.status(withPlugin(OLDER, T(5)));
      await answer(1, false);
      expect(draws.drawnBy(APP)).toBe('maws');
      await answer(0, true); // the earlier read answers last: dropped
      expect(draws.drawnBy(APP)).toBe('maws');
      expect(changed).toEqual([`${APP}:mod`, `${APP}:maws`]);
    });

    it('C1, B1 · the running launch exits while a declaration’s read is outstanding: the exit wins', async () => {
      list();
      draws.status(withPlugin(NEWER, AT));
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(withPlugin(NEWER, AT, { process: 'exiting' }));
      expect(draws.drawnBy(APP)).toBe('maws');
      draws.status(withPlugin(NEWER, AT, { process: 'exited' }));
      await answer(0, true);
      expect(draws.drawnBy(APP)).toBe('maws');
      expect(changed).toEqual([`${APP}:mod`, `${APP}:maws`]);
    });

    it('B3 · a launch bound before its first status is live with its plugins not reported: a just-bound 9 is mod', () => {
      list();
      row = bound('l2', 9);
      draws.bound(APP, 'l2', T(1));
      expect(draws.drawnBy(APP)).toBe('mod');
      row = bound('l2', 8);
      expect(draws.drawnBy(APP)).toBe('maws');
    });

    it('C2 · another launch’s exit never puts the running launch at rest, its id seen before or not (bound and observed at 9, then an unseen l1 exits)', () => {
      list();
      row = bound('l2', 9);
      draws.bound(APP, 'l2', T(1));
      draws.status(status({ launchId: 'l2', launchedAt: T(1), process: 'starting' }));
      draws.status(status({ launchId: 'l1', launchedAt: T(0), process: 'exited' })); // unseen
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(status({ launchId: 'l0', launchedAt: T(2), process: 'exiting' })); // unseen, whatever its time
      expect(draws.drawnBy(APP)).toBe('mod');
    });

    it('C2 · a launch that was running and was replaced: its late statuses, live or exiting, are not applied', () => {
      row = bound('l1', 8);
      list([status({ launchId: 'l1', launchedAt: T(0) })]);
      expect(draws.drawnBy(APP)).toBe('maws');
      row = bound('l2', 9);
      draws.bound(APP, 'l2', T(2));
      draws.status(status({ launchId: 'l2', launchedAt: T(2), process: 'starting' }));
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(status({ launchId: 'l1', launchedAt: T(0), process: 'ready' })); // late, from the launch before
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(status({ launchId: 'l1', launchedAt: T(0), process: 'exited' }));
      expect(draws.drawnBy(APP)).toBe('mod');
    });

    it('C3, A4, B12 · a launch not seen before with a live process becomes the running one (another client’s, or an earlier build’s)', () => {
      row = bound('l1', 8);
      list([status({ launchId: 'l1', launchedAt: T(0) })]);
      expect(draws.drawnBy(APP)).toBe('maws');
      draws.status(status({ launchId: 'l3', launchedAt: T(4), process: 'starting' }));
      expect(draws.drawnBy(APP)).toBe('mod'); // not recorded, nothing bound to it: not known
      draws.status(withPlugin(null, AT, { launchId: 'l3', launchedAt: T(4) }));
      expect(draws.drawnBy(APP)).toBe('maws'); // B14
    });

    it('C3 · by the host’s start times: a late live status of an older launch never becomes the running one', () => {
      row = bound('l2', 9);
      list([status({ launchId: 'l2', launchedAt: T(2) })]);
      draws.status(status({ launchId: 'l1', launchedAt: T(0), process: 'ready' })); // unseen, started before the running one
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(withPlugin(null, AT, { launchId: 'l1', launchedAt: T(0) }));
      expect(draws.drawnBy(APP)).toBe('mod'); // not l1's report: l2 is still not reported
      // and against a launch bound before its first status, the start time the host's answer gave it
      row = bound('l5', 9);
      draws.bound(APP, 'l5', T(6));
      draws.status(status({ launchId: 'l4', launchedAt: T(5), process: 'ready' }));
      draws.status(withPlugin(null, AT, { launchId: 'l4', launchedAt: T(5) }));
      expect(draws.drawnBy(APP)).toBe('mod');
    });

    it('C3 · a launch acknowledged late: the host started l1 at 1, another client’s l2 at 2, the daemon binds l1 at 3: every status of l2 makes it the running one', () => {
      list();
      row = bound('l1', 8); // the decided launch, at 8
      draws.status(status({ launchId: 'l1', launchedAt: T(1), process: 'exited' }));
      draws.status(status({ launchId: 'l2', launchedAt: T(2), process: 'starting' }));
      expect(draws.drawnBy(APP)).toBe('mod'); // l2: not recorded, not known (A4, B12)
      draws.bound(APP, 'l1', T(1)); // the acknowledgement, late: older than the running l2 by the host's times
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(withPlugin(NEWER, AT, { launchId: 'l2', launchedAt: T(2) }));
      expect(draws.drawnBy(APP)).toBe('mod'); // B13
      // the bind before any status of l2
      const other = 'app-late' as AppSessionId;
      draws.bound(other, 'l1', T(1));
      expect(draws.drawnBy(other)).toBe('maws'); // l1 bound at 8
      draws.status(status({ appSessionId: other, launchId: 'l2', launchedAt: T(2), process: 'starting' }));
      expect(draws.drawnBy(other)).toBe('mod');
      draws.status(withPlugin(null, AT, { appSessionId: other, launchId: 'l2', launchedAt: T(2) }));
      expect(draws.drawnBy(other)).toBe('maws'); // B14: l2's own report
    });

    it('C3 · a launch bound with no start time known: the order cannot be told, and an unseen live launch becomes the running one (A4: not known)', () => {
      list();
      row = bound('l5', 8);
      draws.bound(APP, 'l5', null);
      expect(draws.drawnBy(APP)).toBe('maws'); // B2: l5 bound at 8
      draws.status(status({ launchId: 'l4', launchedAt: T(0), process: 'ready' }));
      expect(draws.drawnBy(APP)).toBe('mod'); // l4, whatever its time: not known (B12), never MAWS on a guess
      draws.status(status({ launchId: 'l3', launchedAt: T(0), process: 'exited' }));
      expect(draws.drawnBy(APP)).toBe('mod'); // C2
    });

    it('C4 · a snapshot is not applied over a newer event of that session, nor puts it at rest', () => {
      const since = draws.mark();
      draws.status(status({ process: 'exited' })); // the subscription's event, after the read was sent
      const applied = draws.listed([status({ process: 'ready' })], since);
      expect(applied).toEqual([]);
      expect(draws.drawnBy(APP)).toBe('maws');
      const other = 'app-other' as AppSessionId;
      const again = draws.mark();
      draws.bound(other, 'l9', null);
      draws.listed([], again); // absent from the listing, but bound since the read was sent
      expect(draws.drawnBy(other)).toBe('mod');
    });

    it('C4 · a snapshot puts a session it does not list at rest, and applies the statuses of sessions with no newer event', () => {
      list([status({ process: 'starting' })]);
      expect(draws.drawnBy(APP)).toBe('mod');
      const applied = list([]);
      expect(applied).toEqual([]);
      expect(draws.drawnBy(APP)).toBe('maws');
      expect(list([status({ launchId: 'l1', process: 'ready' })])).toHaveLength(1);
      expect(draws.drawnBy(APP)).toBe('mod');
    });

    it('A1, B12, B13, B14 · the row cannot be read while a launch is live: mod while the mod is loaded or not reported, MAWS once reported without it', async () => {
      list();
      row = null;
      draws.status(status());
      expect(draws.drawnBy(APP)).toBe('mod');
      draws.status(withPlugin(OLDER, AT));
      await answer(0, false);
      expect(draws.drawnBy(APP)).toBe('mod'); // loaded, whatever it declares
      draws.status(withPlugin(null, T(5)));
      expect(draws.drawnBy(APP)).toBe('maws');
      draws.status(withPlugin(OLDER, T(6)));
      row = bound('l1', 8); // read again at the next status
      await answer(1, false);
      expect(draws.drawnBy(APP)).toBe('maws');
    });

    it('A4 · an abandoned unbound reservation at 8 is no proof of a later launch’s number (a lane-off launch whose write failed, not yet recorded)', async () => {
      row = { launchId: 'l0', desired: 'external-style-plus-supplement', advertised: reservation({ number: 8 }) }; // refused, left unbound
      list();
      draws.status(status({ launchId: 'l2', launchedAt: T(2), process: 'starting' })); // sent with nothing; its record not yet written
      expect(draws.drawnBy(APP)).toBe('mod'); // B12
      draws.status(withPlugin(OLDER, AT, { launchId: 'l2', launchedAt: T(2) }));
      await answer(0, false);
      expect(draws.drawnBy(APP)).toBe('mod'); // B13: the loaded mod draws as in a terminal
      row = { launchId: 'l2', desired: 'off', advertised: reservation({ number: 8 }) }; // the record lands, binding nothing
      draws.status(withPlugin(OLDER, AT, { launchId: 'l2', launchedAt: T(2) }));
      expect(draws.drawnBy(APP)).toBe('mod'); // A3, B10
      expect(changed).not.toContain(`${APP}:maws`);
    });

    it('A3, B8, B10 · an earlier build’s launch after a reservation this build left unbound: read from desired; lane off with the plugin present: mod at once', () => {
      row = { launchId: 'l-earlier', desired: 'external-style-plus-supplement', advertised: reservation({ number: 9 }) };
      list([status({ launchId: 'l-earlier' })]);
      expect(draws.drawnBy(APP)).toBe('maws'); // 8
      row = { ...row, desired: 'off' };
      draws.status(status({ launchId: 'l-earlier' }));
      expect(draws.drawnBy(APP)).toBe('mod'); // B8: nothing, plugin unknown, not reported
      draws.status(withPlugin(OLDER, AT, { launchId: 'l-earlier' }));
      expect(draws.drawnBy(APP)).toBe('mod'); // B10: present, its read outstanding
      draws.status(withPlugin(null, T(5), { launchId: 'l-earlier' }));
      expect(draws.drawnBy(APP)).toBe('maws'); // B11
    });

    it('B8, B9, B10 · no advertisement: mod as the launch found the plugin, MAWS when it found none, mod once the plugin is present', () => {
      row = bound('l1', null);
      list([status()]);
      expect(draws.drawnBy(APP)).toBe('mod');
      row = { ...bound('l1', null), advertised: reservation({ launchId: 'l1', number: null, plugin: false }) };
      draws.status(status());
      expect(draws.drawnBy(APP)).toBe('maws');
      draws.status(withPlugin(OLDER, AT));
      expect(draws.drawnBy(APP)).toBe('mod'); // presence known at once, before its read answers
    });

    it('keeps one session’s facts apart from another’s', () => {
      list();
      const other = 'app-other' as AppSessionId;
      draws.status(status());
      draws.status(status({ appSessionId: other, launchId: 'l9', process: 'exited' }));
      expect([draws.drawnBy(APP), draws.drawnBy(other)]).toEqual(['mod', 'maws']);
    });
  });
});
