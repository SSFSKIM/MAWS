import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'; // C7: vi
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { record } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerSlot, resetSlots } from '../app/slots';
import { useSessions } from '../stores/sessions';
import { useUsage } from '../stores/usage';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { SessionPane } from './SessionPane';

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const A = 'app-a' as AppSessionId;

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  window.maws = fakeClient({ 'attention.request': { event: null } }).client;
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
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
    const composer = screen.getByText('Composer arrives with C7'); // C7: the pane docks above C5's fallback composer only
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
    expect(screen.getByText('Composer arrives with C7')).toBeTruthy();
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
    expect(screen.queryByText('Composer arrives with C7')).toBeNull();
    expect(screen.queryByText('request')).toBeNull();
  });

  // C10 (M5): the notice's actions are C10's HolderActions, pinned in `sessions/HolderActions.test.tsx`
  it('a background-job holder with a known id offers "Attach in a terminal tab"; one without an id only "Fork a copy"', () => {
    useSessions.setState({ records: new Map([[A, record('app-a', { holder: { kind: 'background_job', pid: 42, jobId: 'e6dcd828' } })]]) });
    const { unmount } = render(<SessionPane appSessionId={A} paneIndex={0} />);
    expect(screen.getByText('Live as background job · pid 42 · read-only')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Attach in a terminal tab' }) as HTMLButtonElement).disabled).toBe(false);
    unmount();
    useSessions.setState({ records: new Map([[A, record('app-a', { holder: { kind: 'background_job', pid: 42, jobId: null } })]]) });
    render(<SessionPane appSessionId={A} paneIndex={0} />);
    expect(screen.queryByRole('button', { name: 'Attach in a terminal tab' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Fork a copy' })).toBeTruthy();
  });

  it('an unstarted session (no record) shows the newSession slot above the composer and nothing else', () => {
    const NEW = 'app-new-1' as AppSessionId;
    registerSlot('newSession', ({ appSessionId }) => <h2>setup {appSessionId}</h2>);
    render(<SessionPane appSessionId={NEW} paneIndex={0} />);
    const setup = screen.getByRole('heading', { name: `setup ${NEW}` });
    const composer = screen.getByText('Composer arrives with C7');
    expect(setup.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Transcript arrives with C6')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Session status' })).toBeNull();
  });

  it('C5’s newSession fallback renders nothing', () => {
    const { container } = render(<SessionPane appSessionId={'app-new-2' as AppSessionId} paneIndex={0} />);
    expect(container.textContent).toBe('Composer arrives with C7');
  });

  it('swaps to the ordinary pane when the record arrives', () => {
    const NEW = 'app-new-3' as AppSessionId;
    render(<SessionPane appSessionId={NEW} paneIndex={0} />);
    expect(screen.queryByText('Transcript arrives with C6')).toBeNull();
    act(() => void useSessions.getState().applyChanged({ record: record(NEW), cause: 'live', revision: 7 } as never));
    expect(screen.getByText('Transcript arrives with C6')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Session status' })).toBeNull();
  });
});
