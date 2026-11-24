// The spine's prestart of a New chat's engine (ticket 851; docs/doperpowers/plans/2026-11-24-prestart-engine.md, D5, D7,
// D8, D10, R4-4). The window asks while its person types; the spine answers with the guards Send uses and the spec Send
// builds, writing nothing, and asks the engine host to launch that spec hidden (`session.prestart`) for this spine root.
// At Send the setup offers the host that engine (`adopt`, setup.ts); the host adopts it only when the spec and the key
// still match, and launches fresh otherwise.
//
// What the spine keeps is in memory and dies with the root (the host ends a root's prestarts when it is released or its
// connection ends): per intent, the live request's token and epoch, its fences, its host calls in order, the last
// generation the host gave it with the connection that gave it, and whether a request reached the host (which Send's
// launch reads once); `PrestartRequests` below.
import type { AppSessionId } from '@shared/graph/ids';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { SetupIntent } from '@shared/sessions/intent';
import type { LaunchMode } from '@shared/sessions/select-source';
import { ownerChannelLaunch } from '../owner/launch';
import { realOrSelf } from './context';
import { seedPermissionMode, trustMapping } from './launch-mapping';
import { hostLaunchOf } from './machine-route';
import { servedSet } from './served-set';
import { existingWorktreeOf, intentSpecOf, wantedSet, type Setup } from './setup';
import { judgeIntent } from './start-guards';
import { trustStateOf } from './trust';

// D9: whether a spine root prestarts at all. Under MAWS_E2E=1 only a scene that asks (MAWS_E2E_PRESTART=1); never in
// launch mode `scenario`, whose stub source launches nothing. The replay seam, where each launch takes the next fixture, is
// the service's own check.
export function prestartSwitchedOn(env: Record<string, string | undefined>, mode: LaunchMode): boolean {
  return mode === 'index' && (env.MAWS_E2E !== '1' || env.MAWS_E2E_PRESTART === '1');
}

export type PrestartAnswer = { status: 'started' | 'running' | 'skipped'; token: string | null; reason?: string };
export const skipped = (reason: string): PrestartAnswer => ({ status: 'skipped', token: null, reason });

// The shape D8 admits, read from the intent alone: a New chat (kind create, no lineage, no remote spawner) in a directory
// or an existing worktree, with no failed attempt, no trust bootstrap and no message held behind a card. The reason it
// is not, or null.
export function prestartShapeRefusal(intent: SetupIntent | null): string | null {
  if (intent === null) return 'unknown_intent: no setup intent';
  if (intent.kind !== 'create' || intent.lineage) return 'not_new: a fork or a side thread starts from its source';
  if (intent.launchedBy) return 'spawned: a session another machine asked for';
  if (intent.location === null) return 'no_location: no project chosen';
  if (intent.location.kind === 'newWorktree') return 'new_worktree: its checkout is made at Send';
  if (intent.progress.lastFailure !== null) return 'failed: a failed attempt waits for its card';
  if (intent.progress.bootstrap !== null) return 'bootstrap: a trust bootstrap is pending';
  if (intent.message !== null) return 'card: a message waits behind a card';
  return null;
}

