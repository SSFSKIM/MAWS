// The Org page's people and devices against desk-hub's Worker in Miniflare (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-
// p5-o8-org-interface.md, M4a's "Proves"; acceptance 4a), on the local org the O8 suites share (./local-org.ts): rooted
// by O13's real `deployment admin`, app A registered through its `pair` and made a root by its `root add`. A then acts
// only through the session's surface the Org page calls (`org.preview` and `org.change` under the digest shown,
// `org.pair.start`, `org.pair.approve`, `org.view`, the status's `pairing`), its Touch ID the state signer's injected
// confirmation; nothing reaches the Keychain, a browser or the real backup exclusion.
//
// 1. A adds member B and pairs B's first device: B's app, under the stand-in's identity for B, registers with A's code,
//    A judges B's pending entry through H1 (`?member=`), shows the fingerprint B's app shows, and approves it unendorsed.
// 2. A makes B an admin and B's device a root, and B's app reads itself one.
// 3. A demotes B, and B's root leaves.
// 4. A pairs a second profile of its own member, endorsed by A's step-up key inside the same Touch ID; the hub takes it.
// 5. A removes B's device, then B, and B's app reads removed.
// 6. Every state the hub accepted verifies from genesis against the org's pins.
//
// The pairing codes are handed from A's answer to the registering app and are never printed, nor compared in a way
// whose failure would print them.
import { rmSync } from 'node:fs';
import { keyId, stateHash, verifyPinnedChain, type SignedOrgState } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAdminKeys } from '../../apps/desk-hub/deploy/admin-device.ts';
import { createStateSigner, type Confirm } from '../../src/main/device/step-up';
import type { OrgSessionService } from '../../src/main/org/org-session';
import { createRegistryFeed, type RegistryFeed } from '../../src/main/org/registry-feed';
import type { OrgChange, OrgStatus } from '../../src/shared/ipc/schema/org';
import { ADMIN, orgSession, registerThroughPair, registered, scratchDir, startLocalOrg, until, type LocalOrg } from './local-org';

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
/** A's statuses, each kept, so no pairing secret is seen in any of them. */
const statuses: OrgStatus[] = [];
/** Every pairing code A answered, kept only to check that no status carried one. */
const codes: string[] = [];

/** Every prompt A's state signer showed, in order; each answered yes (the injected Touch ID). */
const asked: Array<Parameters<Confirm>[0]> = [];
const confirm: Confirm = async (prompt) => {
  asked.push(prompt);
  return { ok: true };
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

beforeAll(async () => {
  org = await startLocalOrg(scratch);
  a = orgSession({
    userData: scratch.dir('a'),
    build: 'o8-m4a-local',
    log,
    timing: { PAIR_POLL_MS: 100 },
    signing: {
      stateSigner: (keys) => createStateSigner({ key: keys.stepUp, confirm }),
      // No window has focus, so the weekly successor never asks here.
      focused: () => false,
      onFocus: () => () => {},
      notify: (text) => log(`notified: ${text}`),
      roster: () => [],
      onRoster: () => () => {},
      link: () => null,
    },
  });
  sessions.push(a);
  a.onStatus((status) => void statuses.push(status));
  const { device } = await registerThroughPair(org, a);
  follow(a);
  await until(() => registered(a)?.hubAccess === 'connected', 'A’s feed connected');
  // Options first and the id after `--`: a base64url id may start with '-'.
  await org.admin('root', 'add', '--yes', '--', device);
  await until(() => registered(a)?.signer?.maySign, 'A reading itself a root that may sign');
  rooted = (await aSettled('root add')).state.version;
}, 120_000);

afterAll(async () => {
  for (const feed of feeds) feed.close();
  for (const s of sessions) await s.close();
  await org?.stop();
  rmSync(scratch.root, { recursive: true, force: true });
});

describe('the Org page’s people and devices on the local hub', { timeout: 120_000 }, () => {
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

  it('every state the hub accepted verifies from genesis', async () => {
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
    // Every state after `root add` (the deployment admin's last) is A's: eight changes, each with one Touch ID.
    const aSigned = served.chain.filter((s) => s.state.version > rooted);
    expect(aSigned).toHaveLength(8);
    expect(aSigned.every((s) => s.sigs.length === 1 && s.sigs[0].kid === aKid)).toBe(true);
    expect(asked).toHaveLength(8);
  });
});
