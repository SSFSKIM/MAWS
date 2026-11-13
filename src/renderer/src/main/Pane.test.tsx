// A session tab across its machine's link going down and coming back (the UX wave, U9, M3: the ticket on a pane kept through a link's loss and O-39; docs/doperpowers/
// plans/2026-11-12-ux-wave-U9-other-machines.md): a pane that has something to keep stays mounted whatever the phase, one
// status line above it carrying the phase's words, and only a tab that has never had such a pane says the words in its
// middle. Each kept pane is held across down and up and checked for the mounted node, its scroll position and its draft.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { REGISTRY } from '@shared/ipc/registry';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressingOf, addressOf } from '@shared/machine/address';
import { REMOTE_ACT_PENDING_MS } from '@shared/machine/remote-pending';
import { record, remoteRow } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { registerSlot, resetSlots } from '../app/slots';
import { connectRemoteLaneB } from '../lane-b/remote-connect';
import { resetRemoteLaneBStore } from '../lane-b/remote-session';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { SessionTab } from './Pane';

const addressing = addressingOf(REGISTRY);
const NOW = Date.parse('2026-11-13T09:00:00.000Z');
const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
const TERMINAL = addressOf(OTHER_MACHINE, 'eng-t' as AppSessionId);
const LOCAL = at('app-l' as AppSessionId);
const here: MachineState = { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: new Date(NOW - 3_600_000).toISOString(), generation: 0 };
let generation = 1;
// The roster as main says it: `up` a new generation, `down` from now
const link = (state: MachineState['state'], over: Partial<MachineState> = {}) =>
  act(() => {
    if (state === 'up') generation += 1;
    useMachines.getState().applyRoster([here, { ref: OTHER_MACHINE, name: 'Studio', local: false, state, since: new Date(Date.now()).toISOString(), generation: state === 'connecting' ? 0 : generation, ...(state === 'up' && { carrier: 'relay' as const }), ...over }]);
  });
const tab = (appSessionId: AppSessionId) => ({ id: `session:${appSessionId}`, kind: 'session' as const, appSessionId, pinned: false });
const statusLine = () => document.querySelector<HTMLElement>('[data-link-phase]');
const kept = () => ({ scroller: screen.getByTestId('scroller'), draft: screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Draft' }) });

let off: () => void = () => {};
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
  resetShellStores();
  resetRemoteLaneBStore();
  generation = 1;
  const fake = fakeClient({ 'session.get': null, 'layout.set': undefined });
  window.maws = fake.client as unknown as PreloadBridge;
  off = connectRemoteLaneB(fake.client);
  // The transcript slot scrolls its own rows and the composer slot keeps its own draft, as the real ones do: what the
  // reader had lives in the mounted nodes
  registerSlot('transcript', ({ appSessionId }) => (
    <div data-testid="scroller" style={{ height: 100, overflowY: 'auto' }}>
      <p style={{ height: 2000 }}>transcript {appSessionId}</p>
    </div>
  ));
  registerSlot('composer', () => <textarea aria-label="Draft" defaultValue="" />);
  registerSlot('newSession', () => <h2>setup</h2>);
});
afterEach(() => {
  off();
  cleanup();
  resetSlots();
  vi.useRealTimers();
});

// Read, scrolled and typed into with the link up; then the link down until the status line shows, offline, and up again.
function holdAcross(appSessionId: AppSessionId) {
  link('up');
  render(<SessionTab tab={tab(appSessionId)} paneIndex={0} />);
  const before = kept();
  before.scroller.scrollTop = 640;
  fireEvent.change(before.draft, { target: { value: 'a draft typed before the outage' } });
  expect(statusLine(), 'no line while the link is up').toBeNull();

  link('down');
  expect(statusLine()?.textContent).toBe('Reconnecting to Studio…');
  expect(statusLine()?.dataset.linkPhase).toBe('reconnecting');
  fireEvent.change(kept().draft, { target: { value: 'a draft typed before the outage, and during it' } });
  act(() => vi.advanceTimersByTime(REMOTE_ACT_PENDING_MS));
  expect(statusLine()?.textContent).toBe('Studio is offline · this session reconnects when it’s back');

  link('up');
  expect(statusLine(), 'the line goes at up').toBeNull();
  const after = kept();
  expect(after.scroller, 'the same mounted transcript').toBe(before.scroller);
  expect(after.draft, 'the same mounted composer').toBe(before.draft);
  expect(after.scroller.scrollTop, 'the reader’s place').toBe(640);
  expect(after.draft.value).toBe('a draft typed before the outage, and during it');
  expect(document.querySelector('[data-machine-offline]'), 'no full-pane placeholder at any point').toBeNull();
}

