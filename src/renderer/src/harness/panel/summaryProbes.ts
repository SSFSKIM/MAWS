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
    loaded.get(key)?.dispose();
    useTranscriptStore.getState().drop(key);
    // Nothing released at construction (a fixture's own stream point would reach the player's key alone): the seek
    // below decides what is history.
    const session = new HarnessSession({ ...(await loadFixture(fixture)), streamFrom: null }, 0);
    loaded.set(key, session);
    // Both keys hydrated (the player's snapshot is empty) before anything is released, so each hears every event.
    const store = useTranscriptStore.getState();
    await Promise.all([store.attach(session.key, session.source), store.attach(key, session.source)]);
    session.player.seek(opts.releaseTo ?? Number.POSITIVE_INFINITY);
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
