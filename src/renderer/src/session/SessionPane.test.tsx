import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'; // C7: vi
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { item, record, remoteRow, T0 } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useAttention } from '../stores/attention';
import { registerSlot, resetSlots } from '../app/slots';
import { useSessions } from '../stores/sessions';
import { useUsage } from '../stores/usage';
import { fillStores, pageScenario, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { SessionPane } from './SessionPane';

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => pageScenario(nine).sessions.find((r) => r.title.text === title)!.appId; // P5 O6 M2: the page's id
const A = at('app-a' as AppSessionId);

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  window.maws = fakeClient({ 'attention.request': { event: null } }).client as unknown as PreloadBridge;
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
  resetSlots();
  // C7 start: a failing assertion must not leave the fake clock or the windows to the next test
  vi.useRealTimers();
  useUsage.setState({ windows: null });
  // C7 end
});

describe('session pane', () => {
  it('shows the transcript slot and the docked request above the composer, and nothing under it (W2: no status line)', () => {
    const id = idOf('Fix sidebar drag');
    registerSlot('transcript', ({ appSessionId, agentId, paneIndex }) => <p>transcript {`${appSessionId} ${agentId} ${paneIndex}`}</p>);
    registerSlot('requestCard', ({ item, placement, paneIndex }) => <p>request {`${item.kind} ${placement} ${paneIndex}`}</p>);
    // C7: no composer registered here (C5's stub composer registration removed): a registered composer docks the request itself (the C7 case below)
    render(<SessionPane appSessionId={id} paneIndex={1} />);
    expect(screen.getByText(`transcript ${id} null 1`)).toBeTruthy();
    const request = screen.getByText('request permission docked 1');
    const composer = screen.getByText('Composer unavailable'); // C7: the pane docks above C5's fallback composer only
    expect(request.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Session status' })).toBeNull();
  });

  // C7 start: a registered composer is the one docked swap: it docks the request in its own place, so the pane's slot
  // docks nothing (two docked placements of one request would take focus and bind Enter twice).
  it('leaves the docking to a registered composer', () => {
    const id = idOf('Fix sidebar drag');
    registerSlot('requestCard', ({ item, placement }) => <p>request {`${item.kind} ${placement}`}</p>);
    registerSlot('composer', ({ appSessionId, paneIndex }) => <p>composer {`${appSessionId} ${paneIndex}`}</p>);
    render(<SessionPane appSessionId={id} paneIndex={1} />);
    expect(screen.getByText(`composer ${id} 1`)).toBeTruthy();
    expect(screen.queryByText('request permission docked')).toBeNull();
  });
  // C7 end

  it('docks no request when nothing waits', () => {
    registerSlot('requestCard', () => <p>request</p>);
    render(<SessionPane appSessionId={idOf('Charter + research')} paneIndex={0} />);
    expect(screen.queryByText('request')).toBeNull();
    expect(screen.getByText('Composer unavailable')).toBeTruthy();
  });

  it('the docked fallback does not offer to open the session it is already in', () => {
    render(<SessionPane appSessionId={idOf('Fix sidebar drag')} paneIndex={0} />);
    expect(screen.getByText('Approval needed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open session' })).toBeNull();
  });

  it('replaces the composer of a foreign-live session with its holder, and docks no request', () => {
    const id = idOf('Somersault terminal run');
    registerSlot('requestCard', () => <p>request</p>);
    render(<SessionPane appSessionId={id} paneIndex={0} />);
    expect(screen.getByText('Live in Terminal · pid 7135 · read-only')).toBeTruthy();
    expect(screen.queryByText('Composer unavailable')).toBeNull();
    expect(screen.queryByText('request')).toBeNull();
  });

  // C10 (M5): the notice's actions are C10's HolderActions, pinned in `sessions/HolderActions.test.tsx`
  it('a background-job holder with a known id offers "Attach in a terminal tab"; one without an id only "Fork a copy"', () => {
    useSessions.setState({ records: new Map([[A, record(A, { holder: { kind: 'background_job', pid: 42, jobId: 'e6dcd828' } })]]) });
    const { unmount } = render(<SessionPane appSessionId={A} paneIndex={0} />);
    expect(screen.getByText('Live as background job · pid 42 · read-only')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Attach in a terminal tab' }) as HTMLButtonElement).disabled).toBe(false);
    unmount();
    useSessions.setState({ records: new Map([[A, record(A, { holder: { kind: 'background_job', pid: 42, jobId: null } })]]) });
    render(<SessionPane appSessionId={A} paneIndex={0} />);
    expect(screen.queryByRole('button', { name: 'Attach in a terminal tab' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Fork a copy' })).toBeTruthy();
  });

  it('an unstarted session (no record) shows the newSession slot above the composer and nothing else', () => {
    const NEW = at('app-new-1' as AppSessionId);
    registerSlot('newSession', ({ appSessionId }) => <h2>setup {appSessionId}</h2>);
    render(<SessionPane appSessionId={NEW} paneIndex={0} />);
    const setup = screen.getByRole('heading', { name: `setup ${NEW}` });
    const composer = screen.getByText('Composer unavailable');
    expect(setup.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Transcript unavailable')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Session status' })).toBeNull();
  });

  it('C5’s newSession fallback renders nothing', () => {
    const { container } = render(<SessionPane appSessionId={at('app-new-2' as AppSessionId)} paneIndex={0} />);
    expect(container.textContent).toBe('Composer unavailable');
  });

  it('swaps to the ordinary pane when the record arrives', () => {
    const NEW = at('app-new-3' as AppSessionId);
    render(<SessionPane appSessionId={NEW} paneIndex={0} />);
    expect(screen.queryByText('Transcript unavailable')).toBeNull();
    act(() => void useSessions.getState().applyChanged({ record: record(NEW), cause: 'live', revision: 7 } as never, TEST_MACHINE));
    expect(screen.getByText('Transcript unavailable')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Session status' })).toBeNull();
  });

  // P5 O9 M9: another machine's terminal session is a listed lane A row with no record; it reads as started, its
  // composer the lane A port's (never the holder notice), and its pending request docked.
  it('shows another machine’s listed lane A session as started, with its composer and its docked request', () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
    useSessions.setState({ listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'eng-r', { lane: 'A', availability: 'foreign_held' }), appId: REMOTE }]]) });
    registerSlot('transcript', ({ appSessionId }) => <p>transcript {appSessionId}</p>);
    registerSlot('newSession', () => <h2>setup</h2>);
    registerSlot('requestCard', ({ item, placement }) => <p>request {`${item.kind} ${placement}`}</p>);
    useAttention.setState({ bySession: new Map([[REMOTE, [item(REMOTE, 'permission', T0)]]]) });
    render(<SessionPane appSessionId={REMOTE} paneIndex={0} />);
    expect(screen.getByText(`transcript ${REMOTE}`)).toBeTruthy();
    expect(screen.getByText('Composer unavailable')).toBeTruthy();
    expect(screen.getByText('request permission docked')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'setup' })).toBeNull();
  });
});
