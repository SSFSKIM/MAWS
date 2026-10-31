// A lane B session on another machine is read or unread in this app's memory (P5 O7 M2, "Acts": its record's reader fields
// are the owner's on that machine's index until O8 M6 keys them per member, and `session.update` is not offered over the
// link): on screen marks it read, a turn ending off screen marks it unread, the person's own toggle sets it, and the
// record the stores hold says it, whatever record main reads again.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { humanTurn, record, status } from '../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { useSessions } from '../stores/sessions';
import { connectRemoteReadMarks, resetRemoteReadMarks, setRemoteUnread, setRemoteVisible } from './read-marks';
import { resetRemoteLaneBStore } from './remote-session';

const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
const unread = () => useSessions.getState().records.get(REMOTE)?.unread;
const statusOf = (turn: typeof humanTurn | null) => useSessions.getState().applyStatus({ appSessionId: REMOTE, status: status(REMOTE, { engineState: turn ? 'running' : 'idle', turn }) }, OTHER_MACHINE);

let off: () => void = () => {};
beforeEach(() => {
  resetRemoteLaneBStore();
  resetRemoteReadMarks();
  useSessions.setState({ records: new Map([[REMOTE, record(REMOTE, { unread: false })]]), engine: new Map(), listed: new Map(), listedMachines: new Set([OTHER_MACHINE]) });
  off = connectRemoteReadMarks();
});
afterEach(() => off());

describe('remote read marks', () => {
  it('takes the person’s toggle in memory, and keeps it over a record main reads again', () => {
    setRemoteUnread(REMOTE, true);
    expect(unread()).toBe(true);
    useSessions.setState({ records: new Map([[REMOTE, record(REMOTE, { unread: false, title: { text: 'read again', source: 'user' } })]]) });
    expect(unread()).toBe(true);
    setRemoteUnread(REMOTE, false);
    expect(unread()).toBe(false);
  });

  it('marks a turn that ends off screen unread, and the session read once it is on screen', () => {
    statusOf(humanTurn);
    statusOf(null);
    expect(unread()).toBe(true);
    setRemoteVisible(REMOTE, true);
    expect(unread()).toBe(false);
    statusOf(humanTurn);
    statusOf(null); // on screen: read as it ends
    expect(unread()).toBe(false);
    setRemoteVisible(REMOTE, false);
    statusOf(humanTurn);
    useSessions.getState().forgetStatuses(OTHER_MACHINE); // a status forgotten is no turn ending
    expect(unread()).toBe(false);
  });
});
