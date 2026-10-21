// @vitest-environment happy-dom
// A link in a message opens in a new tab, cut off from this page (`noopener`), through the browser's own TranscriptActions
// around MAWS's Markdown — never MAWS's IPC defaults, which the desk does not load.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Delivery, LogEvent, Raised, Settled } from 'desk-hub/protocol';
import { dateFormats } from '@shared/app/date-format';
import { VECTOR_PROJECT as PROJECT } from '../../../test/vectors';
import { memoryLogRecord } from '../../log/record';
import { ProjectConnection } from '../../project/connection';
import { deliveryKey, requestKey, type RequestRecord } from '../../project/conversation';
import type { DeskSession } from '../../shell/sessions';
import { useGrid } from '../../state/grid';
import type { StreamItem } from '../../conversation/stream';
import { DeskContext } from './desk-context';
import { StreamView } from './StreamView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('opens a link in a message in a new tab, without opener', async () => {
  const connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  const event = { ts: '2026-10-15T08:00:00.000Z', writer: 'mini/67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', seq: 1, kind: 'message', mac: { nonce: 'n', value: 'v' } } as LogEvent;
  render(
    <DeskContext.Provider value={{ connection, member: 'm', sessions: new Map() }}>
      <StreamView items={[{ kind: 'message', key: 'm', offset: 1, event, session: null, from: 'maws-45', text: 'see [the PR](https://github.com/SSFSKIM/MAWS/pull/1)' }]} outbox={[]} />
    </DeskContext.Provider>,
  );
  const link = await waitFor(() => screen.getByRole('link', { name: 'the PR' }));
  fireEvent.click(link);
  expect(open).toHaveBeenCalledWith('https://github.com/SSFSKIM/MAWS/pull/1', '_blank', 'noopener,noreferrer');
  connection.stop();
});

it("opens a link in a human's bubble, and in a send on its way, in a new tab, without opener", async () => {
  const connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  const me = '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c';
  const text = 'see [the PR](https://github.com/SSFSKIM/MAWS/pull/1)';
  const event = { ts: '2026-10-15T08:00:00.000Z', writer: `hub/${me}`, seq: 1, kind: 'human', from: 'human', to: '*', text, member: me, mac: { nonce: 'n', value: 'v' } } as LogEvent;
  render(
    <DeskContext.Provider value={{ connection, member: me, sessions: new Map() }}>
      <StreamView
        items={[{ kind: 'human', key: 'h1', offset: 1, event, text, to: '*', wake: false }]}
        outbox={[{ nonce: 'o1', to: '*', text: 'and [the plan](https://example.com/plan)', wake: false, state: 'sending' }]}
      />
    </DeskContext.Provider>,
  );
  fireEvent.click(await waitFor(() => screen.getByRole('link', { name: 'the PR' })));
  expect(open).toHaveBeenCalledWith('https://github.com/SSFSKIM/MAWS/pull/1', '_blank', 'noopener,noreferrer');
  fireEvent.click(screen.getByRole('link', { name: 'the plan' }));
  expect(open).toHaveBeenLastCalledWith('https://example.com/plan', '_blank', 'noopener,noreferrer');
  connection.stop();
});

it("names a session's message by its title, the alias it went out under muted beside it; by that alias alone without one", () => {
  const connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  const [titled, plain] = ['1ea561bc-a60d-4437-a6ac-fa7cd5eda54f', '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b'];
  const sessions = new Map([
    [titled, { title: 'cua_repl', alias: 'maws-4d', machine: 'macbook' }],
    [plain, { title: null, alias: 'maws-45', machine: 'mini' }],
  ]) as unknown as Map<string, DeskSession>;
  const message = (seq: number, session: string, from: string) => {
    const event = { ts: '2026-10-15T08:00:00.000Z', writer: `x/${session}`, seq, kind: 'message', mac: { nonce: `n${seq}`, value: 'v' } } as LogEvent;
    return { kind: 'message' as const, key: `m${seq}`, offset: seq, event, session, from, text: `said ${seq}` };
  };
  render(
    <DeskContext.Provider value={{ connection, member: 'm', sessions }}>
      <StreamView items={[message(1, titled, 'maws-4d'), message(2, plain, 'maws-45')]} outbox={[]} />
    </DeskContext.Provider>,
  );
  const who = screen.getAllByTestId('said-who');
  expect(who.map((e) => e.textContent)).toEqual(['cua_repl', 'maws-45']);
  expect(screen.getAllByTestId('said-alias').map((e) => e.textContent)).toEqual(['maws-4d']);
  expect(who[0].parentElement!.textContent).toContain('@macbook');
  // One line: the title truncates, whole on hover; the alias, the machine and the time never give up their width.
  expect(who[0].className).toContain('truncate');
  expect(who[0].title).toBe('cua_repl');
  expect(who[1].title).toBe('');
  for (const meta of [...who[0].parentElement!.children].slice(1)) expect(meta.className).toContain('shrink-0');
  connection.stop();
});

