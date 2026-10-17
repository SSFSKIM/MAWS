// deploy/walk-console.js, the walk's Part G console (item 8, G1 and G3): run the actual pasteable snippet against the
// local hub with a FakeMachine standing in for a real daemon, and prove it sends exactly the two forged frames and that
// each is refused — the human on import (`bad-code`, reported `rejected`), the steer RPC at the machine (`bad-code`,
// relayed back as `rpc-state` failed). Against the local hub only; never the deployment.
import { readFileSync } from 'node:fs';
import { randomUUID, webcrypto } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeMachine } from '../../fake-machine';
import { enroll } from '../support/clients';
import { ADMIN, startLocalHub, type LocalHub } from '../support/local';
import { IDENTITY_HEADER } from '../../local/standin.ts';

const SNIPPET = readFileSync(join(import.meta.dirname, '../../deploy/walk-console.js'), 'utf8');
const RAW_KEY = new Uint8Array(32).fill(5);

let hub: LocalHub;
beforeAll(async () => {
  hub = await startLocalHub();
});
afterAll(() => hub?.close());

/** Runs the real snippet in a scope that gives it the globals a signed-in browser tab would, the socket carrying the
 * admin's identity to the stand-in, and returns what it left on `DESK_WALK_RESULT`. */
async function runSnippet(cfg: { project: string; session: string; machine: string }, logs: string[]): Promise<Record<string, unknown>> {
  const RealWebSocket = globalThis.WebSocket;
  class WalkWebSocket extends RealWebSocket {
    constructor(url: string | URL) {
      super(url, { headers: { [IDENTITY_HEADER]: ADMIN } } as unknown as string[]);
    }
  }
  const scope = globalThis as unknown as Record<string, unknown>;
  const saved = { WebSocket: scope.WebSocket, location: scope.location, DESK_WALK: scope.DESK_WALK, DESK_WALK_RESULT: scope.DESK_WALK_RESULT };
  scope.WebSocket = WalkWebSocket;
  scope.location = { origin: hub.url };
  scope.crypto ??= webcrypto;
  scope.DESK_WALK = cfg;
  delete scope.DESK_WALK_RESULT;
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
  const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
  try {
    await (0, eval)(SNIPPET); // the file is an async IIFE; its promise settles when it has closed the socket
    return scope.DESK_WALK_RESULT as Record<string, unknown>;
  } finally {
    log.mockRestore();
    warn.mockRestore();
    Object.assign(scope, saved); // restore the globals after reading the result, not before
  }
}

describe('the walk console', () => {
  it('sends exactly the two forged frames, and each is refused bad-code', async () => {
    const name = `wc-${Math.random().toString(36).slice(2, 7)}`;
    const project = randomUUID();
    const credentials = await enroll(hub, ADMIN, name);
    const fm = new FakeMachine({ hub: hub.url, machine: name, credentials, orgKey: RAW_KEY, project, projectName: 'walk-console' });
    await fm.connect();
    try {
      const logs: string[] = [];
      const result = await runSnippet({ project, session: randomUUID(), machine: name }, logs);

      // Exactly the two frames, in order, and nothing else.
      expect(result.sent).toEqual(['human', 'rpc']);

      // 1. The human: the hub holds no key, so it is stored and acked; the fake machine refuses it on import bad-code
      //    (the snippet already waited for that `rejected` frame before it resolved).
      expect((result.humanAnswer as { t: string }).t).toBe('human-ack');
      expect(fm.rejected.some((r) => r.reason === 'bad-code' && (r.event?.writer ?? '').startsWith('hub/'))).toBe(true);
      expect((result.rejected as { rejection: { reason: string } }).rejection.reason).toBe('bad-code');

      // 2. The steer RPC: forwarded, and the fake machine's ledger refuses it bad-code.
      const rpcAnswer = result.rpcAnswer as { state: string; outcome?: { error?: { code: string } } };
      expect(rpcAnswer.state).toBe('failed');
      expect(rpcAnswer.outcome?.error?.code).toBe('bad-code');
      expect(fm.rpcs.some((r) => r.rpc === 'steer' && r.outcome?.state === 'failed' && !r.executed)).toBe(true);

      expect(logs.join('\n')).toMatch(/as expected/);
    } finally {
      await fm.close();
    }
  });

  it('stops before any frame when the project it is given has no socket at the hub', async () => {
    const name = `wc-${Math.random().toString(36).slice(2, 7)}`;
    const project = randomUUID();
    const credentials = await enroll(hub, ADMIN, name);
    const fm = new FakeMachine({ hub: hub.url, machine: name, credentials, orgKey: RAW_KEY, project, projectName: 'walk-console' });
    await fm.connect();
    try {
      // A project the hub does not hold: the socket is refused (404), so the snippet throws before any frame.
      await expect(runSnippet({ project: randomUUID(), session: randomUUID(), machine: name }, [])).rejects.toThrow(/refused|welcome/);
    } finally {
      await fm.close();
    }
  });
});
