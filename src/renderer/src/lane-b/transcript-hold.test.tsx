// The tab's hold on a remote lane B session's transcript (P5 O15 M2b, Decision Log 39; ./transcript-hold.ts): over the
// real stores and a session source on a fake X2 client, the pane's own attach and detach played as its mount and its
// unmount while its tab stays (the floating card taking the session; before the UX wave's U9 M3, the offline placeholder,
// which no longer replaces a pane that has something to keep). The UX wave, U9 (M5, the ticket on history read after a link's return): a history read of the
// machine's session waits, from the roster's `up`, for main's settled word of that generation or SETTLE_BACKSTOP_MS,
// whichever is first; a held key not whole at the return is decided there.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, EventId } from '@shared/graph/ids';
import type { CommandName, CommandResult, EventName, EventPayload, EventSource, MawsBridge } from '@shared/ipc/schema';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../stores/transcript';
import { builder } from '../transcript/model/test-events';
import { ipcSourceOver } from '../transcript/source/ipc';
import { applyRemoteSession, applyRemoteSettled, resetRemoteLaneBStore, SETTLE_BACKSTOP_MS } from './remote-session';
import { remoteSessionState } from './test-support/remote-session';
import type { RemoteAnswer, RemoteSession } from '@shared/ipc/schema/remote';
import { useRemoteTranscriptHold } from './transcript-hold';

// A fake X2 client: every `session.events` waits for the test to answer it; `session.appEvents` answers none at once.
function fakeClient() {
  const listeners = new Map<string, Set<(payload: unknown, from: EventSource) => void>>();
  const calls: { name: string; input: unknown; answer: (result: CommandResult<CommandName>) => void }[] = [];
  const client: MawsBridge = {
    localMachine: TEST_MACHINE,
    invoke: ((name: CommandName, input: unknown) =>
      name === 'session.appEvents' ? Promise.resolve({ ok: true, value: { events: [] } }) : new Promise((resolve) => calls.push({ name, input, answer: resolve as never }))) as MawsBridge['invoke'],
    on: ((name: EventName, listener: (payload: unknown, from: EventSource) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    }) as MawsBridge['on'],
    pathForFile: () => '',
  };
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>, machine: MachineRef = TEST_MACHINE) => {
    for (const listener of [...(listeners.get(name) ?? [])]) listener(payload, { machine });
  };
  return { client, calls, emit };
}

// The hook reads its session's source through `ipcSource`; here it is the fake client's.
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof fakeClient> | null }));
vi.mock('../transcript/source/ipc', async (original) => {
  const module = await original<typeof import('../transcript/source/ipc')>();
  return { ...module, ipcSource: (appSessionId: AppSessionId) => module.ipcSourceOver(fake.current!.client, appSessionId) };
});

const REMOTE = addressOf(OTHER_MACHINE, 'app-t' as AppSessionId);
const LOCAL = at('app-l' as AppSessionId);
const SINCE = '2026-11-10T08:00:00.000Z';
// the roster restamps `since` at each change of state, as main's does: an `up` is now
const machineState = (state: MachineState['state'], generation: number): MachineState => ({ ref: OTHER_MACHINE, name: 'mini', local: false, state, since: new Date().toISOString(), generation, ...(state === 'up' && { carrier: 'relay' as const }) });
const here: MachineState = { ref: TEST_MACHINE, name: 'this Mac', local: true, state: 'up', since: SINCE, generation: 0 };

