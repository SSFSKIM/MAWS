// A lane B session's reading on its machine (P5 O8 M6a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// Interfaces §P; the architect's ruling 2 on `session.reader.update`): where the machine keeps each member's pinned, last
// seen and unread, the person's marks are written there and its `ReaderState` answer is applied to the record held, so
// they outlive the app's run; where it doesn't (an endpoint older than M6a, `not-offered`), this run's memory
// (./read-marks.ts) keeps them exactly as before.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { ReaderState, SessionRecord } from '@shared/graph/session';
import type { ReaderPatch } from '@shared/ipc/schema/session';
import { addressOf } from '@shared/machine/address';
import { humanTurn, record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { sessionActionsFor } from '../app/session-actions';
import { setSessionUnread } from '../keymap/session-navigation';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { connectRemoteReadMarks, resetRemoteReadMarks, useRemoteReadMarks } from './read-marks';
import { readerRowsOf, resetReaderRows } from './reader-rows';
import { connectRemoteReading, pinRemote, setRemoteReading, showRemote } from './remote-reading';
import { resetRemoteLaneBStore } from './remote-session';

const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
const NOT_OFFERED = { refusal: 'not-offered' };
const held = () => useSessions.getState().records.get(REMOTE)!;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// The machine's index: this member's own reading of each session, which outlives the app's run.
function machineKeeping(start: Partial<ReaderState> = {}) {
  let reading: ReaderState = { appSessionId: REMOTE, pinned: false, lastSeen: { messageUuid: null, at: null }, unread: false, ...start };
  const fake = fakeClient({
    'session.reader.update': ({ patch }: { patch: ReaderPatch }) => {
      const seen = patch.lastSeen !== undefined ? { lastSeen: { messageUuid: patch.lastSeen.messageUuid, at: patch.lastSeen.at }, unread: false } : {};
      reading = { ...reading, ...(patch.pinned !== undefined && { pinned: patch.pinned }), ...seen, ...(patch.unread !== undefined && { unread: patch.unread }) };
      return reading;
    },
  });
  // a turn ended there: the index marks every reader unread
  const endTurn = () => void (reading = { ...reading, unread: true });
  return { fake, reading: () => reading, endTurn };
}

let revision = 10;
// main's `session.get` of the session, as a pane's opening read or a relaunch makes it: the record as the member reads it
function readAgain(over: Partial<SessionRecord>): void {
  useSessions.getState().applyChanged({ record: record(REMOTE, over), cause: 'live', revision: ++revision }, OTHER_MACHINE);
}
// a relaunch: this run's memory gone
function relaunch(): void {
  resetRemoteReadMarks();
  resetReaderRows();
  useSessions.setState({ records: new Map() });
}

const offs: Array<() => void> = [];
function connect(fake: FakeClient): void {
  offs.push(connectRemoteReadMarks(), connectRemoteReading(fake.client));
}

beforeEach(() => {
  resetRemoteLaneBStore();
  resetRemoteReadMarks();
  resetReaderRows();
  useNotices.setState({ notices: [] });
  useSessions.setState({ records: new Map([[REMOTE, record(REMOTE, { unread: false })]]), engine: new Map(), listed: new Map(), listedMachines: new Set([OTHER_MACHINE]) });
});
afterEach(() => {
  offs.splice(0).forEach((off) => off());
});

describe('a machine that keeps each member’s reading', () => {
  it('takes the person’s unread toggle, shows its answer, and a relaunch reads it back from there', async () => {
    const { fake, reading } = machineKeeping();
    connect(fake);
    await setSessionUnread(REMOTE, true, fake.client);
    expect(fake.invoked('session.reader.update')).toEqual([{ appSessionId: REMOTE, patch: { unread: true } }]);
    expect(held().unread).toBe(true);
    expect(readerRowsOf(REMOTE)).toBe('kept');
    // a record main reads again says the machine's word, and this run's memory doesn't stand over it
    readAgain({ ...reading(), unread: false });
    expect(held().unread).toBe(false);
    relaunch();
    readAgain(reading());
    expect(held().unread).toBe(true);
    expect(useNotices.getState().notices).toEqual([]);
  });

  it('marks a session on screen read there, and again when a turn ends there while it stays on screen', async () => {
    const { fake, reading, endTurn } = machineKeeping({ unread: true });
    readAgain({ unread: true, lastSeen: { messageUuid: 'm-1', at: null } });
    connect(fake);
    showRemote(REMOTE, true, fake.client);
    expect(held().unread).toBe(false); // on screen is read at once, its write on its way
    const [seen] = fake.invoked('session.reader.update') as Array<{ patch: ReaderPatch }>;
    expect(seen!.patch).toEqual({ unread: false, lastSeen: { messageUuid: 'm-1', at: expect.any(String) } });
    await settle();
    expect(reading().unread).toBe(false);
    // a turn ended there: the machine marks every reader unread, as nothing there shows it
    endTurn();
    readAgain(reading());
    expect(held().unread).toBe(false);
    expect(fake.invoked('session.reader.update')).toHaveLength(2);
    await settle();
    expect(reading().unread).toBe(false);
    // off screen, the machine's unread stands
    showRemote(REMOTE, false, fake.client);
    endTurn();
    readAgain(reading());
    expect(held().unread).toBe(true);
    expect(fake.invoked('session.reader.update')).toHaveLength(2);
    relaunch();
    readAgain(reading());
    expect(held().unread).toBe(true);
  });

  it('pins there, and offers Pin while the machine isn’t known to refuse it', async () => {
    const { fake, reading } = machineKeeping();
    connect(fake);
    expect(sessionActionsFor(held(), { remote: true, remoteReading: readerRowsOf(REMOTE) !== 'refused' })).toContain('pin');
    expect(await pinRemote(REMOTE, true, fake.client)).toBeNull();
    expect(held().pinned).toBe(true);
    relaunch();
    readAgain(reading());
    expect(held().pinned).toBe(true);
  });

  it('says a write the machine couldn’t take, and asks it again at the next', async () => {
    const fake = fakeClient();
    connect(fake);
    const toggled = setSessionUnread(REMOTE, true, fake.client);
    await fake.fail('session.reader.update', 'session.reader.update: machine mini is not reachable', 'host_unavailable');
    await toggled;
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['session.reader.update: machine mini is not reachable']);
    expect(readerRowsOf(REMOTE)).toBeNull();
    void setRemoteReading(REMOTE, { unread: false }, fake.client);
    expect(fake.pending('session.reader.update')).toBe(1);
  });
});

