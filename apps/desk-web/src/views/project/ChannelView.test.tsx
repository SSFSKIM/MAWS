// @vitest-environment happy-dom
// A direct channel's local state belongs to its session: moving from one session's channel to another's carries over
// no draft, no RPC status, and no Retire confirmation, so a confirmation begun for A can never retire B. On a desktop
// whose session's machine is online the center is the session view (DC9), its own chunk, stood in for here: what it
// draws is its own suite's; the log-built stream is the center of a session whose machine is offline.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importOrgKey, type LogEvent } from 'desk-hub/protocol';
import { VECTOR_KEY, VECTOR_PROJECT as PROJECT } from '../../../test/vectors';
import { memoryLogRecord } from '../../log/record';
import { ProjectConnection } from '../../project/connection';
import { useLanding } from '../../pwa/service-worker';
import type { DeskSession } from '../../shell/sessions';
import { learnServed } from '../../shell/transcript-served';
import { DeskContext } from '../conversation/desk-context';
import { ChannelView } from './ChannelView';

vi.mock('./SessionView', () => ({
  default: function SessionView({ session, landedRequest, landedQuestion }: { session: DeskSession; landedRequest?: string | null; landedQuestion?: string | null }) {
    return <section data-testid="session-view" data-session={session.session} data-landed-request={landedRequest ?? undefined} data-landed-question={landedQuestion ?? undefined} />;
  },
  SessionStatus: () => <span data-testid="session-status">Loading…</span>,
}));

const A = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const B = '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a';
const session = (id: string, alias: string, title: string | null = null): DeskSession => ({
  project: PROJECT,
  session: id,
  alias,
  machine: 'mini',
  cwd: '/w',
  worktree: null,
  seat: '',
  title,
  member: true,
  ended: null,
  charge: null,
  status: null,
  state: null,
  joinedAt: 1,
  joinedTs: '',
  group: 'working',
  presence: { record: { status: 'busy' }, bridge: true },
  machineOnline: true,
});

let connection: ProjectConnection;
beforeEach(async () => {
  connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  connection.setKey(await importOrgKey(VECTOR_KEY));
  connection.live.setState({ connected: true }); // the controls act only on a welcomed socket
});
afterEach(() => {
  cleanup();
  connection.stop();
  useLanding.getState().clear();
});

