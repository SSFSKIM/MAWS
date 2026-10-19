// @vitest-environment happy-dom
// A link in a message opens in a new tab, cut off from this page (`noopener`), through the browser's own TranscriptActions
// around MAWS's Markdown — never MAWS's IPC defaults, which the desk does not load.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Delivery, LogEvent } from 'desk-hub/protocol';
import { VECTOR_PROJECT as PROJECT } from '../../../test/vectors';
import { memoryLogRecord } from '../../log/record';
import { ProjectConnection } from '../../project/connection';
import { deliveryKey } from '../../project/conversation';
import type { DeskSession } from '../../shell/sessions';
import { useGrid } from '../../state/grid';
import { DeskContext } from './desk-context';
import { StreamView } from './StreamView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

it('names who posted each human message: you, another member by id, or a human at a machine', () => {
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
  const who = screen.getAllByTestId('said-who');
  expect(who.map((e) => e.textContent)).toEqual(['You', 'Another member (a1b2c3d4)', 'A human']);
  expect(who[2].parentElement!.textContent).toContain('@mini');
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

// The org directory's §6: a cross-project message is in both timelines — the sender's copy, marked with its destination
// (never as a message to the sender's own group), and the delivering event, marked with its origin — each project named
// as the grid names it.
it("marks the sender's copy with its destination and the delivering event with its origin, by the projects' names", () => {
  const connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  const [THERE, ELSEWHERE] = ['a5c3c1de-7a5e-5d2b-9f3a-2c6b7e1d4f20', 'c0ffee00-0000-4000-8000-000000000000'];
  useGrid.setState({ projects: [{ id: THERE, name: 'mini', kind: 'machine', machines: 1, machines_online: 1, working: 0, waiting: 0 }] });
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