describe('a machine older than M6a, which offers no reader rows', () => {
  it('keeps the marks in this run’s memory as before, asking nothing more once it refused, and forgets them at a relaunch', async () => {
    const fake = fakeClient();
    connect(fake);
    const toggled = setSessionUnread(REMOTE, true, fake.client);
    expect(held().unread).toBe(true); // in memory at once, as before
    await fake.fail('session.reader.update', 'refused', 'internal', NOT_OFFERED);
    await toggled;
    expect(readerRowsOf(REMOTE)).toBe('refused');
    expect(useNotices.getState().notices).toEqual([]);
    readAgain({ unread: false }); // the owner's record on that machine
    expect(held().unread).toBe(true);
    // nothing more is asked of it: the toggle, on screen, a turn ending
    await setSessionUnread(REMOTE, false, fake.client);
    showRemote(REMOTE, true, fake.client);
    expect(useRemoteReadMarks.getState().visible.has(REMOTE)).toBe(true);
    showRemote(REMOTE, false, fake.client);
    useSessions.getState().applyStatus({ appSessionId: REMOTE, status: status(REMOTE, { engineState: 'running', turn: humanTurn }) }, OTHER_MACHINE);
    useSessions.getState().applyStatus({ appSessionId: REMOTE, status: status(REMOTE, { engineState: 'idle', turn: null }) }, OTHER_MACHINE);
    expect(held().unread).toBe(true);
    expect(fake.invoked('session.reader.update')).toHaveLength(1);
    expect(sessionActionsFor(held(), { remote: true, remoteReading: readerRowsOf(REMOTE) !== 'refused' })).not.toContain('pin');
    relaunch();
    readAgain({ unread: false });
    expect(held().unread).toBe(false);
  });

  it('is asked again once its feed opens again, its endpoint perhaps newer', async () => {
    const fake = fakeClient();
    connect(fake);
    const toggled = setSessionUnread(REMOTE, true, fake.client);
    await fake.fail('session.reader.update', 'refused', 'internal', NOT_OFFERED);
    await toggled;
    fake.event('artifacts.resync', {}, OTHER_MACHINE);
    expect(readerRowsOf(REMOTE)).toBeNull();
    expect(held().unread).toBe(true); // this run's marks still stand until the machine says otherwise
    void setSessionUnread(REMOTE, false, fake.client);
    expect(fake.pending('session.reader.update')).toBe(1);
  });
});