let f: ReturnType<typeof fakeClient>;
let generation = 1;
// The roster as `connectShell` applies it (the store), and as the session source hears it (the event).
const roster = (state: MachineState['state']) => {
  if (state === 'up') generation += 1;
  linkState = state === 'up' ? 'up' : 'down';
  const machines = [here, machineState(state, generation)];
  useMachines.getState().applyRoster(machines);
  f.emit('machines.changed', { machines });
};
// main's word on the stream, as `connectShell` applies it (the store) and as the session source hears it (the event):
// with `mode`, the stream's next answer (a `subbed`, or an end leaving it idle or ended); without, the latest said again
let answer: RemoteAnswer | null = null;
let linkState: 'up' | 'down' = 'up'; // the link main names, as the roster last moved it
const stream = (state: RemoteSession['stream'], mode?: RemoteAnswer['mode']) => {
  if (mode !== undefined) answer = { n: (answer?.n ?? 0) + 1, mode };
  const said = remoteSessionState(REMOTE, { stream: state, answer, link: { state: linkState, carrier: linkState === 'up' ? 'relay' : null, refusal: null, member: 'member-1', rights: [] } });
  applyRemoteSession(said);
  f.emit('remote.session', said, OTHER_MACHINE);
};
// the link lost past its grace, in main's order: the session's word (the link `down`), then the roster
const lose = (state: RemoteSession['stream'] = 'paused') => {
  linkState = 'down';
  stream(state);
  roster('down');
};
// main's settled word for the roster's current generation (the UX wave, U9, M5), as `connectShell` applies it
const settledWord = () => applyRemoteSettled({ machine: OTHER_MACHINE, generation });
const reads = () => f.calls.filter((call) => call.name === 'session.events');
const entry = (key: AppSessionId = REMOTE) => useTranscriptStore.getState().entries[key];
const attached = (key: AppSessionId = REMOTE) => useTranscriptStore.getState().attached(key);
const history = (() => {
  const b = builder();
  b.turn('u1');
  b.text('m1', 0, 'Answer 1');
  b.end(['u1']);
  return b.events.map((event, i): SessionEvent => ({ ...event, seq: 1 + i, id: `app-t:L1:${1 + i}:0` as EventId }));
})();
const answered = (index: number) => reads()[index]!.answer({ ok: true, value: { events: history, lastSeq: history.length, complete: true } } as never);
const refused = (index: number) => reads()[index]!.answer({ ok: false, error: { code: 'offline', message: 'session.events: the channel to machine mini it was made on ended' } } as never);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// The pane: its transcript attaches the session's source while mounted.
function pane(key: AppSessionId = REMOTE) {
  const source = ipcSourceOver(f.client, key);
  const hydrated = useTranscriptStore.getState().attach(key, source);
  return { hydrated, unmount: () => useTranscriptStore.getState().detach(key) };
}
// The tab: the hook mounted for the tab's life.
const tab = (key: AppSessionId = REMOTE) => renderHook(() => useRemoteTranscriptHold(key));

beforeEach(() => {
  f = fakeClient();
  fake.current = f;
  resetRemoteLaneBStore();
  answer = null;
  linkState = 'up';
  stream('live', 'snapshot'); // main streams the session: it is lane B on another machine
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
});
afterEach(() => {
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  resetRemoteLaneBStore();
});

// Hydrated with the link up, the tab mounted; then the machine goes offline and the pane unmounts while the tab stays.
async function heldThroughALoss() {
  roster('up');
  settledWord();
  const first = pane();
  const hold = tab();
  answered(0);
  await first.hydrated;
  lose();
  first.unmount();
  return hold;
}

