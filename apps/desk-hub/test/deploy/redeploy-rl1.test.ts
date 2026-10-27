// redeploy-check's RL1 leg (O11 M8; acceptance 3's deploy clause), against the local hub, whose runtime restart stands
// in for a redeploy (every object restarts, every connection drops): both the endpoint's RL1 socket and the app's
// Machine socket drop, the endpoint comes back under a higher generation, a new channel echoes, and the leg says when
// each dropped and how long each took; then the whole command, DX2's machines and browser beside the leg, passes across
// the restart and undoes what it made.
import { createServer } from 'node:net';
import { type SignedOrgState } from 'org-protocol';
import { RelayApp } from 'org-protocol/test-support';
import { FakeEndpoint } from '../../fake-machine/endpoint.ts';
import { credentialHeaders } from '../../fake-machine/link.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sleep, until } from '../../deploy/hub.ts';
import { OrgAdmin, type AdminDevice } from '../../deploy/org-admin.ts';
import { Cleanup } from '../../deploy/proof.ts';
import { REDEPLOY_INCONCLUSIVE, redeployCheck } from '../../deploy/redeploy-check.ts';
import { Rl1Watch, upgradeProbe, type AppOpener } from '../../deploy/rl1-reconnect.ts';
import { ORG, startLocalHub, type LocalHub } from '../support/local';
import { adminKeysFile, LocalPerson } from '../support/local-person';

let hub: LocalHub;
let person: LocalPerson;
let device: AdminDevice;

beforeAll(async () => {
  hub = await startLocalHub();
  person = new LocalPerson(hub);
  device = (await adminKeysFile()).device;
});
afterAll(() => hub?.close());

const head = async () => (await person.json<{ head: SignedOrgState }>('/api/org/state')).head.state;
const machines = async () => (await person.json<{ machines: Array<{ name: string }> }>('/api/machines')).machines.map((m) => m.name);

