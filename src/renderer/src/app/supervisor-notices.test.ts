// E10 Task 3.3 (E10 execution document, §Design 6, §Design 1 "The crash", §Design 11; Decision Log b2e4a1b1, 90f959f4):
// the supervisor's notices, driven by main's `host.status` through the hosts store: the update and incompatibility
// banners (replaced in place, dismissed when the mismatch ends, Wait only acknowledging), the crash toast (once per new
// unexpected exit), and a launch refused while waiting re-showing the incompatible banner.
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandName, IpcError } from '@shared/ipc/schema';
import type { HostStatus } from '@shared/ipc/schema/host';
import { fakeClient } from '../../../../test/support/fake-client';
import { createHostsStore } from '../stores/hosts';
import { createNoticesStore } from '../stores/notices';
import { hostStatus, supervisorStatus, updatedStatus, waitingStatus } from '../test-support/host-status';
import { SUPERVISOR_NOTICES } from './copy';
import { connectSupervisorNotices, SUPERVISOR_NOTICE_IDS } from './supervisor-notices';

type Refused = (name: CommandName, error: IpcError) => void;
const AT = '2026-10-06T12:00:00.000Z';
const LATER = '2026-10-06T12:05:00.000Z';

let disconnects: (() => void)[] = [];
afterEach(() => {
  disconnects.forEach((off) => off());
  disconnects = [];
});

async function setup(initial: HostStatus = hostStatus(), { restart = true }: { restart?: boolean } = {}) {
  const fake = fakeClient({
    'engine.hostState': { state: 'ready', pid: 1, restarts: 0, revision: 1 },
    'pty.hostState': { state: 'ready', pid: 2, restarts: 0, revision: 1 },
    'host.status': initial,
    ...(restart ? { 'host.restart': undefined } : {}),
  });
  const hosts = createHostsStore(fake.client);
  const notices = createNoticesStore();
  const refusedListeners = new Set<Refused>();
  const refusals = (listener: Refused) => {
    refusedListeners.add(listener);
    return () => void refusedListeners.delete(listener);
  };
  disconnects.push(connectSupervisorNotices({ client: fake.client, hosts, notices, refusals }));
  await new Promise((resolve) => setTimeout(resolve, 0)); // the snapshot lands
  const status = (next: HostStatus) => fake.event('host.status', next);
  const refuse = (name: CommandName, code: IpcError['code'] = 'host_unavailable') => refusedListeners.forEach((listener) => listener(name, { code, message: 'no host' }));
  const shown = () => notices.getState().notices;
  const one = (id: string) => shown().find((n) => n.id === id);
  return { fake, hosts, notices, status, refuse, shown, one };
}

describe('the update banner (supervisor.updated)', () => {
  it('shows while an older build serves live sessions, with Restart now only, which restarts the supervisor', async () => {
    const t = await setup();
    expect(t.shown()).toEqual([]);
    t.status(updatedStatus(2));
    const notice = t.one(SUPERVISOR_NOTICE_IDS.updated)!;
    expect(notice).toMatchObject({ kind: 'banner', level: 'info', text: SUPERVISOR_NOTICES.updated(2) });
    expect(notice.text).toBe(
      "MAWS was updated. 2 sessions are still running on the previous version's supervisor; MAWS moves to the new one when they become idle. Sessions started meanwhile run on it too.",
    );
    expect(notice.actions.map((a) => a.label)).toEqual(['Restart now']);
    notice.actions[0]!.run();
    expect(t.fake.invoked('host.restart')).toEqual([{ stopSessions: true }]);
  });

  it('is replaced in place on every status and dismissed when the mismatch ends', async () => {
    const t = await setup(updatedStatus(2)); // the snapshot already carries the mismatch
    expect(t.one(SUPERVISOR_NOTICE_IDS.updated)?.text).toBe(SUPERVISOR_NOTICES.updated(2));
    t.status(updatedStatus(1));
    expect(t.shown()).toHaveLength(1);
    expect(t.one(SUPERVISOR_NOTICE_IDS.updated)?.text).toBe(SUPERVISOR_NOTICES.updated(1));
    t.status(hostStatus({ state: 'restarting', supervisor: null, matches: null })); // it exited when they went idle
    expect(t.shown()).toEqual([]);
    t.status(hostStatus()); // the new build's supervisor
    expect(t.shown()).toEqual([]);
  });

  it('stays dismissed once the owner dismissed it while the mismatch lasts, and returns with the next mismatch', async () => {
    const t = await setup(updatedStatus(2));
    t.notices.getState().dismiss(SUPERVISOR_NOTICE_IDS.updated); // the banner's ×
    t.status(updatedStatus(1));
    expect(t.shown()).toEqual([]);
    t.status(hostStatus());
    t.status(updatedStatus(3)); // a later update with live sessions
    expect(t.one(SUPERVISOR_NOTICE_IDS.updated)?.text).toBe(SUPERVISOR_NOTICES.updated(3));
  });

  it('is not shown for an older build holding no live session (main replaces that one silently)', async () => {
    const t = await setup();
    t.status(updatedStatus(0));
    expect(t.shown()).toEqual([]);
  });
});