describe('the hold', () => {
  // the panel's finding 1: the store publishes `hydrating` before it counts the attachment, so a hold mounted with its
  // pane first acquires at the next notification, here main's word of the loss (said before the roster's)
  it('acquiring at main’s word of the loss arms it: a hydration that fails in the outage is read again at the return’s settled word', async () => {
    roster('up');
    settledWord();
    const hold = tab();
    const first = pane();
    expect(attached()).toBe(true);
    lose(); // main's word of the loss, the roster still up, is the hold's next notification: it acquires there
    refused(0);
    await first.hydrated;
    expect(entry().phase).toBe('failed');
    first.unmount();
    roster('up');
    const again = pane();
    stream('live', 'replay');
    await settle();
    expect(reads(), 'decided at the settled word').toHaveLength(1);
    settledWord();
    await vi.waitFor(() => expect(reads()).toHaveLength(2));
    answered(1);
    await vi.waitFor(() => expect(entry().phase).toBe('live'));
    again.unmount();
    hold.unmount();
  });

  // M5's review, finding 1: main says the roster's `down` before the session's (machines/index.ts, manager.ts), and the
  // store publishes `hydrating` before it counts the pane's attachment, so a hold mounted first has acquired at neither
  // word of the loss; the pane stays mounted through the outage, and nothing subscribes or remounts at the return
  it('in main’s order, the roster’s down before the session’s: a hold not yet acquired at the loss heals a hydration that failed in the outage at the next generation’s word', async () => {
    roster('up');
    settledWord();
    const hold = tab();
    const first = pane();
    try {
      roster('down'); // main's order: the roster first
      stream('paused'); // then the session's word, the link down
      refused(0);
      await first.hydrated;
      expect(entry().phase).toBe('failed');
      roster('up');
      await settle();
      expect(reads(), 'decided at the settled word').toHaveLength(1);
      settledWord();
      await vi.waitFor(() => expect(reads()).toHaveLength(2));
      answered(1);
      await vi.waitFor(() => expect(entry().phase).toBe('live'));
    } finally {
      // unmounted on a failure too: a hold left mounted hears the next test's words with this test's source
      first.unmount();
      hold.unmount();
    }
  });

  // M5's fix round: the re-read's wait for a hydration still out asked the store again until it answered the same
  // settlement twice; a key left hydrating with no attachment answers a new settled promise each time, so the wait went
  // round in microtasks and never yielded. Reached here by a second client's source of the key, attached over the
  // hold's and let go (one client's sources are one per key, so the window's own panes never do this)
  it('stops waiting on a key that is hydrating with no attachment left, and never spins on it', async () => {
    const hold = await heldThroughALoss();
    const other = fakeClient();
    void useTranscriptStore.getState().attach(REMOTE, ipcSourceOver(other.client, REMOTE));
    useTranscriptStore.getState().detach(REMOTE);
    expect(attached(), 'no attachment left').toBe(false);
    expect(entry().phase).toBe('hydrating');
    // a bound of its own: past 50 asks the store answers a settlement that never comes, so a spinning wait parks there
    const retry = useTranscriptStore.getState().retry;
    let asks = 0;
    useTranscriptStore.setState({ retry: (key: string) => (++asks > 50 ? new Promise<void>(() => {}) : retry(key)) });
    try {
      roster('up');
      settledWord();
      await settle();
      await settle();
      expect(asks, 'the store asked at most once').toBeLessThanOrEqual(1);
    } finally {
      useTranscriptStore.setState({ retry });
      hold.unmount();
    }
  });

  it('keeps the key the pane attached across offline: at up the pane joins it, and nothing is read again', async () => {
    const hold = await heldThroughALoss();
    expect(attached(), 'held while the pane is unmounted').toBe(true);
    roster('up');
    const again = pane();
    stream('live', 'replay');
    await again.hydrated;
    await settle();
    expect(reads(), 'one read in all: the first hydration').toHaveLength(1);
    expect(entry().phase).toBe('live');
    expect(entry().state.seen.size).toBe(history.length);
    again.unmount();
    hold.unmount();
  });

  // The UX wave, U9 (M3; the ticket on a pane kept through a link's loss): a pane that has something to keep stays mounted through the outage, its attachment its own
  it('reads nothing again at up for a pane kept mounted through the loss', async () => {
    roster('up');
    settledWord();
    const shown = pane();
    const hold = tab();
    answered(0);
    await shown.hydrated;
    lose();
    roster('up');
    stream('live', 'replay');
    await settle();
    expect(reads(), 'one read in all').toHaveLength(1);
    expect(entry().phase).toBe('live');
    shown.unmount();
    hold.unmount();
    expect(attached()).toBe(false);
  });

  it('closing the tab releases it, with its pane unmounted or mounted', async () => {
    const offline = await heldThroughALoss();
    offline.unmount();
    expect(attached()).toBe(false);
    roster('up');
    settledWord();
    const shown = pane();
    const hold = tab();
    expect(reads()).toHaveLength(2); // the next mount hydrates, the machine settled
    shown.unmount();
    hold.unmount();
    expect(attached()).toBe(false);
  });

  it('never creates an attachment: a tab that has only shown the phase’s words holds nothing, and its pane hydrates at up as today', async () => {
    lose();
    const hold = tab();
    expect(attached()).toBe(false);
    roster('up');
    expect(attached(), 'the link up is not a mount').toBe(false);
    settledWord();
    const shown = pane();
    expect(reads()).toHaveLength(1);
    answered(0);
    await shown.hydrated;
    // from here it holds what the pane attached
    lose();
    shown.unmount();
    expect(attached()).toBe(true);
    hold.unmount();
  });

  it('holds nothing a pane attached before the roster said the machine is up: a tab restored at launch while offline', async () => {
    const shown = pane(); // the roster unread: the tab draws the pane
    const hold = tab();
    lose();
    shown.unmount();
    expect(attached(), 'its read went to a link not known up').toBe(false);
    refused(0);
    await shown.hydrated;
    roster('up');
    settledWord();
    const again = pane();
    expect(reads(), 'settled, the pane hydrates').toHaveLength(2);
    again.unmount();
    hold.unmount();
  });

  it('leaves a session the roster no longer lists to the pane: applyList dropping its record changes nothing it holds', async () => {
    useSessions.getState().applyList({ sessions: [], revision: 1 }, OTHER_MACHINE);
    const hold = await heldThroughALoss();
    roster('up');
    stream('live', 'replay');
    useSessions.getState().applyList({ sessions: [], revision: 2 }, OTHER_MACHINE);
    await settle();
    expect(reads()).toHaveLength(1);
    expect(entry().phase).toBe('live');
    hold.unmount();
    expect(attached()).toBe(false);
  });

  it('a local session’s tab holds nothing', async () => {
    const shown = pane(LOCAL);
    const hold = tab(LOCAL);
    answered(0);
    await shown.hydrated;
    shown.unmount();
    expect(attached(LOCAL)).toBe(false);
    hold.unmount();
  });
});

