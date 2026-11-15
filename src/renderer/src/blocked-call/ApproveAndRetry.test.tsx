// UX wave U1c, M3 (the U1c document, Design 4 to 7, Interfaces §D to §G; Acceptance 1, 2, 7 to 13, 16): "Approve and
// retry" as a row draws it. The rows are the store's, from the recordings where one holds the case (probe U1's blocks,
// probe D's subagent), the control is the one the app registers, and every press goes through the session's own port
// to a bridge whose sends answer on command, under fake timers, so the store between the press and the record is seen
// at each step.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonObject } from 'desk-hub/protocol';
import { consentMessage } from '@shared/engine/arrival';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, MessageUuid, ParentToolUseId, SessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import type { JournalRow } from '@shared/wire/journal';
import { humanTurn, record, remoteRow, status, T0 } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { FIXTURE_DIR, loadUxwaveJournal } from '../../../../test/support/fixtures';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { freshSource, subagentLookupOf } from '../lane-a/plane-transcript';
import { laneAState } from '../lane-a/test-support/lane-a-state';
import { applyRemoteSession, resetRemoteLaneBStore } from '../lane-b/remote-session';
import { ALL_OPEN, remoteSessionState } from '../lane-b/test-support/remote-session';
import { LANE_A_WORDS } from '../session/controls/lane-a';
import { applyLaneAState, resetLaneAStore } from '../stores/lane-a';
import { useMachines } from '../stores/machines';
import { resetQueueStore, useQueueStore, type SessionQueue } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../stores/transcript';
import { journalToEvents } from '../transcript/dev/journal';
import { BLOCKED } from '../transcript/model/copy';
import type { Cell, Row } from '../transcript/model/rows';
import { builder, type Builder } from '../transcript/model/test-events';
import type { TranscriptSource } from '../transcript/source/types';
import { NO_ACTIONS } from '../transcript/view/context';
import { registeredActions } from '../transcript/view/registry';
import { renderRow } from '../transcript/view/rows/test-support';
import { Transcript } from '../transcript/view/Transcript';
import { resetGrantsOut, SETTLE_MS } from './grants';
import { registerBlockedCalls } from './index';

const MARKER = 'curl -s -o marker-1.txt "https://example.com/?maws-probe-marker-1"';
const UUID = '11111111-1111-4111-8111-111111111111' as MessageUuid;
const OPENING = 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: ';
const blockedText = `${OPENING}The server-side auto mode classifier judged this action dangerous (it gave no explanation). If you have other tasks that don't depend on this action, continue working on those.`;

// ---- the session and its bridge ---------------------------------------------------------------------------------------

let fake: FakeClient;
let unregister: () => void;
beforeEach(() => {
  resetGrantsOut();
  resetQueueStore();
  resetLaneAStore();
  resetRemoteLaneBStore();
  useSessions.setState({ records: new Map(), engine: new Map(), listed: new Map(), listedMachines: new Set() });
  useTranscriptStore.setState({ entries: {} });
  fake = fakeClient({ 'session.queue.list': { entries: [], paused: false } });
  window.maws = fake.client as unknown as PreloadBridge;
  unregister = registerBlockedCalls();
});
afterEach(() => {
  unregister();
  cleanup();
  vi.useRealTimers();
  resetGrantsOut();
  delete (window as { maws?: PreloadBridge }).maws;
});

const ready = (id: AppSessionId, over: Parameters<typeof status>[1] = {}) => useSessions.getState().applyStatus({ appSessionId: id, status: status(id, over) }, TEST_MACHINE);
const onTerminal = (id: AppSessionId, turn = { running: false, unknown: false }) => {
  useSessions.setState({ records: new Map([[id, record(id, { holder: { kind: 'terminal', pid: 42 } })]]) });
  applyLaneAState(id, laneAState(id, { turn }));
};
const queueOf = (id: AppSessionId, over: Partial<SessionQueue>) =>
  useQueueStore.setState((s) => ({ bySession: new Map(s.bySession).set(id, { entries: [], paused: false, pauseReason: null, steers: [], withdrawn: [], loaded: true, ...over }) }));
const entry = (id: AppSessionId, content: string, over: Partial<QueueEntry> = {}): QueueEntry => ({
  queueId: 'q-1', appSessionId: id, content, createdAt: T0, state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false, ...over,
});

