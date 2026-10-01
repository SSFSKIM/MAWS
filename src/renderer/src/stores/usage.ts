// The account's usage windows (§5.5 status line fields `5h` and `7d`). C5 held the placeholder; C7 fills it (C7
// execution document, "Status line popovers and usage"; D-17, D-19): one shared ClaudeUsage read in main, answered by
// `settings.usage` and pushed by `settings.usageChanged`, and for a direct session the engine's own `get_usage`.
import { create } from 'zustand';
// C7 start
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { MawsBridge } from '@shared/ipc/schema';
import type { AccountUsage, UsageSnapshot } from '@shared/usage/types';
import { ipc } from '../ipc/client';
import { createFreshness } from './freshness';
import { useLayout } from './layout';
import { useSessions } from './sessions';
// C7 end

export type { UsageWindow } from '@shared/usage/types'; // C7: ClaudeUsage's shape, `recordedAt` included
export type Windows = AccountUsage['windows']; // C7: the 5-hour, the weekly and each model's weekly window

export interface UsageState {
  windows: Windows | null; // C7: the drain target's (the account the relay routes new sessions to); null without data
  updatedAt: string | null;
  // C7 start
  snapshot: UsageSnapshot | null; // the latest, null until main has answered
  pinsFor: Record<string, string>; // engine session id → account uuid, for the open session tabs
  direct: ReadonlyMap<AppSessionId, DirectReading>; // the direct fallback: `get_usage` per direct session
  // `pins`: a reply answers for exactly the ids it was asked, so it replaces them; an event's pins are for whoever
  // asked last, so they are laid over the held ones.
  applySnapshot(snapshot: UsageSnapshot, pins?: 'replace' | 'merge'): void;
  setDirect(appSessionId: AppSessionId, reading: DirectReading | null): void;
  // C7 end
  // W6 route executor start: a Route ClaudeUsage answered, laid over every snapshot until C7's reader catches up
  routed: HeldRoute | null;
  applyRoute(drainTarget: string, drainTargetIsManual: boolean): void;
  // W6 route executor end
}

// W6 route executor start
// ClaudeUsage answers a Route before its relay rewrites pins.json, and every snapshot until then (an event for an
// unrelated file, a reply) still names the old drain target. The answered one is laid over each until a snapshot names
// it or no longer lists it, another Route replaces it, or ROUTE_HOLD_MS pass, after which the reader's word stands even if it disagrees.
export const ROUTE_HOLD_MS = 30_000;

export interface HeldRoute {
  drainTarget: string;
  drainTargetIsManual: boolean;
  until: number; // Date.now() past which a snapshot is taken as it is
}
// W6 route executor end

// C7 start
export interface DirectReading {
  windows: Windows | null; // null: the engine reported no rate limits (an API key, or a token without the scope)
  readAt: string;
}

export function createUsageStore() {
  return create<UsageState>()((set, get) => ({
    windows: null,
    updatedAt: null,
    snapshot: null,
    pinsFor: {},
    direct: new Map(),
    routed: null, // W6 route executor
    applySnapshot(read, pins = 'replace') {
      // W6 route executor start: the held Route, while the reader has not named it
      const held = get().routed;
      const gone = read.available && !read.accounts.some((a) => a.uuid === held?.drainTarget); // removed before the reader named it
      const routed = held && read.drainTarget !== held.drainTarget && Date.now() < held.until && !gone ? held : null;
      const snapshot = routed && read.available ? { ...read, drainTarget: routed.drainTarget, drainTargetIsManual: routed.drainTargetIsManual } : read;
      // W6 route executor end
      const drain = snapshot.available ? snapshot.accounts.find((a) => a.uuid === snapshot.drainTarget) : undefined;
      set({
        snapshot,
        windows: drain?.windows ?? null,
        updatedAt: snapshot.readAt,
        pinsFor: pins === 'replace' ? snapshot.pinsFor : { ...get().pinsFor, ...snapshot.pinsFor },
        routed, // W6 route executor
      });
    },
    // W6 route executor start
    applyRoute(drainTarget, drainTargetIsManual) {
      set({ routed: { drainTarget, drainTargetIsManual, until: Date.now() + ROUTE_HOLD_MS } });
      const { snapshot } = get();
      if (snapshot) get().applySnapshot(snapshot, 'merge');
    },
    // W6 route executor end
    setDirect(appSessionId, reading) {
      const direct = new Map(get().direct);
      if (reading) direct.set(appSessionId, reading);
      else direct.delete(appSessionId);
      set({ direct });
    },
  }));
}
// C7 end