it("draws the owner's own message as MAWS's bubble on the right, and another member's or a human's at a machine on the left under who they are", () => {
  const me = '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c';
  const other = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  const human = (seq: number, writer: string, member?: string) => {
    const event = { ts: '2026-10-15T08:00:00.000Z', writer, seq, kind: 'human', from: 'human', to: '*', text: `post ${seq}`, ...(member && { member }), mac: { nonce: `n${seq}`, value: 'v' } } as LogEvent;
    return { kind: 'human' as const, key: `h${seq}`, offset: seq, event, text: `post ${seq}`, to: '*' as const, wake: false };
  };
  render(
    <DeskContext.Provider value={{ connection, member: me, sessions: new Map() }}>
      <StreamView items={[human(1, `hub/${me}`, me), human(2, `hub/${other}`, other), human(3, 'mini/human')]} outbox={[]} />
    </DeskContext.Provider>,
  );
  const bubbles = screen.getAllByRole('region').filter((e) => e.classList.contains('desk-chat-send'));
  expect(bubbles.map((b) => b.getAttribute('data-side'))).toEqual(['you', 'other', 'other']);
  expect(bubbles[0].getAttribute('aria-label')).toBe('Your message');
  expect(bubbles[0].querySelector('[data-testid="said-who"]')).toBeNull(); // the side says who
  expect(bubbles[0].querySelector('.transcript-user-bubble')).not.toBeNull(); // MAWS's bubble, through MAWS's Markdown
  const who = screen.getAllByTestId('said-who');
  expect(who.map((e) => e.textContent)).toEqual(['Another member (a1b2c3d4)', 'A human']);
  expect(who[1].parentElement!.textContent).toContain('@mini');
  // A record, kept for no one, says so in the bubble's foot, untinted.
  expect(bubbles[0].getAttribute('data-state')).toBe('record');
  expect(bubbles[0].querySelector('[data-testid="record"]')!.textContent).toBe('Recorded · delivered to no one');
  connection.stop();
});

const SESSION = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const at = (minutes: number) => `2026-10-15T08:${String(minutes).padStart(2, '0')}:00.000Z`;
const message = (seq: number, text: string, minutes = 0, session = SESSION, from = 'maws-45'): Extract<StreamItem, { kind: 'message' }> => ({
  kind: 'message',
  key: `m${seq}`,
  offset: seq,
  event: { ts: at(minutes), writer: `mini/${session}`, seq, kind: 'message', mac: { nonce: `n${seq}`, value: 'v' } } as LogEvent,
  session,
  from,
  text,
});
const system = (seq: number, subject: string, rest: string, minutes = 0): Extract<StreamItem, { kind: 'system' }> => ({
  kind: 'system',
  key: `s${seq}`,
  offset: seq,
  event: { ts: at(minutes), writer: `mini/${SESSION}`, seq, kind: 'joined', mac: { nonce: `n${seq}`, value: 'v' } } as LogEvent,
  session: SESSION,
  subject,
  rest,
  text: `${subject} ${rest}`,
});
const draw = (items: StreamItem[], sessions = new Map<string, DeskSession>(), requests: Record<string, RequestRecord> = {}) => {
  const connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  connection.conversation.store.setState({ requests });
  render(
    <DeskContext.Provider value={{ connection, member: 'm', sessions }}>
      <StreamView items={items} outbox={[]} />
    </DeskContext.Provider>,
  );
  return connection;
};

