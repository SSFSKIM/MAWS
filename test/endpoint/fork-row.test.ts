// The fork the UX wave offers another machine (U9, M2; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md,
// Interfaces §1 and M2; the section's UC-7.4): `session.fork` in place, a `machine` act the machine's owners alone may
// make, who must also hold `view` on the source, signed with the step-up key. Through the real gate, for each refusal the
// row can give, and run once through the services' ledger (`machine.op`) by the services' own handlers over the real
// index and a real SessionService (its engine host a stand-in: test/support/session-harness.ts), whose ceiling is the
// endpoint's own policy read as it stands when the fork is allocated (`Endpoint.aboveCeiling`).
//
// The fork is composed on the machine and answered at its setup's `launching`, so its record exists when the device opens
// its tab; it carries no starter (`launchedBy`), so it belongs to the machine's owners. The ceiling is judged on the very
// record the fork copies its mode from: a mode raised after the endpoint admitted the fork and before the services read
// the source fails it `ceiling`, nothing allocated and nothing launched; a mode raised once the fork is allocated does not
// reach it.
//
// The org (sub-harness.ts): A owns the machine `mini`; B and C are members.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { keyId, signRecord, SIGNING_DOMAINS, type Action, type Grant } from 'org-protocol';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { HandlerContext } from '@shared/ipc/client';
import { OFFERS } from '../../src/endpoint/offers';
import { registerIndexHandlers } from '../../src/services/index/register';
import { registerSessionServiceHandlers } from '../../src/services/sessions/service-register';
import { sessionIdFor, summary } from '../support/index-fixture';
import { SessionHarness } from '../support/session-harness';
import { iso } from './org-fixtures';
import { act, done, makeOrg, openRemote, ORG, startEndpoint, stopAll, type Fixture, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const harnesses: SessionHarness[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
  for (const h of harnesses.splice(0)) h.dispose();
});

const DEFAULT_MODE = { requested: 'default', effective: 'default', refusal: null } as const;
const BYPASS_MODE = { requested: 'bypassPermissions', effective: 'bypassPermissions', refusal: null } as const;

/** The machine: its endpoint, and the services' real index and session service behind its spine, held to its ceiling. */
async function machine(): Promise<{ f: Fixture; h: SessionHarness }> {
  const f = await startEndpoint(org, started, { limits: { perSource: { burst: 100, perMinute: 6_000 }, overall: { burst: 100, perMinute: 6_000 } } });
  const h = await new SessionHarness({ aboveCeiling: (mode) => f.endpoint.aboveCeiling(mode) }).start();
  harnesses.push(h);
  registerIndexHandlers(h.index, f.spine.bus as never);
  registerSessionServiceHandlers(h.service, { register: f.spine.bus.register, intercept: () => () => {} } as never, 'index');
  return { f, h };
}

let sid = 0x9f00;
/** A lane B session MAWS runs, with a conversation to fork, `owners` its record's (the machine's by default). */
function source(f: Fixture, h: SessionHarness, owners: string[] = ['@machine']): { app: AppSessionId; engine: SessionId } {
  const engine = sessionIdFor(sid++);
  h.trustDirectory(h.work);
  const record = h.index.sessions.upsertFromSummary(summary({ sessionId: engine, directory: h.work, customTitle: 'Studio plan' })).record;
  h.index.sessions.applyEngineStatus(record.appId, { permissionMode: DEFAULT_MODE });
  h.writeTranscript(h.work, engine);
  f.records.set({ lane: 'B', session: engine, owners, shares: [] }, record.appId);
  return { app: record.appId, engine };
}

const forkArgs = (app: AppSessionId, more: Record<string, unknown> = {}) => ({ appSessionId: app, target: { kind: 'inPlace' }, message: null, rewindTo: null, ...more });
/** The fork as the device's adapter builds it: a `machine` act, no session, no context, signed before it goes. */
const stepped = (f: Fixture, r: Remote, args: Record<string, unknown>): Promise<Action> => r.device.stepUp(r.device.action({ machine: f.ref, action: 'session.fork', args }));

/** The act's ack's word, and its outcome when accepted. */
async function run(r: Remote, action: Action): Promise<{ ack: string; outcome?: unknown }> {
  const from = r.inbox.length;
  const ack = await act(r, action);
  return ack === 'ok' ? { ack, outcome: await done(r, action, from) } : { ack };
}

/** A grant of `rights` on the machine to `member`, signed by the owner's device. */
async function grant(f: Fixture, member: string, rights: Grant['rights']): Promise<void> {
  const body: Grant = { org: ORG, machine: f.ref, machineKey: await keyId(f.key.pub), member, rights, version: 1, issued: iso(Date.now()) };
  await f.endpoint.cli('grant', ['-'], JSON.stringify(await signRecord(SIGNING_DOMAINS.grant, body, org.a1.stepUp.privateKey, org.a1.stepUp.pub)));
}

