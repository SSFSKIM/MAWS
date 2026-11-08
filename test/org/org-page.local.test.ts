// The Org page's people, devices and machines against desk-hub's Worker in Miniflare and real endpoints (P5 O8 M4a and
// M4b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's and M4b's "Proves"; acceptance 4a and 4b), on the
// local org the O8 suites share (./local-org.ts): rooted by O13's real `deployment admin`, app A registered through its
// `pair` and made a root by its `root add`. A then acts only through the session's surface the Org page calls
// (`org.preview` and `org.change` under the digest shown, `org.pair.*`, `org.enroll.*`, `org.grants.*`, `org.view`, the
// status's `pairing` and `enrolling`), its Touch ID the state signer's and the record signer's injected confirmation;
// nothing reaches the Keychain, a browser or the real backup exclusion. Two endpoints run beside it: the machine A
// enrolls from the app (reached over O7's link by the hub's relay), and this Mac's own (A's `local`, reached through its
// local door as mawsd's machine socket serves it), enrolled at setup by `enrollEndpoint` before `root add`.
//
// 1. A adds member B and pairs B's first device: B's app, under the stand-in's identity for B, registers with A's code,
//    A judges B's pending entry through H1 (`?member=`), shows the fingerprint B's app shows, and approves it unendorsed.
// 2. A makes B an admin and B's device a root, and B's app reads itself one.
// 3. A demotes B, and B's root leaves.
// 4. A pairs a second profile of its own member, endorsed by A's step-up key inside the same Touch ID; the hub takes it.
// 5. A removes B's device, then B, and B's app reads removed.
// 6. Every state the hub accepted verifies from genesis against the org's pins.
// 7. A enrolls a machine from the app: the endpoint redeems the code and posts its key, A compares the key id the page
//    shows with the machine's own (`keys --json`) and approves, and the endpoint reads `org-listed`.
// 8. A adds B again (case 5 removed B) and grants B `spawn` on that machine while the machine's own reads of the hub are
//    withheld, so it is behind B's addition: one confirmation, the app's head pushed over the link (`endpoint.state`)
//    before the grant, the endpoint's ledger holding it, and `machineRights` giving B `spawn`.
// A. A grants B on this Mac's own machine through the local door (the architect's Fork A): the act through the door and
//    nothing over a link, the grant in that endpoint's ledger, read back through `endpoint.local.grants`.
// 9. The machine's `grants.json` is removed and the endpoint restarted: its startup invariant moves the key, the ledger
//    and the enrollment aside and it reads unenrolled. A re-enrolls it from the page (`machine.replace`, a new key under
//    the same ref); the page shows B's grant missing under the earlier key and re-grants it for the new key above the
//    mark, and the new ledger holds it.
// 10. A changes the machine's owners to B, then back, then drops it; the hub row goes, through the keyed delete
//     (`?ref=&pub=`) the hub's Registry honours (#538).
// 11. Every state the hub accepted verifies from genesis, and every state after `root add` is A's.
//
// The pairing and enrollment codes are handed from A's answer to the registering app or the machine's `enroll` and are
// never printed, nor compared in a way whose failure would print them.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { decodeEnrollmentCodeV2, keyId, stateHash, verifyPinnedChain, type Action, type SignedOrgState } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAdminKeys } from '../../apps/desk-hub/deploy/admin-device.ts';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { machineRights } from '../../src/endpoint/grants';
import { createRecordSigner, createStateSigner, type Confirm } from '../../src/main/device/step-up';
import type { ActOutcome, RemoteLink } from '../../src/main/machines/remote/link';
import type { GrantLink } from '../../src/main/org/grants';
import type { OrgSessionService } from '../../src/main/org/org-session';
import { createRegistryFeed, type RegistryFeed } from '../../src/main/org/registry-feed';
import type { ClientId } from '../../src/shared/ipc/client';
import type { OrgChange, OrgStatus } from '../../src/shared/ipc/schema/org';
import type { MachineRef } from '../../src/shared/machine/ref';
import { fakeServices, type FakeServices } from '../endpoint/fake-services';
import { ADMIN, ORG, enrollEndpoint, orgSession, registerThroughPair, registered, relayLink, scratchDir, sleep, startLocalOrg, until, type LocalOrg } from './local-org';

const B_EMAIL = 'b@example.com';
const scratch = scratchDir('maws-o8-org-page-');
const logs: string[] = [];
const log = (line: string) => void logs.push(line);

let org: LocalOrg;
/** The version `root add` made A a root at: every later state is A's. */
let rooted: number;
let a: OrgSessionService;
let b: OrgSessionService;
const sessions: OrgSessionService[] = [];
const feeds: RegistryFeed[] = [];
/** A's statuses, each kept, so no pairing or enrollment secret is seen in any of them. */
const statuses: OrgStatus[] = [];
/** Every pairing and enrollment code A answered, kept only to check that nothing seen carried one. */
const codes: string[] = [];

