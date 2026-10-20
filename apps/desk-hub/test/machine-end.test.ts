// A `Machine` object's stream that its client stopped reading: every write to it waits. Ending the stream — a newer
// stream replacing it, a revocation, the client's close, or the write bound when nothing else does — must release those
// writes, so a `Project`'s send chain, and the POSTs that wait on it, go on (panel finding scalpel-5#4). The object runs here on Node's streams, which follow
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

const { Machine, WRITE_TIMEOUT_MS } = await import('../src/objects/machine');
const { CLIENT_HEADER, MACHINE_HEADER, ORG_HEADER } = await import('../src/env');
const { GENERATION_HEADER } = await import('../src/protocol/machine');
type DownFrame = import('../src/protocol/machine').DownFrame;
type UpFrame = import('../src/protocol/machine').UpFrame;

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

// Nothing else ends it: the write bound does (desk-open-fast §8).
describe('a stream nobody reads, left alone', () => {
  it(`ends write-stalled within WRITE_TIMEOUT_MS; the sends waiting answer offline, and a hello's POST is answered 503`, { timeout: 30_000 }, async () => {
    const kv = new Map<string, unknown>();
    const ctx = { storage: { kv: { get: (k: string) => kv.get(k), put: (k: string, v: unknown) => kv.set(k, v), delete: (k: string) => kv.delete(k) } } };
    // The project as `fromMachine`'s contract has it: a hello owes its `have`, and one not written fails the run.
    const project = {
      closed: async () => {},
      renew: async () => {},
      fromMachine: async (context: { generation: number }, frames: UpFrame[]) => {
        const sent = await object.send({ t: 'have', project: 'p', have: {}, archive: false } as DownFrame, context.generation);
        return sent === 'written' ? { applied: frames.length, stale: false, failed: false } : { applied: 0, stale: false, failed: true };
      },
    };
    const env = { PROJECT: { idFromName: (name: string) => name, get: () => project }, REGISTRY: { idFromName: (name: string) => name, get: () => ({ orgFrame: directory }) } };
    const object = new Machine(ctx as never, env as never);
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line));
    try {
      const headers = { [ORG_HEADER]: 'org', [MACHINE_HEADER]: 'm', [CLIENT_HEADER]: 'client-1' };
      await object.fetch(new Request('https://machine/stream', { headers })); // its body is never read
      const waiting = object.send({ t: 'hb', at: '2026-10-20T00:00:00.000Z' });
      const started = Date.now();
      const response = await object.fetch(
        new Request('https://machine/frames', {
          method: 'POST',
          headers: { ...headers, [GENERATION_HEADER]: '1' },
          body: JSON.stringify({ t: 'hello', project: '7a2c0a8e-3b2d-4c5e-9f70-0000000000ff', name: 'demo', have: {} }),
        }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: 'delivery-failed', frames: 0 });
      expect(Date.now() - started).toBeLessThan(WRITE_TIMEOUT_MS + 1000);
      expect(await within(waiting)).toBe('offline');
      expect(lines.some((line) => line.includes('"event":"end"') && line.includes('"cause":"write-stalled"'))).toBe(true);
    } finally {
      log.mockRestore();
      object.revoke('client-1');
    }
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