/** Lets the press's chain of promises run (the port's reads, the bridge's invocation) without moving the clock. */
const flush = () => act(async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
});
/** The bridge answers the oldest unanswered `name`, under fake timers. */
async function answer(name: 'session.send' | 'session.steer' | 'session.steer.cancel' | 'session.queue.remove', value: unknown) {
  await act(async () => {
    const answered = fake.reply(name, value);
    await vi.advanceTimersByTimeAsync(0);
    await answered;
  });
  await flush();
}
async function refuse(name: 'session.send', message: string) {
  await act(async () => {
    const answered = fake.fail(name, message);
    await vi.advanceTimersByTimeAsync(0);
    await answered;
  });
  await flush();
}
const sent = (name: 'session.send' | 'session.steer' = 'session.send') => fake.invoked(name) as { content: unknown; priority?: string }[];

// ---- the transcript ---------------------------------------------------------------------------------------------------

/** A store key hydrated with `events`, and a push for later batches, at the address `key`. */
async function storeAt(key: string, events: SessionEvent[], agentId: AgentId | null = null) {
  let listener: ((batch: SessionEvent[]) => void) | null = null;
  const source: TranscriptSource = {
    key,
    ...(agentId !== null && { agentId }),
    subscribe(l) {
      listener = l;
      return () => (listener = null);
    },
    snapshot: () => Promise.resolve(events),
  };
  await useTranscriptStore.getState().attach(key, source, agentId === null ? undefined : { agentId });
  useTranscriptStore.getState().expandAll(key);
  return {
    key: key as AppSessionId,
    source,
    rows: () => useTranscriptStore.getState().rows(key),
    push: (batch: SessionEvent[]) => act(() => listener?.(batch)),
  };
}
type Store = Awaited<ReturnType<typeof storeAt>>;

const cellsOf = (rows: Row[]): Cell[] => rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));
const blockedIds = (store: Store) => cellsOf(store.rows()).filter((cell) => cell.classification.denial?.kind === 'automode-blocked').map((cell) => cell.id);
const rowHolding = (store: Store, id: string) => store.rows().find((row) => row.id === id || (row.kind === 'group' && row.cells.some((cell) => cell.id === id)))!;

/** The row that holds the cell, drawn as a session's own transcript draws it, with the app's registered actions. */
function drawn(store: Store, id: string, over: Partial<{ rewrite: (cell: Cell) => Cell; actions: typeof NO_ACTIONS }> = {}) {
  const row = rowHolding(store, id);
  const shown = over.rewrite ? (row.kind === 'cell' ? over.rewrite(row) : { ...row, cells: (row as Extract<Row, { kind: 'group' }>).cells.map((cell) => (cell.id === id ? over.rewrite!(cell) : cell)) }) : row;
  const view = renderRow(shown as Row, { storeKey: store.key, actions: over.actions ?? registeredActions() });
  const cell = () => view.container.querySelector<HTMLElement>(`[data-cell-id="${id}"]`)!;
  return {
    ...view,
    cell,
    line: () => cell().querySelector<HTMLElement>(':scope > .transcript-cell-line')!.textContent,
    button: () => within(cell()).queryByRole('button', { name: BLOCKED.approve }) as HTMLButtonElement | null,
    subject: () => cell().querySelector('.transcript-blocked-subject')?.textContent ?? null,
    statuses: () => within(cell()).queryAllByRole('status').map((line) => line.textContent),
  };
}

// One turn, its blocked commands and, optionally, a call still running after them (the turn open).
function blockedTurn(commands: readonly string[], options: { running?: boolean; stopped?: boolean } = {}): Builder {
  const b = builder();
  b.turn('u1');
  commands.forEach((command, i) => {
    b.toolUse(`t${i + 1}`, 'Bash', { command });
    b.result(`t${i + 1}`, blockedText, { isError: true, denial: 'automode-blocked' });
  });
  if (options.running) b.toolUse('t-held', 'Bash', { command: 'sleep 30' });
  else b.end(['u1'], options.stopped ? { terminalReason: 'aborted_streaming', isError: true, result: 'error_during_execution' } : {});
  return b;
}
const grantMessage = (b: Builder, u: string, subject: string) => {
  b.emit('turn.started', { userMessageUuid: u as MessageUuid, origin: 'human' });
  b.emit('user.message', { messageUuid: u as MessageUuid, content: consentMessage('command', subject), isReplay: false, isSynthetic: false, origin: 'human', bash: null, arrival: [{ class: 'consent', kind: 'command', subject }] });
};