it("puts a sender's messages within a few minutes under one header, as MAWS's answer prose, and names a session titled with its own alias once", () => {
  const sessions = new Map([[SESSION, { title: 'maws-45', alias: 'maws-45', machine: 'mini' }]]) as unknown as Map<string, DeskSession>;
  const connection = draw([message(1, 'first', 0), message(2, 'second', 2), message(3, 'later', 20)], sessions);
  const heads = screen.getAllByTestId('said');
  expect(heads).toHaveLength(2);
  expect(heads[0].querySelector('[data-testid="said-who"]')!.textContent).toBe('maws-45');
  expect(heads[0].querySelector('[data-testid="said-alias"]')).toBeNull(); // the title is the alias: said once
  expect(heads[0].textContent).toContain('@mini');
  expect(screen.getAllByTestId('run')[0].querySelectorAll('[data-item="message"]')).toHaveLength(2);
  for (const prose of screen.getAllByTestId('prose')) expect(prose.className).toBe('transcript-answer');
  expect(screen.getByRole('separator')).toBeTruthy(); // the day's separator, before the first dated row
  connection.stop();
});

it('merges a session’s lifecycle lines into one quiet line, and folds a longer run behind its count until opened', () => {
  const lines = [system(1, 'maws-45', 'joined on mini'), system(2, 'maws-45', 'is in charge of: grid'), system(3, 'maws-fe', 'joined on SK.local'), system(4, 'cua_repl', 'joined on mini'), system(5, 'maws-44', 'ended')];
  const connection = draw([...lines, message(6, 'hi', 1), system(7, 'maws-45', 'stopped on mini', 2), system(8, 'maws-45', 'is running again on mini', 3)]);
  const fold = screen.getByTestId('quiet-run');
  const button = fold.querySelector('button')!;
  expect(button.textContent).toContain('5 updates · maws-45, maws-fe, cua_repl, maws-44');
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(fold.querySelector('[data-testid="quiet"]')).toBeNull();
  fireEvent.click(button);
  const merged = fold.querySelectorAll('[data-testid="quiet"] li');
  expect(merged).toHaveLength(4);
  expect(merged[0].textContent).toContain('maws-45 joined on mini · is in charge of: grid');
  // Two lines after the message stand as one quiet line, unfolded.
  const quiet = screen.getAllByTestId('quiet');
  expect(quiet.at(-1)!.textContent).toContain('maws-45 stopped on mini · is running again on mini');
  connection.stop();
});

const question = (seq: number, answered: string | null, questions = ['Which column do we keep?'], ref = 'r'): Extract<StreamItem, { kind: 'question' }> => ({
  kind: 'question',
  key: `q${seq}`,
  offset: seq,
  event: { ts: at(0), writer: `mini/${SESSION}`, seq, kind: 'question', mac: { nonce: `n${seq}`, value: 'v' } } as LogEvent,
  session: SESSION,
  from: 'maws-45',
  text: questions.join('\n\n'),
  questions,
  choices: ['user_id', 'owner_id'],
  request: 'toolu_q',
  ref,
  answered: answered === null ? null : { text: answered, event: { ts: at(1), writer: `mini/${SESSION}`, seq: seq + 1, kind: 'answered', mac: { nonce: 'a', value: 'v' } } as LogEvent },
});

