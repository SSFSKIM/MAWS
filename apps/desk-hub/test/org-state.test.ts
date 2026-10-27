// The Registry's org-state chain (O11 M3; RL §5.2): a genesis accepted once, from the configured admin, keeping the
// bootstrap member's id; successors only on the head, verified by the protocol package against the stored head and the
// root transitions held; and the same head and chain served to members and machines.
import { generateSigningKey, NO_CERTIFICATES, type OrgState, type RootTransition, type Signed, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgStateView } from '../src/protocol/identity';
import { enroll } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub, type Who } from './support/local';
import { endorsed, genesis, memberId, newDevice, next, revokedDevice, rootKid, signedBy, transition, type TestDevice } from './support/org';

let hub: LocalHub;
/** The bootstrap admin's member id, as `ensureOrg` made it. */
let A: string;
let a1: TestDevice;
let recovery: SigningKey;
/** The head as the suite last had it accepted. */
let head: SignedOrgState;

beforeAll(async () => {
  hub = await startLocalHub();
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
});
afterAll(() => hub?.close());

/** `<status> <error>` for a refusal, `<status>` for an acceptance. */
async function outcome(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: string };
  return body.error === undefined ? String(response.status) : `${response.status} ${body.error}`;
}
const submit = async (s: SignedOrgState, who: Who = ADMIN) => outcome(await hub.fetchAs(who, '/api/org/state', { body: s }));
const submitTransition = async (t: Signed<RootTransition>, who: Who = ADMIN) => outcome(await hub.fetchAs(who, '/api/org/transitions', { body: t }));
const view = async (query = '', who: Who = ADMIN, path = '/api/org/state') => {
  const response = await hub.fetchAs(who, `${path}${query}`);
  if (response.status !== 200) throw new Error(`GET ${path}${query}: ${response.status} ${await response.text()}`);
  return (await response.json()) as OrgStateView;
};
/** Signs `state` by `devices` and has it accepted; the suite's head moves to it. */
async function accept(state: OrgState, ...devices: TestDevice[]): Promise<SignedOrgState> {
  const s = await signedBy(state, ...devices);
  expect(await submit(s)).toBe('201');
  head = s;
  return s;
}

describe('before any state', () => {
  it('serves no head, and the bootstrap admin is admitted as today', async () => {
    expect(await view()).toEqual({ head: null, transitions: [], certificates: NO_CERTIFICATES });
    const me = (await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { role: string } };
    expect(me.member.role).toBe('admin');
  });
});

describe('a genesis', () => {
  it('is refused from anyone but the configured admin', async () => {
    await hub.addMember('other@example.com', 'admin');
    expect(await submit(await signedBy(await genesis(ORG, A, ADMIN, a1, recovery), a1), 'other@example.com')).toBe('403 not-org-admin');
  });

  it('is refused when the configured admin is not the bootstrap member by id', async () => {
    expect(await submit(await signedBy(await genesis(ORG, memberId(), ADMIN, a1, recovery), a1))).toBe('409 genesis-member');
    expect(await submit(await signedBy(await genesis(ORG, A, 'someone@example.com', a1, recovery), a1))).toBe('409 genesis-member');
  });

  it('is refused for another org, or unsigned by its own root', async () => {
    expect(await submit(await signedBy(await genesis('another-org', A, ADMIN, a1, recovery), a1))).toBe('409 bad-link');
    const stranger = await newDevice('stranger');
    expect(await submit(await signedBy(await genesis(ORG, A, ADMIN, a1, recovery), stranger))).toBe('409 not-root-signed');
    expect(await outcome(await hub.fetchAs(ADMIN, '/api/org/state', { body: 'not json' }))).toBe('400 bad-shape');
    expect(await view()).toMatchObject({ head: null });
  });

  it('is accepted once, keeping the bootstrap id, and a second is refused', async () => {
    // The admin's email in any case: Access's identity is lowercased, and so is the projection.
    const g = await genesis(ORG, A, ADMIN.toUpperCase(), a1, recovery);
    await accept(g, a1);
    expect((await view()).head).toEqual(head);
    const me = (await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string; role: string; email: string } };
    expect(me.member).toMatchObject({ id: A, role: 'admin', email: ADMIN });
    // The seam's member is not in the state: the projection no longer admits it.
    expect((await hub.fetchAs('other@example.com', '/api/me')).status).toBe(403);
    expect(await submit(await signedBy(await genesis(ORG, A, ADMIN, a1, recovery), a1))).toBe('409 not-head');
  });
});

