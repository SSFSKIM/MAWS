// The services' operation ledger (P5 O3-D M4; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §H; O3X7,
// D17): `machine.op` claims and runs a `machine`-owned act through the bus's invoke, once per op id; `machine.opQuery`
// answers as `host.opQuery` does.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toWire } from '@shared/host/json-bytes';
import { OpLedger } from '@shared/host/op-ledger';
import { validateCommandInput } from '@shared/ipc/validate';
import type { HandlerContext } from '@shared/ipc/client';
import { claimable, machineOps, registerMachineOps, type LateOutcome } from './machine-ops';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CONTEXT = { client: { id: 'endpoint/device', onGone: () => () => {} } } as unknown as HandlerContext;
const CLAIM = { member: 'mem-a', device: 'dev-1', fingerprint: 'fp-1' };
const now = () => new Date().toISOString();

type Invoke = (name: string, input: unknown) => Promise<{ ok: true; value: unknown } | { ok: false; error: { code: 'internal'; message: string } }>;

function lab(invoke = vi.fn<Invoke>(async (name, input) => ({ ok: true, value: name === 'session.rename' ? undefined : { ran: name, input } }))) {
  const dir = mkdtempSync(join(tmpdir(), 'machine-ops-'));
  dirs.push(dir);
  const open = () => machineOps({ ledger: OpLedger.open(dir, 'spine-ops.jsonl'), invoke: invoke as never });
  return { ops: open(), reopen: open, invoke, file: join(dir, 'spine-ops.jsonl') };
}

