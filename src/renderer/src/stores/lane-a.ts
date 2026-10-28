// The lane A store (P5 O9 M5, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Interfaces §A): each session a
// terminal or a `--bg` job holds whose sminos bridge answered, as main's lane A driver reports it (`laneA.changed`, and
// `laneA.list` after subscribing, C1's ordering rule), keyed by its address and so partitioned by machine as O6's stores
// are; the body of each session's command catalog, read by `laneA.catalog` once per fingerprint; and the pending-send
// strip: the sends whose fate was not known when `laneA.send` answered (`unconfirmed` in the composer), kept with their
// text by their delivery key until the state's `deliveries` say they entered, or until the person dismisses them.
//
// M5 lists the local machine only: main's driver serves its own sessions, and a remote machine's lane A states come from
// O9's remote adapter once a pane watches one (M9). A `laneA.changed` from any machine is applied.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { DeliveryKey, LaneACatalog, LaneADelivery, LaneAState } from '@shared/ipc/schema/lane-a';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';

// One send the strip keeps: `sending` while the bridge has taken it but not said whether it entered, `refused` with the
// bridge's reason, `unconfirmed` when the stream that would have said is gone ("may not have arrived").
export interface PendingSend {
  key: DeliveryKey;
  text: string;
  state: 'sending' | 'refused' | 'unconfirmed';
  reason: string | null;
}

export interface LaneAStore {
  states: ReadonlyMap<AppSessionId, LaneAState>;
  catalogs: ReadonlyMap<AppSessionId, LaneACatalog>; // the body for the state's fingerprint, once read
  pendingSends: ReadonlyMap<AppSessionId, readonly PendingSend[]>;
  usage: ReadonlyMap<AppSessionId, LaneAUsage>; // the latest `usage` a watch of this page heard (its snapshot's, then each turn's)
}

// The bridge's `usage` (DX5, `desk-hub/protocol`'s `Usage`): the context's fill, absent until a response reported it.
export interface LaneAUsage {
  context: { tokens?: number; window: number; percent?: number };
  cost: { usd: number } | null;
}

const empty = (): LaneAStore => ({ states: new Map(), catalogs: new Map(), pendingSends: new Map(), usage: new Map() });

export const useLaneA = create<LaneAStore>()(empty);

export const laneAStateOf = (appSessionId: AppSessionId): LaneAState | null => useLaneA.getState().states.get(appSessionId) ?? null;
export const useLaneAState = (appSessionId: AppSessionId | null): LaneAState | null => useLaneA((s) => (appSessionId === null ? null : (s.states.get(appSessionId) ?? null)));
export const useLaneACatalog = (appSessionId: AppSessionId): LaneACatalog | null => useLaneA((s) => s.catalogs.get(appSessionId) ?? null);

export const sameKey = (a: DeliveryKey, b: DeliveryKey): boolean => a.writer === b.writer && a.seq === b.seq;

// A held send's fate as its delivery says it; undefined: the delivery says nothing new (no entry, or still on its way).
function fateOf(delivery: LaneADelivery | undefined): Pick<PendingSend, 'state' | 'reason'> | 'entered' | undefined {
  if (!delivery) return undefined;
  if (delivery.state === 'entered') return 'entered';
  if (delivery.state === 'refused') return { state: 'refused', reason: delivery.reason ?? null };
  if (delivery.state === 'unconfirmed') return { state: 'unconfirmed', reason: delivery.reason ?? null };
  return { state: 'sending', reason: null };
}

// The strip's entries against the session's state now: an entered one leaves, another takes its delivery's fate; a
// session gone from lane A leaves every send still on its way unconfirmed, since nothing will say what became of it.
function follow(sends: readonly PendingSend[], state: LaneAState | null): readonly PendingSend[] {
  let changed = false;
  const next: PendingSend[] = [];
  for (const send of sends) {
    const fate = state === null ? (send.state === 'sending' ? { state: 'unconfirmed' as const, reason: null } : undefined) : fateOf(state.deliveries.find((d) => sameKey(d.key, send.key)));
    if (fate === 'entered') {
      changed = true;
      continue;
    }
    if (fate === undefined || (fate.state === send.state && fate.reason === send.reason)) next.push(send);
    else {
      changed = true;
      next.push({ ...send, ...fate });
    }
  }
  return changed ? next : sends;
}

function withPending(map: ReadonlyMap<AppSessionId, readonly PendingSend[]>, appSessionId: AppSessionId, sends: readonly PendingSend[]): ReadonlyMap<AppSessionId, readonly PendingSend[]> {
  const next = new Map(map);
  if (sends.length === 0) next.delete(appSessionId);
  else next.set(appSessionId, sends);
  return next;
}

let catalogClient: MawsBridge | null = null;
const reading = new Map<AppSessionId, string>(); // the fingerprint whose body is being read per session