// ---- the recording ----------------------------------------------------------------------------------------------------

const frameOf = (row: JournalRow) => row.frame as { type?: string; message?: { content?: unknown } };
const isGrantFrame = (row: JournalRow) => row.direction === 'out' && frameOf(row).type === 'user' && typeof frameOf(row).message?.content === 'string' && (frameOf(row).message!.content as string).startsWith('Permission granted');
const seqOf = (event: SessionEvent) => Number((event.id as string).split(':')[2]);
/** A recording up to the frame MAWS wrote for its grant, the rest of it, and that frame's content. */
function recorded(name: string) {
  const journal = loadUxwaveJournal(name);
  const grant = journal.find(isGrantFrame)!;
  const events = journalToEvents(journal);
  return { before: events.filter((event) => seqOf(event) < grant.seq), after: events.filter((event) => seqOf(event) >= grant.seq), content: frameOf(grant).message!.content as string };
}

describe('the button beside its whole subject (Design 6; Acceptance 1, 13)', () => {
  it('u1-soft-seeded-1, idle: the line wraps the whole command and the button stands under it; the press sends the recorded grant byte for byte; the record then approves the row and the button goes', async () => {
    const recording = recorded('u1-soft-seeded-1');
    const store = await storeAt(at('soft-1'), recording.before);
    ready(store.key);
    const [id] = blockedIds(store);
    const row = drawn(store, id!);
    expect(row.line()).toBe(`Auto mode blocked: ${MARKER}`);
    expect(row.cell().hasAttribute('data-names-whole')).toBe(true);
    expect(row.subject(), 'no subject block where the line names it').toBeNull();
    expect(row.button()!.disabled).toBe(false);
    expect(row.button()!.title).toBe('');
    vi.useFakeTimers();
    fireEvent.click(row.button()!);
    await flush();
    expect(sent()).toEqual([{ appSessionId: 'soft-1', content: recording.content }]);
    expect(recording.content).toBe(consentMessage('command', MARKER));
    expect(row.button()!.disabled, 'sending').toBe(true);
    await answer('session.send', { disposition: 'sent', messageUuid: UUID, queueId: 'q-1' });
    expect(row.button()!.disabled, 'delivered, the record not yet').toBe(true);
    await store.push(recording.after);
    expect(row.line()).toBe(`Auto mode blocked: ${MARKER} · approved`);
    expect(row.button()).toBeNull();
    expect(row.cell().hasAttribute('data-names-whole')).toBe(false);
  });

  it('a command of several lines, and one that holds a backtick, stand whole in the subject’s block, equal to the string the grant quotes, the button under it', async () => {
    const commands = ['make build &&\n  make test', 'echo `date`'];
    const store = await storeAt(at('blocks'), blockedTurn(commands).events);
    ready(store.key);
    vi.useFakeTimers();
    for (const [i, id] of blockedIds(store).entries()) {
      const row = drawn(store, id);
      expect(row.cell().hasAttribute('data-names-whole')).toBe(false);
      expect(row.subject()).toBe(commands[i]);
      const block = row.cell().querySelector('.transcript-blocked-subject')!;
      expect(block.compareDocumentPosition(row.button()!) & Node.DOCUMENT_POSITION_FOLLOWING, 'the button under the block').toBeTruthy();
      fireEvent.click(row.button()!);
      await flush();
      await answer('session.send', { disposition: 'sent', messageUuid: UUID, queueId: 'q-1' });
      row.unmount();
    }
    expect(sent().map((send) => send.content)).toEqual(commands.map((command) => consentMessage('command', command)));
  });

  it('the bound of the line: a command of 200 characters on the line, one of 201 in the block', async () => {
    const commands = [`echo ${'a'.repeat(195)}`, `echo ${'b'.repeat(196)}`];
    expect(commands.map((command) => command.length)).toEqual([200, 201]);
    const store = await storeAt(at('bound'), blockedTurn(commands).events);
    ready(store.key);
    const [short, long] = blockedIds(store).map((id) => drawn(store, id));
    expect([short!.cell().hasAttribute('data-names-whole'), short!.subject()]).toEqual([true, null]);
    expect([long!.cell().hasAttribute('data-names-whole'), long!.subject()]).toEqual([false, commands[1]]);
  });

  it('two rows whose lines draw the same command while their recorded commands differ each show their own subject in a block and each send their own (the name is the store’s, never the drawn cell’s)', async () => {
    const commands = ['rm -rf build', 'rm -rf build '];
    const store = await storeAt(at('rewritten'), blockedTurn(commands).events);
    ready(store.key);
    vi.useFakeTimers();
    // a mod's rewrite draws both calls as one plain command
    const rewrite = (cell: Cell): Cell => (cell.detail.kind === 'shell' ? { ...cell, detail: { ...cell.detail, command: 'rm -rf build ' } } : cell);
    for (const [i, id] of blockedIds(store).entries()) {
      const row = drawn(store, id, { rewrite });
      expect(row.cell().hasAttribute('data-names-whole'), id).toBe(false);
      expect(row.subject(), id).toBe(commands[i]);
      fireEvent.click(row.button()!);
      await flush();
      await answer('session.send', { disposition: 'sent', messageUuid: UUID, queueId: 'q-1' });
      row.unmount();
    }
    expect(sent().map((send) => send.content)).toEqual(commands.map((command) => consentMessage('command', command)));
  });
});

