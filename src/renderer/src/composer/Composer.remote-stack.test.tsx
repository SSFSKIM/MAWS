// The composer's keys over the stack of a session on another machine (UX wave U4b, M3;
// docs/doperpowers/plans/2026-11-15-ux-wave-U4b-composer-integrations.md, Acceptance 9, 10, 13 and 15; Interfaces D, F and
// G). Esc on a first next-step row is Send now through that machine's engine; ↑ on the newest waiting row takes it back
// across the link in U4a's order. Where the machine's build does not take the act, the key says its control's sentence
// in the stack and does nothing else. A file of its own: the composer's other suite is edited by landings in flight.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { AppSessionId } from '@shared/graph/ids';
import { REGISTRY } from '@shared/ipc/registry';
import { SEND_NOW_CAPABILITY, SESSION_ACTS_CAPABILITY } from '@shared/ipc/remote-unavailable';
import type { PreloadBridge } from '@shared/ipc/schema';
import { DRAFT_CLAIM, settles } from '@shared/ipc/schema/session';
import { addressingOf, addressOf } from '@shared/machine/address';
import { humanTurn, record, remoteRow, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { connectKeys } from '../keymap/dispatcher';
import { resetReaderRows } from '../lane-b/reader-rows';
import { resetRemoteLaneBStore } from '../lane-b/remote-session';
import { resetCatalogStore } from '../stores/catalog';
import { resetComposerStore } from '../stores/composer';
import { useHosts } from '../stores/hosts';
import { useMachines } from '../stores/machines';
import { useNotices } from '../stores/notices';
import { resetQueueStore } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { hostStatus } from '../test-support/host-status';
import { preloadOf } from '../test-support/preload-of';
import { resetShellStores } from '../test-support/shell-stores';
import { Composer } from './Composer';
import { resetDockedCards } from './docked/registry';
import { resetEffectiveEfforts } from './effective-effort';
import { resetRemoteDrafts } from './editor/drafts';
import { resetTakeBack, TAKE_BACK_WORDS } from './queue/take-back';

const R_ID = 'app-r' as AppSessionId;
const R = addressOf(OTHER_MACHINE, R_ID);
const S = '44444444-4444-4444-8444-444444444444';
const TEXT = 'look at the footer too';
const THIS_BUILD = ['rl2.executor.machine', SESSION_ACTS_CAPABILITY, SEND_NOW_CAPABILITY];
const BUILD_G = ['rl2.executor.machine', SESSION_ACTS_CAPABILITY]; // its capabilities.ts: the session acts, no Send now
const BUILD_F = ['rl2.executor.machine']; // neither
const addressing = addressingOf(REGISTRY);

let remote: FakeClient;
let disconnect: () => void;
let queryClient: QueryClient;
let claimGate: { promise: Promise<void>; resolve: () => void } | null = null; // the next claim waits here
let settleGate: { promise: Promise<void>; resolve: () => void } | null = null; // the next settling save waits here
let saved: (string | null)[] = []; // each `session.drafts.set`'s `replaces`, in order
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

function onMachine(capabilities: string[]) {
  useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-11-15T09:00:00.000Z', generation: 1, carrier: 'relay', capabilities }]);
}

beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  resetEffectiveEfforts();
  resetQueueStore();
  resetCatalogStore();
  resetDockedCards();
  resetRemoteLaneBStore();
  resetRemoteDrafts();
  resetReaderRows();
  useNotices.setState({ notices: [] });
  useHosts.setState({ supervisor: hostStatus() });
  saved = [];
  claimGate = null;
  settleGate = null;
  remote = fakeClient({
    'session.queue.list': { entries: [], paused: false, pauseReason: null },
    'session.history.list': { entries: [] },
    'session.history.append': undefined,
    'session.interrupt': { stillQueued: [], cancelled: [] },
    'session.drafts.get': null,
  });
  const answer = remote.client.invoke.bind(remote.client);
  (remote.client as { invoke: unknown }).invoke = async (name: string, input: Record<string, unknown>, opts?: unknown) => {
    if (name === 'session.drafts.set') {
      const replaces = (input.replaces as string | undefined) ?? null;
      saved.push(replaces);
      const gate = replaces === DRAFT_CLAIM ? claimGate : replaces?.startsWith(settles('')) ? settleGate : null;
      if (gate !== null) {
        if (replaces === DRAFT_CLAIM) claimGate = null;
        else settleGate = null;
        await gate.promise;
      }
      return { ok: true, value: undefined };
    }
    return (answer as (n: string, i: unknown, o?: unknown) => Promise<unknown>)(name, input, opts);
  };
  window.maws = preloadOf(remote);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  disconnect = connectKeys();
  const s = useSessions.getState();
  useSessions.setState({
    listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: R }]]),
    listedMachines: new Set([OTHER_MACHINE]),
    records: new Map(s.records).set(R, addressing.output('session.get').lift(record('app-r'), OTHER_MACHINE)!),
    engine: new Map(s.engine).set(R, addressing.output('engine.sessions').lift([status('app-r', { engineState: 'running', turn: humanTurn })], OTHER_MACHINE)[0]!),
    recordsVersion: s.recordsVersion + 1,
  });
});
afterEach(() => {
  disconnect();
  cleanup();
  resetTakeBack();
  useSessions.setState({ listed: new Map(), listedMachines: new Set() });
  delete (window as { maws?: PreloadBridge }).maws;
  vi.useRealTimers();
});