// The coordinator's B: today's remount gives a pane that is not whole at the return a free retry; the hold keeps it, at
// the stream's return (`remote.session` past `paused`), never before that stream's `subbed`.
describe('a held key not whole at the return', () => {
  it('whose hydration failed is read again at the return’s settled word, not at the link’s up nor at the stream’s answer', async () => {
    roster('up');
    settledWord();
    const first = pane();
    const hold = tab();
    refused(0);
    await first.hydrated;
    expect(entry().phase).toBe('failed');
    lose();
    first.unmount();
    roster('up');
    const again = pane(); // joins the failed attachment
    await settle();
    expect(reads(), 'up is not settled').toHaveLength(1);
    stream('live', 'replay');
    await settle();
    expect(reads(), 'an answer is not settled').toHaveLength(1);
    applyRemoteSettled({ machine: OTHER_MACHINE, generation: generation - 1 }); // an earlier generation's word
    await settle();
    expect(reads()).toHaveLength(1);
    settledWord();
    await settle();
    expect(reads()).toHaveLength(2);
    answered(1);
    await vi.waitFor(() => expect(entry().phase).toBe('live'));
    await settle();
    expect(reads(), 'once').toHaveLength(2);
    again.unmount();
    hold.unmount();
  });

  it('whose hydration failed is read again when nothing resubscribes: at the backstop after up, with no word', async () => {
    roster('up');
    settledWord();
    const first = pane();
    const hold = tab();
    refused(0);
    await first.hydrated;
    lose();
    roster('up');
    await settle();
    expect(reads()).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_BACKSTOP_MS + 100));
    expect(reads()).toHaveLength(2);
    answered(1);
    await vi.waitFor(() => expect(entry().phase).toBe('live'));
    first.unmount();
    hold.unmount();
  });

  it('whose hydration was still out at the loss waits for it, and reads again only if it failed', async () => {
    for (const outcome of ['failed', 'answered'] as const) {
      f = fakeClient();
      fake.current = f;
      useTranscriptStore.getState().drop(REMOTE);
      roster('up');
      settledWord();
      const first = pane();
      const hold = tab();
      lose();
      first.unmount();
      roster('up');
      settledWord();
      await settle();
      expect(reads(), outcome).toHaveLength(1);
      if (outcome === 'failed') refused(0);
      else answered(0);
      await settle();
      expect(reads(), outcome).toHaveLength(outcome === 'failed' ? 2 : 1);
      hold.unmount();
    }
  });

  it('whose staged re-read failed in a second loss is read again at the next return, once', async () => {
    const hold = await heldThroughALoss();
    roster('up');
    f.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L2' }, OTHER_MACHINE);
    stream('gap', 'snapshot');
    await settle();
    expect(reads(), 'the snapshot’s re-read waits for the word').toHaveLength(1);
    settledWord();
    await vi.waitFor(() => expect(reads()).toHaveLength(2));
    lose();
    refused(1);
    await vi.waitFor(() => expect(entry().phase).toBe('failed'));
    expect(entry().state.seen.size, 'the old rows kept').toBe(history.length);
    roster('up');
    await settle();
    expect(reads()).toHaveLength(2);
    stream('live', 'replay');
    await settle();
    expect(reads()).toHaveLength(2);
    settledWord();
    await settle();
    expect(reads()).toHaveLength(3);
    answered(2);
    await vi.waitFor(() => expect(entry().phase).toBe('live'));
    await settle();
    expect(reads()).toHaveLength(3);
    hold.unmount();
  });

  // reviewer-high's P1: B restarted during the loss without restoring the launch; its stream comes back `idle`, with no
  // gap and no batch, while the key is still `live` from before the loss
  it('a whole key whose stream comes back idle is read again once, staged', async () => {
    const hold = await heldThroughALoss();
    roster('up');
    const again = pane();
    stream('idle', 'unavailable');
    await settle();
    expect(reads(), 'an idle session’s re-read waits for the word').toHaveLength(1);
    settledWord();
    await vi.waitFor(() => expect(reads()).toHaveLength(2));
    expect(entry().state.seen.size, 'the old rows kept').toBe(history.length);
    answered(1);
    await vi.waitFor(() => expect(entry().phase).toBe('live'));
    await settle();
    expect(reads()).toHaveLength(2);
    again.unmount();
    hold.unmount();
  });

  it('a whole key reads nothing at the stream’s return', async () => {
    const hold = await heldThroughALoss();
    roster('up');
    stream('live', 'replay');
    settledWord();
    await settle();
    expect(reads()).toHaveLength(1);
    hold.unmount();
  });
});