export const useUsage = createUsageStore(); // C7: built by the factory

// C7 start
export interface SessionWindows {
  source: 'direct' | 'pinned' | 'drain';
  account: AccountUsage | null; // the account the windows belong to; null for a direct session or without data
  windows: Windows | null;
  readAt: string | null; // when the newest of these windows was recorded
}

const newestRecorded = (w: Windows): string | null =>
  [w.fiveHour, w.sevenDay, ...w.scoped.map((s) => s.window)].reduce<string | null>((newest, win) => (win && (newest === null || win.recordedAt > newest) ? win.recordedAt : newest), null);

// Whose windows a session's status line shows (D-19): a direct session's are the engine's own (`get_usage`), since
// ClaudeUsage's relay never sees its requests; a routed session's are its pinned account's, else the drain target's,
// where the relay would send its next request. Without a live status, the record's `routed: false` says direct.
export function windowsFor(state: Pick<UsageState, 'windows' | 'snapshot' | 'pinsFor' | 'direct'>, record: SessionRecord, status: EngineSessionStatus | null): SessionWindows {
  const direct = status ? status.gateway.mode === 'direct' : record.gateway.routed === false;
  if (direct) {
    const reading = state.direct.get(record.appId);
    return { source: 'direct', account: null, windows: reading?.windows ?? null, readAt: reading?.readAt ?? null };
  }
  const snapshot = state.snapshot?.available ? state.snapshot : null;
  const pinned = record.engineSessionId === null ? undefined : state.pinsFor[record.engineSessionId];
  const account = pinned === undefined ? undefined : snapshot?.accounts.find((a) => a.uuid === pinned);
  if (account) return { source: 'pinned', account, windows: account.windows, readAt: newestRecorded(account.windows) };
  const drain = snapshot?.accounts.find((a) => a.uuid === snapshot.drainTarget) ?? null;
  return { source: 'drain', account: drain, windows: state.windows, readAt: state.windows ? newestRecorded(state.windows) : null };
}

// The windows a session's status line and usage popover show, kept current with the store.
export function useSessionWindows(record: SessionRecord, status: EngineSessionStatus | null): SessionWindows {
  const state = useUsage(useShallow((s) => ({ windows: s.windows, snapshot: s.snapshot, pinsFor: s.pinsFor, direct: s.direct })));
  return useMemo(() => windowsFor(state, record, status), [state, record, status]);
}

export const MAX_ASKED_SESSIONS = 64; // settings.usage's bound

export interface UsageStores {
  usage: typeof useUsage;
  sessions: typeof useSessions;
  layout: typeof useLayout;
}

// Keeps the usage store live, app-wide: subscribes to `settings.usageChanged` first, then asks `settings.usage` for
// the engine ids of every open session tab (at most 64), and asks again whenever those ids change and after every
// event, so the pins always answer for the tabs on screen whoever asked main last. A reply an event overtook is dropped.
export function connectUsage(client: MawsBridge = ipc, stores: UsageStores = { usage: useUsage, sessions: useSessions, layout: useLayout }): () => void {
  const freshness = createFreshness();
  let asked: string | null = null;
  const openEngineIds = () => {
    const records = stores.sessions.getState().records;
    const ids = new Set<string>();
    for (const pane of stores.layout.getState().main.panes) {
      for (const tab of pane.tabs) {
        const id = tab.kind === 'session' ? records.get(tab.appSessionId)?.engineSessionId : null;
        if (id) ids.add(id);
      }
    }
    return [...ids].sort().slice(0, MAX_ASKED_SESSIONS);
  };
  const ask = () => {
    const engineSessionIds = openEngineIds();
    asked = engineSessionIds.join('\n');
    const fresh = freshness.stamp();
    void client.invoke('settings.usage', { engineSessionIds }).then((result) => {
      if (!result.ok) console.warn('[usage] settings.usage failed', result.error);
      else if (fresh()) stores.usage.getState().applySnapshot(result.value);
    });
  };
  const askIfChanged = () => {
    if (openEngineIds().join('\n') !== asked) ask();
  };

  const off = client.on('settings.usageChanged', (snapshot) => {
    freshness.advance();
    stores.usage.getState().applySnapshot(snapshot, 'merge');
    ask();
  });
  ask();
  const offLayout = stores.layout.subscribe((state, before) => state.main !== before.main && askIfChanged());
  const offSessions = stores.sessions.subscribe((state, before) => state.records !== before.records && askIfChanged());
  return () => {
    off();
    offLayout();
    offSessions();
    freshness.advance();
  };
}
// C7 end