const claimed = (f: Fixture) => f.spine.claimed.filter((c) => c.name === 'session.fork');
/** The setup intents on disk: none at all where nothing was ever allocated. */
const intentFiles = (h: SessionHarness) => {
  const dir = join(h.userData, 'sessions', 'intents');
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
};

describe('the fork row', () => {
  it('is a `machine` act on the session, the machine’s owners’ alone, taking an in-place fork only', () => {
    const row = OFFERS.commands['session.fork'];
    expect(row).toMatchObject({ kind: 'act', executor: 'machine', target: 'appSessionId', owners: true });
    const app = '9b8f3a52-0000-4000-8000-0000000000f1';
    expect(row.accepts!({ appSessionId: app, target: { kind: 'inPlace' }, message: null, rewindTo: null })).toBe(true);
    expect(row.accepts!({ appSessionId: app, target: { kind: 'inPlace' }, message: { content: 'go on', display: 'go on' }, rewindTo: 'u-1' })).toBe(true);
    expect(row.accepts!({ appSessionId: app, target: { kind: 'newWorktree', name: 'w', branch: { kind: 'new', name: 'w', base: 'HEAD' } }, message: null, rewindTo: null })).toBe(false);
    expect(row.accepts!({ appSessionId: app, target: { kind: 'inPlace', extra: 1 }, message: null, rewindTo: null })).toBe(false);
  });
});

describe('a fork from another machine', () => {
  it('runs for an owner of the machine who views the source, once, answered `starting` when its record exists, with no starter', async () => {
    const { f, h } = await machine();
    const { app, engine } = source(f, h);
    const a = await openRemote(f, org.a1, org.A);
    const message = { content: 'Reply OK', display: 'Reply OK' };
    const ran = await run(a, await stepped(f, a, forkArgs(app, { message })));
    expect(ran).toMatchObject({ ack: 'ok', outcome: { state: 'done', result: { status: 'starting' } } });
    const forkId = (ran.outcome as { result: { appSessionId: AppSessionId } }).result.appSessionId;
    expect(forkId).not.toBe(app);
    // answered once its setup reached `launching`: the record is there when the device opens its tab
    const record = h.index.sessions.get(forkId);
    expect(record).toMatchObject({ appId: forkId, directory: h.work, permissionMode: DEFAULT_MODE });
    expect(record!.launchedBy).toBeUndefined(); // a fork names no starter: it belongs to the machine's owners
    expect(claimed(f)).toHaveLength(1);
    expect(claimed(f)[0]!.op).toMatchObject({ member: org.A });
    expect(await h.settled(forkId)).toMatchObject({ phase: 'ready', outcome: { firstTurn: 'sent' } });
    expect(h.host.launches).toEqual([expect.objectContaining({ appSessionId: forkId, cwd: h.work, permissionMode: 'default', resume: { sessionId: engine, fork: true } })]);
    expect(h.host.launches[0]).not.toHaveProperty('launchedBy');
    expect(h.host.calledWith('session.send')).toEqual([{ appSessionId: forkId, content: 'Reply OK' }]);
  });

  it('makes a second fork for a second act from the same device', async () => {
    const { f, h } = await machine();
    const { app } = source(f, h);
    const a = await openRemote(f, org.a1, org.A);
    const first = await run(a, await stepped(f, a, forkArgs(app)));
    const second = await run(a, await stepped(f, a, forkArgs(app)));
    const ids = [first, second].map((ran) => (ran.outcome as { result: { appSessionId: string } }).result.appSessionId);
    expect(new Set([app, ...ids]).size).toBe(3);
    expect(claimed(f)).toHaveLength(2);
  });

  it('refuses a member who is not one of the machine’s owners `owners-only`, a holder of a spawn grant included, unrun', async () => {
    const { f, h } = await machine();
    const { app } = source(f, h);
    const b = await openRemote(f, org.b1, org.B);
    expect(await act(b, await stepped(f, b, forkArgs(app)))).toBe('owners-only');
    await grant(f, org.B, ['spawn']);
    expect(await act(b, await stepped(f, b, forkArgs(app)))).toBe('owners-only');
    expect(claimed(f)).toEqual([]);
  });

  it('refuses an owner who does not hold `view` on the source `grade`, unrun', async () => {
    const { f, h } = await machine();
    const { app } = source(f, h, [org.B]); // B's, listed: the machine's owner A holds `list` on it, below `view`
    const a = await openRemote(f, org.a1, org.A);
    expect(await act(a, await stepped(f, a, forkArgs(app)))).toBe('grade');
    expect(claimed(f)).toEqual([]);
  });

  it('refuses in read-only mode `read-only`, a target other than in place `malformed`, and an unsigned fork `step-up`, each unrun', async () => {
    const { f, h } = await machine();
    const { app } = source(f, h);
    const a = await openRemote(f, org.a1, org.A);
    const worktree = { kind: 'newWorktree', name: 'loft', branch: { kind: 'new', name: 'loft', base: 'HEAD' } };
    expect(await act(a, await stepped(f, a, forkArgs(app, { target: worktree })))).toBe('malformed');
    expect(await act(a, a.device.action({ machine: f.ref, action: 'session.fork', args: forkArgs(app) }))).toBe('step-up');
    f.endpoint.policy.set({ read_only: true });
    expect(await act(a, await stepped(f, a, forkArgs(app)))).toBe('read-only');
    expect(claimed(f)).toEqual([]);
    expect(h.host.launches).toEqual([]);
  });

  it('answers a source whose turn runs with the guard’s own refusal and leaves nothing behind', async () => {
    const { f, h } = await machine();
    const { app } = source(f, h);
    h.host.reserve(app, { cwd: h.work, turn: { id: 't1', origin: 'human', startedAt: '', acceptedAt: null, userMessageUuids: [] } as never });
    const a = await openRemote(f, org.a1, org.A);
    expect(await run(a, await stepped(f, a, forkArgs(app)))).toEqual({
      ack: 'ok',
      outcome: { state: 'done', result: { status: 'refused', appSessionId: app, reason: 'busy', message: 'the session has a turn running; fork it once the turn ends' } },
    });
    expect(intentFiles(h)).toEqual([]);
    expect(h.host.launches).toEqual([]);
  });
});