const mount = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <section aria-label="pane 0">
        <Composer appSessionId={R} paneIndex={0} />
      </section>
    </QueryClientProvider>,
  );
type TiptapElement = HTMLElement & { editor: { getText(): string } };
const pane = () => screen.getByRole('region', { name: 'pane 0' });
const editorOf = () => within(pane()).getByRole('textbox', { name: 'Message', hidden: true }) as TiptapElement;
const key = (target: HTMLElement, init: KeyboardEventInit) => act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));
const stackNotice = () => screen.queryByRole('status', { name: 'Stack notice' })?.textContent ?? null;
const primary = () => pane().querySelector<HTMLButtonElement>('[data-submit-state]')!;
const waiting = (over: { steers?: { messageUuid: string; content: string; createdAt: string }[]; entries?: QueueEntry[] }) =>
  act(() => remote.event('session.queue', { appSessionId: R_ID, entries: over.entries ?? [], paused: false, pauseReason: null, steers: over.steers ?? [] }, OTHER_MACHINE));
const STEER = { messageUuid: S, content: TEXT, createdAt: '2026-11-15T09:59:00.000Z' };
const AFTER: QueueEntry = { queueId: 'q-1', appSessionId: R_ID, content: TEXT, createdAt: '2026-11-15T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false };

async function ready(capabilities: string[]) {
  onMachine(capabilities);
  mount();
  await waitFor(() => expect(remote.pending('session.queue.list')).toBe(0));
}

describe('Esc on a first next-step row of a session on another machine', () => {
  it('sends it now through that machine, once per fresh press, a second while the first is out, and never interrupts', async () => {
    await ready(THIS_BUILD);
    waiting({ steers: [STEER] });
    act(() => editorOf().focus());
    await key(editorOf(), { key: 'Escape' });
    await waitFor(() => expect(remote.invoked('session.steer.sendNow')).toEqual([{ appSessionId: R_ID, messageUuid: S }]));
    await key(editorOf(), { key: 'Escape', repeat: true }); // the same press held down: nothing more
    expect(remote.invoked('session.steer.sendNow')).toHaveLength(1);
    await key(editorOf(), { key: 'Escape' }); // a fresh press while the first is out
    await waitFor(() => expect(remote.invoked('session.steer.sendNow')).toHaveLength(2));
    await remote.reply('session.steer.sendNow', { outcome: 'delivering' });
    await remote.reply('session.steer.sendNow', { outcome: 'nothing_waiting' });
    expect(remote.invoked('session.interrupt')).toEqual([]);
    expect(stackNotice()).toBeNull();
  });

  it('on a machine that does not list `rl2.send-now` says Send now’s sentence in the stack and sends nothing; the square still stops', async () => {
    await ready(BUILD_G);
    waiting({ steers: [STEER] });
    act(() => editorOf().focus());
    await key(editorOf(), { key: 'Escape' });
    expect(stackNotice()).toBe('Can’t send now on mini yet. Update MAWS on mini and try again.');
    expect(remote.invoked('session.steer.sendNow')).toEqual([]);
    expect(remote.invoked('session.interrupt')).toEqual([]);
    await waitFor(() => expect(primary().textContent).toBe('Stop'));
    await act(async () => primary().click());
    await waitFor(() => expect(remote.invoked('session.interrupt')).toHaveLength(1));
  });
});

describe('↑ on the newest waiting row of a session on another machine', () => {
  it('on a machine that serves no session acts, says Edit’s sentence over a next-step row and walks no history', async () => {
    await ready(BUILD_F);
    waiting({ steers: [STEER] });
    act(() => editorOf().focus());
    await key(editorOf(), { key: 'ArrowUp' });
    expect(stackNotice()).toBe('Can’t edit on mini yet. Update MAWS on mini and try again.');
    expect(editorOf().editor.getText()).toBe('');
    expect(saved).toEqual([]);
    expect(remote.invoked('session.steer.cancel')).toEqual([]);
  });

  it('on such a machine, over an after-the-turn row, says that taking back needs a newer MAWS there, from the first press, with no claim sent', async () => {
    await ready(BUILD_F);
    waiting({ entries: [AFTER] });
    act(() => editorOf().focus());
    await key(editorOf(), { key: 'ArrowUp' });
    expect(stackNotice()).toBe(TAKE_BACK_WORDS.needsNewer('mini'));
    expect(saved).toEqual([]);
    expect(remote.invoked('session.queue.remove')).toEqual([]);
  });

  // Interfaces F's step 2 to 4 across the link: each crossing held open in turn
  it('takes a next-step row back in order: the claim acknowledged before the cancel, the settle after the load, each save once, the box read-only throughout', async () => {
    await ready(BUILD_G);
    waiting({ steers: [STEER] });
    act(() => editorOf().focus());
    const held = () => editorOf().getAttribute('contenteditable') === 'false'; // read-only under “Taking the message back…”
    claimGate = deferred();
    settleGate = deferred();
    const claim = claimGate;
    const settle = settleGate;
    await key(editorOf(), { key: 'ArrowUp' });
    await waitFor(() => expect(saved).toEqual([DRAFT_CLAIM]));
    await waitFor(() => expect(held()).toBe(true));
    expect(remote.invoked('session.steer.cancel')).toEqual([]); // the claim is not yet acknowledged
    await key(editorOf(), { key: 'ArrowUp' }); // a second ↑ meanwhile does nothing
    await userEvent.setup().click(within(pane()).getByRole('button', { name: 'More' }));
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'Edit' })); // nor does Edit
    expect(saved).toEqual([DRAFT_CLAIM]);
    await act(async () => claim.resolve());
    await waitFor(() => expect(remote.invoked('session.steer.cancel')).toEqual([{ appSessionId: R_ID, messageUuid: S }]));
    expect(held()).toBe(true);
    expect(saved).toEqual([DRAFT_CLAIM]); // nothing settled before the load
    await act(() => remote.reply('session.steer.cancel', { outcome: 'cancelled' }));
    await waitFor(() => expect(editorOf().editor.getText()).toContain(TEXT));
    await waitFor(() => expect(saved.filter((replaces) => replaces?.startsWith(settles('')))).toHaveLength(1));
    expect(held()).toBe(true); // until the settle is acknowledged
    await act(async () => settle.resolve());
    await waitFor(() => expect(held()).toBe(false));
    expect(saved.filter((replaces) => replaces === DRAFT_CLAIM)).toHaveLength(1);
    expect(saved.filter((replaces) => replaces?.startsWith(settles('')))).toHaveLength(1);
  });
});
