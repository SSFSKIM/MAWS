import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'; // C7: vi
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge, SessionDigest } from '@shared/ipc/schema';
import { digest, record } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerSlot, resetSlots } from '../app/slots';
import { useSessions } from '../stores/sessions';
import { useUsage } from '../stores/usage';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { SessionPane } from './SessionPane';
import { formatCwd, statusFields } from './StatusLine';

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const A = 'app-a' as AppSessionId;

const statusButtons = () => within(screen.getByRole('group', { name: 'Session status' })).getAllByRole('button');

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  window.maws = fakeClient({ 'attention.request': { event: null } }).client;
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
  resetSlots();
});

describe('session pane', () => {
  it('shows the transcript slot, the docked request above the composer, and the status line', () => {
    const id = idOf('Fix sidebar drag');
    registerSlot('transcript', ({ appSessionId, agentId, paneIndex }) => <p>transcript {`${appSessionId} ${agentId} ${paneIndex}`}</p>);
    registerSlot('requestCard', ({ item, placement, paneIndex }) => <p>request {`${item.kind} ${placement} ${paneIndex}`}</p>);
    registerSlot('composer', ({ appSessionId, paneIndex }) => <p>composer {`${appSessionId} ${paneIndex}`}</p>);
    render(<SessionPane appSessionId={id} paneIndex={1} />);
    expect(screen.getByText(`transcript ${id} null 1`)).toBeTruthy();
    const request = screen.getByText('request permission docked 1');
    const composer = screen.getByText(`composer ${id} 1`);
    expect(request.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(statusButtons()).toHaveLength(6);
  });

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

  it('a background-job holder offers a disabled "Attach in a terminal tab"', () => {
    useSessions.setState({ records: new Map([[A, record('app-a', { holder: { kind: 'background_job', pid: 42, jobId: null } })]]) });
    render(<SessionPane appSessionId={A} paneIndex={0} />);
    expect(screen.getByText('Live as background job · pid 42 · read-only')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Attach in a terminal tab' }) as HTMLButtonElement).disabled).toBe(true);
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
    expect(statusButtons()).toHaveLength(6);
  });
});

describe('status line', () => {
  it('reads cwd, ctx, 5h, 7d, cost and mode, with placeholders where nothing is known', () => {
    render(<SessionPane appSessionId={idOf('Fix sidebar drag')} paneIndex={0} />);
    expect(statusButtons().map((b) => b.textContent)).toEqual(['/private/tmp/maws-probe-qqboLh', 'ctx —', '5h —', '7d —', '$—', 'auto']);
    expect(statusButtons()[0].className).toContain('font-mono');
    expect(statusButtons().every((b) => b.getAttribute('aria-haspopup') === 'dialog')).toBe(true); // C7: every field opens its popover
  });

  it('shows context of the model’s window, the usage windows and the total cost', () => {
    // C7 start: the windows carry their reading time and reset countdown (mockup 04: `5h 74% ↻2h37m`)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-09-28T10:23:00Z'));
    const window = (percent: number, resetsAt: string) => ({ percent, resetsAt, recordedAt: '2026-09-28T10:20:00Z' });
    useUsage.setState({ windows: { fiveHour: window(74, '2026-09-28T13:00:00Z'), sevenDay: window(82, '2026-10-04T07:23:00Z'), scoped: [] } });
    const id = idOf('Charter + research'); // the scenario has it direct; routed, it shows the drain target's windows
    const direct = useSessions.getState().records.get(id)!;
    useSessions.setState({ records: new Map(useSessions.getState().records).set(id, { ...direct, gateway: { ...direct.gateway, routed: true } }) });
    render(<SessionPane appSessionId={id} paneIndex={0} />);
    expect(statusButtons().map((b) => b.textContent).slice(1)).toEqual(['ctx 41% of 200k', '5h 74% ↻2h37m', '7d 82% ↻5d21h', '$0.07', 'default']);
    useUsage.setState({ windows: null });
    vi.useRealTimers();
    // C7 end
  });

  it('marks context past the auto-compact threshold', () => {
    const d: SessionDigest = digest('app-a', { context: { percent: 91, totalTokens: 910_000, maxTokens: 1_000_000, autoCompactThreshold: 900_000 } });
    expect(statusFields(record('app-a'), d, null).ctx).toBe('ctx 91% of 1M ⚠');
    expect(statusFields(record('app-a'), { ...d, context: { ...d.context!, percent: 80, totalTokens: 800_000 } }, null).ctx).toBe('ctx 80% of 1M');
  });

  it('a refused auto mode reads the effective mode with the refusal in words', () => {
    useSessions.setState({
      records: new Map([[A, record('app-a', { permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_model' } })]]),
    });
    render(<SessionPane appSessionId={A} paneIndex={0} />);
    const mode = statusButtons()[5];
    expect(mode.textContent).toContain('default');
    expect(mode.getAttribute('title')).toBe('Auto mode refused: this model does not support it');
    expect(within(mode).getByRole('img', { name: 'Warning' })).toBeTruthy();
  });

  it('abbreviates the home directory', () => {
    expect(formatCwd('/Users/new/Developer/GitHub/MAWS')).toBe('~/Developer/GitHub/MAWS');
    expect(formatCwd('/Users/new')).toBe('~');
    expect(formatCwd('/private/tmp/x')).toBe('/private/tmp/x');
  });
});