describe('the RL1 leg', () => {
  it('sees both sockets dropped by a restart, the endpoint back under a higher generation and a channel echoing again', async () => {
    const lines: string[] = [];
    const cleanup = new Cleanup();
    // A throwaway org with no state: the admin device posts its genesis.
    const admin = await OrgAdmin.open(person, { org: ORG, throwaway: true }, device, (line) => lines.push(line));
    expect(lines).toEqual([`org state: genesis of the throwaway org ${ORG}, signed by device a1`]);
    const watch = await Rl1Watch.start(person, admin, 'rd-ep-local', cleanup, (line) => lines.push(line));
    expect(lines.at(-1)).toMatch(/^rl1: rd-ep-local \(ref [\w-]+\) holds RL1 under generation 1; an app's channel to it echoes$/);

    // Before any redeploy, nothing is settled: a watch that saw no cut reports it as not exercised.
    watch.mark();
    expect(await watch.settle(Date.now() + 300)).toEqual([
      expect.stringMatching(/never cut rd-ep-local's RL1 socket .*not exercised/),
      expect.stringMatching(/never cut the app's socket to rd-ep-local: not exercised/),
    ]);
    // Where the leg forces its own cuts, a redeploy that cut neither socket is said, not failed.
    expect(await watch.settle(Date.now() + 300, { cutRequired: false })).toEqual([]);
    expect(watch.report()).toEqual(['rl1: neither socket was cut']);

    watch.mark();
    await hub.restart();
    expect(await watch.settle(Date.now() + 30_000)).toEqual([]);
    const report = watch.report();
    expect(report.find((l) => l.startsWith("rl1: the endpoint's socket"))).toMatch(/closed \d+ .* at \+[\d.]+ s \(generation 1\); welcomed again under generation [2-9]\d* [\d.]+ s after/);
    expect(report.find((l) => l.startsWith("rl1: the app's socket"))).toMatch(/closed \d+ .* at \+[\d.]+ s; a new channel to the endpoint echoed [\d.]+ s after/);

    expect(await cleanup.run()).toEqual([]);
    expect((await head()).machines).toEqual([]);
    expect(await machines()).not.toContain('rd-ep-local');
  });
});

describe('two cuts in a row', () => {
  // Phase B's run A: the endpoint came back after a first cut and never after a second. Each cut here must be followed
  // by the endpoint welcomed under a higher generation than the one it was cut at, and a new channel echoing.
  const twice = async (name: string, cut: (ref: string) => Promise<void>) => {
    const lines: string[] = [];
    const cleanup = new Cleanup();
    const admin = await OrgAdmin.open(person, { org: ORG, throwaway: true }, device, () => {});
    const watch = await Rl1Watch.start(person, admin, name, cleanup, (line) => lines.push(line));
    const ref = /\(ref ([\w-]+)\)/.exec(lines.at(-1)!)![1];
    const generations: Array<[number, number]> = [];
    for (const n of [1, 2]) {
      watch.mark();
      await cut(ref);
      expect(await watch.settle(Date.now() + 30_000), `cut ${n}`).toEqual([]);
      const report = watch.report();
      const endpoint = /\(generation (\d+)\); welcomed again under generation (\d+)/.exec(report.find((l) => l.startsWith("rl1: the endpoint's socket")) ?? '');
      expect(endpoint, `cut ${n}: ${report.join(' | ')}`).not.toBeNull();
      generations.push([Number(endpoint![1]), Number(endpoint![2])]);
      expect(report.find((l) => l.startsWith("rl1: the app's socket")), `cut ${n}`).toMatch(/a new channel to the endpoint echoed [\d.]+ s after/);
    }
    // The second cut ends the connection the first one's reconnect made, and the endpoint comes back above it.
    expect(generations[0][1]).toBeGreaterThan(generations[0][0]);
    expect(generations[1][0]).toBe(generations[0][1]);
    expect(generations[1][1]).toBeGreaterThan(generations[1][0]);
    expect(await cleanup.run()).toEqual([]);
  };

  it('the runtime restarted twice: the endpoint back under a higher generation and a channel echoing after each', async () => {
    await twice('rd-ep-twice', () => hub.restart());
  }, 120_000);

  // The object holding RL1 is addressed by the machine's ref (relay.ts, relayObjectName).
  it('the object holding RL1 evicted twice, its sockets closed: the same after each', async () => {
    await twice('rd-ep-evict', (ref) => hub.evict('Machine', `${ORG}:ref:${ref}`, 'close'));
  }, 120_000);

  // The live leg's own cuts: a redeploy need not cut RL1 within its window (phase B's runs B and C), so the leg drops
  // both sockets from the client's end, twice in a row, and waits for each to come back before the next.
  it('forced from the client: the endpoint and the app drop their sockets twice, and each time both come back', async () => {
    const cleanup = new Cleanup();
    const admin = await OrgAdmin.open(person, { org: ORG, throwaway: true }, device, () => {});
    const watch = await Rl1Watch.start(person, admin, 'rd-ep-forced', cleanup, () => {});
    const lines: string[] = [];
    expect(await watch.forceCuts(2, (line) => lines.push(line))).toEqual([]);
    const cut = (n: number) =>
      new RegExp(
        `^rl1: forced cut ${n}: the endpoint dropped its socket at generation (\\d+) and was welcomed again under generation (\\d+) [\\d.]+ s after; ` +
          `the app dropped its socket and a new channel to the endpoint echoed [\\d.]+ s after$`,
      );
    expect(lines).toEqual([expect.stringMatching(cut(1)), expect.stringMatching(cut(2))]);
    const [first, second] = [cut(1).exec(lines[0])!, cut(2).exec(lines[1])!].map((m) => [Number(m[1]), Number(m[2])]);
    expect(first[0]).toBe(1);
    expect(first[1]).toBeGreaterThan(first[0]);
    expect(second[0]).toBe(first[1]);
    expect(second[1]).toBeGreaterThan(second[0]);
    // A forced cut is not the redeploy's: a mark after them sees nothing cut.
    watch.mark();
    expect(watch.report()).toEqual(['rl1: neither socket was cut']);
    expect(await cleanup.run()).toEqual([]);
    expect(await machines()).not.toContain('rd-ep-forced');
  }, 120_000);

  it('a forced cut that does not come back within its bound is a problem, and the cuts after it are not made', async () => {
    const cleanup = new Cleanup();
    const admin = await OrgAdmin.open(person, { org: ORG, throwaway: true }, device, () => {});
    let opened = 0;
    // The first socket opens; every reopen is refused, as an app whose Access session lapsed.
    const open: AppOpener = async (hub, ref, headers) => {
      if (opened++ > 0) throw new Error('refused');
      return RelayApp.open(hub, ref, headers);
    };
    const watch = await Rl1Watch.start(person, admin, 'rd-ep-unforced', cleanup, () => {}, open);
    const lines: string[] = [];
    const started = Date.now();
    const problems = await watch.forceCuts(2, (line) => lines.push(line), 3000);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(problems).toEqual(["forced cut 1: no new channel to rd-ep-unforced echoed within 3.0 s of the app's drop"]);
    expect(lines).toEqual([expect.stringMatching(/^rl1: forced cut 1: the endpoint dropped its socket at generation 1 and was welcomed again under generation \d+ [\d.]+ s after; the app dropped its socket and no new channel echoed within 3.0 s$/)]);
    expect(await cleanup.run()).toEqual([]);
  }, 60_000);
});

describe('a failing reconnect, diagnosed', () => {
  it('gives up an upgrade the hub never answers, so the endpoint tries again', async () => {
    const silent = createServer(() => {});
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()));
    const { port } = silent.address() as { port: number };
    const endpoint = new FakeEndpoint({ hub: `http://127.0.0.1:${port}`, credentials: { clientId: 'x', clientSecret: 'y' }, ref: 'r'.repeat(22), openMs: 300 });
    try {
      await expect(endpoint.connect()).rejects.toThrow(/upgrade unanswered for 300 ms/);
    } finally {
      silent.close();
    }
  });

  it('probes what the hub answers an endpoint’s upgrade: the socket for a listed machine, a refusal otherwise', async () => {
    const cleanup = new Cleanup();
    const admin = await OrgAdmin.open(person, { org: ORG, throwaway: true }, device, () => {});
    const machine = await admin.listedMachine('rd-probe', cleanup);
    expect(await upgradeProbe(hub.url, credentialHeaders(machine.credentials))).toBe('101');
    expect(await upgradeProbe(hub.url, credentialHeaders({ clientId: 'nobody', clientSecret: 'nothing' }))).toMatch(/^40[13] /);
    expect(await cleanup.run()).toEqual([]);
    expect(await upgradeProbe(hub.url, credentialHeaders(machine.credentials))).toMatch(/^40[13] /);
  });
});

describe('redeploy-check', () => {
  it('passes across a restart with its DX2 machines, its browser and its RL1 leg, and undoes what it made', async () => {
    const out: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => void out.push(args.join(' '));
    const cleanup = new Cleanup();
    let code: number;
    try {
      code = await redeployCheck(person, ORG, { seconds: '10', 'redeploy-at': '2' }, cleanup, () => hub.restart(), device);
    } finally {
      console.log = log;
    }
    const text = out.join('\n');
    expect(text).toMatch(/PASS: nothing lost, nothing duplicated across the redeploy/);
    expect(code).toBe(0);
    expect(text).toMatch(/rl1: the endpoint's socket closed .* welcomed again under generation/);
    expect(text).toMatch(/rl1: the app's socket closed .* a new channel to the endpoint echoed/);
    // Then the leg's own cuts, twice, on the code the redeploy put up.
    expect(text).toMatch(/rl1: forced cut 1: the endpoint dropped its socket at generation \d+ and was welcomed again under generation \d+ .* a new channel to the endpoint echoed/);
    expect(text).toMatch(/rl1: forced cut 2: the endpoint dropped its socket at generation \d+ and was welcomed again under generation \d+ .* a new channel to the endpoint echoed/);
    expect(await cleanup.run()).toEqual([]);
    const names = await machines();
    expect(names.filter((n) => n.startsWith('rd-'))).toEqual([]);
    expect((await head()).machines).toEqual([]);
  }, 180_000);

  // Acceptance 3 reads "after a staging deploy, both sockets drop": the leg's own cuts prove the reconnect, not the
  // deploy's cut. A redeploy that cut DX2's streams and neither RL1 socket is no PASS, and no FAIL either: the run says
  // the deploy's cut was not exercised and ends with its own status.
  it('is inconclusive, not a pass, when the redeploy cut neither RL1 socket', async () => {
    const out: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => void out.push(args.join(' '));
    const cleanup = new Cleanup();
    // The redeploy's stand-in ends the DX2 machines' objects alone; the object holding RL1 (addressed by the ref) stays.
    const cutDx2Only = async () => {
      for (const name of (await machines()).filter((n) => /^rd-[ab]-/.test(n))) await hub.terminate(name);
    };
    let code: number;
    try {
      code = await redeployCheck(person, ORG, { seconds: '10', 'redeploy-at': '2' }, cleanup, cutDx2Only, device);
    } finally {
      console.log = log;
    }
    const text = out.join('\n');
    expect(text).toMatch(/rl1: neither socket was cut/);
    expect(text).toMatch(/rl1: forced cut 2: .* a new channel to the endpoint echoed/);
    expect(text).not.toMatch(/^PASS/m);
    expect(text).toMatch(/^INCONCLUSIVE: deploy cut: not exercised \(the redeploy cut neither RL1 socket\); nothing lost or duplicated, and the leg's own cuts came back$/m);
    expect(code).toBe(REDEPLOY_INCONCLUSIVE);
    expect(REDEPLOY_INCONCLUSIVE).not.toBe(0);
    expect(REDEPLOY_INCONCLUSIVE).not.toBe(1);
    expect(await cleanup.run()).toEqual([]);
  }, 180_000);
});

describe('stopping the RL1 leg', () => {
  it('is bounded while a reopened socket’s upgrade stalls, and closes that socket when it opens late', async () => {
    const cleanup = new Cleanup();
    const admin = await OrgAdmin.open(person, { org: ORG, throwaway: true }, device, () => {});
    let first: RelayApp | undefined;
    let stalled: ((app: RelayApp) => void) | undefined;
    // The first socket opens; every later upgrade stalls until the test lets it through.
    const open: AppOpener = async (hub, ref, headers) => (first ? new Promise<RelayApp>((resolve) => (stalled = resolve)) : (first = await RelayApp.open(hub, ref, headers)));
    const watch = await Rl1Watch.start(person, admin, 'rd-ep-stall', cleanup, () => {}, open);
    first!.close();
    await until(() => stalled, 'the reopen, stalled');

    const stopped = await Promise.race([watch.stop(500).then(() => 'stopped'), sleep(3000).then(() => 'still waiting on the stalled upgrade')]);
    expect(stopped).toBe('stopped');

    const late = { ended: undefined, closed: false, close: () => void (late.closed = true) };
    stalled!(late as unknown as RelayApp);
    await until(() => (late.closed ? true : undefined), 'the late socket closed', 2000);
    // The cleanup's own stop of the leg returns at once now: the wait was spent by the first stop.
    expect(await cleanup.run()).toEqual([]);
    expect(await machines()).not.toContain('rd-ep-stall');
  });
});