// The spec and the key a Send of `intent` would launch with now, built as Send builds them (the served set, the launch
// directory, the trust mapping, the owner channel's decision without its reservation, the spec the host is sent), after
// the start guards with the relay's cached health; or why it is not prestarted. `intent` is as Send's guards would write
// it (its trust decision bound to the key the location answers to now); nothing here writes, and the session's cua socket
// is named by `browserSocketPath`, which sets nothing up (M3's review, finding 1).
export async function prestartLaunch(s: Setup, intent: SetupIntent, browserSocketPath: (appSessionId: AppSessionId) => string | null): Promise<{ spec: LaunchSpec; key: string } | { skip: string }> {
  const verdict = await judgeIntent(s, intent, { startAnyway: false, relay: 'cached' });
  if (verdict.kind === 'rejected') return { skip: `${verdict.outcome.status}: a start would be refused` };
  if (verdict.kind === 'card') return { skip: `${verdict.outcome.status}: a start would show its card` };
  const gate = await s.launchGate();
  if (gate !== null) return { skip: `launch_gate: ${gate.reason}` };
  const served = await servedSet(s, wantedSet(s, intent));
  if ('refused' in served) return { skip: `tools: ${served.refused}` };
  const location = intent.location!; // a directory or an existing worktree: checked by the shape and the guards
  if (location.kind === 'newWorktree') return { skip: 'new_worktree: its checkout is made at Send' };
  const cwd = location.kind === 'existingWorktree' ? (await existingWorktreeOf(s, location)).path : await realOrSelf(location.path);
  const trust = await trustStateOf(cwd, { git: s.git, env: s.env });
  const mapping = trustMapping({ decision: intent.trust, decisionKey: intent.trustKey, trustRecorded: intent.progress.trustRecorded }, trust);
  if (mapping.bootstrap) return { skip: 'trust_bootstrap: a start would record trust first' };
  const mode = intent.permissionMode ?? seedPermissionMode(await s.userDefaults());
  const spec = intentSpecOf(s, intent, { route: verdict.route, directFallback: false }, { cwd, mode, attestation: mapping.attestation, replay: null, browserBackend: browserSocketPath(intent.appSessionId), mawsTools: served.set });
  const decided = await ownerChannelLaunch(s, spec, { kind: 'new', transcriptOf: null }, { reserve: false });
  const sent = await hostLaunchOf(s, decided.spec);
  if ('refused' in sent) return { skip: `route: ${sent.refused}` };
  if (sent.key === null) return { skip: 'route: the machine route’s base URL is not known for certain here' };
  return { spec: sent.spec, key: sent.key };
}

// The requests' bookkeeping (R4-4, and M3's review: Decision Log 13), per intent:
// - the line: the window's token and the epoch of its newest request. A request's epoch is set before its first await
//   and checked just before it dispatches `session.prestart`; a newer request, a withdraw, a fence and the root's stop
//   end it. A patch's request keeps the token, so the window that asked can withdraw whatever generation now serves it.
// - the fences: a discard and a Send each hold one from their entry to their end; while any is held no request of the id
//   begins or dispatches.
// - the id's host calls, one at a time in order (`serial`): a dispatch with its answer, and each withdraw. A withdraw
//   queued behind a dispatch on its way therefore names that dispatch's generation, and a newer request dispatches only
//   after every withdraw queued before it was sent, so a late cleanup never meets a generation a newer request was told.
// - the generation the host gave last, with the engine host connection it was given on: it is withdrawn only on that
//   connection (a successor host counts its own from 1, and the old one's prestarts died with its connection).
// - whether a request reached the host, which Send's launch reads once to offer the host its engine.
// - the tokens withdrawn that ended no line (M4, Decision Log 14): nothing orders the window's withdraw behind the request
//   carrying its token, so a withdraw that arrives first leaves a tombstone and that request is answered `skipped`,
//   dispatching nothing. At most WITHDRAWN_KEPT per intent, the newest kept; a discard, and a Send that launched, clear them.
export type PrestartLink = object; // an engine host connection (its welcome), compared by identity

interface PrestartId {
  line: { token: string; epoch: number } | null;
  fences: number;
  calls: Promise<unknown>;
  pending: number; // host calls queued or under way
  known: { generation: number; link: PrestartLink } | null;
  requested: boolean;
  withdrawn: string[]; // tombstones, oldest first
}

/** The tombstones kept per intent: a window withdraws at most its last token at each move, and moves are few. */
export const WITHDRAWN_KEPT = 4;

export class PrestartRequests {
  private seq = 0;
  private stopped = false;
  private readonly ids = new Map<AppSessionId, PrestartId>();

  // A request begins (the window's, or a patch's under the same token): its epoch, or null while the id is fenced or the
  // root has stopped.
  begin(appSessionId: AppSessionId, token: string): number | null {
    if (this.stopped) return null;
    const id = this.of(appSessionId);
    if (id.fences > 0 || id.withdrawn.includes(token)) return null;
    id.line = { token, epoch: ++this.seq };
    return id.line.epoch;
  }

