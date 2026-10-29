// The Org page's changes (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "Changes",
// "Pairing" and Proves; Interfaces §M): each composer's successor, applied to a fresh draft of the head, passes the
// package's `successorProblems` and, signed with real keys, its `verifySuccessor`; each refusal the composers hold
// refuses; a target gone from the draft reads `stale`; `member.add`'s id is the one previewed. Real keys and the
// package's own verifiers throughout; the own-device pairing is signed through step-up.ts's state signer, which
// endorses inside the one confirmation.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  base64urlEncode,
  generateSigningKey,
  keyId,
  signOrgState,
  successorProblems,
  verifySuccessor,
  type Device,
  type OrgState,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';

vi.mock('electron', () => ({ systemPreferences: { promptTouchID: () => Promise.reject(new Error('no system prompt in the suites')) } }));

import { createStateSigner } from '../device/step-up';
import { checkSuccessor, type Finding } from './checks';
import { composeChange, deviceApproveEdit, normalizeChange, type EditSelf, type OrgChange } from './edits';
import { RefusedEdit, StaleEdit, successorDraft, type Edit } from './signer';

const ORG = 'org-edits';
const NOW = Date.parse('2026-10-29T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const hex32 = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

type TestDevice = { device: Device; channel: SigningKey; stepUp: SigningKey | null };
async function newDevice(id: string, kind: 'signing' | 'no-step-up' | 'web-cards' = 'signing'): Promise<TestDevice> {
  const channel = await generateSigningKey();
  if (kind === 'signing') {
    const stepUp = await generateSigningKey();
    return { channel, stepUp, device: { id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
  }
  return { channel, stepUp: null, device: { id, class: kind === 'web-cards' ? 'web-cards' : 'native-mac', keyStorage: kind === 'web-cards' ? 'webcrypto' : 'software', channelPub: channel.pub } };
}

// The org: A (this Mac's member, an admin) with this Mac's device `mac` (a root) and `old`; B, a member with one device
// and the machine `mini`; C, an admin whose `c1` is the other root, beside a web-cards device and a native-mac one with
// no step-up key; D, a member with no device yet.
const A = hex32();
const B = hex32();
const C = hex32();
const D = hex32();
const SELF: EditSelf = { member: A, device: 'mac-0001' };
let d: Record<'mac' | 'old' | 'b1' | 'c1' | 'cw' | 'cn', TestDevice>;
let head: SignedOrgState;

beforeAll(async () => {
  d = {
    mac: await newDevice('mac-0001'),
    old: await newDevice('old-0001'),
    b1: await newDevice('b1-00001'),
    c1: await newDevice('c1-00001'),
    cw: await newDevice('cw-00001', 'web-cards'),
    cn: await newDevice('cn-00001', 'no-step-up'),
  };
  const recovery = await generateSigningKey();
  const machine = await generateSigningKey();
  const ref = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const state: OrgState = {
    org: ORG,
    version: 1,
    prev: null,
    issued: iso(NOW - 86_400_000),
    root: { keys: [await keyId(d.mac.stepUp!.pub), await keyId(d.c1.stepUp!.pub)], recoveryPub: recovery.pub },
    members: [
      { id: A, email: 'owner@example.com', role: 'admin', devices: [d.mac.device, d.old.device] },
      { id: B, email: 'b@example.com', role: 'member', devices: [d.b1.device] },
      { id: C, email: 'c@example.com', role: 'admin', devices: [d.c1.device, d.cw.device, d.cn.device] },
      { id: D, email: 'd@example.com', role: 'member', devices: [] },
    ],
    machines: [{ name: 'mini', ref, pub: machine.pub, owners: [B] }],
    machineNames: [{ name: 'mini', ref }],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
  head = await signOrgState(state, [d.mac.stepUp!]);
});

/** The edit applied to a fresh draft of `at`, as the signer drafts it. */
async function drafted(at: SignedOrgState, edit: Edit): Promise<OrgState> {
  const draft = await successorDraft(at, NOW);
  await edit.apply(draft);
  return draft;
}

/** The edit's successor of `at`: its problems by the package's pre-sign function, then signed by this Mac's root and judged. */
async function judged(at: SignedOrgState, edit: Edit): Promise<{ draft: OrgState; problems: string[]; verdict: string }> {
  const draft = await drafted(at, edit);
  const endorsing = edit.endorse === undefined ? undefined : { kid: await keyId(d.mac.stepUp!.pub), devices: edit.endorse.map((e) => e.device) };
  const problems = (await successorProblems(at.state, draft, endorsing === undefined ? {} : { endorsing })).map((p) => p.code);
  const signer = await createStateSigner({ key: d.mac.stepUp!, confirm: async () => ({ ok: true }) });
  const signed = await signer.sign(draft, { summary: edit.summary, text: edit.lines.join('\n') }, { endorse: edit.endorse ?? [] });
  if (!signed.ok) throw new Error('not signed');
  const v = await verifySuccessor(at, signed.signed, []);
  return { draft, problems, verdict: v.ok ? 'ok' : v.code };
}

const compose = (change: OrgChange, self: EditSelf = SELF) => composeChange(head.state, normalizeChange(change), self);
const composeOn = (at: SignedOrgState, change: OrgChange, self: EditSelf = SELF) => composeChange(at.state, normalizeChange(change), self);

/** The refusal a composer throws, by its findings' codes. */
async function refusal(work: Promise<unknown>): Promise<string[]> {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof RefusedEdit)) throw new Error(`expected a refusal, got ${String(error)}`);
  return error.findings.map((f: Finding) => `${f.level}:${f.code}`);
}

/** The refusals the checks name on the edit's successor of `at` (the package's and the app's rows). */
async function checked(at: SignedOrgState, edit: Edit): Promise<string[]> {
  const draft = await drafted(at, edit);
  return (await checkSuccessor(at.state, draft, [], new Date(NOW))).filter((f) => f.level === 'refuse').map((f) => f.code);
}

/** `at`, with C's `c1` the one root: this Mac's `mac` left the root set (signed by `mac`, a root of the parent). */
async function cTheOnlyRoot(): Promise<SignedOrgState> {
  const draft = await successorDraft(head, NOW);
  draft.root.keys = [await keyId(d.c1.stepUp!.pub)];
  return signOrgState(draft, [d.mac.stepUp!]);
}

describe('each composer signs a successor the package accepts', () => {
  it('member.add: a new member with no devices, its email trimmed and lower-cased, its role member unless chosen', async () => {
    const change = normalizeChange({ kind: 'member.add', email: '  New.Person@Example.COM ', role: 'member' });
    expect(change).toMatchObject({ kind: 'member.add', email: 'new.person@example.com', role: 'member' });
    const edit = await composeOn(head, change);
    const { draft, problems, verdict } = await judged(head, edit);
    expect(problems).toEqual([]);
    expect(verdict).toBe('ok');
    expect(draft.members.at(-1)).toEqual({ id: (change as { id: string }).id, email: 'new.person@example.com', role: 'member', devices: [] });
    expect(edit.lines.join('\n')).toContain("Access");
    expect(edit.change).toEqual(change);
  });

  it("member.add: the id signed is the id previewed, however often it is composed again", async () => {
    const change = normalizeChange({ kind: 'member.add', email: 'e@example.com', role: 'admin' });
    const id = (change as { id: string }).id;
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(normalizeChange(change)).toEqual(change); // a normalized change keeps its id
    const first = await drafted(head, await composeOn(head, change));
    const again = await drafted(head, await composeOn(head, change));
    expect(first.members.at(-1)!.id).toBe(id);
    expect(again.members.at(-1)!.id).toBe(id);
    expect(normalizeChange({ kind: 'member.add', email: 'e@example.com', role: 'admin' })).not.toEqual(change); // a fresh preview, a fresh id
  });

  it("member.remove: every device's keys revoked under their holders, a root kid out of the root set", async () => {
    const edit = await compose({ kind: 'member.remove', member: C });
    const { draft, problems, verdict } = await judged(head, edit);
    expect(problems).toEqual([]);
    expect(verdict).toBe('ok');
    expect(draft.members.map((m) => m.id)).not.toContain(C);
    expect(draft.root.keys).toEqual([await keyId(d.mac.stepUp!.pub)]);
    const revoked = draft.revoked.map((r) => r.keyId);
    for (const t of [d.c1, d.cw, d.cn]) expect(revoked).toContain(await keyId(t.channel.pub));
    expect(revoked).toContain(await keyId(d.c1.stepUp!.pub));
    expect(edit.lines.join('\n')).toMatch(/c1-00001 \(native-mac\)[^\n]*\n?/);
    expect(edit.lines.some((l) => l.includes('root set'))).toBe(true);
  });

  it('member.role: a promotion, and a demotion that takes the member\'s root kids out of the root set', async () => {
    const up = await judged(head, await compose({ kind: 'member.role', member: D, role: 'admin' }));
    expect([up.problems, up.verdict]).toEqual([[], 'ok']);
    expect(up.draft.members.find((m) => m.id === D)!.role).toBe('admin');

    const edit = await compose({ kind: 'member.role', member: C, role: 'member' });
    const down = await judged(head, edit);
    expect([down.problems, down.verdict]).toEqual([[], 'ok']);
    expect(down.draft.root.keys).toEqual([await keyId(d.mac.stepUp!.pub)]);
    expect(edit.lines.some((l) => l.includes('c1-00001') && l.includes('root set'))).toBe(true);
  });

  it('member.email: the new address, lower-cased, with the line that the hub and Access admit it from now on', async () => {
    const edit = await compose({ kind: 'member.email', member: B, email: ' B.New@Example.com' });
    const { draft, problems, verdict } = await judged(head, edit);
    expect([problems, verdict]).toEqual([[], 'ok']);
    expect(draft.members.find((m) => m.id === B)!.email).toBe('b.new@example.com');
    expect(edit.lines.join('\n')).toContain('Access');
  });

  it("device.remove: any member's device, both keys revoked, a root's kid out of the root set", async () => {
    const plain = await judged(head, await compose({ kind: 'device.remove', member: A, device: 'old-0001' }));
    expect([plain.problems, plain.verdict]).toEqual([[], 'ok']);
    expect(plain.draft.revoked.map((r) => r.keyId)).toEqual([await keyId(d.old.channel.pub), await keyId(d.old.stepUp!.pub)]);

    const root = await judged(head, await compose({ kind: 'device.remove', member: C, device: 'c1-00001' }));
    expect([root.problems, root.verdict]).toEqual([[], 'ok']);
    expect(root.draft.root.keys).toEqual([await keyId(d.mac.stepUp!.pub)]);
    expect(root.draft.members.find((m) => m.id === C)!.devices.map((x) => x.id)).toEqual(['cw-00001', 'cn-00001']);
  });

  it("root.add: an admin's native-mac device with a step-up key, its kid appended", async () => {
    const edit = await compose({ kind: 'root.add', member: A, device: 'old-0001' });
    const { draft, problems, verdict } = await judged(head, edit);
    expect([problems, verdict]).toEqual([[], 'ok']);
    expect(draft.root.keys.at(-1)).toBe(await keyId(d.old.stepUp!.pub));
    expect(edit.lines.join('\n')).toMatch(/[a-z2-7]{5}-[a-z2-7]{5}/); // the fingerprint, to compare with the device
  });

  it("device approve: another member's first device, unendorsed", async () => {
    const fresh = await newDevice('d1-00001');
    const edit = await deviceApproveEdit(head.state, { member: D, device: fresh.device, self: SELF, live: () => true });
    expect(edit.endorse).toBeUndefined();
    const { draft, problems, verdict } = await judged(head, edit);
    expect([problems, verdict]).toEqual([[], 'ok']);
    expect(draft.members.find((m) => m.id === D)!.devices).toEqual([fresh.device]);
  });

  it("device approve: this Mac's member's later device, named for this Mac's endorsement inside the one Touch ID", async () => {
    const fresh = await newDevice('a2-00001');
    const edit = await deviceApproveEdit(head.state, { member: A, device: fresh.device, self: SELF, live: () => true });
    expect(edit.endorse).toEqual([{ member: A, device: 'a2-00001' }]);
    const { draft, problems, verdict } = await judged(head, edit);
    expect([problems, verdict]).toEqual([[], 'ok']);
    expect(draft.members[0].devices.at(-1)).toEqual(fresh.device); // the draft carries none: the device module endorses
    // Without the endorsement the package names it before anything is signed.
    expect(await successorProblems(head.state, draft)).toMatchObject([{ code: 'endorsement-missing' }]);
  });

  it('device approve: signs the device it was given, frozen, whatever the caller does with its copy after', async () => {
    const fresh = await newDevice('d1-00002');
    const given = structuredClone(fresh.device);
    const edit = await deviceApproveEdit(head.state, { member: D, device: given, self: SELF, live: () => true });
    given.channelPub = (await generateSigningKey()).pub;
    expect((await drafted(head, edit)).members.find((m) => m.id === D)!.devices).toEqual([fresh.device]);
  });
});

describe('the refusals', () => {
  it('member.remove: refused for yourself, and for the member holding this Mac\'s device', async () => {
    expect(await refusal(compose({ kind: 'member.remove', member: A }))).toEqual(['refuse:self']);
    expect(await refusal(compose({ kind: 'member.remove', member: A }, { member: D, device: 'mac-0001' }))).toEqual(['refuse:this-mac']);
  });

  it('member.remove: refused while they own a machine, the package naming it (owners-unknown)', async () => {
    const edit = await compose({ kind: 'member.remove', member: B });
    expect(await checked(head, edit)).toEqual(['owners-unknown']);
    expect((await checkSuccessor(head.state, await drafted(head, edit), [], new Date(NOW)))[0].detail).toContain('mini');
  });

  it('member.role: refused for yourself, for no change, and when it would empty the roots', async () => {
    expect(await refusal(compose({ kind: 'member.role', member: A, role: 'member' }))).toEqual(['refuse:self']);
    expect(await refusal(compose({ kind: 'member.role', member: C, role: 'admin' }))).toEqual(['refuse:no-change']);
    const only = await cTheOnlyRoot();
    expect(await checked(only, await composeOn(only, { kind: 'member.role', member: C, role: 'member' }))).toEqual(['empty-roots']);
  });

  it('member.email: refused for an email another member has, one out of grammar, and no change', async () => {
    expect(await checked(head, await compose({ kind: 'member.email', member: B, email: 'C@example.com' }))).toEqual(['email-taken']);
    expect(await refusal(compose({ kind: 'member.email', member: B, email: 'not an email' }))).toEqual(['refuse:bad-email']);
    expect(await refusal(compose({ kind: 'member.email', member: B, email: 'B@example.com' }))).toEqual(['refuse:no-change']);
  });

  it('member.add: refused for an email out of grammar, and for one a member has (email-taken)', async () => {
    expect(await refusal(compose({ kind: 'member.add', email: 'nobody', role: 'member' }))).toEqual(['refuse:bad-email']);
    expect(await checked(head, await compose({ kind: 'member.add', email: 'B@example.com', role: 'member' }))).toEqual(['email-taken']);
  });

  it("device.remove: refused for this Mac's own device, and when it would empty the roots", async () => {
    expect(await refusal(compose({ kind: 'device.remove', member: A, device: 'mac-0001' }))).toEqual(['refuse:this-mac']);
    const only = await cTheOnlyRoot();
    expect(await checked(only, await composeOn(only, { kind: 'device.remove', member: C, device: 'c1-00001' }))).toEqual(['empty-roots']);
  });

  it("root.add: refused for a device that can't sign org states, one already a root, and a member's who isn't an admin", async () => {
    expect(await refusal(compose({ kind: 'root.add', member: C, device: 'cw-00001' }))).toEqual(['refuse:not-signing-device']);
    expect(await refusal(compose({ kind: 'root.add', member: C, device: 'cn-00001' }))).toEqual(['refuse:not-signing-device']);
    expect(await refusal(compose({ kind: 'root.add', member: C, device: 'c1-00001' }))).toEqual(['refuse:no-change']);
    expect(await checked(head, await compose({ kind: 'root.add', member: B, device: 'b1-00001' }))).toEqual(['root-not-admin']);
  });

  it('device approve: a later device of a member who has devices goes unendorsed, which the package names', async () => {
    const fresh = await newDevice('b2-00001');
    const edit = await deviceApproveEdit(head.state, { member: B, device: fresh.device, self: SELF, live: () => true });
    expect(edit.endorse).toBeUndefined();
    expect(await checked(head, edit)).toEqual(['endorsement-missing']);
  });
});

describe('a target gone from the draft reads `stale`', () => {
  /** A draft of `head` from which `cut` has removed the target, as a head that moved under the sheet would. */
  async function movedDraft(cut: (s: OrgState) => void): Promise<OrgState> {
    const draft = await successorDraft(head, NOW);
    cut(draft);
    return draft;
  }
  const withoutMember = (id: string) => (s: OrgState) => void (s.members = s.members.filter((m) => m.id !== id));
  const withoutDevice = (member: string, device: string) => (s: OrgState) => {
    const m = s.members.find((x) => x.id === member)!;
    m.devices = m.devices.filter((x) => x.id !== device);
  };

  it('for each change whose target left', async () => {
    const cases: Array<[OrgChange, (s: OrgState) => void]> = [
      [{ kind: 'member.remove', member: C }, withoutMember(C)],
      [{ kind: 'member.role', member: D, role: 'admin' }, withoutMember(D)],
      [{ kind: 'member.email', member: B, email: 'b2@example.com' }, withoutMember(B)],
      [{ kind: 'device.remove', member: A, device: 'old-0001' }, withoutDevice(A, 'old-0001')],
      [{ kind: 'device.remove', member: A, device: 'old-0001' }, withoutMember(A)],
      [{ kind: 'root.add', member: A, device: 'old-0001' }, withoutDevice(A, 'old-0001')],
    ];
    for (const [change, cut] of cases) {
      const edit = await compose(change);
      await expect(Promise.resolve().then(async () => edit.apply(await movedDraft(cut))), change.kind).rejects.toBeInstanceOf(StaleEdit);
    }
  });

  it('when what it would sign is no longer what it showed', async () => {
    // C gained a device after the sheet was composed: removing C would now revoke keys the sheet never named.
    const edit = await compose({ kind: 'member.remove', member: C });
    const extra = await newDevice('c9-00001');
    await expect(Promise.resolve().then(async () => edit.apply(await movedDraft((s) => void s.members.find((m) => m.id === C)!.devices.push(extra.device))))).rejects.toBeInstanceOf(StaleEdit);
  });

  it('for a pairing that ended, or whose device is listed meanwhile', async () => {
    const fresh = await newDevice('d1-00003');
    let live = true;
    const edit = await deviceApproveEdit(head.state, { member: D, device: fresh.device, self: SELF, live: () => live });
    live = false;
    await expect(drafted(head, edit)).rejects.toBeInstanceOf(StaleEdit);
    live = true;
    await expect(Promise.resolve().then(async () => edit.apply(await movedDraft((s) => void s.members.find((m) => m.id === D)!.devices.push(fresh.device))))).rejects.toBeInstanceOf(StaleEdit);
    await expect(Promise.resolve().then(async () => edit.apply(await movedDraft(withoutMember(D))))).rejects.toBeInstanceOf(StaleEdit);
  });
});
