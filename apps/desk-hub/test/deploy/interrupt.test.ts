// A command that makes things on a deployment undoes them however it ends (O11 M8), an operator's Ctrl-C (SIGINT) and
// a timeout's kill (SIGTERM) included: the signal stops the work — its requests refused from then on, the cleanup's
// passing — gives what it has in flight a moment to land, runs the cleanup, each step bounded, and ends non-zero; a
// second signal exits at once, naming what may be left. Stubs, then relay-measure and acceptance against the local hub.
import { EventEmitter } from 'node:events';
import { type SignedOrgState } from 'org-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runAcceptance } from '../../deploy/acceptance.ts';
import { Person, sleep, until } from '../../deploy/hub.ts';
import { type AdminDevice } from '../../deploy/org-admin.ts';
import { Cleanup, interruptible } from '../../deploy/proof.ts';
import type { PushSink } from '../../deploy/push-sink.ts';
import { runRelayMeasure } from '../../deploy/relay-measure.ts';
import { ADMIN, ORG, startLocalHub, type LocalHub } from '../support/local';
import { adminKeysFile, LocalPerson } from '../support/local-person';

const never = () => new Promise<never>(() => {});

afterEach(() => vi.restoreAllMocks());

describe('an interrupted run', () => {
  it('stops its work at a signal, runs its cleanup, and ends 130 for SIGINT, 143 for SIGTERM', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const [signal, status] of [
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ] as const) {
      const signals = new EventEmitter();
      const cleanup = new Cleanup();
      const ran: string[] = [];
      const run = interruptible(
        cleanup,
        async () => {
          cleanup.add('undo what it made', async () => void ran.push('undone'));
          return never();
        },
        async (code) => {
          ran.push(`finish ${code}`);
          return (await cleanup.run()).length ? 1 : code;
        },
        { signals, settleMs: 50 },
      );
      await until(() => (signals.listenerCount(signal) ? true : undefined), 'the handler');
      signals.emit(signal, signal);
      expect(await run).toBe(status);
      expect(ran).toEqual([`finish ${status}`, 'undone']);
      expect(signals.listenerCount('SIGINT') + signals.listenerCount('SIGTERM')).toBe(0);
    }
    expect(errors.mock.calls.flat().join('\n')).toMatch(/SIGINT: stopping the run, then undoing what it made \(a second SIGINT exits at once/);
  });

  it('refuses the work’s requests once interrupted, and lets the cleanup’s through', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const signals = new EventEmitter();
    const cleanup = new Cleanup();
    let interrupted!: () => void;
    const signalled = new Promise<void>((resolve) => (interrupted = resolve));
    let work: unknown;
    let cleaning: unknown = 'not checked';
    const run = interruptible(
      cleanup,
      async () => {
        cleanup.add('a request of the cleanup', async () => void (cleaning = (() => (cleanup.check(), 'passed'))()));
        expect(() => cleanup.check()).not.toThrow();
        await signalled;
        try {
          cleanup.check();
        } catch (error) {
          work = error;
        }
        return 0;
      },
      async (code) => ((await cleanup.run()).length ? 1 : code),
      { signals, settleMs: 1000 },
    );
    signals.emit('SIGINT', 'SIGINT');
    interrupted();
    expect(await run).toBe(130);
    expect(String(work)).toMatch(/interrupted by SIGINT/);
    expect(cleaning).toBe('passed');
    expect(cleanup.signal.aborted).toBe(true);
  });

  it('exits at once at a second signal, naming what is not yet undone', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const signals = new EventEmitter();
    const exits: number[] = [];
    const cleanup = new Cleanup(200);
    cleanup.add('revoke m8-rm-x', async () => {});
    cleanup.add('take m8-rm-x out of the org state', never);
    const run = interruptible(cleanup, never, async (code) => ((await cleanup.run()).length ? 1 : code), { signals, settleMs: 10, exit: (code) => void exits.push(code) });
    signals.emit('SIGTERM', 'SIGTERM');
    await until(() => (cleanup.pending[0] === 'take m8-rm-x out of the org state' ? true : undefined), 'the hanging step running');
    signals.emit('SIGINT', 'SIGINT');
    expect(exits).toEqual([130]);
    expect(errors.mock.calls.flat().join('\n')).toMatch(/SIGINT again: exiting now; possibly left behind, not yet undone: take m8-rm-x out of the org state; revoke m8-rm-x/);
    // Had the process not exited, the hanging step is given up at its bound and the rest still runs.
    expect(await run).toBe(143);
    expect(cleanup.pending).toEqual([]);
  });

  it('is the process’s signals by default, and leaves no handler behind', async () => {
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const cleanup = new Cleanup();
    let during: number[] = [];
    await interruptible(
      cleanup,
      async () => {
        during = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
        return 0;
      },
      async (code) => code,
    );
    expect(during).toEqual([before[0] + 1, before[1] + 1]);
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
  });
});