  current(appSessionId: AppSessionId, epoch: number): boolean {
    const id = this.ids.get(appSessionId);
    return !this.stopped && id !== undefined && id.fences === 0 && id.line?.epoch === epoch;
  }

  tokenOf(appSessionId: AppSessionId): string | null {
    return this.ids.get(appSessionId)?.line?.token ?? null;
  }

  // Ends the line (with `token`, only that token's): whether one ended. A token that ends no line is the window's withdraw
  // ahead of its request (or after it ended): a tombstone, so a request still to come under it begins nothing.
  end(appSessionId: AppSessionId, token?: string): boolean {
    if (token !== undefined && this.ids.get(appSessionId)?.line?.token !== token) {
      if (this.stopped) return false;
      const id = this.of(appSessionId);
      if (!id.withdrawn.includes(token)) id.withdrawn = [...id.withdrawn, token].slice(-WITHDRAWN_KEPT);
      return false;
    }
    const id = this.ids.get(appSessionId);
    if (id?.line == null) return false;
    id.line = null;
    return true;
  }

  // The intent was discarded or launched: its tombstones go.
  clearWithdrawn(appSessionId: AppSessionId): void {
    const id = this.ids.get(appSessionId);
    if (id === undefined) return;
    id.withdrawn = [];
    this.prune(appSessionId, id);
  }

  // A discard or a Send: the line ends with nothing withdrawn, and no request of the id begins or dispatches until the
  // returned release (called once).
  fence(appSessionId: AppSessionId): () => void {
    const id = this.of(appSessionId);
    id.fences += 1;
    id.line = null;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      id.fences -= 1;
      this.prune(appSessionId, id);
    };
  }

  // The root stopped: every line ends, and nothing begins or dispatches from now on.
  stop(): void {
    this.stopped = true;
    for (const id of this.ids.values()) id.line = null;
  }

  // The id's host calls, run one at a time in the order they were queued.
  serial<T>(appSessionId: AppSessionId, call: () => Promise<T>): Promise<T> {
    const id = this.of(appSessionId);
    id.pending += 1;
    const run = id.calls.then(call, call);
    id.calls = run.then(
      () => undefined,
      () => undefined,
    );
    void id.calls.then(() => {
      id.pending -= 1;
      this.prune(appSessionId, id);
    });
    return run;
  }

  // In a dispatch's call: the request is sent now (Send's launch of the intent offers to adopt from here on), and what
  // the host answered on `link` (generation 0: refused).
  dispatching(appSessionId: AppSessionId): void {
    this.of(appSessionId).requested = true;
  }
  admitted(appSessionId: AppSessionId, generation: number, link: PrestartLink): void {
    if (generation > 0) this.of(appSessionId).known = { generation, link };
  }

  // In a withdraw's call: the generation to withdraw on `link` (null: none, or one another connection gave); the id's
  // generation is forgotten either way.
  takeKnown(appSessionId: AppSessionId, link: PrestartLink | null): number | null {
    const id = this.ids.get(appSessionId);
    const known = id?.known ?? null;
    if (id !== undefined) id.known = null;
    return known !== null && known.link === link ? known.generation : null;
  }

  // Whether a request of this id reached the host, asked once by the start whose guards passed.
  takeRequested(appSessionId: AppSessionId): boolean {
    const id = this.ids.get(appSessionId);
    if (id === undefined) return false;
    const requested = id.requested;
    id.requested = false;
    return requested;
  }

  private of(appSessionId: AppSessionId): PrestartId {
    let id = this.ids.get(appSessionId);
    if (id === undefined) this.ids.set(appSessionId, (id = { line: null, fences: 0, calls: Promise.resolve(), pending: 0, known: null, requested: false, withdrawn: [] }));
    return id;
  }

  private prune(appSessionId: AppSessionId, id: PrestartId): void {
    if (id.line === null && id.fences === 0 && id.pending === 0 && id.known === null && !id.requested && id.withdrawn.length === 0 && this.ids.get(appSessionId) === id) this.ids.delete(appSessionId);
  }
}