describe('blocked again (Acceptance 2)', () => {
  it('u1-hard-seeded-1: the approved row has no button; the retry’s row reads “Auto mode blocked again”, carries the button and the one muted line under it', async () => {
    const store = await storeAt(at('hard-1'), journalToEvents(loadUxwaveJournal('u1-hard-seeded-1')));
    ready(store.key);
    const [first, retry] = blockedIds(store).map((id) => drawn(store, id));
    expect(first!.line()).toBe(`Auto mode blocked: ${MARKER} · approved`);
    expect(first!.button()).toBeNull();
    expect(retry!.line()).toBe(`Auto mode blocked again: ${MARKER}`);
    expect(retry!.button()!.disabled).toBe(false);
    expect(retry!.statuses()).toEqual([BLOCKED.always.command]);
  });
});

describe('the gate’s precedence (Design 6): approved over closed and unavailable', () => {
  it('a row that reads approved draws no button whatever else holds: a grant the queue lists, a session no port drives', async () => {
    const store = await storeAt(at('approved-first'), journalToEvents(loadUxwaveJournal('u1-hard-seeded-1')));
    const [approved, retry] = blockedIds(store);
    act(() => queueOf(store.key, { entries: [entry(store.key, consentMessage('command', MARKER))] }));
    expect(drawn(store, approved!).button(), 'closed').toBeNull();
    expect(drawn(store, retry!).button()!.disabled, 'the retry’s row: closed').toBe(true);
    cleanup();
    act(() => queueOf(store.key, { entries: [] }));
    useSessions.setState({ records: new Map([[store.key, record(store.key, { holder: { kind: 'terminal', pid: 42 } })]]) });
    expect(drawn(store, approved!).button(), 'unavailable').toBeNull();
    expect(drawn(store, retry!).button()!.title, 'the retry’s row: unavailable').toMatch(/^Held by /);
  });
});