it("draws an answered question as MAWS's receipt, the answers read from the engine's summary and any other text whole in the foot", () => {
  const summary = 'Your questions have been answered: "Which column do we keep?"="user_id". You can now continue with these answers in mind.';
  const partial = 'Your questions have been answered: "Which column?"="user_id". You can now continue with these answers in mind.';
  const connection = draw([
    question(1, summary),
    question(3, 'owner_id', ['Which column do we keep?'], 'r2'),
    question(5, null, ['Ship it?'], 'r3'),
    question(7, 'The user did not answer the questions.', ['Ship it?'], 'r4'),
    question(9, partial, ['Which column?', 'Which table?'], 'r5'),
  ]);
  const receipts = screen.getAllByTestId('question');
  expect(receipts).toHaveLength(5);
  const lines = (receipt: Element) => [...receipt.querySelectorAll('.transcript-question-line')].map((l) => [l.textContent, l.querySelector('[data-answer]')!.getAttribute('data-answer')]);
  const foot = (receipt: Element) => receipt.querySelector('[data-testid="question-settled"]')?.textContent ?? null;
  expect(lines(receipts[0])).toEqual([['Which column do we keep?→user_id', '']]);
  expect(foot(receipts[0])).toBeNull(); // nothing to add to the line
  // A text the reader does not parse (a plain text, MAWS's own steer) is never put on a line: it is answered, and the
  // foot has it whole.
  expect(lines(receipts[1])).toEqual([['Which column do we keep?→answered', 'none']]);
  expect(foot(receipts[1])).toBe('Answered: owner_id');
  // Open, with no request raised to this browser: waiting, and it says so.
  expect(lines(receipts[2])).toEqual([['Ship it?→waiting', 'none']]);
  expect(receipts[2].getAttribute('data-waiting')).toBe('');
  expect(receipts[2].querySelector('[data-testid="question-waiting"]')!.textContent).toBe('Waiting for an answer');
  // The ask mod's words for an ask answered with nothing: the lines say it, and the foot adds nothing.
  expect(lines(receipts[3])).toEqual([['Ship it?→Not answered', 'none']]);
  expect(foot(receipts[3])).toBeNull();
  // A summary names only the questions answered: the one it leaves out was not.
  expect(lines(receipts[4])).toEqual([
    ['Which column?→user_id', ''],
    ['Which table?→Not answered', 'none'],
  ]);
  expect(foot(receipts[4])).toBeNull();
  expect(screen.queryByText('Open question')).toBeNull();
  expect(screen.queryByText(/Your questions have been answered/)).toBeNull();
  connection.stop();
});

/** A request this browser saw for a question, settled. */
const settledRequest = (ref: string, outcome: Settled['outcome'], header = 'Ship'): RequestRecord => {
  const raised = { request: 'toolu_q', session: SESSION, tool: 'mcp__doperpowers__AskUserQuestion', input: { questions: [{ question: 'Ship it?', header, options: [{ label: 'yes' }, { label: 'no' }], multiSelect: false }] }, async: true, mac: { nonce: 'n', value: 'v' } } as Raised;
  return { key: ref, request: 'toolu_q', machine: 'mini', raised, at: 0, pending: false, terminalOnly: false, settled: { request: 'toolu_q', winner: 'web', outcome, by: 'm', mac: { nonce: 's', value: 'v' } } };
};

it('draws a question whose request was settled answered, its answer not in the log yet, as answered, and one withdrawn as not answered', () => {
  const connection = draw([question(1, null, ['Ship it?'], 'r1'), question(3, null, ['Ship it?'], 'r2')], new Map(), { r1: settledRequest('r1', 'answered'), r2: settledRequest('r2', 'withdrawn') });
  const [answered, withdrawn] = screen.getAllByTestId('question');
  expect(answered.querySelector('.transcript-question-line')!.textContent).toBe('Ship→answered');
  expect(answered.querySelector('[data-answer]')!.getAttribute('data-answer')).toBe('none');
  expect(answered.querySelector('[data-testid="question-settled"]')!.textContent).toBe('Answered from the web by you');
  expect(withdrawn.querySelector('.transcript-question-line')!.textContent).toBe('Ship→Not answered');
  expect(withdrawn.querySelector('[data-testid="question-settled"]')!.textContent).toBe('Withdrawn');
  connection.stop();
});

