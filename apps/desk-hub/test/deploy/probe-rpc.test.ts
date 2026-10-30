// `deployment probe --rpc` (deploy/probe.ts, O14 B4 step 3): a DX6 `rpc` frame sent on a project socket opened with the
// owner's token is answered `refused {reason: 'retired'}`, and the probe passes on that answer alone. It writes nothing,
// so it runs in the owner's own org. Against the local hub, and stubs for the answers a hub before M5b gives.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Person } from '../../deploy/hub.ts';
import { rpcCase } from '../../deploy/probe.ts';
import { startLocalHub, type LocalHub } from '../support/local';
import { LocalPerson } from '../support/local-person';

let hub: LocalHub;
const PREFIX = '7e1d2c3b-4a59-4687-9a6b';
const PROJECT = `${PREFIX}-000000000000`;
beforeAll(async () => {
  hub = await startLocalHub();
  await hub.addProjects(1, PREFIX);
});
afterAll(() => hub?.close());

/** An owner whose hub lists `projects` and whose project socket answers an `rpc` frame with `answer`. */
function stubbed(projects: Array<{ id: string; retired: boolean }>, answer: (rpc: { nonce: string }) => Record<string, unknown> | null) {
  const sent: unknown[] = [];
  let closed = false;
  const frames: Array<Record<string, unknown> & { t: string }> = [{ t: 'welcome', project: projects[0]?.id ?? '', member: 'm', head: 0 }];
  const socket = {
    send(frame: { t: string; rpc: { nonce: string } }) {
      sent.push(frame);
      const reply = answer(frame.rpc);
      if (reply) frames.push(reply as never);
    },
    async next(predicate: (frame: Record<string, unknown> & { t: string }) => boolean, what: string, ms = 100) {
      const deadline = Date.now() + ms;
      for (;;) {
        const found = frames.find(predicate);
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    close() {
      closed = true;
    },
  };
  const owner = { json: async () => ({ projects }), socket: async () => socket } as unknown as Person;
  return { owner, sent, closed: () => closed };
}

describe('the probe’s rpc case', () => {
  it('passes on the hub’s refused retired, naming the project, and the hub records nothing', async () => {
    const result = await rpcCase(new LocalPerson(hub));
    expect(result).toMatch(new RegExp(`${PROJECT}.*refused retired`));
    expect(await hub.projectRpcs(PROJECT)).toBe(0);
  });

  it('fails on any other answer, as a hub before M5b gives, and closes its socket', async () => {
    const before = stubbed([{ id: PROJECT, retired: false }], (rpc) => ({ t: 'rpc-state', nonce: rpc.nonce, state: 'failed', outcome: { state: 'failed', error: { code: 'bad-shape' } } }));
    await expect(rpcCase(before.owner, 200)).rejects.toThrow(/rpc-state/);
    expect(before.closed()).toBe(true);
    const silent = stubbed([{ id: PROJECT, retired: false }], () => null);
    await expect(rpcCase(silent.owner, 200)).rejects.toThrow(/no answer/);
    expect(silent.closed()).toBe(true);
  });

  it('sends one frame only, an rpc naming nothing but its nonce, so a hub that took it as an RPC could forward nothing', async () => {
    const probe = stubbed([{ id: PROJECT, retired: false }], (rpc) => ({ t: 'refused', refusal: { reason: 'retired', nonce: rpc.nonce, message: 'm' } }));
    await rpcCase(probe.owner, 200);
    expect(probe.sent).toEqual([{ t: 'rpc', rpc: { nonce: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/) as string } }]);
  });

  it('fails when the org has no project open to a socket, and skips a retired one', async () => {
    await expect(rpcCase(stubbed([], () => null).owner, 200)).rejects.toThrow(/no project/);
    await expect(rpcCase(stubbed([{ id: PROJECT, retired: true }], () => null).owner, 200)).rejects.toThrow(/no project/);
  });

  it('takes only a refusal carrying its own nonce', async () => {
    const other = stubbed([{ id: PROJECT, retired: false }], () => ({ t: 'refused', refusal: { reason: 'retired', nonce: 'AAAAAAAAAAAAAAAAAAAAAA', message: 'm' } }));
    await expect(rpcCase(other.owner, 200)).rejects.toThrow(/no answer/);
  });
});
