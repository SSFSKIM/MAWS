// The lane A store (P5 O9 M5, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Interfaces §A): each session a
// terminal or a `--bg` job holds whose sminos bridge answered, as main's lane A driver reports it (`laneA.changed`, and
// `laneA.list` after subscribing, C1's ordering rule), keyed by its address and so partitioned by machine as O6's stores
// are; the body of each session's command catalog, read by `laneA.catalog` once per fingerprint; and the pending-send
// strip: the sends whose fate was not known when `laneA.send` answered (`unconfirmed` in the composer), kept with their
// text by their delivery key until the state's `deliveries` say they entered, or until the person dismisses them.
//
// P5 O9 M7: the composer's uploads, each file with its state as the bridge's `media` op messages say it.
//
// P5 O9 M6: the settlements this page's answers were told (`laneA.answer`'s `not_pending`), beside those the state carries,
// so a card whose answer lost the race says who won.
//
// M5 lists the local machine: main's driver serves its own sessions. M9: another machine's lane A states come from main's
// remote adapter, for the sessions some page watches there; each machine O8's rows list (`listedMachines`) is listed by
// that machine as the roster gains it, into its own partition, and a machine the roster loses is emptied. A
// `laneA.changed` from any machine is applied, after the list of its machine when one is on its way.
import type { Job } from 'desk-hub/protocol';
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { DeliveryKey, LaneACatalog, LaneADelivery, LaneAState } from '@shared/ipc/schema/lane-a';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { askUntilAnswered } from '../ipc/until-answered';
import { useSessions } from './sessions';

// One send the strip keeps: `sending` while the bridge has taken it but not said whether it entered, `refused` with the
// bridge's reason, `unconfirmed` when the stream that would have said is gone ("may not have arrived").
export interface PendingSend {
  key: DeliveryKey;
  text: string;
  state: 'sending' | 'refused' | 'unconfirmed';
  reason: string | null;
}

// P5 O9 M7: one upload the composer sent, each file with its state as the bridge says it (`queued` until it says one;
// DX4's `MediaState`: `pending`, `claimed`, `read`, `forwarded`, `aborted`, `failed`) and the reason of an `aborted` or a
// `failed` one.
export interface LaneAUpload {
  upload: string;
  files: readonly { name: string; state: string; reason: string | null }[];
}

export interface LaneAStore {
  states: ReadonlyMap<AppSessionId, LaneAState>;
  catalogs: ReadonlyMap<AppSessionId, LaneACatalog>; // the body for the state's fingerprint, once read
  pendingSends: ReadonlyMap<AppSessionId, readonly PendingSend[]>;
  uploads: ReadonlyMap<AppSessionId, readonly LaneAUpload[]>; // M7: the composer's uploads, until they went on or are dismissed
  usage: ReadonlyMap<AppSessionId, LaneAUsage>; // the latest `usage` a watch of this page heard (its snapshot's, then each turn's)
  jobs: ReadonlyMap<AppSessionId, readonly Job[]>; // the latest jobs a watch of this page heard (its snapshot's, then each `subagents`)
  told: ReadonlyMap<AppSessionId, ReadonlyMap<string, RequestSettlement>>; // M6: settlements an answer of this page was told, by request
}

// How a request of a bridged session was settled (DX4 `settled`'s words, `winner` 'web' | 'terminal' | 'other'), or that
// it is the terminal's to answer (`terminalOnly`: a background request past its window). P5 O9 M6.
export interface RequestSettlement {
  winner: string | null;
  outcome: string | null;
  by: string | null;
  terminalOnly?: true;
}

// The bridge's `usage` (DX5, `desk-hub/protocol`'s `Usage`): the context's fill, absent until a response reported it.
export interface LaneAUsage {
  context: { tokens?: number; window: number; percent?: number };
  cost: { usd: number } | null;
}

const empty = (): LaneAStore => ({ states: new Map(), catalogs: new Map(), pendingSends: new Map(), uploads: new Map(), usage: new Map(), jobs: new Map(), told: new Map() });

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
    const told = state === null && s.told.has(appSessionId) ? new Map(s.told) : s.told;
    if (state === null) {
      states.delete(appSessionId);
      (catalogs as Map<AppSessionId, LaneACatalog>).delete(appSessionId);
      (told as Map<AppSessionId, ReadonlyMap<string, RequestSettlement>>).delete(appSessionId);
    } else states.set(appSessionId, state);
    const held = s.pendingSends.get(appSessionId);
    const followed = held ? follow(held, state) : undefined;
    return { states, catalogs, told, pendingSends: held && followed !== held ? withPending(s.pendingSends, appSessionId, followed!) : s.pendingSends };
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

// The session's background shells and monitors as main derives them from its transcript (M5). They outlast the watch
// that heard them only when none still runs (the session's process gone, each job ended or exited): a running one whose
// watch ended unheard-of is no longer known to run.
export function noteLaneAJobs(appSessionId: AppSessionId, jobs: readonly Job[]): void {
  useLaneA.setState((s) => ({ jobs: new Map(s.jobs).set(appSessionId, jobs) }));
}
export function laneAJobsWatchEnded(appSessionId: AppSessionId): void {
  const jobs = useLaneA.getState().jobs.get(appSessionId);
  if (!jobs?.some((j) => j.status === 'running')) return;
  useLaneA.setState((s) => {
    const next = new Map(s.jobs);
    next.delete(appSessionId);
    return { jobs: next };
  });
}
export const useLaneAJobs = (appSessionId: AppSessionId): readonly Job[] | null => useLaneA((s) => s.jobs.get(appSessionId) ?? null);

