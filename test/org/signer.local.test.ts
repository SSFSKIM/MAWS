// The app as the org's signer against desk-hub's Worker in Miniflare (P5 O8 M3, docs/doperpowers/plans/2026-10-28-p5-o8-
// org-interface.md, "Proves"; acceptance 3), on the local org the O8 suites share (./local-org.ts): rooted by O13's real
// `deployment admin`, the app registered through its `pair` (M1), and a real endpoint enrolled in the org with O7's link
// up to it over the hub's relay. Touch ID is the state signer's injected confirmation; nothing reaches the Keychain or
// the real backup exclusion.
//
// - `root add` run by the admin makes the app a root, and the weekly successor it then signs at a window's focus is the
//   hub's head and the admin's next `show`'s.
// - An admin `refresh` that wins the race against the app's successor leaves the app's proposal `pending-fork`, held
//   until the owner's discard.
// - The superseded-key revocation: a recovery rewinds the app's chain past a revocation the hub never held (signed by the
//   deployment admin and delivered straight to the machine, RL §5.2, from which the app learned it at its link's
//   handshake), and the app's revocation of what the recovered line left current reaches the endpoint over the link and
//   is acknowledged. The same is proved for an endpoint far behind, for a post the hub refuses (the endpoint adopting the
//   pending state), and for a run that fills DELIVERY_MAX_BYTES. While a delivery is proved, the endpoint's own reads of
//   the hub's org state fail, so the link is the only way the state can reach it.
// - `rekey` of an unmarked device registers new keys with a second `pair`; the admin's `remove-device` of the old id
//   then has the retired key file destroyed.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateSigningKey,
  importSigningKey,
  keyId,
  signOrgState,
  signTransition,
  stateHash,
  type Device,
  type SignedOrgState,
} from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAdminKeys } from '../../apps/desk-hub/deploy/admin-device.ts';
import { successor } from '../../apps/desk-hub/deploy/org-admin.ts';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { loadDeviceKeys } from '../../src/main/device/keys';
import { createStateSigner, type Confirm } from '../../src/main/device/step-up';
import type { ActOutcome, RemoteLink } from '../../src/main/machines/remote/link';
import { runBytes, type DeliveryLink } from '../../src/main/org/deliveries';
import type { OrgSessionService } from '../../src/main/org/org-session';
import { createRegistryFeed, type RegistryFeed } from '../../src/main/org/registry-feed';
import { orgTiming } from '../../src/main/org/timing';
import type { OrgSignerStatus } from '../../src/shared/ipc/schema/org';
import type { MachineRef } from '../../src/shared/machine/ref';
import { fakeServices, type FakeServices } from '../endpoint/fake-services';
import { ADMIN, ORG, enrollEndpoint, orgSession, registerThroughPair, registered, relayLink, scratchDir, sleep, startLocalOrg, until, type LocalOrg } from './local-org';

const MACHINE = 'o8-signer-mini';
const MAX_BYTES = orgTiming().DELIVERY_MAX_BYTES;
const scratch = scratchDir('maws-o8-signer-');
const profile = scratch.dir('profile');
const logs: string[] = [];
const log = (line: string) => void logs.push(line);

let org: LocalOrg;
let endpoint: Endpoint;
let services: FakeServices;
let ref: MachineRef;
let app: OrgSessionService;
let feed: RegistryFeed;
let detach: () => void = () => {};
let link: RemoteLink;
let deviceId: string;
const others: Array<{ session: OrgSessionService; feed: RegistryFeed }> = [];

// ---- Touch ID, the windows and the roster, as main injects them ----

type Prompt = Parameters<Confirm>[0];
/** Every prompt the state signer showed, in order; each answered yes once `touchId` resolves. */
const asked: Prompt[] = [];
let touchId: (prompt: Prompt) => Promise<void> = async () => {};
const confirm: Confirm = async (prompt) => {
  asked.push(prompt);
  await touchId(prompt);
  return { ok: true };
};
const focusListeners = new Set<() => void>();
const focus = () => focusListeners.forEach((listener) => listener());
let roster: MachineRef[] = [];
const rosterListeners = new Set<() => void>();