describe('cleaning up, bounded', () => {
  it('gives up a step that hangs past its bound, and still runs the rest', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ran: string[] = [];
    const cleanup = new Cleanup(50);
    cleanup.add('first', async () => void ran.push('first'));
    cleanup.add('hangs', never);
    cleanup.add('last', async () => void ran.push('last'));
    expect(await cleanup.run()).toEqual(['hangs: not done within 0.05 s; the steps after it ran anyway']);
    expect(ran).toEqual(['last', 'first']);
    expect(errors).toHaveBeenCalled();
  });

  it('runs a step registered while it runs', async () => {
    const ran: string[] = [];
    const cleanup = new Cleanup();
    cleanup.add('first', async () => void ran.push('first'));
    cleanup.add('adds one', async () => cleanup.add('added', async () => void ran.push('added')));
    expect(await cleanup.run()).toEqual([]);
    expect(ran).toEqual(['added', 'first']);
  });
});

describe('a person’s requests', () => {
  it('pass the run’s gate first, and none leaves once it refuses', async () => {
    const fetched = vi.spyOn(globalThis, 'fetch');
    const person = new Person('http://127.0.0.1:9', 'unused', () => {
      throw new Error('interrupted by SIGINT');
    });
    await expect(person.fetch('/api/me')).rejects.toThrow(/interrupted by SIGINT/);
    await expect(person.json('/api/me')).rejects.toThrow(/interrupted by SIGINT/);
    await expect(person.socket('/api/projects/x/socket')).rejects.toThrow(/interrupted by SIGINT/);
    expect(fetched).not.toHaveBeenCalled();
  });
});

