// The app's org session against desk-hub's Worker in Miniflare (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-
// interface.md, "Proves"; acceptance 1), with the stand-in's identity in Access's place. The org is rooted by O13's
// real `deployment admin` (`init`, `genesis`), and its `pair --class native-mac` is the approving side: the app's
// registration completes against it, and the fingerprint the app shows is the one `pair` prints. Then: a second session
// over the same profile is signed in from its files with no login and no request until its feed opens; an admin
// `refresh` is followed through the feed's notice; a served rollback is refused; O7's link comes up to an endpoint
// enrolled in the same org over the production session (O7 §B met exactly); a second member's app reads `denied` once
// the org removes the member and keeps its held head; and an admin `remove-device` makes `current()` null.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  base64urlEncode,
  encodePairingCode,
  keyId,
  signOrgState,
  type Certificates,
  type Device,
  type SignedOrgState,
} from 'org-protocol';
import { encodeEnrollmentCodeV2, type EnrollmentIssued, type EnrollmentKey, type PendingDevice } from 'desk-hub/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAdmin, type AdminIo } from '../../apps/desk-hub/deploy/admin.ts';
import { readAdminKeys, readText, volumeOf } from '../../apps/desk-hub/deploy/admin-device.ts';
import { successor } from '../../apps/desk-hub/deploy/org-admin.ts';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { loadDeviceKeys } from '../../src/main/device/keys';
import { createStepUp } from '../../src/main/device/step-up';
import { createEndpointRecords, ENDPOINT_RECORDS_FILE } from '../../src/main/machines/remote/endpoint-records';
import { openRelaySocket } from '../../src/main/machines/remote/carriers';
import { createRemoteLink, type RemoteLink } from '../../src/main/machines/remote/link';
import { createOrgSession, type OrgSessionDeps, type OrgSessionService } from '../../src/main/org/org-session';
import { createRegistryFeed, type RegistryFeed } from '../../src/main/org/registry-feed';
import type { OrgStatus } from '../../src/shared/ipc/schema/org';
import { fakeServices, type FakeServices } from '../endpoint/fake-services';
import { ADMIN, ORG, startMiniflareHub, type LocalHub } from '../endpoint/miniflare-hub';
import { FakeEngineHost, Records } from '../endpoint/sub-harness';

const SECOND = 'second@example.com';
const TAILNET = '100.101.102.111';
const v4 = (address: string): NetworkInterfaceInfo => ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.255', mac: '00:00:00:00:00:00', cidr: null });
const OPEN = { perSource: { burst: 1000, perMinute: 60_000 }, overall: { burst: 1000, perMinute: 60_000 } };

const scratch = mkdtempSync(join(tmpdir(), 'maws-o8-sign-in-'));
const dir = (name: string) => {
  const path = join(scratch, name);
  mkdirSync(path, { recursive: true });
  return path;
};
const adminKeys = join(dir('admin'), 'keys.json');

let hub: LocalHub;
let stopHub: () => Promise<void>;
let endpoint: Endpoint | undefined;
let services: FakeServices | undefined;
let ref: string;
const sessions: OrgSessionService[] = [];
const feeds: RegistryFeed[] = [];
const links: RemoteLink[] = [];
const logs: string[] = [];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until<T>(check: () => T | null | false | undefined | Promise<T | null | false | undefined>, what: string, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value !== null && value !== false && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(20);
  }
}

/** `deployment admin`'s world, recorded; the terminal is never asked (every verb runs with --yes). */
function adminIo(): { io: AdminIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: AdminIo = {
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    openTerminal: () => ({ write: () => {}, readLine: async () => '' }),
    secrets: async () => ({}),
    exec: async () => {},
    volumeOf,
    removableVolume: () => false,
    readText,
    placement: { home: join(scratch, 'home'), tmpRoots: [join(scratch, 'swept')] },
    env: {},
    appDir: join(import.meta.dirname, '../../apps/desk-hub'),
    sleep: (ms) => sleep(Math.min(ms, 50)),
    readStdin: async () => '',
    secretOut: async () => {
      throw new Error('no verb here writes a secret to stdout');
    },
    stdoutIsTerminal: false,
  };
  return { io, out, err };
}
const asLocal = () => ['--hub', hub.url, '--user', ADMIN, '--keys', adminKeys];
async function admin(...args: string[]): Promise<{ out: string[]; err: string[] }> {
  const run = adminIo();
  const status = await runAdmin([...args, ...asLocal()], run.io);
  if (status !== 0) throw new Error(`deployment admin ${args[0]}: ${status} ${run.err.join(' | ')}`);
  return run;
}