describe('the ceiling, judged where the fork is allocated', () => {
  /** The services' fork handler, run after `before` (what happens between the endpoint's decision and the services). */
  function between(f: Fixture, before: () => void): void {
    const handler = f.spine.handlers.get('session.fork')!;
    f.spine.handle('session.fork', (input: unknown, context: HandlerContext) => (before(), handler(input, context)));
  }

  it('fails a fork whose source’s mode was raised above the ceiling after the endpoint admitted it: nothing allocated, nothing launched', async () => {
    const { f, h } = await machine();
    const { app } = source(f, h);
    f.endpoint.policy.set({ ceiling: 'acceptEdits' }); // the source's `default` is within it when the endpoint decides
    between(f, () => h.index.sessions.applyEngineStatus(app, { permissionMode: BYPASS_MODE }));
    const a = await openRemote(f, org.a1, org.A);
    expect(await run(a, await stepped(f, a, forkArgs(app)))).toEqual({
      ack: 'ok',
      outcome: { state: 'failed', error: { code: 'internal', message: expect.any(String), issues: { refusal: 'ceiling', mode: 'bypassPermissions' } } },
    });
    expect(claimed(f)).toHaveLength(1);
    expect(h.events.filter((e) => e.name === 'session.intent.changed')).toEqual([]); // never allocated, not allocated and dropped
    expect(intentFiles(h)).toEqual([]);
    expect(await h.service.listIntents()).toEqual([]);
    expect(h.host.launches).toEqual([]);
  });

  it('launches a fork with the mode that was judged when the source’s mode is raised right after the allocation', async () => {
    const { f, h } = await machine();
    const { app } = source(f, h);
    f.endpoint.policy.set({ ceiling: 'acceptEdits' });
    // the first call the services make of the engine host once the fork's intent is written: the source changes then
    const allocated = () => h.events.some((e) => e.name === 'session.intent.changed' && (e.payload as { intent: { kind?: string } | null }).intent?.kind === 'fork');
    let raised = false;
    h.host.onCall = () => {
      if (raised || !allocated()) return;
      raised = true;
      h.index.sessions.applyEngineStatus(app, { permissionMode: BYPASS_MODE });
    };
    const a = await openRemote(f, org.a1, org.A);
    const ran = await run(a, await stepped(f, a, forkArgs(app)));
    expect(ran).toMatchObject({ ack: 'ok', outcome: { state: 'done', result: { status: 'starting' } } });
    expect(raised).toBe(true);
    const forkId = (ran.outcome as { result: { appSessionId: AppSessionId } }).result.appSessionId;
    await h.settled(forkId);
    expect(h.host.launches).toEqual([expect.objectContaining({ appSessionId: forkId, permissionMode: 'default' })]);
    expect(h.index.sessions.get(app)!.permissionMode).toEqual(BYPASS_MODE);
  });

  it('fails a fork whose source is above the ceiling as the endpoint’s policy stands, and lets one within it run', async () => {
    const { f, h } = await machine();
    const { app } = source(f, h);
    h.index.sessions.applyEngineStatus(app, { permissionMode: BYPASS_MODE });
    const a = await openRemote(f, org.a1, org.A);
    expect(await run(a, await stepped(f, a, forkArgs(app)))).toMatchObject({ ack: 'ok', outcome: { state: 'failed', error: { issues: { refusal: 'ceiling', mode: 'bypassPermissions' } } } });
    f.endpoint.policy.set({ ceiling: 'bypassPermissions' });
    expect(await run(a, await stepped(f, a, forkArgs(app)))).toMatchObject({ ack: 'ok', outcome: { state: 'done', result: { status: 'starting' } } });
  });
});
