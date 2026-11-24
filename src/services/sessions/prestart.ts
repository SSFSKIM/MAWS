// The spine's prestart of a New chat's engine (ticket 851; docs/doperpowers/plans/2026-11-24-prestart-engine.md, D5, D7,
// D8, D10, R4-4). The window asks while its person types; the spine answers with the guards Send uses and the spec Send
// builds, writing nothing, and asks the engine host to launch that spec hidden (`session.prestart`) for this spine root.
// At Send the setup offers the host that engine (`adopt`, setup.ts); the host adopts it only when the spec and the key
// still match, and launches fresh otherwise.
//
// What the spine keeps is in memory and dies with the root (the host ends a root's prestarts when it is released or its
// connection ends): per intent, the live request's token and epoch, the newest generation the host gave it, and whether
// a request reached the host (which Send's launch reads once).
import { randomUUID } from 'node:crypto';
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
// it (its trust decision bound to the key the location answers to now); nothing here writes.
export async function prestartLaunch(s: Setup, intent: SetupIntent): Promise<{ spec: LaunchSpec; key: string } | { skip: string }> {
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
  const spec = intentSpecOf(s, intent, { route: verdict.route, directFallback: false }, { cwd, mode, attestation: mapping.attestation, replay: null, mawsTools: served.set });
  const decided = await ownerChannelLaunch(s, spec, { kind: 'new', transcriptOf: null }, { reserve: false });
  const sent = await hostLaunchOf(s, decided.spec);
  if ('refused' in sent) return { skip: `route: ${sent.refused}` };
  if (sent.key === null) return { skip: 'route: the machine route’s base URL is not known for certain here' };
  return { spec: sent.spec, key: sent.key };
}

// The requests' bookkeeping (R4-4). A request's epoch is set before its first await and checked just before it dispatches
// `session.prestart`; a discard, a Send, a withdraw and a newer request end it. A patch's request keeps the token, so the
// window that asked can withdraw whatever generation now serves it. A withdraw (or a request that finds the intent no
// longer eligible) ends the line and withdraws the newest generation known; a request of the line still on its way then
// has its generation withdrawn when it is answered.
export class PrestartRequests {
  private seq = 0;
  private readonly lines = new Map<AppSessionId, { token: string; epoch: number }>();
  private readonly generations = new Map<AppSessionId, number>();
  private readonly inflight = new Map<number, AppSessionId>();
  private readonly orphaned = new Set<number>();
  private readonly requested = new Set<AppSessionId>();

  begin(appSessionId: AppSessionId, token: string = randomUUID()): { token: string; epoch: number } {
    const epoch = ++this.seq;
    this.lines.set(appSessionId, { token, epoch });
    return { token, epoch };
  }

  current(appSessionId: AppSessionId, epoch: number): boolean {
    return this.lines.get(appSessionId)?.epoch === epoch;
  }

  tokenOf(appSessionId: AppSessionId): string | null {
    return this.lines.get(appSessionId)?.token ?? null;
  }

  // the request is sent to the host now: Send's launch of the intent offers to adopt from here on
  dispatching(appSessionId: AppSessionId, epoch: number): void {
    this.inflight.set(epoch, appSessionId);
    this.requested.add(appSessionId);
  }

  // the host answered (generation 0: refused, or no answer); whether that generation must be withdrawn now
  answered(appSessionId: AppSessionId, epoch: number, generation: number): boolean {
    this.inflight.delete(epoch);
    if (generation > 0) this.generations.set(appSessionId, Math.max(generation, this.generations.get(appSessionId) ?? 0));
    return this.orphaned.delete(epoch) && generation > 0;
  }

  // The line ends and its prestart goes: the newest generation known to withdraw now (null: none), and every request of
  // the id still on its way withdrawn when answered. With `token`, only that token's line (else nothing, null).
  withdraw(appSessionId: AppSessionId, token?: string): number | null {
    const line = this.lines.get(appSessionId);
    if (line === undefined || (token !== undefined && line.token !== token)) return null;
    this.lines.delete(appSessionId);
    for (const [epoch, id] of this.inflight) if (id === appSessionId) this.orphaned.add(epoch);
    const generation = this.generations.get(appSessionId) ?? null;
    this.generations.delete(appSessionId);
    return generation;
  }

  // A Send marks the start: the line ends with nothing withdrawn (the launch adopts the prestart or ends it).
  sendStarted(appSessionId: AppSessionId): void {
    this.lines.delete(appSessionId);
  }

  // A discard: the line ends and the id is forgotten here (the host's `session.forget` ends its prestart).
  discarded(appSessionId: AppSessionId): void {
    this.lines.delete(appSessionId);
    this.generations.delete(appSessionId);
    this.requested.delete(appSessionId);
  }

  // Whether a request of this id reached the host, asked once by the start whose guards passed.
  takeRequested(appSessionId: AppSessionId): boolean {
    this.generations.delete(appSessionId);
    return this.requested.delete(appSessionId);
  }
}
