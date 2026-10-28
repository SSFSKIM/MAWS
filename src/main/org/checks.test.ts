// The checks before signing and the superseded states' revocations (P5 O8 M3, docs/doperpowers/plans/2026-10-28-p5-o8-
// org-interface.md, M3's "The checks before signing", "The superseded states' revocations" and Proves; Interfaces §K).
// Every state is signed with the protocol package's own signing and judged by its own `verifySuccessor`, so each refuse
// the app names before Touch ID is shown to be one the package refuses after it (where the package refuses), and each
// offer is shown to pass the package once signed. The desk track's two checks (the Decision Log, 2026-10-28) are here
// too: no path to zero roots, and no successor signed only by a root key it adds itself.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  base64urlEncode,
  endorseDevice,
  generateSigningKey,
  keyId,
  machineKeys,
  NO_CERTIFICATES,
  signBody,
  SIGNING_DOMAINS,
  signOrgState,
  signTransition,
  stateHash,
  verifySuccessor,
  type Delegation,
  type Device,
  type MachineCert,
  type OrgState,
  type RevokedKey,
  type RootTransition,
  type Signed,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';
import { checkSuccessor, supersededRevocations, type Finding } from './checks';

// The org's states, as an admin's app signs them (test/endpoint/org-fixtures.ts's, which src/ doesn't import).
type TestDevice = { device: Device; channel: SigningKey; stepUp: SigningKey };

const ORG = 'org-checks';
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const hex32 = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const randomRef = () => base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));