// The UX wave, U9 (M5, the first case of the ticket on history read after a link's return): a pane's first read with nothing held, of a tab restored at launch or opened
// while the machine was away, is made once the machine settled, not beside the live sessions' resumes
describe('a first read with nothing held', () => {
  it('waits from the roster’s up for the settled word of its generation, and a pane mounted after it reads at once', async () => {
    roster('up');
    const first = pane();
    await settle();
    expect(reads(), 'up is not settled').toHaveLength(0);
    settledWord();
    await settle();
    expect(reads()).toHaveLength(1);
    answered(0);
    await first.hydrated;
    first.unmount();
    useTranscriptStore.getState().drop(REMOTE);
    const later = pane();
    expect(reads(), 'mounted after the word: at once').toHaveLength(2);
    later.unmount();
  });

  it('reads at the backstop when no word comes', async () => {
    roster('up');
    const first = pane();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_BACKSTOP_MS - 300));
    expect(reads()).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(reads()).toHaveLength(1);
    first.unmount();
  });

  it('reads at once for a machine the roster does not say is up, and for a session of this Mac', async () => {
    const away = pane(); // the roster unread
    expect(reads()).toHaveLength(1);
    away.unmount();
    roster('up');
    const local = pane(LOCAL);
    expect(reads()).toHaveLength(2);
    local.unmount();
  });
});
