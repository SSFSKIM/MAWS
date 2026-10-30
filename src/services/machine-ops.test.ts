// The services' operation ledger (P5 O3-D M4; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §H; O3X7,
// D17): `machine.op` claims and runs a `machine`-owned act through the bus's invoke, once per op id; `machine.opQuery`
// answers as `host.opQuery` does.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpLedger } from '@shared/host/op-ledger';
import type { HandlerContext } from '@shared/ipc/client';
import { machineOps } from './machine-ops';

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
  return { ops: open(), reopen: open, invoke };
}

describe('machine.op', () => {
  it('claims and runs a machine-owned act once, and replays a finished op’s answer, across a reopen', async () => {
    const { ops, reopen, invoke } = lab();
    const input = { opId: 'op-1', opCreated: now(), claim: CLAIM, name: 'session.rename', input: { appSessionId: 'app-1', title: 'New' } };
    expect(await ops.op(input, CONTEXT)).toEqual({ state: 'done', result: { ok: true } });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('session.rename', { appSessionId: 'app-1', title: 'New' }, CONTEXT);
    expect(await ops.op(input, CONTEXT)).toEqual({ state: 'done', result: { ok: true } });
    expect(await reopen().op(input, CONTEXT)).toEqual({ state: 'done', result: { ok: true } });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(ops.opQuery({ opId: 'op-1', opCreated: input.opCreated, tombstoneIfAbsent: false })).toEqual({ state: 'done', outcome: { ok: true }, ...CLAIM, target: 'app-1', name: 'session.rename' });
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