describe('the press and the grant that is out (Design 4; Acceptance 9, 10)', () => {
  async function oneBlock(name: string, commands = ['make build']) {
    const store = await storeAt(at(name), blockedTurn(commands).events);
    ready(store.key);
    vi.useFakeTimers();
    return store;
  }

  it('a second press does not send twice: on the same row, while the send is unanswered', async () => {
    const store = await oneBlock('same-row');
    const row = drawn(store, blockedIds(store)[0]!);
    fireEvent.click(row.button()!);
    fireEvent.click(row.button()!);
    await flush();
    fireEvent.click(row.button()!);
    await flush();
    expect(sent()).toHaveLength(1);
    expect(row.button()!.disabled).toBe(true);
  });

  it('a second press does not send twice: on another row of the same key', async () => {
    const store = await oneBlock('same-key', ['make build', 'make build']);
    const [one, two] = blockedIds(store).map((id) => drawn(store, id));
    fireEvent.click(one!.button()!);
    await flush();
    expect(two!.button()!.disabled).toBe(true);
    fireEvent.click(two!.button()!);
    await flush();
    expect(sent()).toHaveLength(1);
  });

  it('a second press does not send twice: on the row unmounted and mounted again while the send is unanswered', async () => {
    const store = await oneBlock('remounted');
    const id = blockedIds(store)[0]!;
    const first = drawn(store, id);
    fireEvent.click(first.button()!);
    await flush();
    first.unmount();
    const again = drawn(store, id);
    expect(again.button()!.disabled).toBe(true);
    fireEvent.click(again.button()!);
    await flush();
    expect(sent()).toHaveLength(1);
  });

  it('a row does not read approved from a press alone: the send answered and the transcript’s row withheld, the button stays closed while the queue lists the grant and SETTLE_MS after it stops, then returns; the row never reads approved', async () => {
    const store = await oneBlock('withheld');
    const row = drawn(store, blockedIds(store)[0]!);
    fireEvent.click(row.button()!);
    await flush();
    await answer('session.send', { disposition: 'queued', messageUuid: null, queueId: 'q-1' });
    act(() => queueOf(store.key, { entries: [entry(store.key, consentMessage('command', 'make build'))] }));
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_MS * 3));
    expect(row.button()!.disabled, 'listed in the queue: the clock is stopped').toBe(true);
    expect(row.line()).toBe('Auto mode blocked: make build');
    act(() => queueOf(store.key, { entries: [] }));
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_MS - 1));
    expect(row.button()!.disabled, 'just before the clock runs out').toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(row.button()!.disabled, 'the clock ran out with no row').toBe(false);
    expect(row.line()).toBe('Auto mode blocked: make build');
    expect(sent()).toHaveLength(1);
  });

  it('when the transcript shows the grant’s row, the row follows the record at once: waiting, then approved', async () => {
    const store = await oneBlock('follows');
    const row = drawn(store, blockedIds(store)[0]!);
    fireEvent.click(row.button()!);
    await flush();
    await answer('session.send', { disposition: 'sent', messageUuid: UUID, queueId: 'q-1' });
    const b = builder('2026-09-28T11:00:00.000Z');
    grantMessage(b, UUID, 'make build');
    await store.push(b.events);
    expect(row.line()).toBe('Auto mode blocked: make build · approved');
    expect(row.button()).toBeNull();
  });

  it('a window that never pressed draws the button disabled while the queue’s snapshot lists a grant for the key, and not for another key', async () => {
    const store = await oneBlock('other-window', ['make build', 'make check']);
    const [build, check] = blockedIds(store).map((id) => drawn(store, id));
    act(() => queueOf(store.key, { entries: [entry(store.key, consentMessage('command', 'make build'))] }));
    expect(build!.button()!.disabled).toBe(true);
    expect(check!.button()!.disabled).toBe(false);
    act(() => queueOf(store.key, { entries: [] }));
    expect(build!.button()!.disabled).toBe(false);
  });

  it('a refused press says why: the answer’s words under the button, which stays enabled, in a row mounted afresh too; the next press clears them', async () => {
    const store = await oneBlock('refused');
    const id = blockedIds(store)[0]!;
    const row = drawn(store, id);
    fireEvent.click(row.button()!);
    await flush();
    await refuse('session.send', 'The engine host could not take the message');
    expect(row.button()!.disabled).toBe(false);
    expect(row.statuses()).toEqual(['The engine host could not take the message']);
    row.unmount();
    const fresh = drawn(store, id);
    expect(fresh.statuses()).toEqual(['The engine host could not take the message']);
    fireEvent.click(fresh.button()!);
    await flush();
    expect(fresh.statuses()).toEqual([]);
    expect(sent()).toHaveLength(2);
  });
});