describe('machine.op', () => {
  it('claims and runs a machine-owned act once, and replays a finished op’s answer, across a reopen', async () => {
    const { ops, reopen, invoke } = lab();
    const input = { opId: 'op-1', opCreated: now(), claim: CLAIM, name: 'session.rename', input: { appSessionId: 'app-1', title: 'New' } };
    expect(await ops.op(input, CONTEXT)).toEqual({ state: 'done', result: { ok: true } });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('session.rename', { appSessionId: 'app-1', title: 'New' }, { ...CONTEXT, op: { opId: 'op-1', opCreated: input.opCreated, ...CLAIM } });
    expect(await ops.op(input, CONTEXT)).toEqual({ state: 'done', result: { ok: true } });
    expect(await reopen().op(input, CONTEXT)).toEqual({ state: 'done', result: { ok: true } });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(ops.opQuery({ opId: 'op-1', opCreated: input.opCreated, tombstoneIfAbsent: false })).toEqual({ state: 'done', outcome: { ok: true }, ...CLAIM, target: 'app-1', name: 'session.rename' });
  });

  // P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §O): the claim and the sealed action
  // reach the handler, and the action is kept with the claim, never said by a query
  it('runs the claimed command with the claim and the sealed action in its context, and keeps the action with the claim', async () => {
    const { ops, invoke, file } = lab();
    const action = { v: 1, opId: 'op-act-0000000001', action: 'session.rename', args: { appSessionId: 'app-1', title: 'New' }, stepUp: { sig: 'c2ln' } };
    const opCreated = now();
    const input = { opId: 'op-act-0000000001', opCreated, claim: CLAIM, name: 'session.rename', input: { appSessionId: 'app-1', title: 'New' }, action };
    expect(await ops.op(input, CONTEXT)).toEqual({ state: 'done', result: { ok: true } });
    expect(invoke).toHaveBeenCalledWith('session.rename', { appSessionId: 'app-1', title: 'New' }, { ...CONTEXT, op: { opId: input.opId, opCreated, ...CLAIM, action } });
    const [claimed] = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { claim?: unknown });
    expect(claimed?.claim).toEqual({ ...CLAIM, target: 'app-1', name: 'session.rename', action });
    expect(ops.opQuery({ opId: input.opId, opCreated, tombstoneIfAbsent: false })).toEqual({ state: 'done', outcome: { ok: true }, ...CLAIM, target: 'app-1', name: 'session.rename' });
    // an op the endpoint sent no action for: the claim alone, in the context and the ledger
    const bare = { opId: 'op-act-0000000002', opCreated, claim: CLAIM, name: 'session.rename', input: { appSessionId: 'app-1', title: 'B' } };
    await ops.op(bare, CONTEXT);
    expect(invoke).toHaveBeenLastCalledWith('session.rename', { appSessionId: 'app-1', title: 'B' }, { ...CONTEXT, op: { opId: bare.opId, opCreated, ...CLAIM } });
    const second = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { opId: string; claim?: Record<string, unknown> }).find((line) => line.opId === bare.opId && line.claim);
    expect(second?.claim).not.toHaveProperty('action');
  });

  it('keeps a command’s refusal as its result: it was tried', async () => {
    const invoke = vi.fn<Invoke>(async () => ({ ok: false, error: { code: 'internal', message: 'no such session' } }));
    const { ops } = lab(invoke);
    const input = { opId: 'op-2', opCreated: now(), claim: CLAIM, name: 'session.archive', input: { appSessionId: 'app-1' } };
    expect(await ops.op(input, CONTEXT)).toEqual({ state: 'done', result: { ok: false, error: { code: 'internal', message: 'no such session' } } });
    expect(await ops.op(input, CONTEXT)).toMatchObject({ state: 'done', result: { ok: false } });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('refuses a name it does not claim: not machine-owned, not an act, or unknown; and an input that fails its schema', async () => {
    const { ops, invoke } = lab();
    const ask = (name: string, input: Record<string, unknown>) => ops.op({ opId: `op-${name}`, opCreated: now(), claim: CLAIM, name, input }, CONTEXT);
    expect(await ask('session.send', { appSessionId: 'app-1', content: { text: 'hi' } })).toEqual({ state: 'refused', reason: 'unavailable' }); // the engine host's: host.op
    expect(await ask('session.list', { includeArchived: false })).toEqual({ state: 'refused', reason: 'unavailable' }); // a read
    expect(await ask('session.follow', { sessions: [], live: false })).toEqual({ state: 'refused', reason: 'unavailable' }); // internal
    expect(await ask('machine.op', {})).toEqual({ state: 'refused', reason: 'unavailable' });
    expect(await ask('daemon.restart', {})).toEqual({ state: 'refused', reason: 'unavailable' }); // mawsd's own, not a service's
    expect(await ask('session.nonesuch', {})).toEqual({ state: 'refused', reason: 'unavailable' });
    expect(await ask('session.rename', { appSessionId: 'app-1', title: 7 })).toEqual({ state: 'refused', reason: 'malformed' });
    expect(invoke).not.toHaveBeenCalled();
  });

  // P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, acceptance 4): the checkouts' acts, once machine's
  it('claims the checkouts’ acts and none of their reads', () => {
    for (const name of ['scm.commit', 'scm.stage', 'scm.push', 'files.write', 'files.upload']) expect(claimable(name), name).toBe(true);
    for (const name of ['git.status', 'git.watch', 'scm.status', 'files.read', 'files.readResolved']) expect(claimable(name), name).toBe(false);
  });

  // P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, acceptance 8): the connectors' and delivery's
  // commands, once machine's, by their grade: every machine-admin name, reads included; no view-graded or internal one
  it('claims the connectors’ and delivery’s machine-admin names, and none graded view or internal', () => {
    const admin = [
      'connectors.open', 'connectors.declare', 'connectors.call', 'connectors.watch', 'connectors.unwatch', 'connectors.refresh', 'connectors.visibility', 'connectors.close',
      'connectors.servers', 'connectors.connect', 'connectors.reconnect', 'connectors.disconnect', 'connectors.signIn', 'connectors.signInCancel',
      'artifacts.grantConnectorTool', 'artifacts.revokeConnectorTool',
      'delivery.status', 'delivery.connect', 'delivery.cancel', 'delivery.receipts',
    ];
    for (const name of admin) expect(claimable(name), name).toBe(true);
    for (const name of ['artifacts.connectorGrants', 'connectors.windowShown', 'connectors.adoptGrant', 'delivery.deliver', 'delivery.send']) expect(claimable(name), name).toBe(false);
  });

  // P5 O4 M3 (acceptance 8): the catalog's machine half takes the namespace's machine-admin grade, its read included; the
  // library's reads stay view-graded, and its main-owned two are no machine's to claim
  it('claims the catalog’s machine half, and none of the library’s reads', () => {
    for (const name of ['catalog.engine', 'catalog.engineRefresh']) expect(claimable(name), name).toBe(true);
    for (const name of ['library.content', 'library.read', 'library.openExternally', 'library.reveal', 'library.exportFormats', 'library.saveAs', 'catalog.home']) expect(claimable(name), name).toBe(false);
  });

  it('runs a connector grant once and answers a replayed op id with its stored result', async () => {
    const { ops, invoke } = lab(vi.fn<Invoke>(async () => ({ ok: true, value: { ok: true, grant: { server: 'notes', tool: 'search', mode: 'read' } } })));
    const input = { opId: 'op-g', opCreated: now(), claim: CLAIM, name: 'artifacts.grantConnectorTool', input: { artifactId: '11111111-1111-4111-8111-111111111111', tool: { server: 'notes', tool: 'search', mode: 'read' } } };
    const first = await ops.op(input, CONTEXT);
    expect(first).toMatchObject({ state: 'done' });
    expect(await ops.op(input, CONTEXT)).toEqual(first);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('claims an act whose grade follows its effect (session.update)', async () => {
    const { ops, invoke } = lab();
    expect(await ops.op({ opId: 'op-u', opCreated: now(), claim: CLAIM, name: 'session.update', input: { appSessionId: 'app-1', patch: { pinned: true } } }, CONTEXT)).toMatchObject({ state: 'done' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('answers another member’s copy op-conflict, and a tombstoned id refused, running nothing', async () => {
    const { ops, invoke } = lab();
    const created = now();
    await ops.op({ opId: 'op-3', opCreated: created, claim: CLAIM, name: 'session.rename', input: { appSessionId: 'app-1', title: 'A' } }, CONTEXT);
    expect(await ops.op({ opId: 'op-3', opCreated: created, claim: { ...CLAIM, member: 'mem-b' }, name: 'session.rename', input: { appSessionId: 'app-1', title: 'A' } }, CONTEXT)).toEqual({ state: 'refused', reason: 'op-conflict' });
    expect(ops.opQuery({ opId: 'op-4', opCreated: created, tombstoneIfAbsent: true })).toEqual({ state: 'not-received' });
    expect(await ops.op({ opId: 'op-4', opCreated: created, claim: CLAIM, name: 'session.rename', input: { appSessionId: 'app-1', title: 'B' } }, CONTEXT)).toEqual({ state: 'refused', reason: 'tombstoned' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

// P5 O7 M5a (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "The `artifact` target rule" and "What crosses,
// as what", Interfaces §O): the claim names the artifact the endpoint resolved, which a query answers as the binding's
// target; bytes cross in json-bytes' tagged form, decoded for the run and kept as sent
describe('machine.op for an artifact-targeted act', () => {
  const ARTIFACT = '11111111-1111-4111-8111-111111111111';
  const GRANT = { artifactId: ARTIFACT, tool: { server: 'notes', tool: 'search', mode: 'read' } };

  it('keeps the claim’s target beside it and answers it from a query, across a reopen; the orphan form too', async () => {
    const { ops, reopen, invoke, file } = lab(vi.fn<Invoke>(async () => ({ ok: true, value: { ok: true, grant: GRANT.tool } })));
    const opCreated = now();
    const input = { opId: 'op-target-00000001', opCreated, claim: { ...CLAIM, target: `artifact:${ARTIFACT}` }, name: 'artifacts.grantConnectorTool', input: GRANT };
    expect(await ops.op(input, CONTEXT)).toMatchObject({ state: 'done' });
    // the handler's claim is the binding the endpoint verified; the target is the ledger's
    expect(invoke).toHaveBeenCalledWith('artifacts.grantConnectorTool', GRANT, { ...CONTEXT, op: { opId: input.opId, opCreated, ...CLAIM } });
    const [claimed] = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { claim?: unknown });
    expect(claimed?.claim).toEqual({ ...CLAIM, target: `artifact:${ARTIFACT}`, name: 'artifacts.grantConnectorTool' });
    const binding = { ...CLAIM, target: `artifact:${ARTIFACT}`, name: 'artifacts.grantConnectorTool' };
    expect(ops.opQuery({ opId: input.opId, opCreated, tombstoneIfAbsent: false })).toEqual({ state: 'done', outcome: { ok: true, value: { ok: true, grant: GRANT.tool } }, ...binding });
    expect(reopen().opQuery({ opId: input.opId, opCreated, tombstoneIfAbsent: false })).toMatchObject({ state: 'done', target: `artifact:${ARTIFACT}` });
    await ops.op({ ...input, opId: 'op-target-00000002', claim: { ...CLAIM, target: 'artifact:' } }, CONTEXT);
    expect(ops.opQuery({ opId: 'op-target-00000002', opCreated, tombstoneIfAbsent: false })).toMatchObject({ state: 'done', target: 'artifact:' });
    // with no target, the binding's is the session the input names, or none
    await ops.op({ ...input, opId: 'op-target-00000003', claim: CLAIM }, CONTEXT);
    expect(ops.opQuery({ opId: 'op-target-00000003', opCreated, tombstoneIfAbsent: false })).toMatchObject({ state: 'done', target: null });
  });

  it('refuses a claim whose target names no artifact at the schema', () => {
    const input = { opId: 'op-target-00000001', opCreated: now(), name: 'artifacts.grantConnectorTool', input: GRANT };
    expect(validateCommandInput('machine.op', { ...input, claim: { ...CLAIM, target: `artifact:${ARTIFACT}` } }).ok).toBe(true);
    for (const target of ['app-1', 'artifact:x', '']) expect(validateCommandInput('machine.op', { ...input, claim: { ...CLAIM, target } }).ok, target).toBe(false);
  });

  it('decodes tagged bytes for the run before the command’s validation, and keeps the claim and the action as sent', async () => {
    const invoke = vi.fn<Invoke>(async () => ({ ok: true, value: { ok: false, reason: 'unknown-lease' } }));
    const { ops, reopen, file } = lab(invoke);
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    // a look-alike of the tagged form in plain data crosses escaped and arrives as it was
    const args = toWire({ leaseId: '33333333-3333-4333-8333-333333333333', request: { tool: 'upload', payload: bytes, literal: { $bytes: 'plain text' } } }) as Record<string, unknown>;
    const action = { v: 1, opId: 'op-bytes-000000001', action: 'connectors.call', args };
    const opCreated = now();
    const input = { opId: 'op-bytes-000000001', opCreated, claim: { ...CLAIM, target: `artifact:${ARTIFACT}` }, name: 'connectors.call', input: args, action };
    expect(validateCommandInput('machine.op', input).ok).toBe(true);
    const done = await ops.op(input, CONTEXT);
    expect(done).toEqual({ state: 'done', result: { ok: true, value: { ok: false, reason: 'unknown-lease' } } });
    const ran = invoke.mock.calls[0]?.[1] as { request: { payload: unknown; literal: unknown } };
    expect(ran.request.payload).toBeInstanceOf(Uint8Array);
    expect([...(ran.request.payload as Uint8Array)]).toEqual([...bytes]);
    expect(ran.request.literal).toEqual({ $bytes: 'plain text' });
    // the ledger holds the action as the endpoint sent it, tagged, and a reopen answers the reseal from it
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { claim?: { action?: unknown } });
    expect(lines[0]?.claim?.action).toEqual(action);
    expect(await reopen().op(input, CONTEXT)).toEqual(done);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

// P5 O7 M4 (the milestone review's finding, as the architect refined it): a claim the last process left with no result
// can't be finished by this one, so the services' ledger (`orphanAtOpen`) answers it `expired`, the RL4 state a device
// settles unknown, instead of `in-progress` until the horizon; it is never run again, and an outcome read back later
// replaces it
describe('a claim the last process left unfinished', () => {
  const SPAWN = { ...CLAIM, target: null, name: 'session.spawn' };
  // the services as mawsd composes them after a restart: the ledger reopened with its orphans, machine.op registered
  function restarted(dir: string, lateOutcome?: LateOutcome) {
    const handlers = new Map<string, (input: unknown, context?: HandlerContext) => unknown>();
    const invoke = vi.fn<Invoke>(async () => ({ ok: true, value: { status: 'ok', appSessionId: 'a-second-run' } }));
    const ledger = OpLedger.open(dir, 'spine-ops.jsonl', { orphanAtOpen: true });
    registerMachineOps({ register: (name: string, handler: (input: unknown, context?: HandlerContext) => unknown) => void handlers.set(name, handler), invoke } as never, ledger, lateOutcome);
    return {
      ledger,
      invoke,
      op: (input: unknown) => handlers.get('machine.op')!(input, CONTEXT) as Promise<unknown>,
      query: (opId: string, opCreated: string) => handlers.get('machine.opQuery')!({ opId, opCreated, tombstoneIfAbsent: true }),
    };
  }

  it('answers it expired after a reopen and never runs it again; an outcome arriving later replaces it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'machine-ops-'));
    dirs.push(dir);
    const opCreated = now();
    const spawn = { opId: 'op-orphan-1', opCreated, claim: CLAIM, name: 'session.spawn', input: { checkout: '/c', permission_mode: 'default' } };
    expect(OpLedger.open(dir, 'spine-ops.jsonl').begin('op-orphan-1', opCreated, SPAWN, () => null)).toEqual({ kind: 'claimed' }); // the process ends here
    // the engine host's and the endpoint's ledgers open without the option: there the claim stays in progress
    expect(OpLedger.open(dir, 'spine-ops.jsonl').query('op-orphan-1', opCreated, false)).toMatchObject({ state: 'in-progress' });

    const first = restarted(dir); // nothing to read back yet
    expect(first.query('op-orphan-1', opCreated)).toEqual({ state: 'expired' });
    expect(await first.op(spawn)).toEqual({ state: 'in-progress' }); // a replay runs nothing
    expect(first.invoke).not.toHaveBeenCalled();
    expect(first.ledger.orphans().map((orphan) => orphan.opId)).toEqual(['op-orphan-1']);
    // the act outlived the process (its session launched on an engine host this mawsd adopted): its outcome, read back
    const late = { ok: true as const, value: { status: 'ok', appSessionId: 'app-launched' } };
    const second = restarted(dir, (name, opId) => (name === 'session.spawn' && opId === 'op-orphan-1' ? late : null));
    expect(second.query('op-orphan-1', opCreated)).toEqual({ state: 'done', outcome: late, ...SPAWN });
    expect(await second.op(spawn)).toEqual({ state: 'done', result: late });
    expect(second.invoke).not.toHaveBeenCalled();
    expect(second.ledger.orphans()).toEqual([]);
    expect(restarted(dir).query('op-orphan-1', opCreated)).toEqual({ state: 'done', outcome: late, ...SPAWN }); // kept on disk
  });

  it('takes an outcome given in the same run in place of the unknown, and leaves a finished op alone at a reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'machine-ops-'));
    dirs.push(dir);
    const opCreated = now();
    const before = OpLedger.open(dir, 'spine-ops.jsonl');
    before.begin('op-orphan-2', opCreated, SPAWN, () => null);
    before.begin('op-kept', opCreated, { ...CLAIM, target: 'app-1', name: 'session.rename' }, () => null);
    before.finish('op-kept', { ok: true });
    const after = restarted(dir);
    expect(after.ledger.orphans().map((orphan) => orphan.opId)).toEqual(['op-orphan-2']);
    expect(after.query('op-kept', opCreated)).toMatchObject({ state: 'done', outcome: { ok: true } });
    after.ledger.finish('op-orphan-2', { ok: true, value: { status: 'ok', appSessionId: 'app-2' } });
    expect(after.query('op-orphan-2', opCreated)).toMatchObject({ state: 'done', outcome: { ok: true, value: { appSessionId: 'app-2' } } });
  });
});
