import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingSteer, QueueEntry } from '@shared/engine/session-state-store';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { REMOTE_UNAVAILABLE, SESSION_ACTS_CAPABILITY } from '@shared/ipc/remote-unavailable';
import { STALE_DRAFT_WORDS } from '@shared/ipc/schema/session';
import type { MawsBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { askSteerText } from '@shared/maws/ask';
import { remoteRow } from '../../../../../test/support/builders';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { resetRemoteSurfaces } from '../../artifacts/remote-surfaces';
import { connectKeys } from '../../keymap/dispatcher';
import { resetRemoteLaneBStore } from '../../lane-b/remote-session';
import { remoteUnavailableOf } from '../../lane-b/remote-unavailable';
import { resetComposerStore } from '../../stores/composer';
import { useHosts } from '../../stores/hosts';
import { useMachines } from '../../stores/machines';
import { useNotices } from '../../stores/notices';
import type { SessionQueue } from '../../stores/queue';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { hostStatus, supervisorStatus } from '../../test-support/host-status';
import { HOST_UPDATING } from './host-wire';
import { PAUSED_COPY, QueueList, UNCERTAIN_TEXT } from './QueueList';
import { STACK_WORDS } from './stack';
import { resetTakeBack, TAKE_BACK_WORDS, takeBack } from './take-back';

const APP = 'app-1' as AppSessionId;
const U1 = '11111111-1111-4111-8111-111111111111' as MessageUuid;
const U2 = '22222222-2222-4222-8222-222222222222' as MessageUuid;
const U3 = '33333333-3333-4333-8333-333333333333' as MessageUuid;
const entry = (queueId: string, over: Partial<QueueEntry> = {}): QueueEntry => ({
  queueId, appSessionId: APP, content: `message ${queueId}`, createdAt: '2026-09-29T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false, ...over,
});
const steer = (messageUuid: MessageUuid, content: string, minute = 0): PendingSteer => ({ messageUuid, content, createdAt: `2026-09-29T09:5${minute}:00.000Z` });
const queue = (entries: QueueEntry[], over: Partial<SessionQueue> = {}): SessionQueue => ({ entries, paused: false, pauseReason: null, steers: [], withdrawn: [], loaded: true, ...over });

function bridge(answers: Record<string, unknown> = {}) {
  const invoke = vi.fn(async (name: string) => (name in answers ? answers[name] : { ok: true, value: name === 'session.queue.promote' ? { messageUuid: null } : undefined }));
  return { client: { invoke, on: () => () => {}, pathForFile: () => '', localMachine: TEST_MACHINE } as unknown as MawsBridge, invoke };
}
const stack = () => screen.getByRole('region', { name: 'Queued messages' });
const rows = () => within(stack()).getAllByRole('listitem');
const mark = (row: HTMLElement) => row.querySelector('[data-mark]')?.textContent;
const notice = () => screen.queryByRole('status', { name: 'Stack notice' })?.textContent ?? null;

let disconnect: () => void;
beforeEach(() => {
  useNotices.setState({ notices: [] });
  resetComposerStore();
  useHosts.setState({ supervisor: hostStatus() });
  useTranscriptStore.setState({ entries: {} });
  disconnect = connectKeys();
});
afterEach(() => {
  disconnect();
  cleanup();
  vi.useRealTimers();
});

describe('the stack’s rows and their marks', () => {
  it('lists after-the-turn rows with Send now (now), Delete, and a menu with Edit and Send at the next step; the running turn is not listed', async () => {
    const { client, invoke } = bridge();
    const onTakeBack = vi.fn();
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-0', { state: 'released' }), entry('q-1'), entry('q-2', { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } }, { type: 'text', text: 'look' }] })])} client={client} onTakeBack={onTakeBack} />);
    expect(within(stack()).queryByText('message q-0')).toBeNull();
    expect(within(stack()).getByText('[Image #1] look')).toBeTruthy();
    expect(stack().querySelector('header')).toBeNull(); // two rows: no header
    const [row] = rows();
    expect(mark(row)).toBe('After the turn');
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Send now' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.promote', { appSessionId: APP, queueId: 'q-1', priority: 'now' });
    await user.click(within(row).getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Send at the next step' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.promote', { appSessionId: APP, queueId: 'q-1', priority: 'next' });
    await user.click(within(row).getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(onTakeBack).toHaveBeenCalledWith(expect.objectContaining({ kind: 'after', key: 'q-1', queueId: 'q-1' }));
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.remove', { appSessionId: APP, queueId: 'q-1' });
    expect(invoke.mock.calls.map(([name]) => name)).not.toContain('session.queue.edit');
    expect(invoke.mock.calls.map(([name]) => name)).not.toContain('session.drafts.set'); // Delete stages nothing
  });

  it('titles Send now by whether a turn runs', () => {
    const { client } = bridge();
    const view = (busy: boolean) => <QueueList appSessionId={APP} busy={busy} queue={queue([entry('q-1')], { paused: !busy, pauseReason: busy ? null : 'interrupt' })} client={client} />;
    const { rerender } = render(view(true));
    expect(screen.getByRole('button', { name: 'Send now' }).getAttribute('title')).toBe('Sends this now; what the agent is running keeps running');
    rerender(view(false));
    expect(screen.getByRole('button', { name: 'Send now' }).getAttribute('title')).toBe('Sends this now');
  });

  // UX wave U4a (l3-input-01): a next-step row's Send now is the engine's send-now, never an interrupt
  it('lists the next-step rows first; Send now is session.steer.sendNow, Delete withdraws, and the menu queues it for after the turn', async () => {
    const { client, invoke } = bridge({ 'session.steer.sendNow': { ok: true, value: { outcome: 'delivering' } }, 'session.steer.cancel': { ok: true, value: { outcome: 'cancelled' } } });
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1')], { steers: [steer(U1, 'look at b too')] })} client={client} />);
    const [row, after] = rows();
    expect(row.getAttribute('data-queue-state')).toBe('next');
    expect(mark(row)).toBe('Next step');
    expect(mark(after)).toBe('After the turn');
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Queue for after the turn' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.hold', { appSessionId: APP, messageUuid: U1 });
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(invoke).toHaveBeenCalledWith('session.steer.cancel', { appSessionId: APP, messageUuid: U1 });
    await user.click(within(row).getByRole('button', { name: 'Send now' }));
    expect(invoke).toHaveBeenCalledWith('session.steer.sendNow', { appSessionId: APP, messageUuid: U1 });
    expect(invoke.mock.calls.map(([name]) => name)).not.toContain('session.interrupt');
  });

  it('with two at the next step, Send now names both, sends once for the row pressed, and both read Sending… until each starts', async () => {
    const { client, invoke } = bridge({ 'session.steer.sendNow': { ok: true, value: { outcome: 'delivering' } } });
    const view = (steers: PendingSteer[]) => <QueueList appSessionId={APP} busy queue={queue([], { steers })} client={client} />;
    const { rerender } = render(view([steer(U1, 'first'), steer(U2, 'second', 1)]));
    for (const row of rows()) expect(within(row).getByRole('button', { name: 'Send now' }).getAttribute('title')).toBe('Sends the 2 waiting messages now; what the agent is running keeps running');
    await userEvent.setup().click(within(rows()[1]).getByRole('button', { name: 'Send now' }));
    expect(invoke.mock.calls.filter(([name]) => name === 'session.steer.sendNow')).toEqual([['session.steer.sendNow', { appSessionId: APP, messageUuid: U2 }]]);
    await waitFor(() => expect(rows().map(mark)).toEqual(['Sending…', 'Sending…']));
    for (const row of rows()) expect(within(row).queryAllByRole('button')).toEqual([]);
    rerender(view([steer(U2, 'second', 1)])); // the first started
    expect(rows().map(mark)).toEqual(['Sending…']);
  });

  it('says the agent has the message when Send now finds nothing waiting', async () => {
    const { client } = bridge({ 'session.steer.sendNow': { ok: true, value: { outcome: 'nothing_waiting' } } });
    render(<QueueList appSessionId={APP} busy queue={queue([], { steers: [steer(U1, 'late')] })} client={client} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(notice()).toBe(STACK_WORDS.readAlready));
  });

  it('a Send now whose answer is withheld closes that row’s controls and no other row’s', async () => {
    let answer!: (value: unknown) => void;
    const { client } = bridge({ 'session.steer.sendNow': new Promise((resolve) => (answer = resolve)) });
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1')], { steers: [steer(U1, 'now please')] })} client={client} />);
    await userEvent.setup().click(within(rows()[0]).getByRole('button', { name: 'Send now' }));
    expect((within(rows()[0]).getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(rows()[1]).getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => answer({ ok: true, value: { outcome: 'delivering' } }));
  });

  it('a snapshot that changes under an open menu closes nothing, and the menu acts on its own row', async () => {
    const { client, invoke } = bridge();
    const view = (entries: QueueEntry[]) => <QueueList appSessionId={APP} busy queue={queue(entries)} client={client} />;
    const { rerender } = render(view([entry('q-1'), entry('q-2')]));
    const user = userEvent.setup();
    await user.click(within(rows()[1]).getByRole('button', { name: 'More' }));
    rerender(view([entry('q-1'), entry('q-2', { createdAt: '2026-09-29T10:00:01.000Z' })]));
    await user.click(await screen.findByRole('menuitem', { name: 'Send at the next step' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.promote', { appSessionId: APP, queueId: 'q-2', priority: 'next' });
  });

  it('an answer’s row offers Send now only', () => {
    const { client } = bridge();
    render(<QueueList appSessionId={APP} busy queue={queue([], { steers: [steer(U1, askSteerText('ask-1', [], []))] })} client={client} />);
    expect(within(rows()[0]).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Send now']);
  });

  it('draws a message the engine holds and the queue does not list as Next step with no controls', () => {
    const { client } = bridge();
    useTranscriptStore.setState({
      entries: { [APP]: { rows: [{ id: 'u3', turnId: 't3', at: '2026-09-29T10:00:00.000Z', kind: 'user', messageUuid: U3, text: 'sent now from after the turn', attachments: [], placeholders: [], lines: 1, editable: false, steer: false, dropped: false, unread: true }], state: { index: { messages: new Map() }, turns: new Map() } } as never },
    });
    render(<QueueList appSessionId={APP} busy queue={queue([])} client={client} />);
    const [row] = rows();
    expect(row.getAttribute('data-queue-state')).toBe('handed');
    expect(mark(row)).toBe('Next step');
    expect(within(row).queryAllByRole('button')).toEqual([]);
  });
});

describe('the stack’s text, fold and pause', () => {
  it('clamps a row to two lines with its whole text as title, and opens it in place by a click or Enter without touching the queue', async () => {
    const { client, invoke } = bridge();
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1', { content: 'one\ntwo\nthree' })])} client={client} />);
    const [row] = rows();
    const text = row.querySelector('[data-row-text]') as HTMLElement;
    expect(text.getAttribute('title')).toBe('one\ntwo\nthree');
    expect(row.getAttribute('data-open')).toBe('false');
    const user = userEvent.setup();
    await user.click(text);
    expect(row.getAttribute('data-open')).toBe('true');
    act(() => row.focus());
    await user.keyboard('{Enter}');
    expect(row.getAttribute('data-open')).toBe('false');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('folds three or more to one line with the first row’s text, opens by its caret, and keeps whether it is open per session', async () => {
    const { client } = bridge();
    const three = queue([entry('q-1'), entry('q-2'), entry('q-3')]);
    const { unmount } = render(<QueueList appSessionId={APP} busy queue={three} client={client} />);
    const toggle = within(stack()).getByRole('button', { name: /3 queued · Next: message q-1/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(stack()).queryAllByRole('listitem')).toEqual([]);
    await userEvent.setup().click(toggle);
    expect(rows()).toHaveLength(3);
    unmount();
    render(<QueueList appSessionId={APP} busy queue={three} client={client} />);
    expect(rows()).toHaveLength(3); // kept for the window's life
  });

  it('in a paused queue marks each row Held, says the reason with Resume, is open, and never says when this turn ends', async () => {
    const { client, invoke } = bridge();
    const cases: [SessionQueue['pauseReason'], string][] = [
      ['interrupt', 'Queue paused because you interrupted'],
      ['user', 'Queue paused'],
      ['exit', 'Queue paused · the session ended'],
      ['engine_turn', 'Queue paused · a background task finished while messages were waiting'],
      ['write_failed', 'Queue paused · a message could not be sent'],
      ['state_corrupt', 'Queue paused · the saved queue could not be read'],
      [null, 'Queue paused'],
    ];
    for (const [pauseReason, copy] of cases) {
      const { unmount } = render(<QueueList appSessionId={APP} busy={false} queue={queue([entry('q-1'), entry('q-2'), entry('q-3')], { paused: true, pauseReason })} client={client} />);
      expect(stack().querySelector('header')!.textContent).toBe(`${copy}Resume`);
      expect(rows().map(mark)).toEqual(['Held', 'Held', 'Held']);
      expect(stack().textContent).not.toMatch(/when this turn ends/i);
      unmount();
    }
    render(<QueueList appSessionId={APP} busy={false} queue={queue([entry('q-1')], { paused: true, pauseReason: 'interrupt' })} client={client} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Resume' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.setPaused', { appSessionId: APP, paused: false });
  });

  it('keeps the uncertain head’s row with Resume, Edit and Delete, and nothing to act on for a submitting sibling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const now = new Date('2026-09-29T10:00:00.000Z');
    vi.setSystemTime(now);
    const { client, invoke } = bridge();
    const onTakeBack = vi.fn();
    render(<QueueList appSessionId={APP} busy={false} queue={queue([entry('q-u', { uncertain: true }), entry('q-s', { state: 'submitting', submittedAt: now.toISOString() })], { paused: true, pauseReason: 'uncertain' })} client={client} onTakeBack={onTakeBack} />);
    const [uncertain] = rows();
    expect(uncertain.getAttribute('data-queue-state')).toBe('uncertain');
    expect(within(uncertain).getByRole('status').textContent).toBe(UNCERTAIN_TEXT);
    expect(within(uncertain).getAllByRole('button').map((b) => b.textContent)).toEqual(['Resume', 'Edit', 'Delete']);
    expect(screen.queryByText(PAUSED_COPY.uncertain, { exact: false })).toBeNull(); // the row explains the pause, not the header
    expect(screen.queryByText('Sending…')).toBeNull();
    await act(async () => void vi.advanceTimersByTime(300));
    const sending = screen.getByText('Sending…').closest('li')!;
    expect(sending.getAttribute('data-queue-state')).toBe('submitting');
    expect(within(sending).queryAllByRole('button')).toEqual([]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(within(uncertain).getByRole('button', { name: 'Edit' }));
    expect(onTakeBack).toHaveBeenCalledWith(expect.objectContaining({ kind: 'uncertain', queueId: 'q-u' }));
    await user.click(within(uncertain).getByRole('button', { name: 'Resume' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.setPaused', { appSessionId: APP, paused: false });
  });

  it('keeps a row whose action the host refused, and says so', async () => {
    const { client } = bridge({ 'session.queue.remove': { ok: false, error: { code: 'internal', message: 'entry is in flight' } } });
    render(<QueueList appSessionId={APP} busy={false} queue={queue([entry('q-1')])} client={client} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['entry is in flight']));
    expect(screen.getByText('message q-1')).toBeTruthy();
  });

  it('renders nothing for a fresh submitting entry, and its row once it has lasted 300 ms', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const now = new Date('2026-09-29T10:00:00.000Z');
    vi.setSystemTime(now);
    const { client } = bridge();
    const { container } = render(<QueueList appSessionId={APP} busy={false} queue={queue([entry('q-s', { state: 'submitting', submittedAt: now.toISOString() })])} client={client} />);
    expect(container.innerHTML).toBe(''); // every Send passes through submitting: no empty box flashes
    await act(async () => void vi.advanceTimersByTime(299));
    expect(container.innerHTML).toBe('');
    await act(async () => void vi.advanceTimersByTime(1));
    expect(stack().textContent).toContain('Sending…');
  });

  it('an entry reverted to queued and submitted again waits its 300 ms again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const first = new Date('2026-09-29T10:00:00.000Z');
    vi.setSystemTime(first);
    const { client } = bridge();
    const at = (entries: QueueEntry[]) => <QueueList appSessionId={APP} busy={false} queue={queue(entries)} client={client} />;
    const { rerender } = render(at([entry('q-s', { state: 'submitting', submittedAt: first.toISOString() })]));
    await act(async () => void vi.advanceTimersByTime(300));
    expect(screen.queryByText('Sending…')).toBeTruthy();
    rerender(at([entry('q-s')])); // reverted: queued again
    expect(screen.queryByText('Sending…')).toBeNull();
    const again = new Date(first.getTime() + 5_000);
    vi.setSystemTime(again);
    rerender(at([entry('q-s', { state: 'submitting', submittedAt: again.toISOString() })]));
    expect(screen.queryByText('Sending…')).toBeNull(); // a new submission: fresh, not shown
    await act(async () => void vi.advanceTimersByTime(300));
    expect(screen.queryByText('Sending…')).toBeTruthy();
  });

  it('renders nothing when nothing waits', () => {
    const { client } = bridge();
    const { container } = render(<QueueList appSessionId={APP} busy={false} queue={queue([entry('q-0', { state: 'released' })], { paused: true, pauseReason: 'interrupt' })} client={client} />);
    expect(container.innerHTML).toBe('');
  });
});

// UC-7 and decision 30: a control that cannot act here is drawn disabled with its sentence
describe('the stack’s refused controls', () => {
  const R = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
  afterEach(() => {
    cleanup(); // before the bridge goes: a mounted row reads it
    useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    delete (window as { maws?: unknown }).maws;
  });

  // From the master that holds U9 (the landing's edge): `session.steer.cancel` is offered behind `rl2.session-acts`, so
  // Edit and Delete read U9's helper (its sentence on a machine that does not list the capability, nothing on one that
  // does); Send now stays declared until U4b
  it('on another machine closes a next-step row’s Send now with its declared sentence, and Edit and Delete with the helper’s where the machine does not take them back', async () => {
    window.maws = { localMachine: TEST_MACHINE } as never;
    const machineLists = (capabilities: string[]) => {
      resetRemoteSurfaces();
      resetRemoteLaneBStore();
      useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay', capabilities }]);
      useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
    };
    const { client, invoke } = bridge();
    const mount = () => render(<QueueList appSessionId={R} busy queue={queue([entry('q-1', { appSessionId: R })], { steers: [steer(U1, 'remote steer')] })} client={client} />);

    machineLists([]); // a build that serves no session acts
    const cancelWords = remoteUnavailableOf(R, 'session.steer.cancel');
    expect(cancelWords).toContain('Update MAWS on mini');
    const view = mount();
    const [next, after] = rows();
    const send = within(next).getByRole('button', { name: 'Send now' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.getAttribute('title')).toBe(REMOTE_UNAVAILABLE['session.steer.sendNow']);
    const del = within(next).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.getAttribute('title')).toBe(cancelWords);
    expect((within(after).getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.setup().click(within(next).getByRole('button', { name: 'More' }));
    const edit = await screen.findByRole('menuitem', { name: 'Edit' });
    expect(edit.getAttribute('aria-disabled')).toBe('true');
    expect(edit.getAttribute('title')).toBe(cancelWords);
    view.unmount();

    machineLists([SESSION_ACTS_CAPABILITY]); // one that takes a waiting message back
    expect(remoteUnavailableOf(R, 'session.steer.cancel')).toBeNull();
    mount();
    const [nextThere] = rows();
    expect((within(nextThere).getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled, 'Send now stays declared').toBe(true);
    expect((within(nextThere).getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.setup().click(within(nextThere).getByRole('button', { name: 'More' }));
    expect((await screen.findByRole('menuitem', { name: 'Edit' })).getAttribute('aria-disabled')).not.toBe('true');
    expect(invoke).not.toHaveBeenCalled();
  });

  // the panel's finding 7: a next-step row can outlive its turn (the queue, the status and the lifecycles arrive apart),
  // and its Send now still goes by `session.steer.sendNow`, so its refusal holds whether or not a turn runs
  it('keeps a next-step row’s Send now refused, on another machine and under another build’s host, once no turn runs', async () => {
    window.maws = { localMachine: TEST_MACHINE } as never;
    resetRemoteSurfaces();
    resetRemoteLaneBStore();
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay' }]);
    useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
    const { client, invoke } = bridge();
    const { unmount } = render(<QueueList appSessionId={R} busy={false} queue={queue([], { steers: [steer(U1, 'outlived its turn')] })} client={client} />);
    const remote = within(rows()[0]).getByRole('button', { name: 'Send now' }) as HTMLButtonElement;
    expect(remote.disabled).toBe(true);
    expect(remote.getAttribute('title')).toBe(REMOTE_UNAVAILABLE['session.steer.sendNow']);
    unmount();
    useHosts.setState({ supervisor: hostStatus({ supervisor: supervisorStatus({ wire: 'w-older' }), matches: 'wire' }) });
    render(<QueueList appSessionId={APP} busy={false} queue={queue([], { steers: [steer(U1, 'outlived its turn')] })} client={client} />);
    const here = within(rows()[0]).getByRole('button', { name: 'Send now' }) as HTMLButtonElement;
    expect(here.disabled).toBe(true);
    expect(here.getAttribute('title')).toBe(HOST_UPDATING);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('under an engine host of another build closes a next-step row’s Send now only, and opens it when this build’s host serves', () => {
    useHosts.setState({ supervisor: hostStatus({ supervisor: supervisorStatus({ wire: 'w-older' }), matches: 'wire' }) });
    const { client } = bridge();
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1')], { steers: [steer(U1, 'waits')] })} client={client} />);
    const send = () => within(rows()[0]).getByRole('button', { name: 'Send now' }) as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    expect(send().getAttribute('title')).toBe(HOST_UPDATING);
    expect((within(rows()[0]).getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(rows()[1]).getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled).toBe(false);
    act(() => useHosts.setState({ supervisor: hostStatus() }));
    expect(send().disabled).toBe(false);
  });

  // decision 13, "Where the store is of an earlier build": Edit is refused for that machine's sessions; Delete never is
  it('once this Mac’s draft store answered a claim as stale, draws Edit refused with the sentence and leaves Delete', async () => {
    window.maws = { localMachine: TEST_MACHINE } as never;
    const { client, invoke } = bridge({ 'session.drafts.set': { ok: false, error: { code: 'internal', message: STALE_DRAFT_WORDS } } });
    await takeBack(APP, { kind: 'after', key: 'q-1', queueId: 'q-1', content: 'message q-1', createdAt: '2026-09-29T10:00:00.000Z' }, { client, controls: () => null });
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(['session.drafts.set']); // nothing withdrawn
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1')])} client={client} />);
    expect(notice()).toBe(TAKE_BACK_WORDS.needsServices);
    const del = within(rows()[0]).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(del.disabled).toBe(false);
    await userEvent.setup().click(within(rows()[0]).getByRole('button', { name: 'More' }));
    const edit = await screen.findByRole('menuitem', { name: 'Edit' });
    expect(edit.getAttribute('aria-disabled')).toBe('true');
    expect(edit.getAttribute('title')).toBe(TAKE_BACK_WORDS.needsServices);
    resetTakeBack();
  });
});