// P5 O9 M6: what an answer was told of its request's settlement (`not_pending`), kept while the session is in lane A.
export function noteLaneASettlement(appSessionId: AppSessionId, request: string, settlement: RequestSettlement): void {
  useLaneA.setState((s) => ({ told: new Map(s.told).set(appSessionId, new Map(s.told.get(appSessionId)).set(request, settlement)) }));
}

// M7: the composer's upload, each file `queued` until the bridge says more (src/renderer/src/lane-a/uploads.ts follows it).
export function holdUpload(appSessionId: AppSessionId, upload: string, names: readonly string[]): void {
  const held: LaneAUpload = { upload, files: names.map((name) => ({ name, state: 'queued', reason: null })) };
  useLaneA.setState((s) => ({ uploads: new Map(s.uploads).set(appSessionId, [...(s.uploads.get(appSessionId) ?? []).filter((u) => u.upload !== upload), held]) }));
}

// The upload as one `media` op message says it: its `attachments` are the whole upload as it stands. Answers the upload
// as it now stands, or null when it is not held.
export function noteUploadStates(appSessionId: AppSessionId, upload: string, attachments: readonly { index: number; state: string; reason?: string }[]): LaneAUpload | null {
  const held = useLaneA.getState().uploads.get(appSessionId)?.find((u) => u.upload === upload);
  if (!held) return null;
  const files = held.files.map((file, index) => {
    const said = attachments.find((a) => a.index === index);
    return said ? { name: file.name, state: said.state, reason: said.reason ?? null } : file;
  });
  const next = { upload, files };
  useLaneA.setState((s) => ({ uploads: new Map(s.uploads).set(appSessionId, (s.uploads.get(appSessionId) ?? []).map((u) => (u.upload === upload ? next : u))) }));
  return next;
}

export function dismissUpload(appSessionId: AppSessionId, upload: string): void {
  useLaneA.setState((s) => {
    const left = (s.uploads.get(appSessionId) ?? []).filter((u) => u.upload !== upload);
    const uploads = new Map(s.uploads);
    if (left.length === 0) uploads.delete(appSessionId);
    else uploads.set(appSessionId, left);
    return { uploads };
  });
}

export function dismissPendingSend(appSessionId: AppSessionId, key: DeliveryKey): void {
  useLaneA.setState((s) => ({ pendingSends: withPending(s.pendingSends, appSessionId, (s.pendingSends.get(appSessionId) ?? []).filter((p) => !sameKey(p.key, key))) }));
}

// Subscribes, then lists this machine's sessions and each listed machine's; a change that raced its machine's list is
// applied after it. 2026-10-31: this machine's list is asked again until answered (an upgrade's mawsd restart answers
// the page's first reads host_unavailable; ../ipc/until-answered.ts), its changes held again while it is out.
export function connectLaneA(client: MawsBridge = ipc): () => void {
  catalogClient = client;
  const local = client.localMachine;
  const buffers = new Map<MachineRef, [AppSessionId, LaneAState | null][]>([[local, []]]); // the machines whose list is on its way
  let listed = new Set<MachineRef>(); // the other machines listed
  let live = true;
  const off = client.on('laneA.changed', ({ appSessionId, state }) => {
    if (!live) return;
    const buffer = buffers.get(machineOf(appSessionId));
    if (buffer) buffer.push([appSessionId, state]);
    else applyLaneAState(appSessionId, state);
  });
  const settle = (machine: MachineRef, result: CommandResult<'laneA.list'>) => {
    const raced = buffers.get(machine) ?? [];
    buffers.delete(machine);
    if (!live) return;
    if (result.ok) applyLaneAList(machine, result.value.states);
    else console.warn(`[lane-a] laneA.list unavailable on ${machine}; starting empty`, result.error.message);
    for (const [id, state] of raced) applyLaneAState(id, state);
  };
  const stopLocal = askUntilAnswered(client, async () => {
    if (!buffers.has(local)) buffers.set(local, []);
    const result = await client.invoke('laneA.list', undefined);
    settle(local, result);
    return result.ok;
  });
  // M9: each machine the rows list, as the roster gains or loses it
  const follow = (machines: ReadonlySet<MachineRef>) => {
    for (const machine of machines) {
      if (machine === local || listed.has(machine)) continue;
      buffers.set(machine, []);
      void client.invoke('laneA.list', undefined, { machine }).then((result) => (listed.has(machine) ? settle(machine, result) : buffers.delete(machine)));
    }
    for (const machine of listed) if (!machines.has(machine)) applyLaneAList(machine, []);
    listed = new Set([...machines].filter((machine) => machine !== local));
  };
  follow(useSessions.getState().listedMachines);
  const offRoster = useSessions.subscribe((state, before) => {
    if (live && state.listedMachines !== before.listedMachines) follow(state.listedMachines);
  });
  return () => {
    live = false;
    stopLocal();
    off();
    offRoster();
    if (catalogClient === client) catalogClient = null;
  };
}

// Tests: the store and its reads back to empty.
export function resetLaneAStore(): void {
  reading.clear();
  catalogClient = null;
  useLaneA.setState(empty());
}