it('names a run of requests alone, from a session the sidebar does not know yet, by its id and the machine it was raised on', () => {
  const key = requestKey({ machine: 'macbook', session: SESSION, request: 'toolu_p' });
  const raised = { request: 'toolu_p', session: SESSION, tool: 'Bash', input: { command: 'ls' }, mac: { nonce: 'n', value: 'v' } } as Raised;
  const record: RequestRecord = { key, request: 'toolu_p', machine: 'macbook', raised, at: 0, pending: true, terminalOnly: false, settled: null };
  const connection = draw([{ kind: 'request', key: `request:${key}`, request: 'toolu_p', ref: key, session: SESSION, ts: null }], new Map(), { [key]: record });
  const head = screen.getByTestId('said');
  expect(head.querySelector('[data-testid="said-who"]')!.textContent).toBe(SESSION.slice(0, 8));
  expect(head.textContent).toContain('@macbook');
  connection.stop();
});

it('labels the day separators against a clock that turns at local midnight', () => {
  const day = new Date(at(0));
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 30));
  const connection = draw([system(1, 'maws-45', 'joined on mini')]);
  const formats = dateFormats();
  expect(screen.getByRole('separator').textContent).toBe(formats.day(0));
  act(() => void vi.advanceTimersByTime(32_000));
  expect(screen.getByRole('separator').textContent).toBe(formats.day(1));
  connection.stop();
});

it("draws each recipient's delivery outcome with the machine's reason when it was not delivered", () => {
  const connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  const [live, seat, rests] = ['67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a', '0d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a59'];
  const to = [
    { session: live, alias: 'walk-b' },
    { session: seat, alias: 'web-1a2b3c' },
    { session: rests, alias: 'maws-45' },
  ];
  const event = { ts: '2026-10-15T08:00:00.000Z', writer: 'hub/4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', seq: 4, kind: 'human', from: 'human', to, text: 'ping', mac: { nonce: 'n4', value: 'v' } } as LogEvent;
  const delivery = (session: string, outcome: Delivery['outcome'], reason: string): Delivery => ({ event: { writer: event.writer, seq: event.seq }, session, outcome, reason, mac: { nonce: `d-${session}`, value: 'v' } });
  const readOnly = 'this machine is read-only: nothing written outside it is delivered';
  connection.conversation.store.setState({
    deliveries: {
      [deliveryKey(event)]: {
        [live]: delivery(live, 'refused-read-only', readOnly),
        [seat]: delivery(seat, 'refused-read-only', readOnly),
        [rests]: delivery(rests, 'delivered', 'pushed to the live session'),
      },
    },
  });
  render(
    <DeskContext.Provider value={{ connection, member: 'm', sessions: new Map() }}>
      <StreamView items={[{ kind: 'human', key: 'h4', offset: 4, event, text: 'ping', to, wake: false }]} outbox={[]} />
    </DeskContext.Provider>,
  );
  const line = (session: string) => document.querySelector(`[data-recipient="${session}"]`)!;
  expect(line(live).textContent).toBe(`walk-b: not delivered: the machine is read-only — ${readOnly}`);
  expect(line(seat).textContent).toBe(`web-1a2b3c: not delivered: the machine is read-only — ${readOnly}`);
  // Delivered says no more on the line; its reason is there on hover.
  expect(line(rests).textContent).toBe('maws-45: delivered');
  expect(line(rests).getAttribute('title')).toBe('pushed to the live session');
  connection.stop();
});

it('tints a send reaching none of its recipients as failed when any failed, else as held, and leaves a send that reached one untinted', () => {
  const connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  const [a, b] = ['67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a'];
  const to = [
    { session: a, alias: 'maws-45' },
    { session: b, alias: 'maws-fe' },
  ];
  const sent = (seq: number) => ({ ts: '2026-10-15T08:00:00.000Z', writer: 'hub/4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', seq, kind: 'human', from: 'human', to, text: `send ${seq}`, mac: { nonce: `n${seq}`, value: 'v' } }) as LogEvent;
  const outcomes = (event: LogEvent, [x, y]: [Delivery['outcome'], Delivery['outcome']]) => ({
    [deliveryKey(event)]: Object.fromEntries(
      [
        [a, x],
        [b, y],
      ].map(([session, outcome]) => [session, { event: { writer: event.writer, seq: event.seq }, session, outcome, reason: 'r', mac: { nonce: `d${event.seq}${session}`, value: 'v' } } as Delivery]),
    ),
  });
  const events = [sent(1), sent(2), sent(3)];
  connection.conversation.store.setState({ deliveries: { ...outcomes(events[0], ['refused-read-only', 'failed']), ...outcomes(events[1], ['recorded', 'refused-read-only']), ...outcomes(events[2], ['delivered', 'failed']) } });
  render(
    <DeskContext.Provider value={{ connection, member: 'm', sessions: new Map() }}>
      <StreamView items={events.map((event) => ({ kind: 'human' as const, key: `h${event.seq}`, offset: event.seq, event, text: String(event.text), to, wake: false }))} outbox={[]} />
    </DeskContext.Provider>,
  );
  const bubbles = screen.getAllByRole('region').filter((e) => e.classList.contains('desk-chat-send'));
  expect(bubbles.map((bubble) => bubble.getAttribute('data-state'))).toEqual(['failed', 'held', 'mixed']);
  connection.stop();
});