describe('while the grant waits, during a turn (Design 5; Acceptance 11 at GRANT_DURING_TURN’s value)', () => {
  it('after the turn: the press is one session.send kept for after the turn; the button stays closed while the queue holds it, after a fresh mount too; Delete takes it out and the button returns when the clock has run', async () => {
    const store = await storeAt(at('busy-after'), blockedTurn(['make build'], { running: true }).events);
    ready(store.key, { turn: humanTurn });
    vi.useFakeTimers();
    const id = blockedIds(store)[0]!;
    const row = drawn(store, id);
    fireEvent.click(row.button()!);
    await flush();
    expect(sent('session.steer')).toEqual([]);
    expect(sent()).toEqual([{ appSessionId: 'busy-after', content: consentMessage('command', 'make build') }]);
    await answer('session.send', { disposition: 'queued', messageUuid: null, queueId: 'q-1' });
    act(() => queueOf(store.key, { entries: [entry(store.key, consentMessage('command', 'make build'))] }));
    row.unmount();
    const fresh = drawn(store, id);
    expect(fresh.button()!.disabled, 'a waiting grant, mounted afresh').toBe(true);
    act(() => queueOf(store.key, { entries: [] })); // Delete took the entry out of the queue
    expect(fresh.button()!.disabled).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_MS));
    expect(fresh.button()!.disabled).toBe(false);
  });
});

describe('where there is no button, and where it is disabled (Acceptance 7 as shipped, 8, 12, 16)', () => {
  it('a mount that supplies no control (the desk’s web app, the harness) draws the short label, no button and no block', async () => {
    const store = await storeAt(at('no-control'), blockedTurn(['make build &&\nmake test']).events);
    ready(store.key);
    const row = drawn(store, blockedIds(store)[0]!, { actions: NO_ACTIONS });
    expect(row.line()).toBe('Auto mode blocked: make build &&\nmake test');
    expect(row.button()).toBeNull();
    expect(row.subject()).toBeNull();
    expect(row.cell().hasAttribute('data-names-whole')).toBe(false);
  });

  it('a row of a rewound branch, a blocked call with no name, and a call the classifier could not judge draw no button', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'make build', run_in_background: true });
    b.result('t1', blockedText, { isError: true, denial: 'automode-blocked' });
    b.toolUse('t2', 'Bash', { command: 'make check' });
    b.result('t2', 'unreadable', { isError: true, denial: 'automode-parsing-error' });
    b.toolUse('t3', 'mcp__files__run', { command: 'make build' });
    b.result('t3', blockedText, { isError: true, denial: 'automode-blocked' });
    b.end(['u1']);
    const store = await storeAt(at('no-name'), b.events);
    ready(store.key);
    for (const cell of cellsOf(store.rows()).filter((cell) => cell.classification.denial !== null)) expect(drawn(store, cell.id).button(), cell.id).toBeNull();
  });

  it.each([
    ['idle', { running: false, unknown: false }],
    ['running', { running: true, unknown: false }],
    ['stopped', { running: false, unknown: false }],
  ] as const)('a terminal session, %s, with no state offered: the button disabled, its title “Not available for a terminal session”, and a press sends nothing to the bridge', async (state, turn) => {
    const b = blockedTurn(['make build'], { running: state === 'running', stopped: state === 'stopped' });
    const store = await storeAt(at(`terminal-${state}`), b.events);
    onTerminal(store.key, turn);
    const row = drawn(store, blockedIds(store)[0]!);
    expect(row.button()!.disabled).toBe(true);
    expect(row.button()!.title).toBe(LANE_A_WORDS.widget);
    fireEvent.click(row.button()!);
    await flush();
    expect(fake.invoked('laneA.send')).toEqual([]);
  });

  it('a terminal session before its bridge is live: the button disabled, its title the holder’s words', async () => {
    const store = await storeAt(at('terminal-held'), blockedTurn(['make build']).events);
    useSessions.setState({ records: new Map([[store.key, record(store.key, { holder: { kind: 'terminal', pid: 42 } })]]) });
    const row = drawn(store, blockedIds(store)[0]!);
    expect(row.button()!.disabled).toBe(true);
    expect(row.button()!.title).toMatch(/^Held by /);
  });

  it('another machine’s session: with the overlay’s send closed the button is disabled and its title is the overlay’s reason', async () => {
    const remote = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: T0, generation: 0 }]);
    useSessions.setState({ listed: new Map([[remote, { ...remoteRow(OTHER_MACHINE, 'app-r', { lane: 'B' }), appId: remote }]]), listedMachines: new Set([OTHER_MACHINE]), records: new Map([[remote, record(remote)]]) });
    applyRemoteSession(remoteSessionState(remote, { controls: { ...ALL_OPEN, send: { available: false, reason: 'Studio’s link is down' } } }));
    const store = await storeAt(remote, blockedTurn(['make build']).events);
    const row = drawn(store, blockedIds(store)[0]!);
    expect(row.button()!.disabled).toBe(true);
    expect(row.button()!.title).toBe('Studio’s link is down');
  });
});