describe('a successor', () => {
  let genesisHead: SignedOrgState;

  it('is accepted only on the head: a fork is refused not-head, an older version rollback', async () => {
    genesisHead = head;
    const fork = await signedBy(await next(head, (s) => s.projects.push({ id: 'fork', name: 'Fork' })), a1);
    await accept(await next(head, (s) => s.projects.push({ id: 'p1', name: 'One' })), a1);
    expect(await submit(fork)).toBe('409 not-head');
    expect(await submit(await signedBy(await next(await next(head)), a1))).toBe('409 not-head');
    expect(await submit(genesisHead)).toBe('409 rollback');
    expect((await view()).head).toEqual(head);
  });

  it('is refused with the package code when its signature fails, and nothing is kept', async () => {
    const s = await signedBy(await next(head), a1);
    s.state.projects.push({ id: 'smuggled', name: 'Smuggled' });
    expect(await submit(s)).toBe('409 bad-signature');
    expect(await submit({ ...s, sigs: [] } as unknown as SignedOrgState)).toBe('409 malformed');
    expect((await view()).head).toEqual(head);
  });

  it('that loses a race to the head is refused not-head', async () => {
    const [x, y] = await Promise.all([1, 2].map(async (n) => signedBy(await next(head, (s) => s.projects.push({ id: `race-${n}`, name: 'Race' })), a1)));
    const outcomes = await Promise.all([submit(x), submit(y)]);
    expect(outcomes.sort()).toEqual(['201', '409 not-head']);
    head = (await view()).head!;
    expect([x, y]).toContainEqual(head);
  });

  it('is served in the chain after a version', async () => {
    const all = await view('?since=0');
    expect(all.chain!.map((s) => s.state.version)).toEqual([1, 2, 3]);
    expect(all.chain![0]).toEqual(genesisHead);
    expect(all.more).toBe(false);
    expect((await view(`?since=${head.state.version}`)).chain).toEqual([]);
    expect((await view('?since=2')).chain).toEqual([head]);
    for (const bad of ['?since=-1', '?since=x', '?since=1.5']) expect((await hub.fetchAs(ADMIN, `/api/org/state${bad}`)).status).toBe(400);
  });
});

describe('admins and their devices', () => {
  it('refuses a successor signed by a removed admin’s key', async () => {
    const C = memberId();
    const c1 = await newDevice('c1');
    const kid = await rootKid(c1);
    await accept(
      await next(head, (s) => {
        s.members.push({ id: C, email: 'c@example.com', role: 'admin', devices: [c1.device] });
        s.root.keys.push(kid);
      }),
      a1,
    );
    // While C is an admin, C's key signs.
    await accept(await next(head, (s) => s.projects.push({ id: 'by-c-admin', name: 'C' })), c1);
    // C's device leaves with C: its keys are revoked in the same step (RL DL 24).
    const revoked = await revokedDevice(C, c1.device);
    await accept(
      await next(head, (s) => {
        s.members = s.members.filter((m) => m.id !== C);
        s.root.keys = s.root.keys.filter((k) => k !== kid);
        s.revoked.push(...revoked);
      }),
      a1,
    );
    expect(await submit(await signedBy(await next(head, (s) => s.projects.push({ id: 'by-c', name: 'C' })), c1))).toBe('409 not-root-signed');
  });

  it('accepts a second device only with the member’s endorsement and an admin’s signature', async () => {
    const B = memberId();
    const b1 = await newDevice('b1');
    await accept(await next(head, (s) => s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] })), a1);
    const b2 = await newDevice('b2');
    const add = (device: TestDevice) => next(head, (s) => s.members.find((m) => m.id === B)!.devices.push(device.device));
    expect(await submit(await signedBy(await add(b2), a1))).toBe('409 endorsement-missing');
    expect(await submit(await signedBy(await add(await endorsed(ORG, B, b2, a1)), a1))).toBe('409 unknown-signer');
    const b2Endorsed = await endorsed(ORG, B, b2, b1);
    expect(await submit(await signedBy(await add(b2Endorsed), b1))).toBe('409 not-root-signed');
    await accept(await add(b2Endorsed), a1);
    // The admin's own second device needs only one of the admin's devices.
    const a2 = await endorsed(ORG, A, await newDevice('a2'), a1);
    await accept(await next(head, (s) => s.members.find((m) => m.id === A)!.devices.push(a2.device)), a1);
  });
});

describe('a root transition', () => {
  let recovered: TestDevice;
  let before: SignedOrgState;

  it('is stored beside the chain, and the successor after it verifies against the new root', async () => {
    before = head;
    recovered = await newDevice('a-recovered');
    const t = await transition(head, [recovered], recovery);
    expect(await submitTransition(t)).toBe('201');
    expect(await submitTransition(t)).toBe('201');
    expect((await view()).transitions).toEqual([t]);
    // The old root set no longer signs.
    expect(await submit(await signedBy(await next(head, (s) => s.projects.push({ id: 'old-root', name: 'Old' })), a1))).toBe('409 not-root-signed');
    const kid = await rootKid(recovered);
    await accept(
      await next(head, (s) => {
        s.members.find((m) => m.id === A)!.devices.push(recovered.device);
        s.root.keys = [kid];
      }),
      recovered,
    );
  });

  it('refuses rollback after it, and a transition that is stale or not the recovery key’s', async () => {
    expect(await submit(before)).toBe('409 rollback');
    expect(await submitTransition(await transition(before, [recovered], recovery))).toBe('409 rollback');
    expect(await submitTransition(await transition(head, [recovered], await generateSigningKey()))).toBe('409 unknown-signer');
    expect(await submit(await signedBy(await next(head, (s) => s.projects.push({ id: 'after', name: 'After' })), recovered))).toBe('201');
  });
});

describe('a machine', () => {
  it('reads the same head, chain, transitions and certificates as a member, and each only on its own route', async () => {
    const credentials = await enroll(hub, ADMIN, 'reader');
    head = (await view()).head!;
    expect(await view('', credentials, '/machine/org/state')).toEqual(await view());
    expect(await view('?since=3', credentials, '/machine/org/state')).toEqual(await view('?since=3'));
    expect((await hub.fetchAs(credentials, '/api/org/state')).status).toBe(404);
    expect((await hub.fetchAs(ADMIN, '/machine/org/state')).status).toBe(404);
  });
});