/** Each `endpoint.state` run the deliveries sent over the link: its states' versions, its size and its outcome. */
type Run = { versions: number[]; bytes: number; outcome: ActOutcome | null };
const runs: Run[] = [];
/** The link as the deliveries reach it (main's `Machines.remote(ref)`), each `endpoint.state` act recorded on its way. */
let delivering: DeliveryLink | null = null;
function recording(through: RemoteLink): DeliveryLink {
  return {
    state: () => through.state(),
    caps: () => through.caps(),
    onState: (listener) => through.onState(listener),
    act(request) {
      const handle = through.act(request);
      if (request.action === 'endpoint.state') {
        const { states, transitions } = request.args as { states: SignedOrgState[]; transitions: Parameters<typeof runBytes>[1] };
        const run: Run = { versions: states.map((s) => s.state.version), bytes: runBytes(states, transitions), outcome: null };
        runs.push(run);
        void handle.outcome.then((outcome) => (run.outcome = outcome));
      }
      return handle;
    },
  };
}

// ---- The network seams ----

/** While set, the app's reads of the org state wait until its next post of one has its answer (the race's window). */
let holding: { released: Promise<void>; release(): void } | null = null;
/** While set, the hub answers the app's post of a state `503 busy`, as the Registry does when it can't commit one. */
let refusing = false;
const appFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname !== '/api/org/state') return fetch(input, init);
  const posting = (init?.method ?? 'GET') === 'POST';
  if (posting && refusing) return Response.json({ error: 'busy', message: 'send it again' }, { status: 503, headers: { 'x-desk-build': 'local' } });
  const hold = holding;
  if (hold === null) return fetch(input, init);
  if (!posting) {
    await hold.released;
    return fetch(input, init);
  }
  try {
    return await fetch(input, init);
  } finally {
    hold.release();
  }
};
/** While set, the endpoint's reads of the hub's org state fail: what it adopts, it adopts over the link. */
let withheld = false;
const endpointFetch: typeof fetch = (input, init) =>
  withheld && new URL(String(input)).pathname === '/machine/org/state' ? Promise.reject(new TypeError('the hub is withheld from this machine')) : fetch(input, init);

// ---- Reading the parties ----

const signer = (): NonNullable<OrgSignerStatus> => {
  const status = registered(app)?.signer;
  if (status == null) throw new Error(`no signer status: ${JSON.stringify(app.status())}`);
  return status;
};
const appHead = () => app.current()!.view.head();
const endpointHead = () => endpoint.parts!.org.head();
const hubHead = async () => (await org.served()).head;
const same = async (a: SignedOrgState, b: SignedOrgState) => (await stateHash(a.state)) === (await stateHash(b.state));
/** The app's signing.json as it is on disk. */
const signingFile = () => JSON.parse(readFileSync(join(profile, 'org', 'signing.json'), 'utf8')) as { pending: { signed: SignedOrgState } | null };

/** Waits until the app and the endpoint both hold the hub's head (the endpoint only when its reads aren't withheld). */
async function settled(what: string): Promise<SignedOrgState> {
  const head = await hubHead();
  await until(async () => app.current() !== null && (await same(appHead(), head)), `the app at the hub's version ${head.state.version} (${what})`);
  if (!withheld) await until(async () => endpoint.parts?.org.ready && (await same(endpointHead(), head)), `the endpoint at the hub's version ${head.state.version} (${what})`);
  return head;
}

/** Every machine has acknowledged every revocation the app signed. */
const acknowledged = () => signer().owing.length === 0;

/** The status's `owing` each time it changed, so a machine owing a version, then not, is seen. */
const owed: Array<NonNullable<OrgSignerStatus>['owing']> = [];

/**
 * A revocation the recovered line loses. Through the hub, the deployment admin adds a member with one device. It then
 * signs that device's removal (both keys into `revoked`) and, instead of posting it, has it delivered straight to the
 * endpoint (RL §5.2), as while the hub is withheld: here over the app's link, since `endpoint.state` carries its
 * authority in the state's own signature. The app learns it from the endpoint at its link's next handshake. Then the recovery: a root transition the org's recovery key signs from the hub's head (the version
 * before the removal), saying the states after it are forged, and two successors under the same roots, the second of
 * which brings the app to read the hub and rewind. The app's chain now holds the removal only as superseded, and the
 * recovered line lists the device again: the superseded offer revokes it.
 *
 * The endpoint keeps the removal, on the superseded branch: its own sync reads the hub from its head on, and a page
 * after the removal's version never holds the recovered line's first state, so only a delivery carrying the recovery
 * (recovery first) brings it back. From the recovery on its reads of the hub are withheld, so whatever it adopts next
 * it adopts over the link.
 */