describe('against the local hub', () => {
  let hub: LocalHub;
  let device: AdminDevice;
  beforeAll(async () => {
    hub = await startLocalHub();
    device = (await adminKeysFile()).device;
  });
  afterAll(() => hub?.close());

  const head = async () => (await new LocalPerson(hub).json<{ head: SignedOrgState }>('/api/org/state')).head.state;
  const machines = async () => (await new LocalPerson(hub).json<{ machines: Array<{ name: string }> }>('/api/machines')).machines.map((m) => m.name);

  it('relay-measure, interrupted while it measures, takes its machine out and revokes it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const signals = new EventEmitter();
    const cleanup = new Cleanup();
    const person = new LocalPerson(hub, ADMIN, () => cleanup.check());
    const lines: string[] = [];
    const started = Date.now();
    const status = await runRelayMeasure(
      person,
      { org: ORG, throwaway: true },
      device,
      { samples: 100_000, seconds: 600, window: 2 },
      cleanup,
      (line) => {
        lines.push(line);
        if (line.startsWith('relay-measure: ')) setTimeout(() => signals.emit('SIGINT', 'SIGINT'), 200);
      },
      { signals, settleMs: 5000 },
    );
    expect(status).toBe(130);
    expect(Date.now() - started).toBeLessThan(30_000);
    const name = /machine (m8-rm-[a-z0-9]+)/.exec(lines.join('\n'))![1];
    const state = await head();
    expect(state.machines).toEqual([]);
    expect(state.machineNames.map((m) => m.name)).toContain(name);
    expect(state.retired.some((r) => 'machine' in r.holder)).toBe(true);
    expect(await machines()).not.toContain(name);
    expect(lines.some((l) => l.startsWith('tailnet verdict'))).toBe(false);
  }, 60_000);

  it('acceptance, interrupted after its delegation, undoes it and starts no further check', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const signals = new EventEmitter();
    const cleanup = new Cleanup();
    const person = new LocalPerson(hub, ADMIN, () => cleanup.check());
    const printed: string[] = [];
    const status = await runAcceptance(
      person,
      { org: ORG, throwaway: true },
      device,
      { items: ['2', '3'], frames: 2 },
      cleanup,
      (line) => {
        printed.push(line);
        if (line.startsWith('PASS 2 re-issued as a delegation')) signals.emit('SIGINT', 'SIGINT');
      },
      { signals, settleMs: 5000 },
    );
    expect(status).toBe(130);
    const text = printed.join('\n');
    expect(text).toMatch(/PASS 2 re-issued as a delegation/);
    expect(text).not.toMatch(/ 2 a delegated VM enrolls| 3-6 | 3 frames/);
    expect(text).toMatch(/^cleanup: the head lists none of the run’s members, machines or delegations/m);
    expect(text).toMatch(/^acceptance: FAIL$/m);
    const state = await head();
    expect(state.delegations).toEqual([]);
    expect(state.revoked.some((r) => 'delegation' in r.holder)).toBe(true);
    expect(state.members.map((m) => m.email)).toEqual([ADMIN]);
    const { keys } = await new LocalPerson(hub).json<{ keys: Array<{ revoked?: string | null }> }>('/api/provisioning-keys');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.revoked)).toBe(true);
  }, 120_000);

  type Init = { method?: string; body?: unknown; signal?: AbortSignal };
  const provisioningKeys = async () => (await new LocalPerson(hub).json<{ keys: Array<{ id: string; revoked: string | null }> }>('/api/provisioning-keys')).keys;

  it('acceptance, interrupted while its provisioning key is being created, revokes that key all the same', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const signals = new EventEmitter();
    const cleanup = new Cleanup();
    // The hub makes the key; its answer is held past the run's settle, as a slow network would hold it, and the signal
    // comes meanwhile: the run never learns the key's id.
    class SlowCreation extends LocalPerson {
      override async fetch(path: string, init: Init = {}): Promise<Response> {
        const response = await super.fetch(path, init);
        if (path === '/api/provisioning-keys' && init.body !== undefined) {
          signals.emit('SIGINT', 'SIGINT');
          await sleep(1500);
        }
        return response;
      }
    }
    const before = (await provisioningKeys()).length;
    const printed: string[] = [];
    const status = await runAcceptance(new SlowCreation(hub, ADMIN, () => cleanup.check()), { org: ORG, throwaway: true }, device, { items: ['2'], frames: 2 }, cleanup, (line) => void printed.push(line), {
      signals,
      settleMs: 200,
    });
    expect(status).toBe(130);
    const text = printed.join('\n');
    expect(text).not.toMatch(/PASS 2 re-issued as a delegation/);
    expect(text).not.toMatch(/^LEFT /m);
    const keys = await provisioningKeys();
    expect(keys.length).toBe(before + 1);
    expect(keys.filter((k) => !k.revoked)).toEqual([]);
  }, 120_000);

  it('acceptance, interrupted, ends 130 within its bound though its sink’s close and the read-back after the cleanup stall', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const signals = new EventEmitter();
    const cleanup = new Cleanup();
    let interrupted = false;
    // After the signal, the hub never answers the machines' list (the read-back's; nothing in the cleanup reads it),
    // short of the request's own signal ending it; and the push sink never finishes closing.
    class StalledReads extends LocalPerson {
      override async fetch(path: string, init: Init = {}): Promise<Response> {
        if (interrupted && path === '/api/machines' && init.method === undefined && init.body === undefined) {
          return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
        }
        return super.fetch(path, init);
      }
    }
    const sink: PushSink = { endpoint: (name) => `https://push.invalid/${name}`, received: () => [], close: () => new Promise<void>(() => {}) };
    const printed: string[] = [];
    const started = Date.now();
    const status = await runAcceptance(
      new StalledReads(hub, ADMIN, () => cleanup.check()),
      { org: ORG, throwaway: true },
      device,
      { items: ['2'], frames: 2, sink },
      cleanup,
      (line) => {
        printed.push(line);
        if (line.startsWith('PASS 2 re-issued as a delegation')) {
          interrupted = true;
          signals.emit('SIGINT', 'SIGINT');
        }
      },
      { signals, settleMs: 200, afterCleanupMs: 500 },
    );
    expect(status).toBe(130);
    const text = printed.join('\n');
    expect(text).toMatch(/^LEFT the check after cleanup failed: no answer within 0.5 s$/m);
    expect(text).toMatch(/^acceptance: FAIL$/m);
    expect(Date.now() - started).toBeLessThan(60_000);
    expect((await provisioningKeys()).filter((k) => !k.revoked)).toEqual([]);
  }, 120_000);
});