describe('the incompatibility banner (supervisor.incompatible)', () => {
  it('names the sessions the waited-for supervisor runs and offers Restart now and Wait', async () => {
    const t = await setup();
    t.status(waitingStatus(2));
    const notice = t.one(SUPERVISOR_NOTICE_IDS.incompatible)!;
    expect(notice).toMatchObject({ kind: 'banner', level: 'warning', dismissible: false });
    expect(notice.text).toBe(
      'MAWS was updated and cannot talk to the previous supervisor, which still runs 2 sessions. No session can start until it exits, which it does by itself once they go idle.',
    );
    expect(notice.actions.map((a) => a.label)).toEqual(['Restart now', 'Wait']);
    notice.actions[0]!.run();
    expect(t.fake.invoked('host.restart')).toEqual([{ stopSessions: true }]);
  });

  it('Wait only acknowledges: the banner goes, the next status does not bring it back, and nothing is sent', async () => {
    const t = await setup(waitingStatus(2));
    t.one(SUPERVISOR_NOTICE_IDS.incompatible)!.actions[1]!.run();
    expect(t.shown()).toEqual([]);
    t.status(waitingStatus(1));
    expect(t.shown()).toEqual([]);
    expect(t.fake.invoked('host.restart')).toEqual([]);
  });

  it('a launch refused with host_unavailable while waiting shows it again; other refusals do not', async () => {
    const t = await setup(waitingStatus(2));
    t.one(SUPERVISOR_NOTICE_IDS.incompatible)!.actions[1]!.run(); // Wait
    t.refuse('session.start', 'internal');
    t.refuse('settings.set');
    expect(t.shown()).toEqual([]);
    t.refuse('session.start');
    expect(t.one(SUPERVISOR_NOTICE_IDS.incompatible)?.text).toBe(SUPERVISOR_NOTICES.incompatible(2));
    t.one(SUPERVISOR_NOTICE_IDS.incompatible)!.actions[1]!.run();
    t.refuse('session.send'); // a send resumes a released session: a launch too
    expect(t.one(SUPERVISOR_NOTICE_IDS.incompatible)).toBeDefined();
    for (const launch of ['session.fork', 'session.takeOver'] as const) {
      t.one(SUPERVISOR_NOTICE_IDS.incompatible)!.actions[1]!.run();
      t.refuse(launch); // a fork launches its new session; a take-over resumes the session here
      expect(t.one(SUPERVISOR_NOTICE_IDS.incompatible), launch).toBeDefined();
    }
  });

  it('a refused launch while not waiting shows nothing; the banner goes when the wait ends', async () => {
    const t = await setup();
    t.refuse('session.start');
    expect(t.shown()).toEqual([]);
    t.status(waitingStatus(1));
    t.status(hostStatus({ state: 'starting', supervisor: null, matches: null })); // the old one exited; a fresh start
    expect(t.shown()).toEqual([]);
  });
});

describe('the crash toast (supervisor.crashed)', () => {
  const crashed = (at: string, code: number | null, signal: string | null, interrupted: number) =>
    hostStatus({ state: 'restarting', supervisor: null, matches: null, lastExit: { code, signal, at, interrupted } });

  it('toasts each new unexpected exit once, naming the interrupted sessions and the exit code when known', async () => {
    const t = await setup();
    t.status(crashed(AT, 1, null, 2));
    expect(t.one(SUPERVISOR_NOTICE_IDS.crashed)).toMatchObject({ kind: 'toast', level: 'warning', dismissible: true });
    expect(t.one(SUPERVISOR_NOTICE_IDS.crashed)?.text).toBe(
      'The session supervisor stopped unexpectedly (exit 1); 2 sessions were interrupted. Their transcripts are on disk; open one to resume.',
    );
    t.notices.getState().dismiss(SUPERVISOR_NOTICE_IDS.crashed);
    t.status(hostStatus({ lastExit: { code: 1, signal: null, at: AT, interrupted: 2 }, supervisor: supervisorStatus({ pid: 9 }) })); // the successor, same exit
    expect(t.shown()).toEqual([]);
    t.status(crashed(LATER, null, 'SIGKILL', 1));
    expect(t.one(SUPERVISOR_NOTICE_IDS.crashed)?.text).toBe(
      'The session supervisor stopped unexpectedly (SIGKILL); 1 session was interrupted. Their transcripts are on disk; open one to resume.',
    );
  });

  it('omits the parenthesis when the cause is unknown and says when nothing was interrupted', async () => {
    const t = await setup();
    t.status(crashed(AT, null, null, 0));
    expect(t.one(SUPERVISOR_NOTICE_IDS.crashed)?.text).toBe('The session supervisor stopped unexpectedly; no session was interrupted.');
  });

  it('does not repeat an exit the page already knew at its first word (a reload after the crash)', async () => {
    const t = await setup(crashed(AT, 1, null, 2));
    expect(t.shown()).toEqual([]);
    t.status(hostStatus({ lastExit: { code: 1, signal: null, at: AT, interrupted: 2 } }));
    expect(t.shown()).toEqual([]);
  });
});

describe('the connection', () => {
  it('a refused Restart now is a warning toast with the reason', async () => {
    const t = await setup(updatedStatus(2), { restart: false });
    t.one(SUPERVISOR_NOTICE_IDS.updated)!.actions[0]!.run();
    await t.fake.fail('host.restart', 'the engine host is quitting');
    expect(t.shown().filter((n) => n.kind === 'toast').map((n) => [n.level, n.text])).toEqual([['warning', 'The supervisor was not restarted · the engine host is quitting']]);
  });

  it('connects the hosts store app-wide and stops posting after disconnect', async () => {
    const t = await setup();
    expect(t.fake.invoked('host.status')).toHaveLength(1);
    disconnects.pop()!();
    t.status(updatedStatus(2));
    expect(t.shown()).toEqual([]);
  });
});