const served = async (as = ADMIN) => (await (await hub.fetchAs(as, '/api/org/state?since=0')).json()) as { head: SignedOrgState; chain: SignedOrgState[]; certificates: Certificates };
/** A successor the deployment admin's device signs, posted. */
async function amend(edit: (state: SignedOrgState['state']) => void): Promise<SignedOrgState> {
  const keys = await readAdminKeys(adminKeys);
  const head = (await served()).head;
  const next = await signOrgState(await successor(head.state, edit), [keys.stepUp]);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: next });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  return next;
}

function session(userData: string, over: Partial<OrgSessionDeps> = {}): OrgSessionService {
  const made = createOrgSession({
    userData,
    build: 'o8-m1-local',
    packaged: false,
    env: { MAWS_DEV_STANDIN_USER: ADMIN },
    openExternal: () => {
      throw new Error('the stand-in opens no browser');
    },
    stepUp: (keys, device) => createStepUp({ device, key: keys.stepUp, confirm: async () => ({ ok: true }) }),
    loadKeys: (profile) => loadDeviceKeys(profile, { excludeFromBackup: async () => true }),
    excludeFromBackup: async () => true,
    timing: { APPROVAL_POLL_MS: 200 },
    log: (line) => void logs.push(line),
    ...over,
  });
  sessions.push(made);
  return made;
}
function follow(s: OrgSessionService): RegistryFeed {
  const feed = createRegistryFeed({ session: s, log: (line) => void logs.push(line) });
  s.attach(feed);
  feeds.push(feed);
  return feed;
}
const registered = (s: OrgSessionService) => {
  const status = s.status();
  return status.state === 'registered' ? status : null;
};

let member: string;
const profile = dir('profile');

beforeAll(async () => {
  ({ hub, stop: stopHub } = await startMiniflareHub());
  await admin('init');
  member = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  const recovery = join(dir('volume'), 'recovery.json');
  const genesis = adminIo();
  expect(await runAdmin(['genesis', '--recovery', recovery, ...asLocal(), '--yes'], genesis.io)).toBe(0);
}, 120_000);

afterAll(async () => {
  for (const link of links) link.close();
  for (const feed of feeds) feed.close();
  for (const s of sessions) await s.close();
  await endpoint?.stop();
  services?.cleanup();
  await stopHub?.();
  rmSync(scratch, { recursive: true, force: true });
});