it("carries none of one session's draft or confirmation into another's channel, and retires only the session it was confirmed for", async () => {
  const sessions = new Map([
    [A, session(A, 'maws-45')],
    [B, session(B, 'maws-fe')],
  ]);
  const view = (id: string) => (
    <DeskContext.Provider value={{ connection, member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', sessions }}>
      <ChannelView name="MAWS" channel={{ kind: 'session', session: id }} session={sessions.get(id)!} events={[]} />
    </DeskContext.Provider>
  );
  const { rerender } = render(view(A));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message maws-45' }), { target: { value: 'for maws-45 only' } });
  fireEvent.click(screen.getByRole('button', { name: 'Retire…' }));
  expect(screen.getByRole('button', { name: 'Retire' })).toBeTruthy();

  rerender(view(B));
  expect((screen.getByRole('textbox', { name: 'Message maws-fe' }) as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByRole('button', { name: 'Retire' })).toBeNull(); // the confirmation stayed with maws-45
  fireEvent.click(screen.getByRole('button', { name: 'Retire…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
  await waitFor(() => expect(Object.values(connection.conversation.store.getState().rpcs)).toHaveLength(1));
  expect(Object.values(connection.conversation.store.getState().rpcs)[0].rpc.args).toEqual({ session: B });
});

it('draws every control that issues an RPC disabled while the project socket is down, saying why; Send stays', () => {
  connection.live.setState({ connected: false });
  const sessions = new Map([[A, session(A, 'maws-45')]]);
  render(
    <DeskContext.Provider value={{ connection, member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', sessions }}>
      <ChannelView name="MAWS" channel={{ kind: 'session', session: A }} session={sessions.get(A)!} events={[]} />
    </DeskContext.Provider>,
  );
  for (const name of ['Retire…', 'Steer', 'Interrupt', 'Model', 'Compact']) {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement;
    expect(button.disabled, name).toBe(true);
    expect(button.title, name).toBe('not connected to the hub');
  }
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false);
});

it("offers an ended session's Resume only once its machine is known to serve its transcript, saying why until then", async () => {
  const ended: DeskSession = { ...session(A, 'acc-ask71'), group: 'ended', member: false, ended: { by: '', reason: 'ended' }, presence: { record: null, bridge: false } };
  const sessions = new Map([[A, ended]]);
  render(
    <DeskContext.Provider value={{ connection, member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', sessions }}>
      <ChannelView name="MAWS" channel={{ kind: 'session', session: A }} session={ended} events={[]} />
    </DeskContext.Provider>,
  );
  const resume = () => screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement;
  expect([resume().disabled, resume().title]).toEqual([true, "offered once mini serves acc-ask71's transcript"]);
  const owner = {}; // the session's owner, as the session view's subscription would tell it
  const where = { project: PROJECT, machine: 'mini', session: A };
  act(() => learnServed(where, owner, 'none'));
  expect([resume().disabled, resume().title]).toEqual([true, 'mini serves no transcript of acc-ask71 to resume']);
  act(() => learnServed(where, owner, 'served'));
  expect(resume().disabled).toBe(false);
  fireEvent.click(resume());
  await waitFor(() => expect(Object.values(connection.conversation.store.getState().rpcs).map((r) => [r.rpc.rpc, r.rpc.args])).toEqual([['resume', { session: A }]]));
  act(() => learnServed(where, owner, null)); // the view let go: not known again
  expect(resume().disabled).toBe(true);
});

it("draws a direct channel's session view on a desktop while its machine is online, its status word beside the actions; the log-built stream once it is offline", async () => {
  const online = session(A, 'maws-45');
  const view = (s: DeskSession) => (
    <DeskContext.Provider value={{ connection, member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', sessions: new Map([[A, s]]) }}>
      <ChannelView name="MAWS" channel={{ kind: 'session', session: A }} session={s} events={[]} />
    </DeskContext.Provider>
  );
  const { rerender } = render(view(online));
  expect((await screen.findByTestId('session-view')).dataset.session).toBe(A);
  expect(screen.getByTestId('session-status').parentElement?.contains(screen.getByRole('button', { name: 'Retire…' }))).toBe(true);
  expect(screen.queryByTestId('channel-events')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Message maws-45' })).toBeTruthy(); // the composer stays below it

  rerender(view({ ...online, machineOnline: false }));
  expect(screen.getByTestId('machine-offline')).toBeTruthy();
  expect(screen.queryByTestId('session-view')).toBeNull();
  expect(screen.queryByTestId('session-status')).toBeNull();
  expect(screen.getByTestId('channel-events')).toBeTruthy();
});

it("draws a direct channel's session view on a phone too while its machine is online, its status word beside ⋯; the log-built stream once it is offline", async () => {
  // The owner, 2026-10-18: the phone's direct channel is the session view a desktop draws (§4's old binding reversed).
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), addEventListener() {}, removeEventListener() {} }));
  try {
    const online = session(A, 'maws-45');
    const view = (s: DeskSession) => (
      <DeskContext.Provider value={{ connection, member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', sessions: new Map([[A, s]]) }}>
        <ChannelView name="MAWS" channel={{ kind: 'session', session: A }} session={s} events={[]} />
      </DeskContext.Provider>
    );
    const { rerender } = render(view(online));
    const more = () => screen.getByRole('button', { name: 'maws-45: Retire, and what opens on a computer' });
    expect((await screen.findByTestId('session-view')).dataset.session).toBe(A);
    expect(screen.getByTestId('session-status').parentElement?.contains(more())).toBe(true);
    expect(screen.queryByTestId('channel-events')).toBeNull();
    fireEvent.click(more());
    expect(screen.getByTestId('channel-header').textContent).toContain("maws-45's subagents, jobs and diff open on a computer.");

    rerender(view({ ...online, machineOnline: false }));
    expect(screen.queryByTestId('session-view')).toBeNull();
    expect(screen.getByTestId('channel-events')).toBeTruthy();
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("a tapped notification's question event, in the session view", () => {
  const mac = { nonce: 'n', value: 'v' };
  const asked = { offset: 2, event: { ts: '2026-10-18T08:00:00.000Z', writer: `mini/${A}`, seq: 2, kind: 'question', from: 'maws-45', to: 'host', text: ['Ship it?'], choices: [], src: 'toolu_ask', mac } as LogEvent };
  const raised = { request: 'request-7', session: A, tool: 'mcp__doperpowers__AskUserQuestion', input: {}, async: true as const, toolUseId: 'toolu_ask', mac };
  const record = { key: 'k1', request: 'request-7', machine: 'mini', raised, at: 1, pending: true, terminalOnly: false, settled: null };
  const opened = async () => {
    useLanding.setState({ landed: { project: PROJECT, session: A, landing: { kind: 'event', writer: `mini/${A}`, seq: 2 } } });
    const sessions = new Map([[A, session(A, 'maws-45')]]);
    render(
      <DeskContext.Provider value={{ connection, member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', sessions }}>
        <ChannelView name="MAWS" channel={{ kind: 'session', session: A }} session={sessions.get(A)!} events={[asked]} />
      </DeskContext.Provider>,
    );
    return screen.findByTestId('session-view');
  };

  it('lands on the card of the request a bridge raised for the same ask, and stays there once it is answered there', async () => {
    connection.conversation.store.setState({ requests: { k1: record }, checked: true });
    const view = await opened();
    expect(view.dataset.landedRequest).toBe('request-7');
    expect(view.dataset.landedQuestion).toBeUndefined();
    // Answered on its card, the request settles: the reader is not sent up to the call.
    act(() => connection.conversation.store.setState({ requests: { k1: { ...record, pending: false } } }));
    expect(view.dataset.landedRequest).toBe('request-7');
    expect(view.dataset.landedQuestion).toBeUndefined();
  });

  it("lands on its call's row when no request waits for it (MAWS's ask), once the pending set is checked", async () => {
    const view = await opened();
    expect(view.dataset.landedQuestion).toBeUndefined(); // a request for it may not be checked yet
    act(() => connection.conversation.store.setState({ checked: true }));
    expect(view.dataset.landedQuestion).toBe('toolu_ask');
    expect(view.dataset.landedRequest).toBeUndefined();
  });
});

it("draws each item of a session's stream once as it changes (the stream and the composer each keep their own key)", () => {
  const sessions = new Map([[A, { ...session(A, 'maws-45'), machineOnline: false }]]);
  const mac = { nonce: 'n', value: 'v' };
  const joined = { offset: 1, event: { ts: '2026-10-15T08:00:00.000Z', writer: `mini/${A}`, seq: 1, kind: 'joined', session: A, alias: 'maws-45', machine: 'mini', seat: '', mac } as LogEvent };
  render(
    <DeskContext.Provider value={{ connection, member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', sessions }}>
      <ChannelView name="MAWS" channel={{ kind: 'session', session: A }} session={sessions.get(A)!} events={[joined]} />
    </DeskContext.Provider>,
  );
  const raised = { request: 'toolu_1', session: A, tool: 'Bash', input: { command: 'pnpm e2e' }, mac };
  const record = { key: 'k1', request: 'toolu_1', machine: 'mini', raised, at: 1, pending: true, terminalOnly: false, settled: null };
  act(() => connection.conversation.store.setState({ requests: { k1: record } }));
  act(() => connection.conversation.store.setState({ requests: { k1: { ...record, pending: false } } }));
  const lines = document.querySelectorAll('[data-item="system"]');
  expect(lines).toHaveLength(1);
  expect(lines[0].textContent).toContain('maws-45 joined on mini');
  expect(document.querySelectorAll('[data-request="toolu_1"]')).toHaveLength(1);
});

it('says when the machine is read-only, before anything is sent: a send is recorded and not delivered, and every RPC is drawn disabled saying why', () => {
  const sessions = new Map([[A, { ...session(A, 'maws-45'), machineReadOnly: true }]]);
  render(
    <DeskContext.Provider value={{ connection, member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', sessions }}>
      <ChannelView name="MAWS" channel={{ kind: 'session', session: A }} session={sessions.get(A)!} events={[]} />
    </DeskContext.Provider>,
  );
  expect(screen.getByTestId('machine-read-only').textContent).toBe("mini is read-only: it runs nothing sent from outside it, so what you send maws-45 is recorded and not delivered, and only its terminal can answer or steer it.");
  for (const name of ['Retire…', 'Steer', 'Interrupt', 'Model', 'Compact']) {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement;
    expect(button.disabled, name).toBe(true);
    expect(button.title, name).toBe('mini is read-only: it runs nothing sent from outside it');
  }
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false);
  // While a turn runs the note says why Steer is off too.
  expect(screen.getByTestId('composer-note').textContent).toBe('recorded, not delivered: mini is read-only · mini is read-only: it runs nothing sent from outside it');
});

it("heads a direct channel as a sidebar row names it — the title, its machine online, the alias under — and names it so below; by its alias without one", () => {
  const long = 'Codex native Computer Use internals, its approval prompts, and the native helper';
  const sessions = new Map([
    [A, session(A, 'maws-4d', long)],
    [B, session(B, 'maws-fe')],
  ]);
  const view = (id: string) => (
    <DeskContext.Provider value={{ connection, member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', sessions }}>
      <ChannelView name="MAWS" channel={{ kind: 'session', session: id }} session={sessions.get(id)!} events={[]} />
    </DeskContext.Provider>
  );
  const { rerender } = render(view(A));
  const header = () => screen.getByTestId('channel-header');
  const name = header().querySelector('[data-testid="session-name"]') as HTMLElement;
  expect(name.textContent).toBe(long);
  expect(name.className).toContain('truncate'); // cut to the header's width, and whole on hover
  expect(name.title).toBe(long);
  expect(name.parentElement?.textContent).toBe(`${long}@minionline`);
  expect(header().querySelector('[data-testid="alias"]')?.textContent).toBe('maws-4d');
  expect(screen.getByRole('textbox', { name: `Message ${long}` })).toBeTruthy();

  rerender(view(B));
  expect(header().querySelector('[data-testid="session-name"]')?.textContent).toBe('maws-fe');
  expect(header().querySelector('[data-testid="machine"]')?.textContent).toBe('@mini');
  expect(header().querySelector('[data-testid="alias"]')).toBeNull();
  expect(header().querySelector('[data-testid="liveness"]')).toBeNull(); // the header as it was: no word
  expect(screen.getByRole('textbox', { name: 'Message maws-fe' })).toBeTruthy();
});

it('gives the actions their width first: the name and the charge truncate in one group beside them, a confirmation included', () => {
  const long = 'Codex native Computer Use internals, its approval prompts, and the native helper';
  const titled = { ...session(A, 'maws-4d', long), charge: 'owner artifacts page' };
  render(
    <DeskContext.Provider value={{ connection, member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', sessions: new Map([[A, titled]]) }}>
      <ChannelView name="MAWS" channel={{ kind: 'session', session: A }} session={titled} events={[]} />
    </DeskContext.Provider>,
  );
  const header = screen.getByTestId('channel-header');
  const group = screen.getByTestId('channel-name');
  const [first, actions] = [...header.children];
  expect(header.children).toHaveLength(2);
  expect(first).toBe(group);
  // The group takes what the actions leave and no more: it grows from nothing, shrinks, and clips.
  expect(group.className.split(' ')).toEqual(expect.arrayContaining(['flex-1', 'min-w-0', 'overflow-hidden']));
  expect(group.querySelector('[data-testid="session-name"]')?.textContent).toBe(long);
  expect(group.textContent).toContain('· owner artifacts page');
  expect(actions.contains(screen.getByRole('button', { name: 'Retire…' }))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retire…' }));
  expect(actions.textContent).toContain(`Retire ${long}?`);
  expect(group.textContent).not.toContain('Retire');
});