// Ruling J, Decision Log 25: a subagent's blocked row carries a name from its own transcript file and through another
// machine's rows, so the check of the transcript's variant is the only thing that keeps a button off it. Probe D's
// `u1c-d-after-1`, the subagent's own transcript file (its blocked call is line 24), by both routes, mounted as a child's
// transcript is (the drill-in, and another machine's agent transcript, `RemoteAgentTranscript`); and the same store row
// drawn as a session's own row would be, which carries the button, so the absence is the variant's.
describe('a subagent’s rows (ruling J; Acceptance 12)', () => {
  const SESSION = '0f0e0d0c-0000-4000-8000-00000000c0de';
  const CHILD = 'a76ce748bb105e7a4' as AgentId;
  const LAUNCH = 'toolu_01TnEruuyhgcF3zMSUG4zE1T' as ParentToolUseId;
  const childText = readFileSync(join(FIXTURE_DIR, 'uxwave', `u1c-d-after-1.agent-${CHILD}.transcript.jsonl`), 'utf8');
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (this.hasAttribute('data-transcript-scroller')) return 4000;
        if (this.hasAttribute('data-index')) return 40;
        return 0;
      },
    });
  });
  afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

  async function fromFile(): Promise<SessionEvent[]> {
    const events: SessionEvent[] = [];
    const follower = new ChainFollower(new MemoryFileReader(childText), SESSION as SessionId, { agentId: CHILD, parentToolUseId: LAUNCH }, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
    await follower.start();
    follower.stop();
    return events;
  }
  const fromRows = (): Promise<SessionEvent[]> =>
    freshSource(childText.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as JsonObject).filter((row) => typeof row.uuid === 'string'), SESSION, subagentLookupOf([]), CHILD).snapshot();

  async function mountedAsChild(name: string, events: SessionEvent[]) {
    const parent = at(name) as AppSessionId;
    ready(parent);
    const store = await storeAt(`${parent}:${CHILD}`, events, CHILD);
    const [id] = blockedIds(store);
    expect(id, 'the subagent’s blocked call is a blocked row with a name on this route').toBeDefined();
    expect(cellsOf(store.rows()).find((cell) => cell.id === id)!.blocked).toEqual({ kind: 'command', subject: MARKER });
    const view = render(<Transcript source={store.source} variant="child" actions={registeredActions()} />);
    await flush();
    act(() => useTranscriptStore.getState().expandAll(store.key));
    const cell = view.container.querySelector<HTMLElement>(`[data-cell-id="${id}"]`);
    expect(cell, 'the blocked row is drawn').not.toBeNull();
    expect(cell!.querySelector(':scope > .transcript-cell-line')!.textContent).toBe(`Auto mode blocked: ${MARKER}`);
    return { store, id: id!, view, cell: cell! };
  }

  it('u1c-d-after-1, the subagent’s own transcript file, mounted as a child’s transcript: the blocked row and no button', async () => {
    const { store, id, view, cell } = await mountedAsChild('child-file', await fromFile());
    expect(within(cell).queryByRole('button', { name: BLOCKED.approve })).toBeNull();
    expect(view.container.querySelector('.transcript-blocked')).toBeNull();
    view.unmount();
    expect(drawn(store, id).button(), 'the same row in a session’s own transcript').not.toBeNull();
  });

  it('u1c-d-after-1, the subagent’s rows as another machine’s rows give them, mounted as a child’s transcript: the blocked row and no button', async () => {
    const { store, id, view, cell } = await mountedAsChild('child-link', await fromRows());
    expect(within(cell).queryByRole('button', { name: BLOCKED.approve })).toBeNull();
    expect(view.container.querySelector('.transcript-blocked')).toBeNull();
    view.unmount();
    expect(drawn(store, id).button(), 'the same row in a session’s own transcript').not.toBeNull();
  });
});