// The org directory's §6: a cross-project message is in both timelines — the sender's copy, marked with its destination
// (never as a message to the sender's own group), and the delivering event, marked with its origin — each project named
// as the grid names it.
it("marks the sender's copy with its destination and the delivering event with its origin, by the projects' names", () => {
  const connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  const [THERE, ELSEWHERE] = ['a5c3c1de-7a5e-5d2b-9f3a-2c6b7e1d4f20', 'c0ffee00-0000-4000-8000-000000000000'];
  useGrid.setState({ projects: [{ id: THERE, name: 'mini', kind: 'machine', machines: 1, machines_online: 1, working: 0, waiting: 0, live: 0 }] });
  const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
  const at = (seq: number, kind: string, fields: Record<string, unknown>) =>
    ({ ts: '2026-10-18T08:00:00.000Z', writer: `macbook/${S1}`, seq, kind, mac: { nonce: `n${seq}`, value: 'v' }, from: 'maws-45', text: `text ${seq}`, ...fields }) as LogEvent;
  const copy = at(1, 'say', { to: [{ session: 'x', alias: 'mini-7c', project: THERE }], copy: `${THERE}:macbook/${S1}:7` });
  const inbound = at(2, 'say', { to: [{ session: S1, alias: 'maws-45' }], from: 'doperpowers-2a', from_project: ELSEWHERE });
  const plain = at(3, 'say', { to: [{ session: S1, alias: 'maws-45' }], from: 'maws-fe' });
  const humanCopy = at(4, 'human', { from: 'human', to: [{ session: 'x', alias: 'mini-7c', project: THERE }], copy: `${THERE}:macbook/human:3` });
  render(
    <DeskContext.Provider value={{ connection, member: 'm', sessions: new Map() }}>
      <StreamView
        items={[
          { kind: 'agents', key: 'a1', says: [{ offset: 1, event: copy }] },
          { kind: 'agents', key: 'a2', says: [{ offset: 2, event: inbound }] },
          { kind: 'agents', key: 'a3', says: [{ offset: 3, event: plain }] },
          { kind: 'human', key: 'h4', offset: 4, event: humanCopy, text: 'text 4', to: humanCopy.to as never, wake: false },
        ]}
        outbox={[]}
      />
    </DeskContext.Provider>,
  );
  const runs = screen.getAllByTestId('agent-run');
  expect(runs[0].textContent).toContain('maws-45 → mini-7c');
  expect(runs[0].querySelector('[data-testid="cross-project"]')?.textContent).toBe('→ mini');
  expect(runs[1].querySelector('[data-testid="cross-project"]')?.textContent).toBe(`from ${ELSEWHERE.slice(0, 8)}`); // a project the grid does not list
  expect(runs[2].querySelector('[data-testid="cross-project"]')).toBeNull();
  // A human's copy delivers nothing: it names where it went, and no delivery outcome of its own.
  const human = screen.getByText('text 4').closest('li')!;
  expect(human.querySelector('[data-testid="cross-project"]')?.textContent).toBe('→ mini: mini-7c');
  expect(human.querySelector('[data-testid="deliveries"]')).toBeNull();
  connection.stop();
  useGrid.setState({ projects: [] });
});

