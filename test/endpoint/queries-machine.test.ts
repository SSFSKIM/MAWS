// RL4's query routed to the services' ledger (P5 O3-D M4; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// Interfaces §H; D28): a query naming the executor `machine` goes to `machine.opQuery`, tombstoning an absent id, and is
// answered through the same binding check as the engine host's. RL2's `query.executor` gains `machine` only with O7
// (the composite's C3), so no channel delivers such a query yet: the route is driven here directly.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OpLedger } from '@shared/host/op-ledger';
import type { HandlerContext } from '@shared/ipc/client';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { CommandInput } from '@shared/ipc/schema';
import type { AuthorizeRequest } from '../../src/endpoint/authorize';
import type { RemoteChannel } from '../../src/endpoint/channels';
import { Queries } from '../../src/endpoint/queries';
import { machineOps } from '../../src/services/machine-ops';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const CTX = { client: { id: 'endpoint', onGone: () => () => {} } } as unknown as HandlerContext;

function lab() {
  const dir = fs.mkdtempSync(join(tmpdir(), 'queries-machine-'));
  dirs.push(dir);
  const ops = machineOps({ ledger: OpLedger.open(dir, 'spine-ops.jsonl'), invoke: (async () => ({ ok: true, value: { renamed: true } })) as never });
  const asked: AuthorizeRequest[] = [];
  const dispatched: string[] = [];
  const ok = (value: unknown): HostResponse => ({ t: 'res', id: 'x', ok: true, value });
  const queries = new Queries({
    // the asker must be the stored member (the real check also asks for `view` on the stored target)
    authorize: async (request, who) => (asked.push(request), (request.input as { member: string }).member === who.member ? { ok: true } : { ok: false, reason: 'grade' }) as never,
    own: { query: () => ({ state: 'not-received' }) } as never,
    rl10: {} as never,
    dispatch: async (owner, name, input) => {
      dispatched.push(`${owner} ${name}`);
      if (owner === 'machine' && name === 'machine.opQuery') return ok(ops.opQuery(input as CommandInput<'machine.opQuery'>));
      if (owner === 'machine' && name === 'session.get') return ok(null); // no record in the index: the engine host places it (P5 O7 M2)
      if (owner === 'engine-host' && name === 'session.status') return ok({ appSessionId: 'app-own', launchId: 'launch-1', engineSessionId: 'eng-own' });
      return { t: 'res', id: 'x', ok: false, error: { code: 'unknown_command', message: name } };
    },
    now: Date.now,
    log: () => {},
  });
  const ask = (member: string, opId: string, opCreated: string) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const channel = { key: 'c', member, device: 'dev-1', clientClass: 'desktop', capabilities: [], send: (m: Record<string, unknown>) => resolve(m) } as unknown as RemoteChannel;
      queries.route(channel, { t: 'query', opId, opCreated, executor: 'machine' } as never);
    });
  return { ops, ask, asked, dispatched };
}

describe('a query of the services’ ledger', () => {
  it('answers the op from machine.opQuery to the member who sent it, authorized over its stored binding', async () => {
    const { ops, ask, asked, dispatched } = lab();
    const created = new Date().toISOString();
    await ops.op({ opId: 'op-1', opCreated: created, claim: { member: 'mem-a', device: 'dev-1', fingerprint: 'fp' }, name: 'session.rename', input: { appSessionId: 'app-own', title: 'x' } }, CTX);
    expect(await ask('mem-a', 'op-1', created)).toEqual({ t: 'queried', opId: 'op-1', state: 'done', outcome: { state: 'done', result: { renamed: true } } });
    expect(dispatched[0]).toBe('machine machine.opQuery');
    expect(asked[0]).toEqual({ kind: 'query', name: 'session.rename', input: { member: 'mem-a', target: { lane: 'B', session: 'eng-own', appSessionId: 'app-own' } } });
    expect(await ask('mem-b', 'op-1', created)).toEqual({ t: 'queried', opId: 'op-1', state: 'refused', reason: 'grade' });
  });

  it('tombstones an id it holds nothing of: the original arriving later is refused and never runs', async () => {
    const { ops, ask } = lab();
    const created = new Date().toISOString();
    expect(await ask('mem-a', 'op-2', created)).toEqual({ t: 'queried', opId: 'op-2', state: 'not-received' });
    expect(await ops.op({ opId: 'op-2', opCreated: created, claim: { member: 'mem-a', device: 'dev-1', fingerprint: 'fp' }, name: 'session.rename', input: { appSessionId: 'app-own', title: 'x' } }, CTX)).toEqual({ state: 'refused', reason: 'tombstoned' });
  });
});
