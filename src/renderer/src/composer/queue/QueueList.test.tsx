import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingSteer, QueueEntry } from '@shared/engine/session-state-store';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { SEND_NOW_CAPABILITY, SESSION_ACTS_CAPABILITY } from '@shared/ipc/remote-unavailable';
import { STALE_DRAFT_WORDS } from '@shared/ipc/schema/session';
import type { MawsBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { askSteerText } from '@shared/maws/ask';
import { consentMessage } from '@shared/engine/arrival'; // UX wave U1c
import type { AskAnswer, AskQuestion } from '@shared/maws/tools';
import { humanTurn, remoteRow, status } from '../../../../../test/support/builders';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { resetRemoteSurfaces } from '../../artifacts/remote-surfaces';
import { connectKeys } from '../../keymap/dispatcher';
import { resetRemoteLaneBStore } from '../../lane-b/remote-session';
import { resetComposerStore } from '../../stores/composer';
import { useHosts } from '../../stores/hosts';
import { useMachines } from '../../stores/machines';
import { useNotices } from '../../stores/notices';
import type { SessionQueue } from '../../stores/queue';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { rowsOf } from '../../transcript/model/derive';
import { applyEvents, createState } from '../../transcript/model/reduce';
import { builder } from '../../transcript/model/test-events';
import { hostStatus, supervisorStatus } from '../../test-support/host-status';
import { HOST_UPDATING } from './host-wire';
import { PAUSED_COPY, QueueList, UNCERTAIN_TEXT } from './QueueList';
import { newestToTake, STACK_WORDS, stackRows } from './stack';
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

  // UX wave U4b (decision 13): `nothing_waiting` is no evidence that the agent read anything; the row's own state says
  // what became of the message
  it('shows nothing when Send now finds nothing waiting, and marks no row Sending…', async () => {
    const { client, invoke } = bridge({ 'session.steer.sendNow': { ok: true, value: { outcome: 'nothing_waiting' } } });
    render(<QueueList appSessionId={APP} busy queue={queue([], { steers: [steer(U1, 'late')] })} client={client} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('session.steer.sendNow', { appSessionId: APP, messageUuid: U1 }));
    await waitFor(() => expect((within(rows()[0]).getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled).toBe(false));
    expect(notice()).toBeNull();
    expect(rows().map(mark)).toEqual(['Next step']);
    expect(useNotices.getState().notices).toEqual([]);
  });

  it('a Send now whose answer never comes ends at main’s bound as a toast, the row left as it was', async () => {
    const { client } = bridge({ 'session.steer.sendNow': { ok: false, error: { code: 'timeout', message: 'mini took the request but hasn’t confirmed it' } } });
    render(<QueueList appSessionId={APP} busy queue={queue([], { steers: [steer(U1, 'out there')] })} client={client} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['mini took the request but hasn’t confirmed it']));
    expect(rows().map(mark)).toEqual(['Next step']);
    expect((within(rows()[0]).getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled).toBe(false);
    expect(notice()).toBeNull();
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

describe('a waiting answer (UX wave U4b, X-049)', () => {
  // an invented async ask: two questions, the first with a header, in a turn that has ended and folded
  const LAYOUT: AskQuestion = { id: 'q1', question: 'Which layout should the gallery use?', header: 'Layout', modality: 'choice', options: [{ label: 'Grid' }, { label: 'List' }] };
  const THEME: AskQuestion = { id: 'q2', question: 'Which theme?', header: 'Theme', modality: 'choice', options: [{ label: 'Dark' }, { label: 'Light' }] };
  const SIZE: AskQuestion = { id: 'q3', question: 'How large should the tiles be?', modality: 'text' };
  const GRID: AskAnswer = { id: 'q1', question: LAYOUT.question, status: 'answered', value: ['Grid'] };
  const asked = (questions: AskQuestion[]) => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_a', 'mcp__maws__ask', { blocking: false, questions });
    b.result('toolu_a', [{ type: 'text', text: JSON.stringify({ status: 'asked', askId: 'toolu_a' }) }]);
    b.text('m1', 0, 'I will go on meanwhile.');
    b.end(['u1']);
    const state = applyEvents(createState(null, null), b.events);
    const rows = rowsOf(state); // the turn folded: the ask's capsule is one of the rows it leaves in view
    expect(rows.some((row) => row.kind === 'ask')).toBe(true);
    useTranscriptStore.setState({ entries: { [APP]: { state, rows } as never } });
  };
  const texts = () => rows().map((row) => row.querySelector('[data-row-text]')?.textContent);

  it('reads "Answer to <header>: <words>" where the window holds the ask under a folded turn, and the question’s own text where it holds none', () => {
    const { client } = bridge();
    const view = () => <QueueList appSessionId={APP} busy queue={queue([], { steers: [steer(U1, askSteerText('toolu_a', [LAYOUT], [GRID]))] })} client={client} />;
    const { rerender } = render(view());
    expect(texts()).toEqual(['Answer to Which layout should the gallery use?: Grid']);
    asked([LAYOUT]);
    rerender(view());
    expect(texts()).toEqual(['Answer to Layout: Grid']);
    expect(mark(rows()[0])).toBe('Next step');
  });

  it('reads the same once a Stop holds it, marked Held', () => {
    asked([LAYOUT]);
    const { client } = bridge();
    render(<QueueList appSessionId={APP} busy={false} queue={queue([entry('q-a', { content: askSteerText('toolu_a', [LAYOUT], [GRID]) })], { paused: true, pauseReason: 'interrupt' })} client={client} />);
    expect(texts()).toEqual(['Answer to Layout: Grid']);
    expect(mark(rows()[0])).toBe('Held');
  });

  it('several questions read counted and in the asked order, whole in the row’s hover title; the row offers Send now only', () => {
    asked([LAYOUT, THEME, SIZE]);
    const answers: AskAnswer[] = [GRID, { id: 'q2', question: THEME.question, status: 'skipped' }, { id: 'q3', question: SIZE.question, status: 'decide_for_me' }];
    const { client } = bridge();
    render(<QueueList appSessionId={APP} busy queue={queue([], { steers: [steer(U1, askSteerText('toolu_a', [LAYOUT, THEME, SIZE], answers))] })} client={client} />);
    const line = 'Answers to 3 questions: Layout: Grid; Theme: Skipped; How large should the tiles be?: Decide for me';
    expect(texts()).toEqual([line]);
    expect(rows()[0].querySelector('[data-row-text]')?.getAttribute('title')).toBe(line);
    expect(within(rows()[0]).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Send now']);
  });

  it('a folded stack whose first row is an answer names it', () => {
    asked([LAYOUT]);
    const { client } = bridge();
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1'), entry('q-2')], { steers: [steer(U1, askSteerText('toolu_a', [LAYOUT], [GRID]))] })} client={client} />);
    expect(within(stack()).getByRole('button', { expanded: false }).textContent).toBe('3 queued · Next: Answer to Layout: Grid');
  });
});

// UX wave U1c (the U1c document, Interfaces §G; card 2): a waiting "Approve and retry" reads as the line it becomes, with
// Send now and Delete and no More (an edited grant is no grant); a message that only holds the sentence among other words
// is the person's own message and reads as any message.
describe('a waiting grant’s row', () => {
  const GRANT = consentMessage('command', 'make build');
  const labels = (row: HTMLElement) => within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);

  it('at the next step: “You approved make build”, Next step, Send now and Delete, no More; Delete withdraws the steer', async () => {
    const { client, invoke } = bridge({ 'session.steer.cancel': { ok: true, value: { outcome: 'cancelled' } } });
    render(<QueueList appSessionId={APP} busy queue={queue([], { steers: [steer(U1, GRANT)] })} client={client} />);
    const [row] = rows();
    expect(within(row).getByText('You approved make build')).toBeTruthy();
    expect(mark(row)).toBe('Next step');
    expect(labels(row)).toEqual(['Send now', 'Delete']);
    await userEvent.setup().click(within(row).getByRole('button', { name: 'Delete' }));
    expect(invoke).toHaveBeenCalledWith('session.steer.cancel', { appSessionId: APP, messageUuid: U1 });
  });

  it('after the turn: the same line, After the turn, Send now (now) and Delete, no More', async () => {
    const { client, invoke } = bridge();
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1', { content: GRANT })])} client={client} />);
    const [row] = rows();
    expect(within(row).getByText('You approved make build')).toBeTruthy();
    expect(mark(row)).toBe('After the turn');
    expect(labels(row)).toEqual(['Send now', 'Delete']);
    await userEvent.setup().click(within(row).getByRole('button', { name: 'Send now' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.promote', { appSessionId: APP, queueId: 'q-1', priority: 'now' });
  });

  it('folded, its line names it so', () => {
    const { client } = bridge();
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1', { content: GRANT }), entry('q-2'), entry('q-3')])} client={client} />);
    expect(within(stack()).getByRole('button', { name: '3 queued · Next: You approved make build' })).toBeTruthy();
  });

  it('a message that holds a grant line among other words reads as any message, with its menu', () => {
    const { client } = bridge();
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1', { content: `Go ahead.\n${GRANT}` })])} client={client} />);
    const [row] = rows();
    expect(row.querySelector('[data-row-text]')!.textContent).toBe(`Go ahead.\n${GRANT}`);
    expect(labels(row)).toEqual(['Send now', 'Delete', 'More']);
  });

  // Decision Log 44: the grant sentence is a grant row only when it is everything the message holds
  it.each([
    ['an image', { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } }, '[Image #1]'],
    ['a PDF', { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBE' } }, '[PDF #1]'],
  ] as const)('the exact sentence beside %s is an ordinary message: its own text, More with Edit, and the newest to take', async (_, block, named) => {
    const { client } = bridge();
    const onTakeBack = vi.fn();
    const content = [block, { type: 'text', text: GRANT }];
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1', { content })])} client={client} onTakeBack={onTakeBack} />);
    const [row] = rows();
    expect(row.querySelector('[data-row-text]')!.textContent).toBe(`${named} ${GRANT}`);
    expect(labels(row)).toEqual(['Send now', 'Delete', 'More']);
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeTruthy();
    expect(newestToTake(stackRows(queue([entry('q-1', { content })]), new Set(), { unread: [], started: () => false, questions: () => null }))?.key).toBe('q-1');
  });

  // Decision Log 49 (2): wherever the message is drawn; here the message the engine holds and the queue does not list.
  // Decision Log 53: the handed row takes the transcript row's own reading (`consent`), never the text it draws
  it('a handed message that holds an image beside the exact sentence reads as its own text, not as the line it would become', () => {
    const { client } = bridge();
    const image = { kind: 'image', name: 'Image #1', bytes: 4, dataUrl: null, mediaType: 'image/png' };
    const consent = { kind: 'command', subject: 'make build' };
    const handed = (attachments: unknown[], over: object = { consent }) => ({ id: 'u3', turnId: 't3', at: '2026-09-29T10:00:00.000Z', kind: 'user', messageUuid: U3, text: GRANT, attachments, placeholders: [], lines: 1, editable: false, steer: false, dropped: false, unread: true, ...over });
    const drawn = (row: object) => {
      useTranscriptStore.setState({ entries: { [APP]: { rows: [row], state: { index: { messages: new Map() }, turns: new Map() } } as never } });
      const { unmount } = render(<QueueList appSessionId={APP} busy queue={queue([])} client={client} />);
      const text = rows()[0]!.querySelector('[data-row-text]')!.textContent;
      unmount();
      return text;
    };
    expect(drawn(handed([image])), 'with the image').toBe(GRANT);
    expect(drawn(handed([])), 'the sentence alone').toBe('You approved make build');
    expect(drawn(handed([], {})), 'the sentence drawn, no grant recorded').toBe(GRANT);
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

  // UX wave U4b (Interfaces D and G): each control reads the helper with its own label, and the three builds' lists draw
  // three states. Build F's (neither capability): Send now, Edit and Delete closed on a next-step row, and Edit on any
  // other row closed from the first draw (decision 10), its Delete open. Build G's (`rl2.session-acts` alone): Send now
  // closed, the rest open. This build's: all open.
  it('on another machine closes each control with its own sentence by what the machine’s build lists', async () => {
    window.maws = { localMachine: TEST_MACHINE } as never;
    const machineLists = (capabilities: string[]) => {
      resetRemoteSurfaces();
      resetRemoteLaneBStore();
      useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay', capabilities }]);
      useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
    };
    const { client, invoke } = bridge();
    const mount = () => render(<QueueList appSessionId={R} busy queue={queue([entry('q-1', { appSessionId: R })], { steers: [steer(U1, 'remote steer')] })} client={client} />);
    const button = (row: HTMLElement, name: string) => within(row).getByRole('button', { name }) as HTMLButtonElement;
    const editItem = async (row: HTMLElement) => {
      await userEvent.setup().click(within(row).getByRole('button', { name: 'More' }));
      const item = await screen.findByRole('menuitem', { name: 'Edit' });
      const state = [item.getAttribute('aria-disabled') === 'true', item.getAttribute('title')];
      await userEvent.setup().keyboard('{Escape}');
      return state;
    };

    machineLists(['rl2.executor.machine']); // build F's
    let view = mount();
    let [next, after] = rows();
    expect([button(next, 'Send now').disabled, button(next, 'Send now').getAttribute('title')]).toEqual([true, 'Can’t send now on mini yet. Update MAWS on mini and try again.']);
    expect([button(next, 'Delete').disabled, button(next, 'Delete').getAttribute('title')]).toEqual([true, 'Can’t delete on mini yet. Update MAWS on mini and try again.']);
    expect(await editItem(next)).toEqual([true, 'Can’t edit on mini yet. Update MAWS on mini and try again.']);
    expect(button(after, 'Send now').disabled).toBe(false);
    expect(button(after, 'Delete').disabled).toBe(false);
    expect(await editItem(after)).toEqual([true, TAKE_BACK_WORDS.needsNewer('mini')]);
    view.unmount();

    machineLists(['rl2.executor.machine', SESSION_ACTS_CAPABILITY]); // build G's
    view = mount();
    [next, after] = rows();
    expect([button(next, 'Send now').disabled, button(next, 'Send now').getAttribute('title')]).toEqual([true, 'Can’t send now on mini yet. Update MAWS on mini and try again.']);
    expect(button(next, 'Delete').disabled).toBe(false);
    expect((await editItem(next))[0]).toBe(false);
    expect((await editItem(after))[0]).toBe(false);
    view.unmount();

    machineLists(['rl2.executor.machine', SESSION_ACTS_CAPABILITY, SEND_NOW_CAPABILITY]); // this build's
    mount();
    [next] = rows();
    expect(button(next, 'Send now').disabled).toBe(false);
    expect(button(next, 'Delete').disabled).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('on a machine that is offline, says each control is unavailable while it is', () => {
    window.maws = { localMachine: TEST_MACHINE } as never;
    resetRemoteSurfaces();
    resetRemoteLaneBStore();
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'down', since: '2026-11-15T09:00:00.000Z', generation: 0 }]);
    useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
    const { client } = bridge();
    render(<QueueList appSessionId={R} busy queue={queue([], { steers: [steer(U1, 'remote steer')] })} client={client} />);
    const [next] = rows();
    expect(within(next).getByRole('button', { name: 'Send now' }).getAttribute('title')).toBe('Send now is unavailable while mini is offline.');
    expect(within(next).getByRole('button', { name: 'Delete' }).getAttribute('title')).toBe('Delete is unavailable while mini is offline.');
  });

  // the panel's finding 7: a next-step row can outlive its turn (the queue, the status and the lifecycles arrive apart),
  // and its Send now still goes by `session.steer.sendNow`, so its refusal holds whether or not a turn runs
  it('keeps a next-step row’s Send now refused, on another machine and under another build’s host, once no turn runs', async () => {
    window.maws = { localMachine: TEST_MACHINE } as never;
    resetRemoteSurfaces();
    resetRemoteLaneBStore();
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay', capabilities: ['rl2.executor.machine', SESSION_ACTS_CAPABILITY] }]); // build G's
    useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
    const { client, invoke } = bridge();
    const { unmount } = render(<QueueList appSessionId={R} busy={false} queue={queue([], { steers: [steer(U1, 'outlived its turn')] })} client={client} />);
    const remote = within(rows()[0]).getByRole('button', { name: 'Send now' }) as HTMLButtonElement;
    expect(remote.disabled).toBe(true);
    expect(remote.getAttribute('title')).toBe('Can’t send now on mini yet. Update MAWS on mini and try again.');
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

// UX wave U4b (decision 13; Interfaces E): "The agent has already read this message" is said only where the session's
// record says so. A Delete answered `already_started`, or refused because the session is not running on its machine,
// reads the record once from the row's time; any other refusal is said as a toast in main's words.
describe('what a Delete says', () => {
  const STARTED = { id: 'ev-started', sessionId: 'eng-1', at: '2026-09-29T09:50:01.000Z', seq: 1, agentId: null, parentToolUseId: null, kind: 'command.lifecycle', commandUuid: U1, state: 'started' };
  const deleteOn = async (answers: Record<string, unknown>) => {
    const { client, invoke } = bridge(answers);
    const view = render(<QueueList appSessionId={APP} busy queue={queue([], { steers: [steer(U1, 'gone already')] })} client={client} />);
    await userEvent.setup().click(within(rows()[0]).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect((within(rows()[0]).getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(false));
    return { invoke, view };
  };
  const ALREADY = { 'session.steer.cancel': { ok: true, value: { outcome: 'already_started' } } };
  const NOT_LIVE = { 'session.steer.cancel': { ok: false, error: { code: 'internal', message: 'Not taken back: the session isn’t running on mini', issues: { refusal: 'not-live' } } } };

  it.each([
    ['already_started, the record says read: the line', ALREADY, { ok: true, value: { events: [STARTED], complete: true } }, STACK_WORDS.readAlready],
    ['already_started, the record says nothing of it: nothing', ALREADY, { ok: true, value: { events: [], complete: true } }, null],
    ['already_started, the record could not be asked: nothing', ALREADY, { ok: false, error: { code: 'host_unavailable', message: 'mini is offline' } }, null],
    ['not running there, the record says read: the line', NOT_LIVE, { ok: true, value: { events: [STARTED], complete: true } }, STACK_WORDS.readAlready],
    ['not running there, the record says nothing of it: nothing', NOT_LIVE, { ok: true, value: { events: [], complete: true } }, null],
  ])('%s', async (_name, cancel, history, line) => {
    const { invoke } = await deleteOn({ ...cancel, 'session.promptHistory': history });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('session.promptHistory', { appSessionId: APP, since: steer(U1, '').createdAt }));
    await waitFor(() => expect(notice()).toBe(line));
    expect(invoke.mock.calls.filter(([name]) => name === 'session.promptHistory')).toHaveLength(1);
    expect(useNotices.getState().notices).toEqual([]); // no toast
  });

  it('any other refusal is said as a toast, and the record is not read', async () => {
    const { invoke } = await deleteOn({ 'session.steer.cancel': { ok: false, error: { code: 'host_unavailable', message: 'Not taken back: mini is offline', issues: { refusal: 'offline' } } } });
    await waitFor(() => expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['Not taken back: mini is offline']));
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(['session.steer.cancel']);
    expect(notice()).toBeNull();
  });
});

// UX wave U4b, M3's conditional step (decision 15; the Decision Log's line on the probe's result): while a turn runs, Send
// now on an after-the-turn row is a promote at `next` and then, with the uuid the promote answered, the engine's send-now.
// The order is the rule: the request written before the frame answers `nothing_waiting` and moves nothing
// (spikes/protocol-probe/findings-uxwave-u4b-send-now-early.txt, reqfirst). Everywhere else it is today's promote at `now`.
describe('Send now on an after-the-turn row while a turn runs', () => {
  const running = (id: AppSessionId) => useSessions.setState({ engine: new Map([[id, status(id, { engineState: 'running', turn: humanTurn })]]) });
  afterEach(() => {
    cleanup();
    useSessions.setState({ engine: new Map(), listed: new Map(), listedMachines: new Set() });
    delete (window as { maws?: unknown }).maws;
  });
  const NEXT = { appSessionId: APP, queueId: 'q-1', priority: 'next' };

  it('promotes it at the next step, and only once the promote answered its uuid sends that uuid now; never a promote at `now`', async () => {
    running(APP);
    let promoted!: (value: unknown) => void;
    const { client, invoke } = bridge({ 'session.queue.promote': new Promise((resolve) => (promoted = resolve)), 'session.steer.sendNow': { ok: true, value: { outcome: 'delivering' } } });
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1')], { steers: [steer(U1, 'waits at the next step')] })} client={client} />);
    await userEvent.setup().click(within(rows()[1]).getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls).toEqual([['session.queue.promote', NEXT]]); // held open: nothing else yet
    await act(async () => promoted({ ok: true, value: { messageUuid: U2 } }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls).toEqual([['session.queue.promote', NEXT], ['session.steer.sendNow', { appSessionId: APP, messageUuid: U2 }]]);
  });

  it('a promote refused, or answering no uuid, sends nothing now: the refusal is said as today', async () => {
    running(APP);
    const refused = bridge({ 'session.queue.promote': { ok: false, error: { code: 'internal', message: 'entry is in flight' } } });
    const view = render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1')])} client={refused.client} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['entry is in flight']));
    expect(refused.invoke.mock.calls).toEqual([['session.queue.promote', NEXT]]);
    view.unmount();
    const unnamed = bridge(); // the promote answers `{ messageUuid: null }`
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1')])} client={unnamed.client} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled).toBe(false));
    expect(unnamed.invoke.mock.calls).toEqual([['session.queue.promote', NEXT]]);
  });

  it('`nothing_waiting` after the pair shows nothing', async () => {
    running(APP);
    const { client, invoke } = bridge({ 'session.queue.promote': { ok: true, value: { messageUuid: U2 } }, 'session.steer.sendNow': { ok: true, value: { outcome: 'nothing_waiting' } } });
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1')])} client={client} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled).toBe(false));
    expect(notice()).toBeNull();
    expect(useNotices.getState().notices).toEqual([]);
  });

  it('a send-now that fails after the promote is said as any Send now’s failure, and nothing more is invoked: the message stays waiting at the next step', async () => {
    running(APP);
    const { client, invoke } = bridge({ 'session.queue.promote': { ok: true, value: { messageUuid: U2 } }, 'session.steer.sendNow': { ok: false, error: { code: 'internal', message: 'Not sent now: mini is offline' } } });
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1')], { steers: [steer(U1, 'waits at the next step')] })} client={client} />);
    await userEvent.setup().click(within(rows()[1]).getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['Not sent now: mini is offline']));
    await waitFor(() => expect((within(rows()[1]).getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled).toBe(false));
    expect(invoke.mock.calls).toEqual([['session.queue.promote', NEXT], ['session.steer.sendNow', { appSessionId: APP, messageUuid: U2 }]]); // no rollback, no interrupt, no second promote
    expect(screen.queryByText('Sending…')).toBeNull();
    expect(notice()).toBeNull();
  });

  it('is today’s promote at `now` with no turn running, in a paused queue, under an engine host of another build, and on a machine that does not list `rl2.send-now`', async () => {
    const press = async (appSessionId: AppSessionId, busy: boolean, over: Partial<SessionQueue> = {}) => {
      const { client, invoke } = bridge();
      const view = render(<QueueList appSessionId={appSessionId} busy={busy} queue={queue([entry('q-1', { appSessionId })], over)} client={client} />);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Send now' }));
      await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
      view.unmount();
      return invoke.mock.calls;
    };
    const NOW = (appSessionId: AppSessionId) => [['session.queue.promote', { appSessionId, queueId: 'q-1', priority: 'now' }]];
    expect(await press(APP, false), 'no turn running').toEqual(NOW(APP));
    running(APP);
    expect(await press(APP, false, { paused: true, pauseReason: 'user' }), 'a paused queue').toEqual(NOW(APP));
    useHosts.setState({ supervisor: hostStatus({ supervisor: supervisorStatus({ wire: 'w-older' }), matches: 'wire' }) });
    expect(await press(APP, true), 'an engine host of another build').toEqual(NOW(APP));
    useHosts.setState({ supervisor: hostStatus() });
    const R = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    window.maws = { localMachine: TEST_MACHINE } as never;
    resetRemoteSurfaces();
    resetRemoteLaneBStore();
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay', capabilities: ['rl2.executor.machine', SESSION_ACTS_CAPABILITY] }]);
    useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
    running(R);
    expect(await press(R, true), 'a machine of build G').toEqual(NOW(R));
  });

  it('titles such a row’s Send now by the messages that go with it', () => {
    running(APP);
    const { client } = bridge();
    const view = (steers: PendingSteer[]) => <QueueList appSessionId={APP} busy queue={queue([entry('q-1')], { steers })} client={client} />;
    const { rerender } = render(view([steer(U1, 'first')]));
    expect(within(rows()[1]).getByRole('button', { name: 'Send now' }).getAttribute('title')).toBe(STACK_WORDS.sendNowAll(2));
    rerender(view([]));
    expect(within(rows()[0]).getByRole('button', { name: 'Send now' }).getAttribute('title')).toBe(STACK_WORDS.sendNowWhileRunning);
  });
});
