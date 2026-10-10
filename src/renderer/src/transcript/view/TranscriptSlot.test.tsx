// The actions registry and the TranscriptSlot (C8's ask, Public surface): each later child contributes its callbacks
// from its own block; the slot mounts one Transcript over the session's IPC source with those callbacks merged over the
// defaults, and re-renders when they change.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { MawsBridge } from '@shared/ipc/schema';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { resetQueueStore } from '../../stores/queue';
import { useSessions } from '../../stores/sessions';
import { DEFAULT_ACTIONS, registerRequestRenderer, registerTranscriptActions, TranscriptSlot, useTranscriptStore } from '../index';
import { BASH_RESULT, builder, request, tool } from '../model/test-events';
import type { Row } from '../model/rows';
import { registeredActions } from './registry';

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  // happy-dom has no layout: a viewport for the scroller and a height per row, so the virtualiser mounts rows.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-transcript-scroller') ? 2000 : this.hasAttribute('data-index') ? 40 : 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

// No case waits on a clock (L79). The slot renders through its lazy chunk (`lazy.tsx`), whose first import is real
// module loading that the machine's load can stretch past any poll's deadline, so the chunk is loaded before the cases.
// After that, everything a render or an event sets off is promise-chained (the fake IPC's answers, the store's batches,
// React's renders and effects): `settle` drains it inside act by yielding the event loop once, and the expectation is
// read once, so load can slow a case but not fail it.
beforeAll(async () => {
  await Promise.all([import('./TranscriptSlot'), import('./Transcript'), import('./markdown/Markdown')]);
});
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const disposers: (() => void)[] = [];
const register = (partial: Parameters<typeof registerTranscriptActions>[0]) => {
  const dispose = registerTranscriptActions(partial);
  disposers.push(dispose);
  return dispose;
};
afterEach(() => {
  cleanup();
  for (const dispose of disposers.splice(0)) dispose();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  resetQueueStore();
  delete (window as { maws?: MawsBridge }).maws;
});

describe('registerTranscriptActions', () => {
  it('merges registrations over the defaults: a later registration of a key wins, its disposer restores the earlier one, a disposed key falls back to the default', () => {
    expect(registeredActions()).toEqual(DEFAULT_ACTIONS);
    const openFile = vi.fn();
    const openSubagent = vi.fn();
    const later = vi.fn();
    register({ openFile });
    register({ openSubagent });
    expect(registeredActions()).toMatchObject({ openFile, openSubagent, loadSpill: DEFAULT_ACTIONS.loadSpill });
    const disposeLater = register({ openFile: later });
    expect(registeredActions().openFile).toBe(later);
    disposeLater();
    disposeLater(); // a disposer runs once
    expect(registeredActions().openFile).toBe(openFile);
    disposers.shift()!();
    expect(registeredActions().openFile).toBe(DEFAULT_ACTIONS.openFile);
    expect(registeredActions().openSubagent).toBe(openSubagent);
    expect(registeredActions()).toBe(registeredActions()); // stable between changes
  });
});