// The catalog's body for the state's fingerprint, read once (a read in flight for the same fingerprint is not repeated).
function readCatalog(appSessionId: AppSessionId, state: LaneAState): void {
  const fingerprint = state.catalog?.fingerprint ?? null;
  if (catalogClient === null || fingerprint === null) return;
  if (useLaneA.getState().catalogs.get(appSessionId)?.fingerprint === fingerprint || reading.get(appSessionId) === fingerprint) return;
  reading.set(appSessionId, fingerprint);
  void catalogClient.invoke('laneA.catalog', { appSessionId }).then((result) => {
    if (reading.get(appSessionId) === fingerprint) reading.delete(appSessionId);
    if (!result.ok || result.value === null || !useLaneA.getState().states.has(appSessionId)) return;
    const body = result.value;
    useLaneA.setState((s) => ({ catalogs: new Map(s.catalogs).set(appSessionId, body) }));
  });
}

// One session's state as main reports it; null: the session left lane A.
export function applyLaneAState(appSessionId: AppSessionId, state: LaneAState | null): void {
  useLaneA.setState((s) => {
    const states = new Map(s.states);
    const catalogs = state === null ? new Map(s.catalogs) : s.catalogs;
    if (state === null) {
      states.delete(appSessionId);
      (catalogs as Map<AppSessionId, LaneACatalog>).delete(appSessionId);
    } else states.set(appSessionId, state);
    const held = s.pendingSends.get(appSessionId);
    const followed = held ? follow(held, state) : undefined;
    return { states, catalogs, pendingSends: held && followed !== held ? withPending(s.pendingSends, appSessionId, followed!) : s.pendingSends };
  });
  if (state !== null) readCatalog(appSessionId, state);
}

// A machine's whole list: its partition replaced (a session it no longer lists left lane A), others untouched.
export function applyLaneAList(machine: MachineRef, states: readonly LaneAState[]): void {
  const listed = new Set(states.map((s) => s.appSessionId));
  for (const id of useLaneA.getState().states.keys()) if (machineOf(id) === machine && !listed.has(id)) applyLaneAState(id, null);
  for (const state of states) applyLaneAState(state.appSessionId, state);
}

// The composer's send whose fate `laneA.send` could not name yet, held with its text under its key.
export function holdPendingSend(appSessionId: AppSessionId, key: DeliveryKey, text: string): void {
  useLaneA.setState((s) => {
    const held = (s.pendingSends.get(appSessionId) ?? []).filter((p) => !sameKey(p.key, key));
    const sends = follow([...held, { key, text, state: 'sending', reason: null }], s.states.get(appSessionId) ?? null);
    return { pendingSends: withPending(s.pendingSends, appSessionId, sends) };
  });
}

export function noteLaneAUsage(appSessionId: AppSessionId, usage: LaneAUsage): void {
  useLaneA.setState((s) => ({ usage: new Map(s.usage).set(appSessionId, usage) }));
}
// The context ring's reading of it (no autocompact threshold: the bridge reports none), once a response reported the fill.
export const contextOfUsage = (usage: LaneAUsage | null): { percent: number; maxTokens: number; autoCompactThreshold: null } | null =>
  usage && usage.context.percent !== undefined ? { percent: usage.context.percent, maxTokens: usage.context.window, autoCompactThreshold: null } : null;
export const useLaneAUsage = (appSessionId: AppSessionId): LaneAUsage | null => useLaneA((s) => s.usage.get(appSessionId) ?? null);

export function dismissPendingSend(appSessionId: AppSessionId, key: DeliveryKey): void {
  useLaneA.setState((s) => ({ pendingSends: withPending(s.pendingSends, appSessionId, (s.pendingSends.get(appSessionId) ?? []).filter((p) => !sameKey(p.key, key))) }));
}

// Subscribes, then lists this machine's sessions; a change that raced the list is applied after it.
export function connectLaneA(client: MawsBridge = ipc): () => void {
  catalogClient = client;
  let buffer: [AppSessionId, LaneAState | null][] | null = [];
  let live = true;
  const off = client.on('laneA.changed', ({ appSessionId, state }) => {
    if (!live) return;
    if (buffer) buffer.push([appSessionId, state]);
    else applyLaneAState(appSessionId, state);
  });
  void client.invoke('laneA.list', undefined).then((result) => {
    if (!live) return;
    if (result.ok) applyLaneAList(client.localMachine, result.value.states);
    else console.warn('[lane-a] laneA.list unavailable; starting empty', result.error.message);
    const raced = buffer ?? [];
    buffer = null;
    for (const [id, state] of raced) applyLaneAState(id, state);
  });
  return () => {
    live = false;
    off();
    if (catalogClient === client) catalogClient = null;
  };
}

// Tests: the store and its reads back to empty.
export function resetLaneAStore(): void {
  reading.clear();
  catalogClient = null;
  useLaneA.setState(empty());
}
