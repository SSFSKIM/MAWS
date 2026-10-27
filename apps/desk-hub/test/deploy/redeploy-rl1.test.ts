// redeploy-check's RL1 leg (O11 M8; acceptance 3's deploy clause), against the local hub, whose runtime restart stands
// in for a redeploy (every object restarts, every connection drops): both the endpoint's RL1 socket and the app's
// Machine socket drop, the endpoint comes back under a higher generation, a new channel echoes, and the leg says when
// each dropped and how long each took; then the whole command, DX2's machines and browser beside the leg, passes across
// the restart and undoes what it made.
import { createServer } from 'node:net';
import { type SignedOrgState } from 'org-protocol';
import { FakeEndpoint } from '../../fake-machine/endpoint.ts';
import { credentialHeaders } from '../../fake-machine/link.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrgAdmin, type AdminDevice } from '../../deploy/org-admin.ts';
import { Cleanup } from '../../deploy/proof.ts';
import { redeployCheck } from '../../deploy/redeploy-check.ts';
import { Rl1Watch, upgradeProbe } from '../../deploy/rl1-reconnect.ts';
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
    expect(await cleanup.run()).toEqual([]);
    const names = await machines();
    expect(names.filter((n) => n.startsWith('rd-'))).toEqual([]);
    expect((await head()).machines).toEqual([]);
  }, 180_000);
});