async function loseRevocation(n: number): Promise<{ member: string; device: Device; kids: string[]; base: number; removal: SignedOrgState }> {
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  const device: Device = { id: await keyId(channel.pub), class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub };
  const member = `${'c'.repeat(31)}${n}`;
  await org.amend((state) => void state.members.push({ id: member, email: `lost-${n}@example.com`, role: 'member', devices: [device] }));
  const head = await settled(`lost device ${n} listed`);
  const base = head.state.version;

  const kids = [await keyId(channel.pub), await keyId(stepUp.pub)];
  const removal = await signOrgState(
    await successor(head.state, (state) => {
      state.members.find((m) => m.id === member)!.devices = [];
      state.revoked.push({ keyId: kids[0], holder: { member, device: device.id, class: 'native-mac', key: 'channel' } });
      state.revoked.push({ keyId: kids[1], holder: { member, device: device.id, class: 'native-mac', key: 'step-up' } });
    }),
    [(await readAdminKeys(org.adminKeys)).stepUp],
  );
  expect(await link.act({ action: 'endpoint.state', args: { states: [removal], transitions: [] }, stepUp: 'never' }).outcome).toMatchObject({ state: 'done', result: { version: base + 1 } });
  // The endpoint closes the channel; O7's link comes up again at once, and the endpoint's h2 brings the app the removal.
  await endpoint.channels.closeAll('restart');
  await until(async () => appHead().state.version === base + 1 && (await same(appHead(), removal)), 'the removal learned at the handshake');

  withheld = true;
  const recovery = (JSON.parse(readFileSync(org.recovery, 'utf8')) as { key: JsonWebKey }).key;
  const key = await importSigningKey(recovery);
  // The same roots go on: a root kid names an admin's device's step-up key, which the transition carries whole.
  const stepUps = new Map<string, string>();
  for (const d of head.state.members.flatMap((m) => m.devices)) if (d.stepUpPub !== undefined) stepUps.set(await keyId(d.stepUpPub), d.stepUpPub);
  const newRootKeys = head.state.root.keys.map((kid) => stepUps.get(kid)!);
  const transition = await signTransition({ org: ORG, fromVersion: base, newRootKeys, issued: new Date().toISOString() }, key.privateKey, key.pub);
  const posted = await org.hub.fetchAs(ADMIN, '/api/org/transitions', { body: transition });
  expect(posted.status, await posted.clone().text()).toBe(201);
  // The recovered line's first state is at the removal's version, whose notice the app doesn't follow (it follows a
  // notice above its head); the second one's notice is above it.
  await org.amend(() => {});
  await org.amend(() => {});
  await settled(`recovery ${n}`);
  await until(() => (signer().offer?.superseded ?? 0) === 2, `the offer to revoke lost device ${n}`);
  return { member, device, kids, base, removal };
}

/** The endpoint's reads of the org state work again, and it catches up with the hub. */
async function release(): Promise<void> {
  withheld = false;
  await endpoint.syncNow();
  await settled('the endpoint released');
}

beforeAll(async () => {
  org = await startLocalOrg(scratch);
  app = orgSession({
    userData: profile,
    build: 'o8-m3-local',
    log,
    fetch: appFetch,
    // The weekly successor is due as soon as the app may sign, so a window's focus asks (weekly.test.ts holds the 7 days).
    timing: { WEEKLY_DUE_DAYS: 0 },
    signing: {
      stateSigner: (keys) => createStateSigner({ key: keys.stepUp, confirm }),
      focused: () => true,
      onFocus: (listener) => {
        focusListeners.add(listener);
        return () => void focusListeners.delete(listener);
      },
      notify: (text) => log(`notified: ${text}`),
      roster: () => roster,
      onRoster: (listener) => {
        rosterListeners.add(listener);
        return () => void rosterListeners.delete(listener);
      },
      link: (machine) => (machine === ref ? delivering : null),
    },
  });
  app.onStatus((status) => {
    const owing = status.state === 'registered' ? status.signer?.owing : undefined;
    if (owing !== undefined && JSON.stringify(owing) !== JSON.stringify(owed.at(-1))) owed.push(owing);
  });
  ({ device: deviceId } = await registerThroughPair(org, app));
  feed = createRegistryFeed({ session: app, log });
  detach = app.attach(feed);

  services = fakeServices();
  endpoint = createEndpoint({ build: 'o8-m3-local', sleep: (ms) => sleep(Math.min(ms, 50)), fetch: endpointFetch });
  await endpoint.start(services);
  ref = services.machine.ref;
  await enrollEndpoint(org, endpoint, ref, MACHINE);
  await until(() => endpoint.hub.connected, 'the endpoint’s hub link');
  await settled('the endpoint enrolled');

  link = relayLink({ session: app, machine: { ref, name: MACHINE }, profile, log });
  await until(() => link.carrier() === 'relay', 'the link up over the relay', 30_000);
  delivering = recording(link);
  roster = [ref];
  rosterListeners.forEach((listener) => listener());
}, 180_000);