/** Every prompt A's state and record signers showed, in order; each answered yes (the injected Touch ID). */
const asked: Array<Parameters<Confirm>[0]> = [];
const confirm: Confirm = async (prompt) => {
  asked.push(prompt);
  return { ok: true };
};

// ---- The machines: one A enrolls from the app and reaches over O7's link, and this Mac's own behind its local door ----

/** The machine A enrolls from the page (case 7) and re-enrolls (case 9). */
const MACHINE = 'o8-page-mini';
/** This Mac's own machine, A's `local`. */
const OWN = 'o8-page-own';
/** The window the enrollment's commands come from (`org.enroll.*`'s asking client). */
const WINDOW = 'org-page-window' as ClientId;

let machine: Endpoint;
let machineServices: FakeServices;
let machineRef: MachineRef;
let own: Endpoint;
let ownServices: FakeServices;
let ownRef: MachineRef;
/** A's link to the machine over the hub's relay, from case 7 on. */
let link: RemoteLink | null = null;
const roster: MachineRef[] = [];
const rosterListeners = new Set<() => void>();

/** While set, the machine's own reads of the hub's org state fail: what it adopts, it adopts over A's link. */
let withheld = false;
const machineFetch: typeof fetch = (input, init) =>
  withheld && new URL(String(input)).pathname === '/machine/org/state' ? Promise.reject(new TypeError('the hub is withheld from this machine')) : fetch(input, init);
const machineEndpoint = () => createEndpoint({ build: 'o8-m4b-local', sleep: (ms) => sleep(Math.min(ms, 50)), fetch: machineFetch });

/** Each act A's grants sent over the link (the head push's `endpoint.state` runs and `endpoint.grant`), with its outcome. */
const overLink: Array<{ action: string; outcome: ActOutcome | null }> = [];
/** The link as A's grants reach it (main's `Machines.remote(ref)`), each act recorded on its way. */
const granting: GrantLink = {
  state: () => link!.state(),
  caps: () => link!.caps(),
  onState: (listener) => link!.onState(listener),
  call: (name, input, options) => link!.call(name, input, options),
  act(request) {
    const handle = link!.act(request);
    const sent: (typeof overLink)[number] = { action: request.action, outcome: null };
    overLink.push(sent);
    void handle.outcome.then((outcome) => (sent.outcome = outcome));
    return handle;
  },
};
/** Each act A's grants handed this Mac's own endpoint through its local door. */
const throughDoor: Action[] = [];

/** Every DELETE A's app sent the hub (the dropped machine's row). */
const deletes: URL[] = [];
const appFetch: typeof fetch = (input, init) => {
  if ((init?.method ?? (input instanceof Request ? input.method : 'GET')) === 'DELETE') deletes.push(new URL(input instanceof Request ? input.url : String(input)));
  return fetch(input, init);
};

function follow(session: OrgSessionService): void {
  const feed = createRegistryFeed({ session, log });
  session.attach(feed);
  feeds.push(feed);
}

/** A second app, under the stand-in's identity for `email`; closed at the end. */
function app(name: string, email: string): OrgSessionService {
  const made = orgSession({ userData: scratch.dir(name), build: 'o8-m4a-local', log, env: { MAWS_DEV_STANDIN_USER: email } });
  sessions.push(made);
  return made;
}

const hubHead = async () => (await org.served()).head;
const same = async (x: SignedOrgState, y: SignedOrgState) => (await stateHash(x.state)) === (await stateHash(y.state));
const headOf = (s: OrgSessionService) => s.current()?.view.head() ?? null;
const memberIn = (head: SignedOrgState, id: string) => head.state.members.find((m) => m.id === id);
const machineIn = (head: SignedOrgState, ref: string) => head.state.machines.find((m) => m.ref === ref);
/** The Org page's row for the machine `ref`. */
const rowOf = async (ref: string) => (await a.view())!.machines.find((m) => m.ref === ref);
/** The version of the head an endpoint holds. */
const heldBy = (endpoint: Endpoint) => endpoint.parts!.org.head().state.version;
/** `member`'s grant as `endpoint`'s ledger keeps it, or undefined. */
const keptBy = (endpoint: Endpoint, member: string) => endpoint.parts!.state.ledger?.grants[member];
/** `member`'s grades on `endpoint`'s machine, as its authorization reads them. */
const rightsOn = (endpoint: Endpoint, member: string) => {
  const { state, org: held, services } = endpoint.parts!;
  return machineRights(state, held.head().state, held.certificates(), services.machine.ref, member, new Date());
};
/** The machine's own word on its key (`mawsd keys --json`), once it holds one. */
const keyShownBy = (endpoint: Endpoint) =>
  until(async () => {
    const shown = JSON.parse((await endpoint.cli('keys', ['--json'])).out) as { enrollment: string; ref: string; keyId?: string };
    return shown.keyId === undefined ? null : { ...shown, keyId: shown.keyId };
  }, 'the machine showing its key');