async function newDevice(id: string): Promise<TestDevice> {
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  return { channel, stepUp, device: { id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
}

/** `device` endorsed by `by`, an earlier device of member `A`, as a member's later device must be. */
async function endorsed(device: TestDevice, by: TestDevice): Promise<Device> {
  return { ...device.device, endorsement: await endorseDevice(ORG, A, device.device, by.stepUp.privateKey, by.stepUp.pub) };
}

async function genesis(): Promise<SignedOrgState> {
  const state: OrgState = {
    org: ORG,
    version: 1,
    prev: null,
    issued: iso(Date.now() - 20 * DAY),
    root: { keys: [await keyId(a1.stepUp.pub)], recoveryPub: recovery.pub },
    members: [{ id: A, email: 'owner@example.com', role: 'admin', devices: [a1.device] }],
    machines: [],
    machineNames: [],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
  return signOrgState(state, [a1.stepUp]);
}

/** The state after `head`, changed by `edit`, signed by `signers`' step-up keys; issued `issued`, or now, never before the head. */
async function successor(head: SignedOrgState, signers: TestDevice[], edit: (s: OrgState) => void | Promise<void> = () => {}, issued?: string): Promise<SignedOrgState> {
  const state = structuredClone(head.state);
  state.version += 1;
  state.prev = await stateHash(head.state);
  const at = issued ?? iso(Date.now());
  state.issued = at > head.state.issued ? at : head.state.issued;
  await edit(state);
  return signOrgState(state, signers.map((d) => d.stepUp));
}

const transition = (fromVersion: number, to: TestDevice[]): Promise<Signed<RootTransition>> =>
  signTransition({ org: ORG, fromVersion, newRootKeys: to.map((d) => d.stepUp.pub), issued: iso(Date.now()) }, recovery.privateKey, recovery.pub);

async function deviceEntries(device: Device): Promise<RevokedKey[]> {
  return [
    { keyId: await keyId(device.channelPub), holder: { member: A, device: device.id, class: device.class, key: 'channel' } },
    { keyId: await keyId(device.stepUpPub!), holder: { member: A, device: device.id, class: device.class, key: 'step-up' } },
  ];
}

/** `id` leaves member A with both its keys revoked (`remove-device`'s edit), its step-up kid out of the root set. */
async function removeDevice(s: OrgState, device: Device): Promise<void> {
  s.members[0].devices = s.members[0].devices.filter((d) => d.id !== device.id);
  s.revoked.push(...(await deviceEntries(device)));
  const kid = await keyId(device.stepUpPub!);
  s.root.keys = s.root.keys.filter((k) => k !== kid);
}

async function newDelegation(prefix: string, expires = iso(Date.now() + 30 * DAY)): Promise<{ delegation: Delegation; key: SigningKey }> {
  const key = await generateSigningKey();
  return { key, delegation: { id: hex32(), pub: key.pub, prefix, expires, maxUses: 10, offlineRevokeS: 0, owners: [A] } };
}

/** `delegation drop`'s edit: the delegation's key revoked by its id and prefix, its certificates' retirements revoked. */
async function dropDelegation(s: OrgState, d: Delegation): Promise<void> {
  s.delegations = s.delegations.filter((x) => x.id !== d.id);
  s.revoked.push({ keyId: await keyId(d.pub), holder: { delegation: d.id, prefix: d.prefix } });
  const ours = (r: OrgState['retired'][number]) => 'machine' in r.holder && r.holder.machine.startsWith(`${d.id}_`);
  for (const r of s.retired.filter(ours)) s.revoked.push({ keyId: r.keyId, holder: r.holder });
  s.retired = s.retired.filter((r) => !ours(r));
}

/** A machine certificate of `d` (signed by its key), for a ref under its id and a name under its prefix. */
async function certificate(d: { delegation: Delegation; key: SigningKey }, name: string): Promise<{ cert: Signed<MachineCert>; key: SigningKey }> {
  const key = await generateSigningKey();
  const body: MachineCert = { org: ORG, machine: `${d.delegation.id}_${randomRef()}`, name, pub: key.pub, delegation: d.delegation.id, use: 1, issued: iso(Date.now() - 5 * DAY) };
  return { key, cert: { body, sig: await signBody(SIGNING_DOMAINS.machineCert, body, d.key.privateKey, d.key.pub) } };
}

async function enroll(s: OrgState, name: string): Promise<{ ref: string; key: SigningKey }> {
  const key = await generateSigningKey();
  const ref = randomRef();
  s.machines.push({ name, ref, pub: key.pub, owners: [A] });
  s.machineNames.push({ name, ref });
  return { ref, key };
}

const codes = (findings: Finding[]) => findings.map((f) => `${f.level}:${f.code}`);
const check = (head: SignedOrgState, next: SignedOrgState, superseded: SignedOrgState[] = [], now = new Date()) => checkSuccessor(head.state, next.state, superseded, now);
const verdict = async (head: SignedOrgState, next: SignedOrgState, transitions: Signed<RootTransition>[] = []) => {
  const v = await verifySuccessor(head, next, transitions);
  return v.ok ? 'ok' : v.code;
};

let A: string;
let a1: TestDevice;
let recovery: SigningKey;
let g: SignedOrgState;
const self = (device: TestDevice) => Promise.all([keyId(device.channel.pub), keyId(device.stepUp.pub)]).then(([channelKid, stepUpKid]) => ({ channelKid, stepUpKid }));

beforeEach(async () => {
  A = hex32();
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  g = await genesis();
});

describe('checkSuccessor', () => {
  it('finds nothing in a no-change successor', async () => {
    expect(await check(g, await successor(g, [a1]))).toEqual([]);
  });

  describe('revives-revoked', () => {
    it("refuses a revoked device's keys made current again, as the package does", async () => {
      const d = await newDevice('d');
      const s2 = await successor(g, [a1], async (s) => void s.members[0].devices.push(await endorsed(d, a1)));
      const s3 = await successor(s2, [a1], (s) => removeDevice(s, d.device));
      const next = await successor(s3, [a1], async (s) => void s.members[0].devices.push(await endorsed(d, a1)));
      const findings = await check(s3, next);
      expect(codes(findings)).toEqual(['refuse:revives-revoked', 'refuse:revives-revoked']);
      expect(findings[0].detail).toContain('d');
      expect(await verdict(s3, next)).toBe('revoked');
    });

    it("refuses a revoked machine's key enrolled again, as the package does", async () => {
      let machine!: { ref: string; key: SigningKey };
      const s2 = await successor(g, [a1], async (s) => void (machine = await enroll(s, 'mini')));
      const s3 = await successor(s2, [a1], async (s) => {
        s.machines = [];
        s.revoked.push({ keyId: await keyId(machine.key.pub), holder: { machine: machine.ref } });
      });
      const next = await successor(s3, [a1], (s) => void s.machines.push({ name: 'mini', ref: machine.ref, pub: machine.key.pub, owners: [A] }));
      expect(codes(await check(s3, next))).toEqual(['refuse:revives-revoked']);
      expect(await verdict(s3, next)).toBe('revoked');
    });

    it('refuses a key the successor itself revokes while still holding it, as the package does', async () => {
      const d = await newDevice('d');
      const s2 = await successor(g, [a1], async (s) => void s.members[0].devices.push(await endorsed(d, a1)));
      const next = await successor(s2, [a1], async (s) => void s.revoked.push((await deviceEntries(d.device))[0]));
      expect(codes(await check(s2, next))).toEqual(['refuse:revives-revoked']);
      expect(await verdict(s2, next)).toBe('revoked');
    });
  });

  describe('delegation prefixes', () => {
    async function headWith(prefix: string): Promise<SignedOrgState> {
      const { delegation } = await newDelegation(prefix);
      return successor(g, [a1], (s) => void s.delegations.push(delegation));
    }
    async function adding(head: SignedOrgState, prefix: string): Promise<SignedOrgState> {
      const { delegation } = await newDelegation(prefix);
      return successor(head, [a1], (s) => void s.delegations.push(delegation));
    }

    it('refuses dc-prod- under a live dc- as nested, as the package does', async () => {
      const head = await headWith('dc-');
      const next = await adding(head, 'dc-prod-');
      expect(codes(await check(head, next))).toEqual(['refuse:prefix-nested']);
      expect(await verdict(head, next)).toBe('malformed');
    });

    it('refuses dc- over a live dc-prod- as covering it, as the package does', async () => {
      const head = await headWith('dc-prod-');
      const next = await adding(head, 'dc-');
      expect(codes(await check(head, next))).toEqual(['refuse:prefix-covers']);
      expect(await verdict(head, next)).toBe('malformed');
    });

    it('refuses an equal prefix, case-folded, as the package does', async () => {
      const head = await headWith('dc-');
      const next = await adding(head, 'DC-');
      expect(codes(await check(head, next))).toEqual(['refuse:prefix-equal']);
      expect(await verdict(head, next)).toBe('malformed');
    });

    it("refuses a dropped delegation's prefix, reserved for the life of the org, as the package does", async () => {
      const dc = await newDelegation('dc-');
      const s2 = await successor(g, [a1], (s) => void s.delegations.push(dc.delegation));
      const s3 = await successor(s2, [a1], (s) => dropDelegation(s, dc.delegation));
      for (const [prefix, code] of [['dc-', 'prefix-equal'], ['dc-x-', 'prefix-nested'], ['d', 'prefix-covers']] as const) {
        const next = await adding(s3, prefix);
        expect(codes(await check(s3, next))).toEqual([`refuse:${code}`]);
        expect(await verdict(s3, next)).toBe('malformed');
      }
    });

    it('refuses a prefix nesting in a delegation the same state drops, naming it once', async () => {
      const dc = await newDelegation('dc-');
      const head = await successor(g, [a1], (s) => void s.delegations.push(dc.delegation));
      const prod = await newDelegation('dc-prod-');
      const next = await successor(head, [a1], async (s) => {
        await dropDelegation(s, dc.delegation);
        s.delegations.push(prod.delegation);
      });
      expect(codes(await check(head, next))).toEqual(['refuse:prefix-nested', 'warn:drops-delegation']);
      expect(await verdict(head, next)).toBe('malformed');
    });

    it('refuses two new delegations that nest in each other once', async () => {
      const x = await newDelegation('dc-');
      const y = await newDelegation('dc-prod-');
      const next = await successor(g, [a1], (s) => void s.delegations.push(x.delegation, y.delegation));
      expect(codes(await check(g, next))).toEqual(['refuse:prefix-covers']);
      expect(await verdict(g, next)).toBe('malformed');
    });

    it('refuses a machine dc-prod-1 under a new dc-, as the package does', async () => {
      const head = await successor(g, [a1], (s) => enroll(s, 'dc-prod-1').then(() => {}));
      const next = await adding(head, 'dc-');
      const findings = await check(head, next);
      expect(codes(findings)).toEqual(['refuse:prefix-names-machine']);
      expect(findings[0].detail).toContain('dc-prod-1');
      expect(await verdict(head, next)).toBe('malformed');
    });

    it('refuses a new prefix over a retained name whose machine left, as the package does', async () => {
      let machine!: { ref: string; key: SigningKey };
      const s2 = await successor(g, [a1], async (s) => void (machine = await enroll(s, 'DC-old')));
      const s3 = await successor(s2, [a1], async (s) => {
        s.machines = [];
        s.retired.push({ keyId: await keyId(machine.key.pub), pub: machine.key.pub, notAfter: s.issued, holder: { machine: machine.ref } });
      });
      const next = await adding(s3, 'dc-');
      expect(codes(await check(s3, next))).toEqual(['refuse:prefix-names-machine']);
      expect(await verdict(s3, next)).toBe('malformed');
    });

    it("refuses a machine enrolled under a delegation's prefix, as the package does", async () => {
      const head = await headWith('dc-');
      const next = await successor(head, [a1], (s) => enroll(s, 'dc-9').then(() => {}));
      expect(codes(await check(head, next))).toEqual(['refuse:prefix-names-machine']);
      expect(await verdict(head, next)).toBe('malformed');
    });
  });

  describe('delegation-id-used', () => {
    it("refuses a dropped delegation's id, as the package does", async () => {
      const dc = await newDelegation('dc-');
      const s2 = await successor(g, [a1], (s) => void s.delegations.push(dc.delegation));
      const s3 = await successor(s2, [a1], (s) => dropDelegation(s, dc.delegation));
      const again = await newDelegation('other-');
      const next = await successor(s3, [a1], (s) => void s.delegations.push({ ...again.delegation, id: dc.delegation.id }));
      expect(codes(await check(s3, next))).toEqual(['refuse:delegation-id-used']);
      expect(await verdict(s3, next)).toBe('malformed');
    });

    it("refuses a live delegation's id under another key, as the package does", async () => {
      const dc = await newDelegation('dc-');
      const head = await successor(g, [a1], (s) => void s.delegations.push(dc.delegation));
      const other = await newDelegation('vm-');
      const next = await successor(head, [a1], (s) => void s.delegations.push({ ...other.delegation, id: dc.delegation.id }));
      expect(codes(await check(head, next))).toEqual(['refuse:delegation-id-used']);
      expect(await verdict(head, next)).toBe('malformed');
    });
  });

  describe('renewals', () => {
    const t0 = Date.now();

    it('refuses renewing a delegation whose expires is not later than the successor, as the package does', async () => {
      const dc = await newDelegation('dc-', iso(t0 - 2 * DAY));
      const head = await successor(g, [a1], (s) => void s.delegations.push(dc.delegation), iso(t0 - 3 * DAY));
      const next = await successor(head, [a1], (s) => void (s.delegations[0].expires = iso(t0 + 30 * DAY)), iso(t0));
      expect(codes(await check(head, next, [], new Date(t0)))).toEqual(['refuse:renew-expired']);
      expect(await verdict(head, next)).toBe('malformed');
    });

    it('refuses a renewal to a value not later than the successor, as the package does', async () => {
      const dc = await newDelegation('dc-', iso(t0 + 30 * DAY));
      const head = await successor(g, [a1], (s) => void s.delegations.push(dc.delegation), iso(t0 - DAY));
      const next = await successor(head, [a1], (s) => void (s.delegations[0].expires = iso(t0)), iso(t0));
      expect(codes(await check(head, next, [], new Date(t0)))).toEqual(['refuse:renew-expired']);
      expect(await verdict(head, next)).toBe('malformed');
    });

    it('refuses a renewal of a delegation expired by the clock, though the successor is issued before it', async () => {
      const dc = await newDelegation('dc-', iso(t0 - DAY));
      const head = await successor(g, [a1], (s) => void s.delegations.push(dc.delegation), iso(t0 - 3 * DAY));
      const next = await successor(head, [a1], (s) => void (s.delegations[0].expires = iso(t0 + 30 * DAY)), iso(t0 - 2 * DAY));
      expect(codes(await check(head, next, [], new Date(t0)))).toEqual(['refuse:renew-expired']);
    });

    it('refuses shortening a live delegation; the package accepts it, so only the app holds renewals to extending', async () => {
      const dc = await newDelegation('dc-', iso(t0 + 30 * DAY));
      const head = await successor(g, [a1], (s) => void s.delegations.push(dc.delegation), iso(t0 - DAY));
      const next = await successor(head, [a1], (s) => void (s.delegations[0].expires = iso(t0 + 10 * DAY)), iso(t0));
      expect(codes(await check(head, next, [], new Date(t0)))).toEqual(['refuse:renew-not-extension']);
      expect(await verdict(head, next)).toBe('ok');
    });

    it('accepts extending a live delegation', async () => {
      const dc = await newDelegation('dc-', iso(t0 + 10 * DAY));
      const head = await successor(g, [a1], (s) => void s.delegations.push(dc.delegation), iso(t0 - DAY));
      const next = await successor(head, [a1], (s) => void (s.delegations[0].expires = iso(t0 + 40 * DAY)), iso(t0));
      expect(await check(head, next, [], new Date(t0))).toEqual([]);
      expect(await verdict(head, next)).toBe('ok');
    });
  });

  it("warns, without refusing, when a delegation is dropped, naming its certificates' keys", async () => {
    const dc = await newDelegation('dc-');
    const head = await successor(g, [a1], (s) => void s.delegations.push(dc.delegation));
    const next = await successor(head, [a1], (s) => dropDelegation(s, dc.delegation));
    const findings = await check(head, next);
    expect(codes(findings)).toEqual(['warn:drops-delegation']);
    expect(findings[0].detail).toContain(dc.delegation.id);
    expect(findings[0].detail).toContain('certificates');
    expect(await verdict(head, next)).toBe('ok');
  });

  // The desk track's checks (the Decision Log, 2026-10-28): no path leaves the org with zero roots, and a successor
  // signed only by a root key it adds itself is refused.
  describe('no path to zero roots', () => {
    let app: TestDevice;
    let twoRoots: SignedOrgState;
    let appAlone: SignedOrgState;

    beforeEach(async () => {
      app = await newDevice('app');
      // `root add`'s edit: the app's device listed under the deployment admin's member, its step-up kid appended.
      const listed = await successor(g, [a1], async (s) => void s.members[0].devices.push(await endorsed(app, a1)));
      twoRoots = await successor(listed, [a1], async (s) => void s.root.keys.push(await keyId(app.stepUp.pub)));
      appAlone = await successor(twoRoots, [app], (s) => removeDevice(s, a1.device));
    });

    it("accepts the app's root alone removing the deployment admin's device and its kid", async () => {
      expect(appAlone.state.root.keys).toEqual([await keyId(app.stepUp.pub)]);
      expect(await verdict(twoRoots, appAlone)).toBe('ok');
      expect(await check(twoRoots, appAlone)).toEqual([]);
    });

    it("refuses removing the last root's device: malformed by the package, empty-roots before Touch ID", async () => {
      const next = await successor(appAlone, [app], (s) => removeDevice(s, app.device));
      expect(next.state.root.keys).toEqual([]);
      expect(await verdict(appAlone, next)).toBe('malformed');
      expect(codes(await check(appAlone, next))).toEqual(['refuse:empty-roots']);
    });

    it('refuses emptying root.keys while keeping the devices, the same way', async () => {
      const next = await successor(appAlone, [app], (s) => void (s.root.keys = []));
      expect(await verdict(appAlone, next)).toBe('malformed');
      expect(codes(await check(appAlone, next))).toEqual(['refuse:empty-roots']);
    });

    it('refuses a successor signed only by a root key it adds itself (not-root-signed)', async () => {
      const b = await newDevice('b');
      const edit = async (s: OrgState) => {
        s.members[0].devices.push(await endorsed(b, a1));
        s.root.keys.push(await keyId(b.stepUp.pub));
      };
      const selfSigned = await successor(g, [b], edit);
      expect(await verdict(g, selfSigned)).toBe('not-root-signed');
      const rootSigned = await signOrgState(selfSigned.state, [a1.stepUp]);
      expect(await verdict(g, rootSigned)).toBe('ok');
    });
  });
});

/**
 * A recovery from `base`: the superseded branch (each state an edit signed by the old root `a1`), a transition from the
 * base to `to`, and the recovered head, the first state under it (`to` listed under A, the one root), then `after`.
 */
async function rewound(base: SignedOrgState, discarded: Array<(s: OrgState) => void | Promise<void>>, to: TestDevice, after: Array<(s: OrgState) => void | Promise<void>> = []) {
  const superseded: SignedOrgState[] = [];
  let at = base;
  for (const edit of discarded) superseded.push((at = await successor(at, [a1], edit)));
  const t = await transition(base.state.version, [to]);
  const toKid = await keyId(to.stepUp.pub);
  let head = await successor(base, [to], async (s) => {
    if (!s.members[0].devices.some((d) => d.id === to.device.id)) s.members[0].devices.push(to.device);
    s.root.keys = [toKid];
  });
  expect(await verdict(base, head, [t])).toBe('ok');
  for (const edit of after) {
    const next = await successor(head, [to], edit);
    expect(await verdict(head, next, [t])).toBe('ok');
    head = next;
  }
  return { superseded, head, transitions: [t] };
}

/** The offer applied to a successor of `head`, signed by `root` and judged by the package. */
async function signOffer(head: SignedOrgState, root: TestDevice, offer: NonNullable<Awaited<ReturnType<typeof supersededRevocations>>>, transitions: Signed<RootTransition>[]) {
  const signed = await successor(head, [root], (s) => offer.edit(s));
  return { signed, verdict: await verdict(head, signed, transitions) };
}

describe('supersededRevocations after a rewind', () => {
  let app: TestDevice;
  let d: TestDevice;
  let withD: SignedOrgState;

  beforeEach(async () => {
    app = await newDevice('app');
    d = await newDevice('d');
    withD = await successor(g, [a1], async (s) => void s.members[0].devices.push(await endorsed(d, a1)));
  });

  it('offers an honest revocation of a device current again after the recovery, the device removed', async () => {
    const { superseded, head, transitions } = await rewound(withD, [(s) => removeDevice(s, d.device)], app);
    expect(head.state.members[0].devices.map((x) => x.id)).toContain('d');
    const offer = await supersededRevocations(head.state, superseded, await self(app));
    expect(offer).not.toBeNull();
    expect(offer!.withheld).toEqual([]);
    const kids = (await deviceEntries(d.device)).map((r) => r.keyId);
    expect(offer!.lines.join('\n')).toContain(kids[0]);
    const { signed, verdict: v } = await signOffer(head, app, offer!, transitions);
    expect(v).toBe('ok');
    expect(signed.state.members[0].devices.map((x) => x.id)).not.toContain('d');
    expect(signed.state.revoked.map((r) => r.keyId)).toEqual(expect.arrayContaining(kids));
    // The check names what an unrelated edit leaves out, and nothing once the offer is carried.
    expect(codes(await check(head, await successor(head, [app]), superseded))).toEqual(['warn:superseded-keys', 'warn:superseded-keys']);
    expect(await check(head, signed, superseded)).toEqual([]);
  });

  it('accounts for the companion: a channel key revoked and a step-up key retired on the discarded branch', async () => {
    const [channel, stepUp] = await deviceEntries(d.device);
    const { superseded, head, transitions } = await rewound(
      withD,
      [
        (s) => {
          s.members[0].devices = s.members[0].devices.filter((x) => x.id !== 'd');
          s.revoked.push(channel);
          s.retired.push({ keyId: stepUp.keyId, pub: d.stepUp.pub, notAfter: s.issued, holder: { member: A, device: 'd', class: 'native-mac', key: 'step-up' } });
        },
      ],
      app,
    );
    const offer = (await supersededRevocations(head.state, superseded, await self(app)))!;
    expect(offer.lines.length).toBeGreaterThanOrEqual(2);
    expect(offer.lines.join('\n')).toContain(stepUp.keyId);
    const { signed, verdict: v } = await signOffer(head, app, offer, transitions);
    expect(v).toBe('ok');
    expect(signed.state.revoked).toEqual(expect.arrayContaining([channel, stepUp]));
    expect(signed.state.retired).toEqual([]);
  });

  it('offers a revoked delegated certificate the recovery restored as a machine-holder revocation, served or withheld', async () => {
    const dc = await newDelegation('dc-');
    const { cert, key } = await certificate(dc, 'dc-1');
    const base = await successor(g, [a1], (s) => void s.delegations.push(dc.delegation));
    const entry: RevokedKey = { keyId: await keyId(key.pub), holder: { machine: cert.body.machine } };
    const { superseded, head, transitions } = await rewound(base, [(s) => void s.revoked.push(entry)], app);
    const served = { certs: [cert], retirements: [] };
    const now = new Date();
    // The recovery restored the certificate: the hub that serves it makes its key current; one that withholds it hides it.
    expect((await machineKeys(head.state, cert.body.machine, served, now)).keys).toEqual([key.pub]);
    expect((await machineKeys(head.state, cert.body.machine, NO_CERTIFICATES, now)).keys).toEqual([]);
    // The offer is the same either way: it reads the states alone, never the hub's certificate set.
    const offer = (await supersededRevocations(head.state, superseded, await self(app)))!;
    expect(offer.withheld).toEqual([]);
    expect(offer.lines.join('\n')).toContain(cert.body.machine);
    const { signed, verdict: v } = await signOffer(head, app, offer, transitions);
    expect(v).toBe('ok');
    expect(signed.state.revoked).toContainEqual(entry);
    expect((await machineKeys(signed.state, cert.body.machine, served, now)).keys).toEqual([]);
  });

  it("moves an enrolled machine's and a certificate's retired keys, revoked on the discarded branch, to revoked", async () => {
    const dc = await newDelegation('dc-');
    const { cert, key: certKey } = await certificate(dc, 'dc-1');
    let machine!: { ref: string; key: SigningKey };
    const s2 = await successor(withD, [a1], async (s) => {
      s.delegations.push(dc.delegation);
      machine = await enroll(s, 'mini');
    });
    const s3 = await successor(s2, [a1], async (s) => {
      s.machines = [];
      s.retired.push({ keyId: await keyId(machine.key.pub), pub: machine.key.pub, notAfter: s.issued, holder: { machine: machine.ref } });
      s.retired.push({ keyId: await keyId(certKey.pub), pub: certKey.pub, notAfter: s.issued, holder: { machine: cert.body.machine } });
    });
    const retired = s3.state.retired.map((r) => r.keyId);
    const { superseded, head, transitions } = await rewound(
      s3,
      [
        (s) => {
          for (const r of s.retired) s.revoked.push({ keyId: r.keyId, holder: r.holder });
          s.retired = [];
        },
      ],
      app,
    );
    const offer = (await supersededRevocations(head.state, superseded, await self(app)))!;
    expect(offer.lines).toHaveLength(2);
    const { signed, verdict: v } = await signOffer(head, app, offer, transitions);
    expect(v).toBe('ok');
    expect(signed.state.retired).toEqual([]);
    expect(signed.state.revoked.map((r) => r.keyId)).toEqual(expect.arrayContaining(retired));
  });

  it('drops a delegation the discarded branch dropped, moving the certificates the recovered branch retired to revoked', async () => {
    const dc = await newDelegation('dc-');
    const { cert, key: certKey } = await certificate(dc, 'dc-1');
    const base = await successor(g, [a1], (s) => void s.delegations.push(dc.delegation));
    const retire = async (s: OrgState) => void s.retired.push({ keyId: await keyId(certKey.pub), pub: certKey.pub, notAfter: s.issued, holder: { machine: cert.body.machine } });
    const { superseded, head, transitions } = await rewound(base, [(s) => dropDelegation(s, dc.delegation)], app, [retire]);
    const offer = (await supersededRevocations(head.state, superseded, await self(app)))!;
    expect(offer.lines.join('\n')).toContain(await keyId(certKey.pub));
    const { signed, verdict: v } = await signOffer(head, app, offer, transitions);
    expect(v).toBe('ok');
    expect(signed.state.delegations).toEqual([]);
    expect(signed.state.retired).toEqual([]);
    expect(signed.state.revoked.map((r) => r.keyId)).toEqual(expect.arrayContaining([await keyId(dc.delegation.pub), await keyId(certKey.pub)]));
    // Without the move the package refuses the drop: a dropped delegation's certificates keep no `retired` entry.
    const bare = await successor(head, [app], async (s) => {
      s.delegations = [];
      s.revoked.push({ keyId: await keyId(dc.delegation.pub), holder: { delegation: dc.delegation.id, prefix: dc.delegation.prefix } });
    });
    expect(await verdict(head, bare, transitions)).toBe('malformed');
  });

  it("moves a certificate's retired key once when the discarded branch revoked it and then dropped its delegation", async () => {
    const dc = await newDelegation('dc-');
    const { cert, key: certKey } = await certificate(dc, 'dc-1');
    const certKid = await keyId(certKey.pub);
    const base = await successor(g, [a1], async (s) => {
      s.delegations.push(dc.delegation);
      s.retired.push({ keyId: certKid, pub: certKey.pub, notAfter: s.issued, holder: { machine: cert.body.machine } });
    });
    const revokeCert = (s: OrgState) => {
      s.retired = [];
      s.revoked.push({ keyId: certKid, holder: { machine: cert.body.machine } });
    };
    const { superseded, head, transitions } = await rewound(base, [revokeCert, (s) => dropDelegation(s, dc.delegation)], app);
    const offer = (await supersededRevocations(head.state, superseded, await self(app)))!;
    expect(offer.lines.filter((line) => line.includes(certKid))).toHaveLength(1);
    const { signed, verdict: v } = await signOffer(head, app, offer, transitions);
    expect(v).toBe('ok');
    expect(signed.state.revoked.filter((r) => r.keyId === certKid)).toHaveLength(1);
    expect(signed.state.retired).toEqual([]);
  });

  it('offers nothing for a device added only on the discarded branch', async () => {
    const n = await newDevice('n');
    const { superseded, head } = await rewound(withD, [async (s) => void s.members[0].devices.push(await endorsed(n, a1)), (s) => removeDevice(s, n.device)], app);
    expect(await supersededRevocations(head.state, superseded, await self(app))).toBeNull();
    expect(await check(head, await successor(head, [app]), superseded)).toEqual([]);
  });

  it("withholds this device's own keys and offers the rest", async () => {
    const me = await newDevice('me');
    const base = await successor(withD, [a1], async (s) => void s.members[0].devices.push(await endorsed(me, a1)));
    const { superseded, head, transitions } = await rewound(base, [(s) => removeDevice(s, me.device), (s) => removeDevice(s, d.device)], app);
    const offer = (await supersededRevocations(head.state, superseded, await self(me)))!;
    expect(offer.withheld).toEqual(await deviceEntries(me.device));
    expect(offer.lines.join('\n')).not.toContain(await keyId(me.channel.pub));
    const { signed, verdict: v } = await signOffer(head, app, offer, transitions);
    expect(v).toBe('ok');
    const ids = signed.state.members[0].devices.map((x) => x.id);
    expect(ids).toContain('me');
    expect(ids).not.toContain('d');
  });

  it('withholds a revocation whose closure would empty root.keys', async () => {
    // The recovery's new root is d, a device the discarded branch had revoked: revoking it again would leave no root.
    const { superseded, head } = await rewound(withD, [(s) => removeDevice(s, d.device)], d);
    expect(head.state.root.keys).toEqual([await keyId(d.stepUp.pub)]);
    const offer = (await supersededRevocations(head.state, superseded, await self(app)))!;
    expect(offer.withheld.map((r) => r.keyId)).toEqual((await deviceEntries(d.device)).map((r) => r.keyId));
    expect(offer.lines).toEqual([]);
    const draft = structuredClone(head.state);
    offer.edit(draft);
    expect(draft).toEqual(head.state);
  });
});