// sminos 1.2.0's scoped broadcast (the org directory's §5a): a broadcast is named by its scope where a bare one says
// @all, and the sender's copy of one several projects' events deliver names each of those projects.
it("names a scoped broadcast by its scope, and every project a broadcast's copy went to", () => {
  const connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  const [THERE, YONDER] = ['a5c3c1de-7a5e-5d2b-9f3a-2c6b7e1d4f20', '7d3b9e40-52c4-4f1e-8f0a-2b6c5d4e3f22'];
  const grid = (id: string, name: string) => ({ id, name, kind: 'machine' as const, machines: 1, machines_online: 1, working: 0, waiting: 0, live: 0 });
  useGrid.setState({ projects: [grid(THERE, 'mini'), grid(YONDER, 'projB')] });
  const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
  const at = (seq: number, kind: string, fields: Record<string, unknown>) =>
    ({ ts: '2026-10-20T08:00:00.000Z', writer: `macbook/${S1}`, seq, kind, mac: { nonce: `n${seq}`, value: 'v' }, from: 'maws-45', text: `text ${seq}`, ...fields }) as LogEvent;
  const me = [{ session: S1, alias: 'maws-45' }];
  const both = [
    { session: 'x', alias: 'mini-7c', project: THERE },
    { session: 'y', alias: 'rb', project: YONDER },
  ];
  const scoped = at(1, 'say', { to: me, from: 'doperpowers-2a', wake: true, scope: { projects: [THERE], machines: ['beta'], states: ['waiting'] } });
  const bare = at(2, 'say', { to: me, from: 'maws-fe', wake: true });
  const copy = at(3, 'say', { to: both, wake: true, scope: {}, copy: [`${THERE}:macbook/${S1}:7`, `${YONDER}:macbook/${S1}:2`] });
  const humanScoped = at(4, 'human', { from: 'human', to: me, wake: true, scope: { machines: ['mini'] } });
  const humanBare = at(5, 'human', { from: 'human', to: me, wake: true });
  const humanCopy = at(6, 'human', { from: 'human', to: both, wake: true, scope: { here: 'macbook' }, copy: [`${THERE}:macbook/human:3`, `${YONDER}:macbook/human:9`] });
  const human = (event: LogEvent) => ({ kind: 'human' as const, key: `h${event.seq}`, offset: event.seq, event, text: String(event.text), to: event.to as never, wake: true });
  render(
    <DeskContext.Provider value={{ connection, member: 'm', sessions: new Map() }}>
      <StreamView
        items={[
          { kind: 'agents', key: 'a1', says: [{ offset: 1, event: scoped }] },
          { kind: 'agents', key: 'a2', says: [{ offset: 2, event: bare }] },
          { kind: 'agents', key: 'a3', says: [{ offset: 3, event: copy }] },
          human(humanScoped),
          human(humanBare),
          human(humanCopy),
        ]}
        outbox={[]}
      />
    </DeskContext.Provider>,
  );
  const runs = screen.getAllByTestId('agent-run');
  expect(runs[0].textContent).toContain('doperpowers-2a → @all in mini on beta (waiting)');
  expect(runs[1].textContent).toContain('maws-fe → @all');
  expect(runs[2].textContent).toContain('maws-45 → @org');
  expect(runs[2].querySelector('[data-testid="cross-project"]')?.textContent).toBe('→ mini, projB');
  const bubble = (text: string) => screen.getByText(text).closest('li')!;
  expect(bubble('text 4').querySelector('[data-wake]')?.textContent).toBe('@all on mini at sending');
  expect(bubble('text 5').querySelector('[data-wake]')?.textContent).toBe('@all at sending');
  // A human's copy of a broadcast into two projects: each project with its recipients there, and no outcome of its own.
  expect(bubble('text 6').querySelector('[data-testid="cross-project"]')?.textContent).toBe('→ mini: mini-7c · projB: rb');
  expect(bubble('text 6').querySelector('[data-testid="deliveries"]')).toBeNull();
  connection.stop();
  useGrid.setState({ projects: [] });
});