/** The hub's machine rows, as an admin reads them. */
const hubRows = async () => ((await (await org.hub.fetchAs(ADMIN, '/api/machines')).json()) as { machines: Array<{ name: string; key?: { ref: string; pub: string } }> }).machines;
/** Whether anything this suite saw carries a code A answered, or the token or secret inside an enrollment code. */
function codeSeen(): boolean {
  const seen = JSON.stringify([statuses, logs, machineServices.lines, ownServices.lines]);
  const secrets = codes.flatMap((code) => {
    const body = code.slice(code.indexOf('.') + 1);
    if (!code.startsWith('smns-enroll-v2.')) return [code, body];
    const { token, k } = decodeEnrollmentCodeV2(code);
    return [code, body, token, k];
  });
  return secrets.some((secret) => seen.includes(secret));
}

/** Waits until A holds the hub's head, and returns it. */
async function aSettled(what: string): Promise<SignedOrgState> {
  const head = await hubHead();
  await until(async () => {
    const held = headOf(a);
    return held !== null && (await same(held, head));
  }, `A at the hub's version ${head.state.version} (${what})`);
  return head;
}

/** A change as the Org page makes it: previewed, then signed under the digest of what the sheet showed. */
async function signChange(change: OrgChange): Promise<{ version: number; lines: string[]; change: OrgChange }> {
  const shown = await a.preview(change);
  if (!shown.ok) throw new Error(`preview of ${change.kind}: ${shown.reason} ${shown.detail ?? ''} ${JSON.stringify(shown.findings)}`);
  expect(shown.lines.length).toBeGreaterThan(0);
  const before = asked.length;
  const signed = await a.change(shown.change, shown.digest);
  if (!signed.ok) throw new Error(`change ${change.kind}: ${signed.reason} ${signed.detail ?? ''}`);
  expect(asked).toHaveLength(before + 1); // one Touch ID per change
  expect((await hubHead()).state.version).toBe(signed.version);
  await aSettled(change.kind);
  return { version: signed.version, lines: shown.lines, change: shown.change };
}

/**
 * A pairing from A's Org page: started for `member`, the code handed to `registering` (which posts its entry), the
 * entry's fingerprint shown by A compared with the one the registering app shows, then approved under the candidate's
 * generation and digest. Resolves once the registering app is signed in.
 */
async function pairThroughA(member: string, registering: OrgSessionService): Promise<{ device: string; version: number }> {
  await registering.loaded;
  const started = a.pairStart({ member, class: 'native-mac' });
  if (!started.ok) throw new Error(`pair start: ${started.reason} ${started.detail ?? ''}`);
  codes.push(started.code);
  const attempt = registering.register(started.code);
  if (!attempt.ok) throw new Error(`register: ${attempt.reason.code}`);
  const theirs = await until(() => {
    const status = registering.status();
    return status.state === 'registering' && status.step === 'approval' ? status.fingerprint : null;
  }, 'the registering app at its approval step');
  const pairing = await until(() => {
    const p = registered(a)?.pairing;
    return p?.entry != null ? p : null;
  }, 'the entry found by A');
  expect(pairing).toMatchObject({ member, class: 'native-mac', problem: null, entry: { class: 'native-mac', keyStorage: 'software', fingerprint: theirs } });

  const approved = await a.pairApprove({ generation: pairing.generation, digest: pairing.entry!.digest });
  if (!approved.ok) throw new Error(`approve: ${approved.reason} ${approved.detail ?? ''}`);
  const signedIn = await until(() => registering.current(), 'the paired app signed in');
  expect(signedIn.identity.device).toBe(pairing.entry!.id);
  await until(() => registered(a)?.pairing === null, 'the pairing done');
  await aSettled('the pairing approved');
  return { device: signedIn.identity.device, version: approved.version };
}

/**
 * An enrollment from A's Org page (a re-enrollment when `replace` names the machine's ref): started, the code handed to
 * the machine's `enroll` at its hidden prompt (its secret input, never an argument), the key id A's page shows compared
 * with the one the machine shows, then approved under the run's generation and digest, behind one confirmation. Resolves
 * once the machine's `enroll` has ended `org-listed` and A holds the state it signed, with that state's version and the
 * key id compared.
 */
