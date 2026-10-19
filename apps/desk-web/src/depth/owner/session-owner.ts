// The per-session owner (DC9; the composite's §9.1, "The subscription moves"): one main transcript per (machine,
// session), shared by the views that read it — the center's session view and the depth column, whose Subagents, Diff
// and Info tabs are fed by the same subscription — while any of them holds it. It is opened at the first hold and, at
// the last release, closed, its key in MAWS's store dropped, and forgotten, so a later view starts afresh. A release
// takes effect after the pass that made it, so one view handing the owner to another in the same commit (the column
// remounting, React's strict effects) keeps the subscription it has.
//
// What the views share rides on it besides the transcript: the session's liveness, told once for every view
// (`keeper.ts`: the store's `setLive`, the subscription taken up again after an end); whether the machine serves the
// transcript at all, told to the desk (`shell/transcript-served.ts`), which offers Resume only once it does; and the
// open-agent request — an `Agent` row in the center names its agent, and the column, which takes the request, opens its
// Subagents tab on it.
import { useEffect, useState } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { SubagentRef } from '../../../../../src/renderer/src/transcript/model/rows';
import type { SessionPlane } from '../../shell/session-plane';
import type { DeskSession } from '../../shell/sessions';
import { learnServed, type TranscriptServed } from '../../shell/transcript-served';
import { DeskTranscript, type TranscriptStoreApi } from '../source/desk-transcript';
import { reachOf, TranscriptKeeper } from '../source/keeper';

/** The agent an `Agent` row asked the column to open: null when the tree does not name it yet (the tree is shown). */
export type AgentRequest = { agentId: string | null };

export class SessionOwner {
  readonly plane: SessionPlane;
  readonly main: DeskTranscript;
  readonly keeper: TranscriptKeeper;
  /** The open-agent request, until the column takes it. */
  readonly agentRequest: StoreApi<{ request: AgentRequest | null }> = createStore(() => ({ request: null as AgentRequest | null }));
  private readonly where: { project: string; machine: string; session: string };
  private served: TranscriptServed | null = null;
  private offServed: (() => void) | null = null;

  constructor(options: { project: string; machine: string; session: string; plane: SessionPlane; store: TranscriptStoreApi }) {
    this.plane = options.plane;
    this.where = { project: options.project, machine: options.machine, session: options.session };
    this.main = new DeskTranscript({ plane: options.plane, project: options.project, target: { machine: options.machine, session: options.session, agentId: null }, store: options.store });
    this.keeper = new TranscriptKeeper(this.main, options.store);
  }

  /** The first hold: the subscription opens, and what it says of the machine's transcript is told to the desk. */
  start(): void {
    this.keeper.start();
    this.offServed ??= this.main.state.subscribe(() => this.readServed());
    this.readServed();
  }

  /** The last release: the subscription closes, and what it said of the transcript is forgotten with it. */
  stop(): void {
    this.offServed?.();
    this.offServed = null;
    this.served = null;
    learnServed(this.where, this, null);
    this.keeper.stop();
  }

  /**
   * Whether the machine serves the transcript: served once the subscription is live and holds a row; none once it ended
   * at n 0 with `session-ended` (DX4's one remaining meaning of it), held until rows come, so a retry under way does not
   * flicker back; unknown until either. An empty snapshot says neither: the plane answers a running session whose
   * transcript it cannot find with one, and sends no `end` when that session's process goes, and a transcript of no
   * rows resumes into an empty session all the same.
   */
  private readServed(): void {
    const { phase, ended } = this.main.state.getState();
    const rows = this.main.heldRows().length;
    let served = this.served;
    if (phase === 'live' && rows > 0) served = 'served';
    else if (phase === 'ended' && ended?.reason === 'session-ended' && rows === 0) served = 'none';
    if (served === this.served) return;
    this.served = served;
    learnServed(this.where, this, served);
  }

  /**
   * An `Agent` call's row opens its agent, as MAWS's opens its Subagents tool on it. Before the tree names the agent the
   * row's ref holds the call's id, which the tree resolves once it does; until then the tree is shown.
   */
  openSubagent(ref: SubagentRef): void {
    if (ref.kind === 'workflow') return;
    const id = String(ref.agentId ?? ref.taskId);
    const pending = ref.toolUseId !== null && id === String(ref.toolUseId);
    const resolved = pending ? this.main.state.getState().tasks.byToolUse.get(ref.toolUseId!) : id;
    this.agentRequest.setState({ request: { agentId: resolved === undefined ? null : String(resolved) } });
  }

  /** The column takes the pending request, once: a column opened later does not jump to it again. */
  takeAgentRequest(): AgentRequest | null {
    const { request } = this.agentRequest.getState();
    if (request !== null) this.agentRequest.setState({ request: null });
    return request;
  }
}

type Held = { owner: SessionOwner; holds: number };
const owners = new Map<string, Held>();
const ownerKey = (project: string, machine: string, session: string) => `${project}\u0000${machine}\u0000${session}`;
const keys = new WeakMap<SessionOwner, string>();

/**
 * The session's owner: the one the views already share, or a new one, opened only when first held. One that nobody
 * holds and that reads another plane (a project connection made anew) is replaced.
 */
export function sessionOwner(options: { project: string; machine: string; session: string; plane: SessionPlane; store?: TranscriptStoreApi }): SessionOwner {
  const key = ownerKey(options.project, options.machine, options.session);
  const held = owners.get(key);
  if (held && (held.holds > 0 || held.owner.plane === options.plane)) return held.owner;
  const owner = new SessionOwner({ ...options, store: options.store ?? useTranscriptStore });
  owners.set(key, { owner, holds: 0 });
  keys.set(owner, key);
  return owner;
}

/** Holds the owner for one view; the returned release lets it go. The first hold opens the subscription. */
export function holdOwner(owner: SessionOwner): () => void {
  const key = keys.get(owner)!;
  let held = owners.get(key);
  if (held?.owner !== owner) {
    // Let go after a view had read it and before that view held it: it is the session's again, unless another was made
    // meanwhile, which keeps the session's place (this one lives out its holds on its own).
    held = { owner, holds: 0 };
    if (!owners.has(key)) owners.set(key, held);
  }
  const mine = held;
  mine.holds += 1;
  if (mine.holds === 1) owner.start();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mine.holds -= 1;
    if (mine.holds === 0) queueMicrotask(() => letGo(key, mine));
  };
}

function letGo(key: string, held: Held): void {
  if (held.holds > 0) return;
  if (owners.get(key) === held) owners.delete(key);
  held.owner.stop();
}

/** A view's hold on its session's owner while it is mounted, with the session's liveness told to it. */
export function useSessionOwner(project: string, session: DeskSession, plane: SessionPlane): SessionOwner {
  const [owner] = useState(() => sessionOwner({ project, machine: session.machine, session: session.session, plane }));
  const reach = reachOf(session);
  useEffect(() => holdOwner(owner), [owner]);
  useEffect(() => owner.keeper.reachable(reach), [owner, reach]);
  return owner;
}