describe('a session tab of another machine through an outage', () => {
  it('keeps a pane with a record mounted across down and up: the same node, the scroll position and the draft', () => {
    useSessions.setState({
      listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: REMOTE }]]),
      listedMachines: new Set([OTHER_MACHINE]),
      records: new Map([[REMOTE, addressing.output('session.get').lift(record('app-r'), OTHER_MACHINE)!]]),
    });
    holdAcross(REMOTE);
  });

  it('keeps a terminal session’s recordless pane mounted across down and up: the same node, the scroll position and the draft', () => {
    useSessions.setState({ listed: new Map([[TERMINAL, { ...remoteRow(OTHER_MACHINE, 'eng-t', { lane: 'A', availability: 'foreign_held' }), appId: TERMINAL }]]), listedMachines: new Set([OTHER_MACHINE]) });
    holdAcross(TERMINAL);
  });

  it('keeps a pane it has mounted even when what it was drawn from leaves the stores during the outage', () => {
    useSessions.setState({
      listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: REMOTE }]]),
      listedMachines: new Set([OTHER_MACHINE]),
      records: new Map([[REMOTE, addressing.output('session.get').lift(record('app-r'), OTHER_MACHINE)!]]),
    });
    link('up');
    render(<SessionTab tab={tab(REMOTE)} paneIndex={0} />);
    link('down');
    act(() => useSessions.setState({ records: new Map() }));
    expect(statusLine()?.textContent, 'still the line, not the words in the middle').toBe('Reconnecting to Studio…');
    expect(statusLine()?.dataset.linkWords).toBe('line');
  });

  it('says the phase in the middle of a tab that never had a pane in this run, and mounts the pane once the link is up', () => {
    useSessions.setState({ listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: REMOTE }]]), listedMachines: new Set([OTHER_MACHINE]) });
    link('connecting');
    render(<SessionTab tab={tab(REMOTE)} paneIndex={0} />);
    expect(statusLine()?.textContent, 'A2: a restored tab reads Connecting until the link is up').toBe('Connecting to Studio…');
    expect(statusLine()?.dataset.linkWords).toBe('middle');
    expect(screen.queryByText('Opening on Studio…')).toBeNull();
    link('down', { generation: 0 }); // the first attempt failed
    expect(statusLine()?.textContent).toBe('Studio is offline · this session reconnects when it’s back');
    link('up');
    expect(statusLine()).toBeNull();
    expect(screen.getByRole('status').textContent, 'the pane, opening the session there').toBe('Opening on Studio…');
  });

  it('says a removal in the line over the kept pane', () => {
    useSessions.setState({ listed: new Map([[TERMINAL, { ...remoteRow(OTHER_MACHINE, 'eng-t', { lane: 'A', availability: 'foreign_held' }), appId: TERMINAL }]]), listedMachines: new Set([OTHER_MACHINE]) });
    link('up');
    render(<SessionTab tab={tab(TERMINAL)} paneIndex={0} />);
    link('down', { refusal: 'removed' });
    expect(statusLine()?.textContent).toBe('This Mac is no longer allowed on Studio');
    expect(screen.getByTestId('scroller')).toBeTruthy();
  });
});

describe('a session tab of this Mac', () => {
  it('draws the pane with no line', () => {
    useSessions.setState({ records: new Map([[LOCAL, record(LOCAL)]]) });
    link('down');
    render(<SessionTab tab={tab(LOCAL)} paneIndex={0} />);
    expect(statusLine()).toBeNull();
    expect(screen.getByTestId('scroller')).toBeTruthy();
  });
});
