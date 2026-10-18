// A `Machine` object's stream that its client stopped reading: every write to it waits. Ending the stream — a newer
// stream replacing it, a revocation, the client's close — must release those writes, so a `Project`'s send chain, and
// the POSTs that wait on it, go on (panel finding scalpel-5#4). The object runs here on Node's streams, which follow
// the same WHATWG semantics as workerd's, with `DurableObject` stood in for.
import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      readonly ctx: unknown,
      readonly env: unknown,
    ) {}
  },
}));

const { Machine } = await import('../src/objects/machine');
const { CLIENT_HEADER, MACHINE_HEADER, ORG_HEADER } = await import('../src/env');

const directory = async () => ({ frame: { t: 'org', projects: [], machines: [] }, version: 0 });

function machineObject(orgFrame: () => Promise<unknown> = directory) {
  const kv = new Map<string, unknown>();
  const ctx = { storage: { kv: { get: (k: string) => kv.get(k), put: (k: string, v: unknown) => kv.set(k, v), delete: (k: string) => kv.delete(k) } } };
  const project = { closed: async () => {}, renew: async () => {} };
  const registry = { orgFrame };
  const env = { PROJECT: { idFromName: (name: string) => name, get: () => project }, REGISTRY: { idFromName: (name: string) => name, get: () => registry } };
  return new Machine(ctx as never, env as never);
}

const open = (machine: InstanceType<typeof Machine>, client = 'client-1') =>
  machine.fetch(new Request('https://machine/stream', { headers: { [ORG_HEADER]: 'org', [MACHINE_HEADER]: 'm', [CLIENT_HEADER]: client } }));

/** What became of a send within `ms`: its answer, or 'pending'. */
const within = (send: Promise<'written' | 'offline'>, ms = 1000) => Promise.race([send, new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), ms))]);

describe("a stream nobody reads, ended", () => {
  it('by a newer stream: the stalled write answers offline', async () => {
    const machine = machineObject();
    await open(machine); // its body is never read: the welcome, and every write after it, waits
    const stalled = machine.send({ t: 'hb', at: '2026-10-15T00:00:00.000Z' });
    expect(await within(stalled, 100)).toBe('pending');
    const newer = await open(machine);
    expect(await within(stalled)).toBe('offline');
    await newer.body?.cancel();
    machine.revoke('client-1');
  });

  it('by a revocation: the stalled write answers offline', async () => {
    const machine = machineObject();
    await open(machine);
    const stalled = machine.send({ t: 'hb', at: '2026-10-15T00:00:00.000Z' });
    expect(await within(stalled, 100)).toBe('pending');
    machine.revoke('client-1');
    expect(await within(stalled)).toBe('offline');
  });
});

describe("a stream whose org directory the Registry could not give", () => {
  it('ends, so the machine reconnects for it, and nothing queued behind the directory is written', async () => {
    const machine = machineObject(async () => {
      throw new Error('the Registry is unreachable');
    });
    const response = await open(machine);
    const reply = machine.send({ t: 'rpc-ack', project: 'p', nonce: 'AQEBAQEBAQEBAQEBAQEBAQ' });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const ended = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return 'ended';
          text += decoder.decode(value, { stream: true });
        }
      } catch {
        return 'ended';
      }
    })();
    const outcome = await Promise.race([ended, new Promise<'open'>((resolve) => setTimeout(() => resolve('open'), 1000))]);
    // The welcome may or may not reach the client before the end (an errored stream drops what it had not handed over);
    // either way the daemon takes the end as a dead stream and opens another.
    expect(text).not.toContain('rpc-ack');
    expect(text).not.toContain('event: hb');
    expect(outcome).toBe('ended');
    expect(await within(reply)).toBe('offline');
    machine.revoke('client-1');
  });
});
