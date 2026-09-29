// The `#panel` harness's summary seams (C8a execution document, M2; Interfaces *Harness API*): the fake sessions'
// records, statuses and digests patched in place, and C6's fixtures played as a session's transcript. A loaded fixture
// is a `HarnessSession` (C6's harness player) whose source is attached under the fake session's id as well, so the
// summary reads `entries[id]` exactly as the product reads what the session tab hydrated.
import type { SessionEvent } from '@shared/graph/events';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import type { TurnId } from '../../transcript';
import { loadFixture } from '../fixtures';
import { HarnessSession } from '../player';
import type { PanelHarnessApi } from './api';
import { fakeId } from './fakeSessions';

const loaded = new Map<string, HarnessSession>();

// The transcript loaded into a fake session (the `child` tool reads its first child agent), and a listener told after
// each load has released its history.
export const loadedSession = (appSessionId: string): HarnessSession | null => loaded.get(appSessionId) ?? null;
const loadListeners = new Set<(appSessionId: string) => void>();
export function onTranscriptLoaded(listener: (appSessionId: string) => void): () => void {
  loadListeners.add(listener);
  return () => void loadListeners.delete(listener);
}

// A replaced player stops and leaves the store with its children's keys (HarnessSession.dispose pauses and drops them).
function retire(appSessionId: string): void {
  loaded.get(appSessionId)?.dispose();
  loaded.delete(appSessionId);
}

// Resolves once a key's hydration has settled (the player's own key is attached by HarnessSession's constructor).
function settled(key: string): Promise<void> {
  const done = () => useTranscriptStore.getState().entries[key]?.phase !== 'hydrating';
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useTranscriptStore.subscribe(() => {
      if (!done()) return;
      off();
      resolve();
    });
  });
}

export const summaryProbes: Pick<PanelHarnessApi, 'setSession' | 'setStatus' | 'setDigest' | 'loadTranscript' | 'transcript'> = {
  setSession(id, patch) {
    useSessions.setState((s) => {
      const record = s.records.get(fakeId(id));
      if (!record) return {};
      return { records: new Map(s.records).set(fakeId(id), { ...record, ...patch }), recordsVersion: s.recordsVersion + 1 };
    });
  },

  setStatus(id, status) {
    useSessions.setState((s) => {
      const engine = new Map(s.engine);
      if (status) engine.set(fakeId(id), status);
      else engine.delete(fakeId(id));
      return { engine };
    });
  },

  setDigest(id, patch) {
    useSessions.setState((s) => {
      const digest = s.digests.get(fakeId(id));
      if (!digest) return {};
      return { digests: new Map(s.digests).set(fakeId(id), { ...digest, ...patch, revision: digest.revision + 1 }), digestsVersion: s.digestsVersion + 1 };
    });
  },

  async loadTranscript(id, fixture, opts = {}) {
    const key = fakeId(id);
    const fixtureEvents = loadFixture(fixture);
    // Before and after the fetch: a load that landed while this one fetched its fixture is replaced too, so no player
    // key is left behind.
    retire(key);
    const events = await fixtureEvents;
    retire(key);
    useTranscriptStore.getState().drop(key);
    // Nothing released at construction (a fixture's own stream point would reach the player's key alone): the seek
    // below decides what is history.
    const session = new HarnessSession({ ...events, streamFrom: null }, 0);
    loaded.set(key, session);
    // Both keys hydrated (the player's snapshot is empty) before anything is released, so each hears every event. The
    // player's key is the constructor's one attachment (childSource reads it); the session's key is this one.
    await Promise.all([settled(session.key), useTranscriptStore.getState().attach(key, session.source)]);
    session.player.seek(opts.releaseTo ?? Number.POSITIVE_INFINITY);
    if (loaded.get(key) === session) loadListeners.forEach((listener) => listener(key));
  },

  transcript(id) {
    const key = fakeId(id);
    const store = useTranscriptStore.getState;
    return {
      expandAll: () => store().expandAll(key),
      collapseAll() {
        const state = store().entries[key]?.state;
        if (!state) return;
        const open = (turn: TurnId) => state.ui.expandedTurns.has(turn) || (state.turns.get(turn)?.state === 'open' && !state.ui.collapsedTurns.has(turn));
        for (const turn of state.order) if (open(turn)) store().toggleTurn(key, turn);
      },
      release(n) {
        const session = loaded.get(key);
        if (!session) return 0;
        let released = 0;
        const off = session.player.subscribe((batch: SessionEvent[]) => void (released += batch.length));
        for (let i = 0; i < n && !session.player.done; i += 1) session.player.step();
        off();
        return released;
      },
    };
  },
};