describe('TranscriptSlot', () => {
  const APP = 'app-slot' as AppSessionId;
  const EMPTY = { entries: [], paused: false, pauseReason: null, steers: [], withdrawn: [] };
  function history(): SessionEvent[] {
    const b = builder();
    b.turn('u1', 'Open the file');
    b.text('m1', 0, 'See [the file](src/a.ts).');
    b.end(['u1']);
    return b.events;
  }

  it('renders the session’s rows from its IPC source, with every registered action reaching the rendered Transcript', async () => {
    const invoke = vi.fn((name: string) =>
      Promise.resolve(
        name === 'session.events'
          ? { ok: true, value: { events: history(), lastSeq: 3, complete: true } }
          : name === 'session.appEvents'
            ? { ok: true, value: { events: [] } }
            : name === 'session.queue.list'
              ? { ok: true, value: EMPTY }
              : { ok: false, error: { code: 'internal', message: 'unexpected' } },
      ),
    );
    (window as { maws?: MawsBridge }).maws = { invoke, on: vi.fn(() => () => {}) } as unknown as MawsBridge;
    render(<TranscriptSlot appSessionId={APP} className="slot" />);
    await settle();
    expect(screen.getByRole('region', { name: 'Your message' })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('session.events', { appSessionId: APP, afterSeq: null, limit: null });
    expect(document.querySelector('[data-kind="assistant_text"]')?.textContent).toContain('See the file');

    const editAndResubmit = vi.fn();
    const openFile = vi.fn();
    act(() => {
      register({ editAndResubmit });
      register({ openFile });
    });
    fireEvent.click(screen.getByTitle('Edit here · Send rewinds this session to this message'));
    expect(editAndResubmit).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector<HTMLElement>('[data-chip="path"]')!);
    expect(openFile).toHaveBeenCalledWith('src/a.ts', undefined);

    const again = vi.fn();
    let dispose = () => {};
    act(() => {
      dispose = register({ openFile: again });
    });
    fireEvent.click(document.querySelector<HTMLElement>('[data-chip="path"]')!);
    expect(again).toHaveBeenCalledTimes(1);
    act(() => dispose());
    fireEvent.click(document.querySelector<HTMLElement>('[data-chip="path"]')!);
    expect(openFile).toHaveBeenCalledTimes(2);
  });

  it('tells the Transcript where the session runs, from its record: a shell call with no cwd shows the worktree’s checkout', async () => {
    const id = 'app-slot-shell' as AppSessionId;
    const b = builder();
    b.turn('u1', 'List it');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'a', { structured: BASH_RESULT('a') });
    b.end(['u1']);
    const records = useSessions.getState().records;
    act(() => useSessions.setState({ records: new Map([[id, { directory: '/w/project', worktree: { path: '/w/project-wt', branch: 'wt' } } as unknown as SessionRecord]]) }));
    onTestFinished(() => useSessions.setState({ records }));
    const invoke = vi.fn((name: string) => Promise.resolve({ ok: true, value: name === 'session.queue.list' ? EMPTY : name === 'session.appEvents' ? { events: [] } : { events: b.events, lastSeq: 3, complete: true } }));
    (window as { maws?: MawsBridge }).maws = { invoke, on: vi.fn(() => () => {}) } as unknown as MawsBridge;
    render(<TranscriptSlot appSessionId={id} />);
    await settle();
    expect(useTranscriptStore.getState().entries[id]?.phase).toBe('live');
    act(() => useTranscriptStore.getState().expandAll(id, { cells: true }));
    await settle();
    expect(document.querySelector('.transcript-shell-meta')?.textContent).toBe('Session directory /w/project-wt');
  });

  // A child agent's shell may have run in its own worktree, so its transcript names no directory it cannot vouch for.
  it('tells a child agent’s Transcript no session directory', async () => {
    const id = 'app-slot-child-shell' as AppSessionId;
    const agent = 'agent-shell' as AgentId;
    const c = builder();
    c.turn('c1', 'List it');
    c.toolUse('t1', 'Bash', { command: 'ls' });
    c.result('t1', 'a', { structured: BASH_RESULT('a') });
    c.end(['c1']);
    const events = c.events.map((event) => ({ ...event, agentId: agent }));
    const records = useSessions.getState().records;
    act(() => useSessions.setState({ records: new Map([[id, { directory: '/w/project', worktree: null } as unknown as SessionRecord]]) }));
    onTestFinished(() => useSessions.setState({ records }));
    const invoke = vi.fn((name: string) =>
      Promise.resolve(
        name === 'session.events' || name === 'session.appEvents' ? { ok: true, value: { events: [], lastSeq: 0, complete: true } } : { ok: true, value: { events, complete: true } },
      ),
    );
    (window as { maws?: MawsBridge }).maws = { invoke, on: vi.fn(() => () => {}) } as unknown as MawsBridge;
    render(<TranscriptSlot appSessionId={id} agentId={agent} />);
    const key = `${id}:${agent}`;
    await settle();
    expect(useTranscriptStore.getState().entries[key]?.phase).toBe('live');
    act(() => useTranscriptStore.getState().expandAll(key, { cells: true }));
    await settle();
    expect(document.querySelector('.transcript-shell')).not.toBeNull();
    expect(document.querySelector('.transcript-shell-meta')).toBeNull();
    expect(invoke.mock.calls.map(([name]) => name)).not.toContain('session.queue.list'); // a child's transcript has no queue
  });

  // The held tail and the withdrawn-steer filter read C7's queue store, which the slot attaches itself: a session's
  // transcript shown without its composer follows the queue as it changes, and lets it go when it unmounts.
  it('attaches the session’s queue itself: mounted alone, its held tail follows the queue’s events', async () => {
    const id = 'app-slot-queue' as AppSessionId;
    const b = builder();
    b.turn('u1', 'Start the work');
    b.text('m1', 0, 'Working on it.');
    const held = (queueId: string, content: string) => ({ queueId, appSessionId: id, content, createdAt: '2026-10-01T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false });
    const listeners = new Set<(payload: unknown) => void>();
    const invoke = vi.fn((name: string) =>
      Promise.resolve({
        ok: true,
        value: name === 'session.queue.list' ? { ...EMPTY, entries: [held('q-1', 'Then run the tests')] } : name === 'session.appEvents' ? { events: [] } : { events: b.events, lastSeq: 3, complete: true },
      }),
    );
    const on = vi.fn((name: string, listener: (payload: unknown) => void) => {
      if (name !== 'session.queue') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    (window as { maws?: MawsBridge }).maws = { invoke, on } as unknown as MawsBridge;
    const { unmount } = render(<TranscriptSlot appSessionId={id} />);
    const heldTexts = () => [...document.querySelectorAll('[data-pending="held"]')].map((bubble) => bubble.querySelector('[data-bubble]')?.textContent);
    await settle();
    expect(heldTexts()).toEqual(['Then run the tests']);
    expect(invoke).toHaveBeenCalledWith('session.queue.list', { appSessionId: id });

    act(() => listeners.forEach((listener) => listener({ appSessionId: id, ...EMPTY, entries: [held('q-1', 'Then run the tests'), held('q-2', 'And commit')] })));
    await settle();
    expect(heldTexts()).toEqual(['Then run the tests', 'And commit']);
    act(() => listeners.forEach((listener) => listener({ appSessionId: id, ...EMPTY, entries: [held('q-2', 'And commit')] })));
    await settle();
    expect(heldTexts()).toEqual(['And commit']);

    unmount();
    expect(listeners.size).toBe(0); // the last attachment let the queue go
  });

  it('docks the latest registered request renderer in a pending request’s slot; its disposer restores the previous one, then the placeholder', async () => {
    const b = builder();
    b.turn('u1', 'Ask me');
    b.toolUse('q1', 'AskUserQuestion', { questions: [] });
    b.emit('question.requested', { requestId: request('r1'), toolUseId: tool('q1'), questions: [] });
    const invoke = vi.fn((name: string) => Promise.resolve({ ok: true, value: name === 'session.queue.list' ? EMPTY : name === 'session.appEvents' ? { events: [] } : { events: b.events, lastSeq: 3, complete: true } }));
    (window as { maws?: MawsBridge }).maws = { invoke, on: vi.fn(() => () => {}) } as unknown as MawsBridge;
    render(<TranscriptSlot appSessionId={'app-slot-request' as AppSessionId} />);
    const slot = () => document.querySelector<HTMLElement>('[data-kind="request_slot"]');
    await settle();
    expect(slot()?.textContent).toBe('Waiting for you · AskUserQuestion · answer in the composer');

    let disposeFirst = () => {};
    let disposeSecond = () => {};
    act(() => {
      disposeFirst = registerRequestRenderer((row) => <div data-card="first">{`First card ${row.requestId}`}</div>);
    });
    expect(slot()?.textContent).toBe('First card r1');
    act(() => {
      disposeSecond = registerRequestRenderer((row) => <div data-card="second">{`Second card ${row.requestKind}`}</div>);
    });
    expect(slot()?.textContent).toBe('Second card question');
    act(() => disposeSecond());
    expect(slot()?.textContent).toBe('First card r1');
    act(() => disposeFirst());
    expect(slot()?.textContent).toBe('Waiting for you · AskUserQuestion · answer in the composer');
    expect(slot()?.querySelector('[role="status"]')).not.toBeNull();
  });

  // P2-E1 (M2; ledger §5 row 3): the comment card's three options. `startAt` names the first row shown (none while it
  // answers null, and it is told whether the history is loaded); `actions` override the registered ones for this mount;
  // `presentation` reaches the rows' context. Without them the slot draws exactly as before.
  it('startAt, actions and presentation: the rows from startAt’s index (none while null), the overrides over the registered actions, the presentation on the context', async () => {
    const id = 'app-slot-card' as AppSessionId;
    const b = builder();
    b.turn('u1', 'The parent’s copied prompt');
    b.text('m1', 0, 'The parent’s copied answer.');
    b.end(['u1']);
    b.turn('u2', 'The thread’s own prompt');
    b.text('m2', 0, '<to-human>See [the file](src/a.ts).</to-human>');
    b.end(['u2']);
    const invoke = vi.fn((name: string) => Promise.resolve({ ok: true, value: name === 'session.queue.list' ? EMPTY : name === 'session.appEvents' ? { events: [] } : { events: b.events, lastSeq: 9, complete: true } }));
    (window as { maws?: MawsBridge }).maws = { invoke, on: vi.fn(() => () => {}) } as unknown as MawsBridge;
    const registered = vi.fn();
    const override = vi.fn();
    register({ openFile: registered });
    const seen: boolean[] = [];
    let index: number | null = null;
    const startAt = (rows: readonly Row[], loaded: boolean) => {
      seen.push(loaded);
      const own = rows.findIndex((row) => row.kind === 'user' && row.text === 'The thread’s own prompt');
      return index === null ? null : own;
    };
    const overrides = { openFile: override };
    const view = render(<TranscriptSlot appSessionId={id} startAt={startAt} actions={overrides} presentation="local" />);
    await settle();
    expect(useTranscriptStore.getState().entries[id]?.phase).toBe('live');
    expect(seen.at(-1)).toBe(true);
    expect(screen.queryAllByRole('region', { name: 'Your message' })).toEqual([]); // null: nothing yet

    index = 0;
    view.rerender(<TranscriptSlot appSessionId={id} startAt={(rows, loaded) => startAt(rows, loaded)} actions={overrides} presentation="local" />);
    await settle();
    expect(screen.getAllByRole('region', { name: 'Your message' })).toHaveLength(1);
    expect(document.body.textContent).toContain('The thread’s own prompt');
    expect(document.body.textContent).not.toContain('The parent’s copied');
    expect(document.querySelector('[data-owner-report]')).not.toBeNull(); // the local presenter
    fireEvent.click(document.querySelector<HTMLElement>('[data-chip="path"]')!);
    expect(override).toHaveBeenCalledWith('src/a.ts', undefined);
    expect(registered).not.toHaveBeenCalled();

    view.rerender(<TranscriptSlot appSessionId={id} />); // inert by default: every row, the registered action
    await settle();
    expect(screen.getAllByRole('region', { name: 'Your message' })).toHaveLength(2);
    fireEvent.click(document.querySelector<HTMLElement>('[data-chip="path"]')!);
    expect(registered).toHaveBeenCalledTimes(1);
  });
});