describe('the org session on the local hub', { timeout: 120_000 }, () => {
  let deviceId: string;

  it('registers through `deployment admin pair --class native-mac`: the fingerprint the app shows is the one pair prints', async () => {
    const pairing = adminIo();
    const running = runAdmin(['pair', '--class', 'native-mac', '--ttl', '60', ...asLocal(), '--yes'], pairing.io);
    const line = await until(() => pairing.out.find((l) => l.startsWith('pairing code: ')), 'the pairing code');
    const s = session(profile);
    await s.loaded;
    expect(s.status()).toEqual({ state: 'none' });
    const statuses: OrgStatus[] = [];
    s.onStatus((status) => void statuses.push(status));
    expect(s.register(`  ${line.slice('pairing code: '.length)}\n`)).toEqual({ ok: true });
    const approval = await until(() => {
      const status = s.status();
      return status.state === 'registering' && status.step === 'approval' ? status : null;
    }, 'the approval step');
    expect(approval.fingerprint).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(await running).toBe(0);
    expect(pairing.out.find((l) => l.startsWith('pending: '))).toMatch(new RegExp(`fingerprint ${approval.fingerprint}$`));
    const signedIn = await until(() => s.current(), 'the device signed in');
    deviceId = signedIn.identity.device;
    expect(signedIn.identity).toMatchObject({ org: ORG, member, clientClass: 'native-mac', capabilities: [] });
    expect(deviceId).toBe(await keyId(signedIn.identity.channelKey.pub));
    expect(await signedIn.hub!.headers()).toEqual({ 'x-desk-standin-user': ADMIN });
    expect(registered(s)).toMatchObject({ session: 'signed-in', member: { id: member, email: ADMIN }, head: { version: (await served()).head.state.version }, problem: null });
    // No status ever carried the code's secret.
    const k = JSON.parse(Buffer.from(line.slice('pairing code: smns-pair-v1.'.length), 'base64url').toString()).k as string;
    expect(JSON.stringify(statuses)).not.toContain(k);
    await s.close();
  });

  it('signs in again from the profile with no login and no request until the feed opens', async () => {
    const requests: string[] = [];
    const s = session(profile, {
      login: async () => {
        throw new Error('no login at a relaunch');
      },
      fetch: (input, init) => {
        requests.push(String(input));
        return fetch(input, init);
      },
    });
    await s.loaded;
    expect(s.current()?.identity.device).toBe(deviceId);
    expect(requests).toEqual([]);
    follow(s);
    await until(() => registered(s)?.hubAccess === 'connected', 'the feed connected');
    await until(() => requests.length > 0, 'the chain read at the feed’s open');
  });

  it('follows an admin `refresh` through the feed’s notice', async () => {
    const s = sessions.at(-1)!;
    const before = s.current()!.view.head().state.version;
    let changed = 0;
    s.onChanged(() => void changed++);
    await admin('refresh');
    await until(() => s.current()?.view.head().state.version === before + 1 && changed > 0, 'the refreshed head adopted and told');
    expect(registered(s)?.head?.version).toBe(before + 1);
  });

  it('refuses a served rollback, the held head standing', async () => {
    const whole = await served();
    const old = whole.chain[0];
    const held = whole.head.state.version;
    // A hub that serves the genesis as its head, as one restored from an old backup would.
    const s = session(profile, {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname !== '/api/org/state') return fetch(input, init);
        const since = Number(url.searchParams.get('since') ?? NaN);
        const body = { head: old, transitions: [], certificates: whole.certificates, ...(Number.isNaN(since) ? {} : { chain: since < 1 ? [old] : [], more: false }) };
        return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'x-desk-build': 'test' } });
      },
    });
    await s.loaded;
    follow(s);
    await until(() => registered(s)?.problem === 'rollback', 'the rollback refused');
    expect(s.current()?.view.head().state.version).toBe(held);
    await s.close();
  });

  it('meets O7 §B: O7’s link comes up over the hub to an endpoint enrolled in the same org', async () => {
    services = fakeServices();
    const host = new FakeEngineHost();
    host.serve(services);
    const records = new Records();
    let port = 0;
    endpoint = createEndpoint({
      build: 'o8-m1-local',
      sleep: (ms) => sleep(Math.min(ms, 50)),
      env: { MAWS_ENDPOINT_DIRECT: '1' },
      direct: {
        interfaces: () => ({ utun4: [v4(TAILNET)] }),
        listen: (server: Server) =>
          new Promise<number>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => resolve((port = (server.address() as AddressInfo).port)));
          }),
        limits: OPEN,
      },
      authorization: { records, checkouts: { known: (path) => endpoint!.rl10.members.known(path) }, settingsMode: () => 'default' },
    });
    records.bindLaneA(endpoint.rl10.members);
    await endpoint.start(services);
    ref = services.machine.ref;
    const keys = await readAdminKeys(adminKeys);
    const head = (await served()).head;
    const issued = (await (await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as EnrollmentIssued;
    const code = encodeEnrollmentCodeV2({ hub: hub.url, token: issued.token, roots: [await keyId(keys.stepUp.pub)], recoveryPub: head.state.root.recoveryPub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
    const enrolling = endpoint.cli('enroll', ['--name', 'o8-mini', '--wait', '30', '--json'], code);
    const key = await until(async () => {
      const response = await hub.fetchAs(ADMIN, `/api/enrollments/${issued.enrollment.id}/key`);
      if (response.status === 200) return (await response.json()) as EnrollmentKey;
      await response.body?.cancel();
      return null;
    }, 'the posted machine key');
    await amend((state) => {
      state.machines.push({ name: 'o8-mini', ref, pub: key.pub, owners: [member] });
      state.machineNames.push({ name: 'o8-mini', ref });
    });
    expect((await enrolling).code).toBe(0);
    await until(() => endpoint!.hub.connected && endpoint!.status().listener.bound && port !== 0, 'the endpoint up');
    const version = (await served()).head.state.version;
    await until(() => (endpoint!.status().stateVersion ?? 0) >= version, 'the endpoint at the head');
    const hosted = host.add('app-1');
    records.set({ lane: 'B', session: hosted.engineSessionId!, owners: ['@machine'] }, 'app-1');
    host.attach(true);

    const s = sessions[1]; // the second test's session, which follows the hub
    await until(() => s.current()?.view.head().state.version === version, 'the session at the head');
    const link = createRemoteLink({
      machine: { ref: ref as never, name: 'o8-mini' },
      session: s,
      records: createEndpointRecords({ file: join(profile, ENDPOINT_RECORDS_FILE), log: (line) => void logs.push(line) }),
      dialDirect: async (url) => {
        throw new Error(`${url} refused: this test goes through the hub`);
      },
      openRelay: (url, headers) => openRelaySocket(url, headers),
      timing: { DIRECT_BUCKET: OPEN.perSource },
      log: (line) => void logs.push(line),
    });
    links.push(link);
    await until(() => link.carrier() === 'relay', 'the link up over the relay', 30_000);
    expect(await link.call('session.status', { appSessionId: 'app-1' })).toMatchObject({ ok: true });
  });

  it('reads `denied` when the org removes the member, keeping the held head until a verified one drops the device', async () => {
    let second = '';
    await amend((state) => {
      second = `${'b'.repeat(31)}1`;
      state.members.push({ id: second, email: SECOND, role: 'member', devices: [] });
    });
    const head = (await served()).head;
    const k = crypto.getRandomValues(new Uint8Array(16));
    const code = encodePairingCode({ hub: hub.url, org: ORG, member: second, roots: head.state.root.keys, recoveryPub: head.state.root.recoveryPub, k: base64urlEncode(k) });
    const s = session(dir('second'), { env: { MAWS_DEV_STANDIN_USER: SECOND } });
    await s.loaded;
    expect(s.register(code)).toEqual({ ok: true });
    await until(() => s.status().state === 'registering' && (s.status() as { step: string }).step === 'approval', 'the second member’s approval step');
    // The org's admin approves the member's first device (no endorsement: it is the member's first).
    const { pending } = (await (await hub.fetchAs(SECOND, '/api/devices/pending')).json()) as { pending: PendingDevice[] };
    expect(pending).toHaveLength(1);
    const { deviceId, class: cls, keyStorage, channelPub, stepUpPub } = pending[0];
    const entry: Device = { id: deviceId, class: cls, keyStorage, channelPub, stepUpPub };
    await amend((state) => void state.members.find((m) => m.id === second)!.devices.push(entry));
    const signedIn = await until(() => s.current(), 'the second member signed in');
    follow(s);
    await until(() => registered(s)?.hubAccess === 'connected', 'the second member’s feed connected');

    const heldVersion = signedIn.view.head().state.version;
    const kids = { channel: await keyId(entry.channelPub), stepUp: await keyId(entry.stepUpPub!) };
    await amend((state) => {
      state.members = state.members.filter((m) => m.id !== second);
      state.revoked.push({ keyId: kids.channel, holder: { member: second, device: entry.id, class: 'native-mac', key: 'channel' } });
      state.revoked.push({ keyId: kids.stepUp, holder: { member: second, device: entry.id, class: 'native-mac', key: 'step-up' } });
    });
    await until(() => registered(s)?.hubAccess === 'denied', 'denied');
    expect(s.current()).not.toBeNull();
    expect(s.current()!.hub).toBeNull();
    expect(s.current()!.view.head().state.version).toBe(heldVersion);
  });

  it('makes current() null when an admin `remove-device` drops this device', async () => {
    const s = sessions[1];
    expect(s.current()).not.toBeNull();
    await admin('remove-device', deviceId, '--yes');
    await until(() => s.current() === null, 'current() null');
    expect(registered(s)).toMatchObject({ session: 'removed' });
  });
});