async function enrollThroughA(endpoint: Endpoint, replace?: MachineRef): Promise<{ version: number; keyId: string }> {
  const before = asked.length;
  const started = await a.enrollStart(replace === undefined ? { name: MACHINE } : { name: MACHINE, replace }, WINDOW);
  if (!started.ok) throw new Error(`enroll start: ${started.reason} ${started.detail ?? ''}`);
  codes.push(started.code);
  const run = await until(() => registered(a)?.enrolling, 'the enrollment under way');
  expect(run).toMatchObject({ name: MACHINE, replace: replace ?? null, candidate: null, problem: null });
  const enrolling = endpoint.cli('enroll', ['--wait', '60', '--json'], started.code);
  const candidate = await until(() => registered(a)?.enrolling?.candidate, 'the machine’s posted key shown on the page', 30_000);
  const shown = await keyShownBy(endpoint);
  expect(shown).toMatchObject({ enrollment: 'hub-confirmed', ref: machineRef });
  expect(candidate).toMatchObject({ name: MACHINE, ref: machineRef, keyId: shown.keyId });

  const approved = await a.enrollApprove({ generation: run.generation, digest: candidate.digest });
  if (!approved.ok) throw new Error(`enroll approve: ${approved.reason} ${approved.detail ?? ''}`);
  expect(asked).toHaveLength(before + 1); // one Touch ID
  const ended = await enrolling;
  expect(ended.code, ended.out).toBe(0);
  expect(JSON.parse(ended.out)).toMatchObject({ enrollment: 'org-listed', name: MACHINE, ref: machineRef });
  expect(endpoint.status()).toMatchObject({ enrollment: 'org-listed', name: MACHINE });
  await until(() => registered(a)?.enrolling === null, 'the enrollment done');
  const head = await aSettled('the enrollment approved');
  expect(head.state.version).toBe(approved.version);
  return { version: approved.version, keyId: shown.keyId };
}

beforeAll(async () => {
  org = await startLocalOrg(scratch);
  // This Mac's own machine: its ref is A's `local` from the start, so its grants go through the door.
  ownServices = fakeServices();
  ownRef = ownServices.machine.ref;
  a = orgSession({
    userData: scratch.dir('a'),
    build: 'o8-m4a-local',
    log,
    fetch: appFetch,
    timing: { PAIR_POLL_MS: 100, ENROLL_POLL_MS: 100 },
    signing: {
      stateSigner: (keys) => createStateSigner({ key: keys.stepUp, confirm }),
      // No window has focus, so the weekly successor never asks here.
      focused: () => false,
      onFocus: () => () => {},
      notify: (text) => log(`notified: ${text}`),
      // No machine is owed M3's deliveries here: every `endpoint.state` the machine is sent is the grants' head push.
      roster: () => [],
      onRoster: () => () => {},
      link: () => null,
    },
    local: ownRef,
    grants: {
      recordSigner: (keys) => createRecordSigner({ key: keys.stepUp, confirm }),
      // mawsd's `endpoint.local.act` and `endpoint.local.grants`, the endpoint module's door called directly
      door: {
        act: (action) => {
          throughDoor.push(action);
          return own.local.act(action);
        },
        grants: () => own.local.call('endpoint.grants', null),
      },
      roster: () => roster,
      onRoster: (listener) => {
        rosterListeners.add(listener);
        return () => void rosterListeners.delete(listener);
      },
      link: (ref) => (link !== null && ref === machineRef ? granting : null),
    },
  });
  sessions.push(a);
  a.onStatus((status) => void statuses.push(status));
  const { device } = await registerThroughPair(org, a);
  follow(a);
  await until(() => registered(a)?.hubAccess === 'connected', 'A’s feed connected');

  // This Mac's own endpoint, enrolled by the setup helper as A's member's (the deployment admin's state, before A roots).
  own = createEndpoint({ build: 'o8-m4b-local', sleep: (ms) => sleep(Math.min(ms, 50)) });
  await own.start(ownServices);
  await enrollEndpoint(org, own, ownRef, OWN);
  await until(() => own.hub.connected, 'this Mac’s endpoint’s hub link');
  // The machine A enrolls from the page, started unenrolled.
  machineServices = fakeServices();
  machineRef = machineServices.machine.ref;
  machine = machineEndpoint();
  await machine.start(machineServices);

  // Options first and the id after `--`: a base64url id may start with '-'.
  await org.admin('root', 'add', '--yes', '--', device);
  await until(() => registered(a)?.signer?.maySign, 'A reading itself a root that may sign');
  rooted = (await aSettled('root add')).state.version;
}, 180_000);

afterAll(async () => {
  link?.close();
  for (const feed of feeds) feed.close();
  for (const s of sessions) await s.close();
  await machine?.stop();
  await own?.stop();
  machineServices?.cleanup();
  ownServices?.cleanup();
  await org?.stop();
  rmSync(scratch.root, { recursive: true, force: true });
});