afterAll(async () => {
  link?.close();
  detach();
  feed?.close();
  await app?.close();
  for (const other of others) {
    other.feed.close();
    await other.session.close();
  }
  await endpoint?.stop();
  services?.cleanup();
  await org?.stop();
  rmSync(scratch.root, { recursive: true, force: true });
});

describe('the app as the org’s signer on the local hub', { timeout: 180_000 }, () => {
  it('becomes a root by `deployment admin root add`, and reads itself one', async () => {
    const before = signer();
    expect(before).toMatchObject({ root: false, maySign: false });
    expect(await app.resign()).toMatchObject({ ok: false, reason: 'not-root' });

    const { out } = await org.admin('root', 'add', deviceId, '--yes');
    expect(out.find((line) => line.startsWith('root added: '))).toMatch(new RegExp(`^root added: ${deviceId}, step-up ${before.stepUpKid} \\(version \\d+\\)$`));
    await until(() => signer().root && signer().maySign, 'the app reading itself a root');
    const adminKid = await keyId((await readAdminKeys(org.adminKeys)).stepUp.pub);
    expect(appHead().state.root.keys).toEqual([adminKid, before.stepUpKid]);
    expect(asked).toEqual([]);
  });

  it('signs the weekly successor at a window’s focus, which the hub takes and the admin’s next `show` adopts', async () => {
    const before = await settled('before the weekly successor');
    expect(signer()).toMatchObject({ due: true, pending: null });

    focus();
    const signed = await until(async () => {
      const head = await hubHead();
      return head.state.version === before.state.version + 1 ? head : null;
    }, 'the weekly successor at the hub');
    expect(asked).toEqual([{ summary: 're-sign the org state (no change)', text: expect.stringContaining('No change') }]);
    expect(signed.sigs.map((s) => s.kid)).toEqual([signer().stepUpKid]);
    // No change but the link: the version, its predecessor's hash and the time it was issued.
    expect({ ...signed.state, version: 0, prev: '', issued: '' }).toEqual({ ...before.state, version: 0, prev: '', issued: '' });
    await settled('the weekly successor');
    await until(() => signer().pending === null && signer().ageDays === 0, 'the weekly successor settled');

    // A second focus the same day doesn't ask again.
    focus();
    await sleep(500);
    expect(asked).toHaveLength(1);

    await org.admin('show');
    const anchor = JSON.parse(readFileSync(`${org.adminKeys}.org.json`, 'utf8')) as { version: number };
    expect(anchor.version).toBe(signed.state.version);
  });

  it('holds its proposal as `pending-fork` when an admin `refresh` wins the race, until the owner discards it', async () => {
    const parent = (await settled('before the race')).state.version;
    // While Touch ID is asked, the admin's `refresh` takes the parent's successor at the hub; the app's reads of the
    // hub wait until its own post is answered, so its proposal goes out on the head it was signed on.
    touchId = async () => {
      let release!: () => void;
      holding = { released: new Promise<void>((resolve) => (release = resolve)), release: () => release() };
      await org.admin('refresh');
    };
    const raced = await app.resign();
    touchId = async () => {};
    holding = null;

    expect(raced).toEqual({ ok: false, reason: 'hub', detail: 'not-head' });
    const theirs = await hubHead();
    expect(theirs.state.version).toBe(parent + 1);
    expect(theirs.sigs.map((s) => s.kid)).not.toContain(signer().stepUpKid);
    await until(async () => (await same(appHead(), theirs)) && signer().pending?.fork === true, 'the proposal read as a fork');
    expect(signer().pending).toEqual({ version: parent + 1, fork: true, exposed: true, refused: 'not-head' });
    const proposal = signingFile().pending!.signed;
    expect(await same(proposal, theirs)).toBe(false);

    // Settling (as every sign does first) and the feed's next notices leave it: nothing else is signed meanwhile.
    expect(await app.resign()).toEqual({ ok: false, reason: 'pending' });
    await org.admin('refresh');
    await settled('a later refresh');
    expect(signer().pending).toMatchObject({ version: parent + 1, fork: true });
    expect(signingFile().pending?.signed).toEqual(proposal);

    expect(await app.discardPending(true)).toEqual({ ok: true, unsent: false, hubVersion: parent + 2, forkAt: parent + 1 });
    expect(signer()).toMatchObject({ pending: null, abandoned: [{ version: parent + 1, hub: true, machines: [] }] });
    expect(signingFile().pending).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('delivers a superseded key’s revocation to the endpoint over the link, which acknowledges it and holds it', async () => {
    const lost = await loseRevocation(1);
    // The endpoint still holds the removal, on the branch the recovery superseded.
    expect(await same(endpointHead(), lost.removal)).toBe(true);
    const sent = runs.length;

    const outcome = await app.revokeSuperseded();
    expect(outcome).toEqual({ ok: true, version: lost.base + 3 });
    expect(asked.at(-1)).toMatchObject({ summary: 'revoke the keys a recovery left current' });
    await until(() => acknowledged() && endpointHead().state.version === lost.base + 3, 'the revocation acknowledged');

    const held = endpointHead();
    expect(await same(held, appHead())).toBe(true);
    expect(await same(held, await hubHead())).toBe(true);
    expect(held.state.revoked.map((r) => r.keyId)).toEqual(expect.arrayContaining(lost.kids));
    expect(held.state.members.find((m) => m.id === lost.member)!.devices).toEqual([]);
    expect(owed).toContainEqual([{ version: lost.base + 3, machines: [ref], tooLarge: [] }]);
    // Recovery first: one run from the recovery's base rewound the endpoint onto the app's line and was acknowledged.
    expect(runs.slice(sent)).toEqual([{ versions: [lost.base, lost.base + 1, lost.base + 2, lost.base + 3], bytes: expect.any(Number), outcome: { state: 'done', result: { version: lost.base + 3, rewound: true } } }]);
    await release();
  });

  it('rekeys an unmarked device with a second `pair`, and destroys the old key file once the admin removes the old device', async () => {
    const userData = scratch.dir('unmarked');
    const keysFile = (name: string) => join(userData, 'device', name);
    // Its keys made while the backup exclusion failed: they lack the mark, and the org section offers new ones.
    const unmarked = orgSession({ userData, build: 'o8-m3-local', log, loadKeys: (p) => loadDeviceKeys(p, { excludeFromBackup: async () => false }) });
    const unmarkedFeed = createRegistryFeed({ session: unmarked, log });
    others.push({ session: unmarked, feed: unmarkedFeed });
    const { device: old } = await registerThroughPair(org, unmarked);
    unmarked.attach(unmarkedFeed);
    expect(JSON.parse(readFileSync(keysFile('keys.json'), 'utf8'))).not.toHaveProperty('excludedFromBackupAtCreation');
    await until(() => registered(unmarked)?.signer?.rekey === 'unmarked', 'the rekey offered');

    const pairing = org.start('pair', '--class', 'native-mac', '--ttl', '60', '--yes');
    const line = await until(() => pairing.out.find((l) => l.startsWith('pairing code: ')), 'the second pairing code');
    expect(unmarked.rekey(line.slice('pairing code: '.length))).toEqual({ ok: true });
    const approval = await until(() => {
      const rekeying = registered(unmarked)?.signer?.rekeying;
      return rekeying?.step === 'approval' ? rekeying : null;
    }, 'the new keys awaiting approval');
    // The old device answers for this Mac until the head lists the new entry.
    expect(unmarked.current()?.identity.device).toBe(old);
    expect(await pairing.status).toBe(0);
    expect(pairing.out.find((l) => l.startsWith('pending: '))).toMatch(new RegExp(`fingerprint ${approval.fingerprint}$`));

    const renewed = await until(() => {
      const current = unmarked.current();
      return current !== null && current.identity.device !== old ? current : null;
    }, 'the new device signed in');
    expect(renewed.identity.device).toBe(await keyId(renewed.identity.channelKey.pub));
    expect(JSON.parse(readFileSync(keysFile('keys.json'), 'utf8'))).toMatchObject({ excludedFromBackupAtCreation: true });
    expect(existsSync(keysFile('keys.next.json'))).toBe(false);
    expect(existsSync(keysFile('keys.retired.json'))).toBe(true);
    await until(() => registered(unmarked)?.signer?.oldDevice === old, 'the old device named');
    expect(registered(unmarked)).toMatchObject({ device: renewed.identity.device, session: 'signed-in', signer: { rekey: null, rekeying: null } });

    await org.admin('remove-device', old, '--yes');
    await until(() => !existsSync(keysFile('keys.retired.json')) && registered(unmarked)?.signer?.oldDevice === null, 'the retired key file destroyed');
    expect(unmarked.current()?.identity.device).toBe(renewed.identity.device);
    expect((await hubHead()).state.members.flatMap((m) => m.devices.map((d) => d.id))).not.toContain(old);
  });

  it('delivers a revocation to an endpoint more than 16 states behind, which adopts the run and acknowledges it', async () => {
    const lost = await loseRevocation(2);
    const behind = endpointHead().state.version;
    for (let i = 0; i < 17; i++) await org.amend(() => {});
    await settled('17 states the endpoint lacks');
    const sent = runs.length;

    const outcome = await app.revokeSuperseded();
    expect(outcome).toMatchObject({ ok: true });
    const version = (outcome as { version: number }).version;
    expect(version - behind).toBeGreaterThan(16);
    await until(() => acknowledged() && endpointHead().state.version === version, 'the deep revocation acknowledged');
    expect(await same(endpointHead(), appHead())).toBe(true);
    expect(endpointHead().state.revoked.map((r) => r.keyId)).toEqual(expect.arrayContaining(lost.kids));
    const done = runs.slice(sent).filter((run) => run.outcome?.state === 'done');
    expect(done.at(-1)).toMatchObject({ outcome: { result: { version } } });
    expect(done.flatMap((run) => run.versions)).toEqual(expect.arrayContaining(Array.from({ length: version - behind }, (_, i) => behind + 1 + i)));
    await release();
  });

  it('delivers the pending state over the link while the hub refuses its post, and settles it once the hub takes it', async () => {
    const lost = await loseRevocation(3);
    refusing = true;
    const parent = await hubHead();

    const outcome = await app.revokeSuperseded();
    expect(outcome).toMatchObject({ ok: false, reason: 'hub' });
    const version = parent.state.version + 1;
    await until(() => acknowledged() && endpointHead().state.version === version, 'the pending state adopted by the endpoint');
    const pending = signingFile().pending!.signed;
    expect(pending.state.version).toBe(version);
    expect(await same(endpointHead(), pending)).toBe(true);
    expect(endpointHead().state.revoked.map((r) => r.keyId)).toEqual(expect.arrayContaining(lost.kids));
    expect(signer().pending).toMatchObject({ version, fork: false, exposed: true });
    expect(await same(await hubHead(), parent)).toBe(true);

    // The hub answers again; the feed's next open settles the slot by posting the same bytes.
    refusing = false;
    detach();
    feed.close();
    feed = createRegistryFeed({ session: app, log });
    detach = app.attach(feed);
    await until(() => signer().pending === null, 'the pending state settled');
    expect(await same(await hubHead(), pending)).toBe(true);
    await release();
  });

  it('delivers a run that fills DELIVERY_MAX_BYTES over the real link, which the endpoint adopts', async () => {
    const lost = await loseRevocation(4);
    // Some 40 states of about 17 KB each (150 more members), more than one run holds: the run from the recovery's base
    // stops within one state's size of the bound.
    await org.amend((state) => {
      for (let i = 0; i < 150; i++) state.members.push({ id: `e${i.toString(16).padStart(31, '0')}`, email: `m${i}@example.com`, role: 'member', devices: [] });
    });
    for (let i = 0; i < 40; i++) await org.amend(() => {});
    await settled('the larger states');
    const sent = runs.length;

    const outcome = await app.revokeSuperseded();
    expect(outcome).toMatchObject({ ok: true });
    const version = (outcome as { version: number }).version;
    await until(() => acknowledged() && endpointHead().state.version === version, 'the revocation acknowledged through full runs', 60_000);
    expect(endpointHead().state.revoked.map((r) => r.keyId)).toEqual(expect.arrayContaining(lost.kids));

    // A run is full when the state after its last one would have taken it over the bound.
    const line = app.current()!.view.since(0).states;
    const full = runs.slice(sent).filter((run) => {
      const next = line[run.versions.at(-1)!]; // versions count from 1
      return next !== undefined && run.bytes <= MAX_BYTES && run.bytes + Buffer.byteLength(JSON.stringify(next)) + 1 > MAX_BYTES;
    });
    expect(full.length, JSON.stringify(runs.slice(sent).map(({ versions, bytes, outcome }) => ({ versions, bytes, outcome })))).toBeGreaterThan(0);
    expect(full[0].outcome).toMatchObject({ state: 'done' });
    expect(full[0].bytes).toBeGreaterThan(MAX_BYTES - 20 * 1024);
    await release();
  });
});