describe('the Org page’s people, devices and machines on the local hub', { timeout: 120_000 }, () => {
  let bMember: string;
  let bDevice: string;
  let bKid: string;
  let aKid: string;

  it('adds member B and pairs B’s first device: B’s app registers with A’s code, A approves it through H1, B reads signed in', async () => {
    aKid = registered(a)!.signer!.stepUpKid;
    const added = await signChange({ kind: 'member.add', email: ` ${B_EMAIL.toUpperCase()} `, role: 'member' });
    expect(added.change).toMatchObject({ kind: 'member.add', email: B_EMAIL, role: 'member' });
    bMember = (added.change as Extract<OrgChange, { kind: 'member.add' }>).id!;
    // The id previewed is the id signed, and the hub admits B by email from this state on.
    expect(memberIn(await hubHead(), bMember)).toMatchObject({ email: B_EMAIL, role: 'member', devices: [] });
    const me = (await (await org.hub.fetchAs(B_EMAIL, '/api/me')).json()) as { member: { id: string } };
    expect(me.member.id).toBe(bMember);
    expect((await a.view())!.members.find((m) => m.id === bMember)).toMatchObject({ email: B_EMAIL, you: false, devices: [] });

    b = app('b', B_EMAIL);
    const paired = await pairThroughA(bMember, b);
    bDevice = paired.device;
    follow(b);
    await until(() => registered(b)?.hubAccess === 'connected', 'B’s feed connected');
    expect(registered(b)).toMatchObject({ session: 'signed-in', member: { id: bMember, email: B_EMAIL } });
    // B's first device, unendorsed, as the protocol allows (P5 Decision Log 34).
    const listed = memberIn(await hubHead(), bMember)!.devices;
    expect(listed.map((d) => d.id)).toEqual([bDevice]);
    expect(listed[0].endorsement).toBeUndefined();
    bKid = await keyId(listed[0].stepUpPub!);

    // B now has a device and doesn't sign: its next device is not offered.
    expect(a.pairStart({ member: bMember, class: 'native-mac' })).toMatchObject({ ok: false, reason: 'later-device' });
    // The code was in the start's answer alone.
    const seen = JSON.stringify(statuses);
    expect(codes.some((code) => seen.includes(code) || seen.includes(code.slice('smns-pair-v1.'.length)))).toBe(false);
  });

  it('makes B an admin and B’s device a root, and B’s app reads itself one', async () => {
    await signChange({ kind: 'member.role', member: bMember, role: 'admin' });
    const rooted = await signChange({ kind: 'root.add', member: bMember, device: bDevice });
    const head = await hubHead();
    expect(head.state.version).toBe(rooted.version);
    expect(head.state.root.keys).toEqual(expect.arrayContaining([aKid, bKid]));
    expect(memberIn(head, bMember)).toMatchObject({ role: 'admin' });

    await until(() => registered(b)?.signer?.root === true, 'B reading itself a root');
    const view = (await a.view())!;
    expect(view.members.find((m) => m.id === bMember)).toMatchObject({ role: 'admin', devices: [{ id: bDevice, root: true, thisMac: false }] });
    expect(view.roots).toContainEqual({ kid: bKid, member: bMember, device: bDevice });
  });

  it('demotes B, and B’s root leaves', async () => {
    const demoted = await signChange({ kind: 'member.role', member: bMember, role: 'member' });
    expect(demoted.lines.length).toBeGreaterThan(1); // the role, and the root taken out with it
    const head = await hubHead();
    expect(memberIn(head, bMember)).toMatchObject({ role: 'member' });
    expect(head.state.root.keys).not.toContain(bKid);
    expect(head.state.root.keys).toContain(aKid);

    await until(() => registered(b)?.signer?.root === false, 'B reading itself no root');
    expect(registered(b)).toMatchObject({ session: 'signed-in' });
    expect((await a.view())!.members.find((m) => m.id === bMember)!.devices).toEqual([expect.objectContaining({ id: bDevice, root: false })]);
  });

  it('pairs a second profile of A’s own member, endorsed by A inside the same Touch ID, and the hub accepts it', async () => {
    const self = registered(a)!.member.id;
    const second = app('a-second', ADMIN);
    const before = asked.length;
    const paired = await pairThroughA(self, second);
    expect(asked).toHaveLength(before + 1); // one confirmation endorsed and signed

    const head = await hubHead();
    expect(head.state.version).toBe(paired.version);
    const listed = memberIn(head, self)!.devices.find((d) => d.id === paired.device)!;
    expect(listed).toMatchObject({ class: 'native-mac', keyStorage: 'software' });
    expect(listed.endorsement?.kid).toBe(aKid);
    expect(registered(second)).toMatchObject({ session: 'signed-in', member: { id: self, email: ADMIN }, device: paired.device });
    expect((await a.view())!.members.find((m) => m.you)!.devices.map((d) => d.id)).toContain(paired.device);
  });

  it('removes B’s device, then B, and B’s app reads removed', async () => {
    await signChange({ kind: 'device.remove', member: bMember, device: bDevice });
    let head = await hubHead();
    expect(memberIn(head, bMember)!.devices).toEqual([]);
    expect(head.state.revoked.map((r) => r.keyId)).toEqual(expect.arrayContaining([bDevice, bKid]));
    await until(() => registered(b)?.session === 'removed', 'B reading removed');
    expect(b.current()).toBeNull();

    await signChange({ kind: 'member.remove', member: bMember });
    head = await hubHead();
    expect(memberIn(head, bMember)).toBeUndefined();
    expect((await a.view())!.members.map((m) => m.id)).not.toContain(bMember);
    expect((await org.hub.fetchAs(B_EMAIL, '/api/me')).status).toBe(403);
    expect(registered(b)).toMatchObject({ session: 'removed' });
    expect(b.current()).toBeNull();
  });

  /** Every state the hub serves, verified from genesis against the org's pins; those after `root add` are A's, each signed once. */
  async function verifiedFromGenesis(): Promise<SignedOrgState[]> {
    const served = await org.served();
    expect((served as { more?: boolean }).more).not.toBe(true);
    const genesis = served.chain[0];
    expect(genesis.state.version).toBe(1);
    const pins = { roots: [await keyId((await readAdminKeys(org.adminKeys)).stepUp.pub)], recoveryPub: genesis.state.root.recoveryPub };
    const verified = await verifyPinnedChain(served.chain, served.transitions, pins);
    if (!verified.ok) throw new Error(`the chain from genesis: ${verified.code}`);
    expect(verified.adopted).toHaveLength(served.chain.length);
    expect(verified.adopted.map((s) => s.state.version)).toEqual(served.chain.map((_, i) => i + 1));
    expect(await same(verified.head, served.head)).toBe(true);
    const aSigned = served.chain.filter((s) => s.state.version > rooted);
    expect(aSigned.every((s) => s.sigs.length === 1 && s.sigs[0].kid === aKid)).toBe(true);
    return aSigned;
  }

  it('every state the hub accepted verifies from genesis', async () => {
    // Every state after `root add` (the deployment admin's last) is A's: eight changes, each with one Touch ID.
    expect(await verifiedFromGenesis()).toHaveLength(8);
    expect(asked).toHaveLength(8);
  });

  // ---- M4b: machines ----

  let aMember: string;
  /** Member B, added again in case 8 (case 5 removed the first B). */
  let bAgain: string;
  /** The machine's key id under its first enrollment, and B's grant on it under that key. */
  let firstKid: string;
  let firstGrant: number;

  it('enrolls a machine from the app: the endpoint redeems the code and posts its key, A compares and approves, and the endpoint reads org-listed', async () => {
    aMember = registered(a)!.member.id;
    expect(machine.status()).toMatchObject({ enrollment: 'none' });
    const { version, keyId: kid } = await enrollThroughA(machine);
    firstKid = kid;
    const head = await hubHead();
    expect(head.state.version).toBe(version);
    expect(machineIn(head, machineRef)).toEqual({ name: MACHINE, ref: machineRef, pub: machine.key!.pub, owners: [aMember] });
    expect(head.state.machineNames).toContainEqual({ name: MACHINE, ref: machineRef });
    expect(await keyId(machine.key!.pub)).toBe(kid);
    expect(await rowOf(machineRef)).toMatchObject({ name: MACHINE, owners: [aMember], keyId: kid, certified: false, mayGrant: true });
    await until(() => heldBy(machine) >= version, 'the machine at the state listing it');

    // O7's link to it over the hub's relay, as the roster's machines are reached, from here on A's grants' way to it.
    await until(() => machine.hub.connected, 'the machine’s hub link');
    link = relayLink({ session: a, machine: { ref: machineRef, name: MACHINE }, profile: scratch.dir('a'), timing: { BACKOFF_MS: [0, 250, 500, 1000], SLOW_RETRY_MS: 1000 }, log });
    await until(() => link!.carrier() === 'relay', 'A’s link up over the relay', 30_000);
    roster.push(machineRef);
    for (const listener of rosterListeners) listener();
  });

  it('grants B spawn on a machine behind B’s addition: the head pushed over the link first, one confirmation, the ledger holds it and machineRights gives B spawn', async () => {
    const before = heldBy(machine);
    withheld = true;
    try {
      const added = await signChange({ kind: 'member.add', email: B_EMAIL, role: 'member' });
      bAgain = (added.change as Extract<OrgChange, { kind: 'member.add' }>).id!;
      expect(memberIn(await hubHead(), bAgain)).toMatchObject({ email: B_EMAIL, role: 'member', devices: [] });
      // The machine can't read B's addition from the hub: it is behind it as A grants.
      await sleep(300);
      expect(heldBy(machine)).toBe(before);
      expect(before).toBeLessThan(added.version);
      expect(await rowOf(machineRef)).toMatchObject({ mayGrant: true });

      const asks = asked.length;
      const sentFrom = overLink.length;
      const granted = await a.grantsSet({ ref: machineRef, member: bAgain, rights: ['spawn'] });
      if (!granted.ok) throw new Error(`grant: ${granted.reason} ${granted.detail ?? ''} ${JSON.stringify(granted.problems ?? [])}`);
      expect(granted.delivered).toBe('done');
      expect(asked).toHaveLength(asks + 1); // one Touch ID: the push asks nothing
      firstGrant = granted.version;

      // Over the link: the app's head pushed (`endpoint.state`), answered at B's addition or later, then the one grant.
      const sent = overLink.slice(sentFrom);
      const grantAt = sent.findIndex((s) => s.action === 'endpoint.grant');
      expect(sent.map((s) => s.action).filter((action) => action === 'endpoint.grant')).toEqual(['endpoint.grant']);
      expect(grantAt).toBeGreaterThan(0);
      const pushed = sent.slice(0, grantAt);
      expect(pushed.every((s) => s.action === 'endpoint.state')).toBe(true);
      const answered = pushed.at(-1)!.outcome;
      expect(answered).toMatchObject({ state: 'done', result: { version: expect.any(Number) } });
      expect((answered as unknown as { result: { version: number } }).result.version).toBeGreaterThanOrEqual(added.version);
      expect(sent[grantAt].outcome).toMatchObject({ state: 'done' });
      // which reached the machine by the link alone
      expect(heldBy(machine)).toBeGreaterThanOrEqual(added.version);
    } finally {
      withheld = false;
    }

    expect(keptBy(machine, bAgain)?.body).toMatchObject({ org: ORG, machine: machineRef, machineKey: firstKid, member: bAgain, rights: ['spawn'], version: firstGrant });
    expect(machine.parts!.state.ledger!.highWater[bAgain]).toBe(firstGrant);
    expect(await rightsOn(machine, bAgain)).toEqual(['spawn']);
    const view = await a.grantsView({ ref: machineRef });
    expect(view).toMatchObject({ ok: true, live: true, missing: [], digest: null });
    expect(view.ok && view.grants).toContainEqual(expect.objectContaining({ member: bAgain, rights: ['spawn'], version: firstGrant, state: 'on-machine' }));
  });

  it('grants B on this Mac’s own machine through the local door: stored in that endpoint’s ledger and read back through endpoint.local.grants', async () => {
    // The door has nothing to push: this Mac's endpoint reads B's addition from the hub itself.
    const version = (await hubHead()).state.version;
    await until(() => heldBy(own) >= version, 'this Mac’s endpoint at the hub’s head');
    expect(await rowOf(ownRef)).toMatchObject({ name: OWN, owners: [aMember], mayGrant: true });

    const asks = asked.length;
    const linkFrom = overLink.length;
    const doorFrom = throughDoor.length;
    const granted = await a.grantsSet({ ref: ownRef, member: bAgain, rights: ['spawn', 'shell'] });
    if (!granted.ok) throw new Error(`grant: ${granted.reason} ${granted.detail ?? ''} ${JSON.stringify(granted.problems ?? [])}`);
    expect(granted.delivered).toBe('done');
    expect(asked).toHaveLength(asks + 1);

    // One act, through the door, unsigned (the grant's own signature is its authority), and nothing over a link.
    const acts = throughDoor.slice(doorFrom);
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ org: ORG, machine: ownRef, device: registered(a)!.device, action: 'endpoint.grant', args: { grant: { body: { machine: ownRef, member: bAgain, rights: ['spawn', 'shell'], version: granted.version } } } });
    expect(acts[0]).not.toHaveProperty('stepUp');
    expect(overLink.slice(linkFrom)).toEqual([]);

    expect(keptBy(own, bAgain)?.body).toMatchObject({ machine: ownRef, machineKey: await keyId(own.key!.pub), member: bAgain, rights: ['spawn', 'shell'], version: granted.version });
    expect(await rightsOn(own, bAgain)).toEqual(['spawn', 'shell']);
    const read = await own.local.call('endpoint.grants', null);
    if (!read.ok) throw new Error(`endpoint.local.grants: ${read.code}`);
    const entry = (read.output as { members: Array<{ member: string; grant: { body: Record<string, unknown> } | null; highWater: number }> }).members.find((m) => m.member === bAgain);
    expect(entry).toMatchObject({ highWater: granted.version, grant: { body: { machine: ownRef, member: bAgain, rights: ['spawn', 'shell'], version: granted.version } } });
    const view = await a.grantsView({ ref: ownRef });
    expect(view.ok && view.grants).toContainEqual(expect.objectContaining({ member: bAgain, rights: ['spawn', 'shell'], version: granted.version, state: 'on-machine' }));
  });

  it('re-enrolls a machine whose ledger was lost: moved aside and unenrolled at its start, enrolled again with a new key, and B’s missing grant re-granted above the mark', async () => {
    const dir = machineServices.machine.stateDir;
    await machine.stop();
    rmSync(join(dir, 'grants.json'));
    machine = machineEndpoint();
    await machine.start(machineServices);
    // The startup invariant (src/endpoint/state/store.ts): the key without its ledger is moved aside with the enrollment.
    expect(machine.status()).toMatchObject({ enrollment: 'none', refusing: 'stale-state' });
    expect(machine.enrollment()).toBeNull();
    for (const name of ['machine-key.json', 'grants.json', 'enrollment.json']) expect(existsSync(join(dir, name)), name).toBe(false);
    const aside = readdirSync(dir).filter((name) => name.startsWith('stale-'));
    expect(aside).toHaveLength(1);
    expect(readdirSync(join(dir, aside[0])).sort()).toEqual(['enrollment.json', 'machine-key.json']);
    expect(machineServices.lines.join('\n')).toContain('the machine key and the grant ledger were not found together');

    // Re-enroll…, from the page: `machine.replace`, a new key under the same ref.
    const replaced = await enrollThroughA(machine, machineRef);
    expect(replaced.keyId).not.toBe(firstKid);
    const head = await hubHead();
    expect(machineIn(head, machineRef)).toEqual({ name: MACHINE, ref: machineRef, pub: machine.key!.pub, owners: [aMember] });
    expect(head.state.retired.map((r) => r.keyId)).toContain(firstKid);
    expect(await rowOf(machineRef)).toMatchObject({ keyId: replaced.keyId, mayGrant: true });

    // A's link comes up again to the new key, on a channel the machine opened at the new state or later.
    await until(() => link!.state() === 'up' && (link!.caps()?.stateVersion ?? 0) >= replaced.version, 'A’s link up to the re-enrolled machine', 60_000);
    expect(keptBy(machine, bAgain)).toBeUndefined();
    const view = await a.grantsView({ ref: machineRef });
    if (!view.ok) throw new Error(`grants view: ${view.reason}`);
    expect(view.live).toBe(true);
    // B's grant, under the earlier key, is missing from the new ledger.
    expect(view.missing).toMatchObject([{ member: bAgain, rights: ['spawn'], version: firstGrant }]);
    expect(view.digest).not.toBeNull();

    const asks = asked.length;
    const regranted = await a.grantsRegrant({ ref: machineRef, digest: view.digest! });
    if (!regranted.ok) throw new Error(`regrant: ${regranted.reason} ${regranted.detail ?? ''}`);
    expect(asked).toHaveLength(asks + 1);
    expect(regranted.results).toMatchObject([{ member: bAgain, delivered: 'done' }]);
    const version = regranted.results[0].version;
    expect(version).toBeGreaterThan(firstGrant);
    expect(keptBy(machine, bAgain)?.body).toMatchObject({ machine: machineRef, machineKey: replaced.keyId, member: bAgain, rights: ['spawn'], version });
    expect(machine.parts!.state.ledger!.heldKeys).toContain(replaced.keyId);
    expect(machine.parts!.state.ledger!.heldKeys).not.toContain(firstKid);
    expect(await rightsOn(machine, bAgain)).toEqual(['spawn']);
    const after = await a.grantsView({ ref: machineRef });
    expect(after).toMatchObject({ ok: true, live: true, missing: [], digest: null });
    expect(after.ok && after.grants).toContainEqual(expect.objectContaining({ member: bAgain, version, state: 'on-machine' }));
  });

  it('changes the machine’s owners to B and back, then drops it, and the hub row goes through the keyed delete', async () => {
    await signChange({ kind: 'machine.owners', ref: machineRef, owners: [bAgain] });
    expect(machineIn(await hubHead(), machineRef)).toMatchObject({ owners: [bAgain] });
    // An admin, no longer its owner: the owners stay A's to change (a root's), its grants no longer A's to sign.
    expect(await rowOf(machineRef)).toMatchObject({ owners: [bAgain], mayGrant: false });
    await signChange({ kind: 'machine.owners', ref: machineRef, owners: [aMember] });
    expect(machineIn(await hubHead(), machineRef)).toMatchObject({ owners: [aMember] });
    expect(await rowOf(machineRef)).toMatchObject({ owners: [aMember], mayGrant: true });

    const pub = machineIn(await hubHead(), machineRef)!.pub;
    expect((await hubRows()).find((r) => r.name === MACHINE)?.key).toMatchObject({ ref: machineRef, pub });
    const from = deletes.length;
    await signChange({ kind: 'machine.drop', ref: machineRef, revoke: false });
    const head = await hubHead();
    expect(machineIn(head, machineRef)).toBeUndefined();
    expect(head.state.retired.map((r) => r.keyId)).toContain(await keyId(pub));
    expect(head.state.machineNames).toContainEqual({ name: MACHINE, ref: machineRef }); // the name stays bound to its ref
    expect((await a.view())!.machines.map((m) => m.ref)).not.toContain(machineRef);

    // The row's delete, bound to the key the state listed (#538's precondition), and the row gone; this Mac's stays.
    await until(() => deletes.length > from, 'the hub row’s delete');
    expect(deletes.slice(from).map((url) => [url.pathname, url.searchParams.get('ref'), url.searchParams.get('pub')])).toEqual([[`/api/machines/${MACHINE}`, machineRef, pub]]);
    const names = await until(async () => {
      const rows = (await hubRows()).map((r) => r.name);
      return rows.includes(MACHINE) ? null : rows;
    }, 'the hub row gone');
    expect(names).toContain(OWN);
    expect(registered(a)?.hubRowsLeft).toEqual([]);
  });

  it('every state the hub accepted verifies from genesis, the machines’ included', async () => {
    // After `root add`, A's: case 1 to 5's eight, the enrollment, B's addition, the re-enrollment, the owners twice and the
    // drop. Every one with one Touch ID, and the three grants (B on the machine, on this Mac's, and re-granted) one each.
    expect(await verifiedFromGenesis()).toHaveLength(14);
    expect(asked).toHaveLength(17);
    // No code A answered, nor an enrollment code's token or secret, is in any status, log line or the machines' logs.
    expect(codeSeen()).toBe(false);
  });
});
