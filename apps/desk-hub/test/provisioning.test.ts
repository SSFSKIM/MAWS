// Provisioning keys (docs/doperpowers/specs/2026-10-21-desk-provisioning-keys-design.md, M1) on the local runtime,
// through the stand-in for Access: an admin's reusable, revocable key; redemption through it under a prefixed name,
// after which the machine is an ordinary pending one; `uses` under a race; and a machine's own record and its own
// revocation, bound to its enrollment. The offline sweep is provisioning-sweep.test.ts's.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { serviceTokenName, type MachineSelf, type ProvisioningKeyRecord } from '../src/protocol/identity';
import { enroll, enrollmentToken, enrollThrough, MachineClient, provisioningKey, refusal, waitFor } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';

let hub: LocalHub;
beforeAll(async () => {
  hub = await startLocalHub();
  await hub.addMember('member@example.com', 'member');
});
afterAll(() => hub?.close());
afterEach(() => {
  hub.faults.length = 0;
});

const MEMBER = 'member@example.com';
const DAY = 86_400;
const redeem = (token: string, machine: string) => hub.fetchAs(null, '/machine/enroll', { body: { token, machine } });
const tokensNamed = (machine: string) => hub.standin.tokens().filter((t) => t.name === serviceTokenName(ORG, machine));
const isCreate = (request: Request) => request.method === 'POST' && new URL(request.url).pathname.endsWith('/access/service_tokens');
const isDelete = (request: Request) => request.method === 'DELETE';
const machines = async () => ((await (await hub.fetchAs(ADMIN, '/api/machines')).json()) as { machines: Array<{ name: string; state: string; client_id: string | null }> }).machines;
const keys = async (who = ADMIN) => ((await (await hub.fetchAs(who, '/api/provisioning-keys')).json()) as { keys: ProvisioningKeyRecord[] }).keys;
const keyOf = async (id: string) => (await keys()).find((k) => k.id === id)!;
const revokeKey = (id: string, who = ADMIN) => hub.fetchAs(who, `/api/provisioning-keys/${id}`, { method: 'DELETE' });
const self = (creds: { clientId: string; clientSecret: string }) => hub.fetchAs(creds, '/machine/enrollment');
const leave = (creds: { clientId: string; clientSecret: string }) => hub.fetchAs(creds, '/machine/enrollment', { method: 'DELETE' });
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
let keyCount = 0;
const newKey = (request: Partial<Parameters<typeof provisioningKey>[2]> = {}) => provisioningKey(hub, ADMIN, { label: `key ${++keyCount}`, prefix: 'dc-', ...request });

describe('a provisioning key', () => {
  it('is made by an admin, its secret answered once and kept nowhere in an answer after', async () => {
    const before = Date.now();
    const response = await hub.fetchAs(ADMIN, '/api/provisioning-keys', { body: { label: 'devcloud', prefix: 'dc-', max_uses: 5, offline_revoke_s: 21_600 } });
    expect(response.status).toBe(201);
    const { key, token } = (await response.json()) as { key: ProvisioningKeyRecord; token: string };
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(key).toMatchObject({ label: 'devcloud', prefix: 'dc-', max_uses: 5, uses: 0, offline_revoke_s: 21_600, revoked: null, machines: [] });
    expect(key.id).toMatch(/^[0-9a-f]{32}$/);
    expect(key.created_by).toMatch(/^[0-9a-f]{32}$/);
    // 90 days by default.
    expect(Date.parse(key.expires) - Date.parse(key.created)).toBe(90 * DAY * 1000);
    expect(Date.parse(key.created)).toBeGreaterThanOrEqual(before - 1000);

    const listed = await hub.fetchAs(MEMBER, '/api/provisioning-keys');
    expect(listed.status).toBe(200);
    const text = await listed.text();
    expect(text).not.toContain(token);
    expect((JSON.parse(text) as { keys: ProvisioningKeyRecord[] }).keys.find((k) => k.id === key.id)).toEqual(key);
    expect(JSON.stringify(await machines())).not.toContain(token);
  });

  it('is made and revoked by an admin only; a member lists them', async () => {
    expect(await refusal(await hub.fetchAs(MEMBER, '/api/provisioning-keys', { body: { label: 'x', prefix: 'dc-' } }))).toBe('403 not-admin');
    const { id } = await newKey();
    expect(await refusal(await revokeKey(id, MEMBER))).toBe('403 not-admin');
    expect((await keyOf(id)).revoked).toBeNull();
    expect((await keys(MEMBER)).some((k) => k.id === id)).toBe(true);
  });

  it.each([
    ['no body', undefined, 'label'],
    ['an empty label', { label: '', prefix: 'dc-' }, 'label'],
    ['a label of 101 characters', { label: 'l'.repeat(101), prefix: 'dc-' }, 'label'],
    ['a label that is not a string', { label: 7, prefix: 'dc-' }, 'label'],
    ['no prefix', { label: 'k' }, 'prefix'],
    ['the prefix hub', { label: 'k', prefix: 'HUB' }, 'prefix'],
    ['a prefix starting with a dash', { label: 'k', prefix: '-dc' }, 'prefix'],
    ['a prefix of 64 characters', { label: 'k', prefix: 'd'.repeat(64) }, 'prefix'],
    ['a ttl under an hour', { label: 'k', prefix: 'dc-', ttl_s: 3599 }, 'ttl_s'],
    ['a ttl over a year', { label: 'k', prefix: 'dc-', ttl_s: 31_536_001 }, 'ttl_s'],
    ['a ttl that is not whole', { label: 'k', prefix: 'dc-', ttl_s: 3600.5 }, 'ttl_s'],
    ['a null ttl', { label: 'k', prefix: 'dc-', ttl_s: null }, 'ttl_s'],
    ['no uses', { label: 'k', prefix: 'dc-', max_uses: 0 }, 'max_uses'],
    ['too many uses', { label: 'k', prefix: 'dc-', max_uses: 10_001 }, 'max_uses'],
    ['uses as a string', { label: 'k', prefix: 'dc-', max_uses: '3' }, 'max_uses'],
    ['an offline time under an hour', { label: 'k', prefix: 'dc-', offline_revoke_s: 3599 }, 'offline_revoke_s'],
    ['an offline time over 30 days', { label: 'k', prefix: 'dc-', offline_revoke_s: 2_592_001 }, 'offline_revoke_s'],
  ])('refuses %s, naming the field', async (_label, body, field) => {
    const response = await hub.fetchAs(ADMIN, '/api/provisioning-keys', { body: body ?? '' });
    expect(response.status).toBe(400);
    const answer = (await response.json()) as { error: string; message: string };
    expect(answer.error).toBe('bad-shape');
    expect(answer.message.startsWith(`${field} must be `)).toBe(true);
  });

  it('takes every bound at its edge', async () => {
    const low = await newKey({ label: 'l'.repeat(100), prefix: 'x', ttl_s: 3600, max_uses: 1, offline_revoke_s: 3600 });
    expect(Date.parse(low.key.expires) - Date.parse(low.key.created)).toBe(3600_000);
    const high = await newKey({ prefix: 'd'.repeat(63), ttl_s: 31_536_000, max_uses: 10_000, offline_revoke_s: 2_592_000 });
    expect(high.key).toMatchObject({ max_uses: 10_000, offline_revoke_s: 2_592_000 });
    expect((await newKey({ max_uses: null, offline_revoke_s: null })).key).toMatchObject({ max_uses: null, offline_revoke_s: null });
  });

  it('is revoked by an admin once: a second revocation answers the same and keeps the first time', async () => {
    const { id } = await newKey();
    const first = await revokeKey(id);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ revoked: id });
    const revoked = (await keyOf(id)).revoked;
    expect(revoked).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await revokeKey(id);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ revoked: id });
    expect((await keyOf(id)).revoked).toBe(revoked);
    expect(await refusal(await revokeKey('0'.repeat(32)))).toBe('404 unknown-key');
  });

  it('is listed by creation, revoked ones included', async () => {
    const a = await newKey();
    const b = await newKey();
    await revokeKey(a.id);
    const ids = (await keys()).map((k) => k.id);
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
  });
});

describe('redemption through a key', () => {
  it('enrolls a machine under the prefix, without regard to case: an ordinary pending machine, listed under the key', async () => {
    const { id, token } = await newKey();
    const response = await redeem(token, 'DC-Case-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { org: string; machine: string; client_id: string; client_secret: string };
    expect(body).toMatchObject({ org: ORG, machine: 'DC-Case-1' });
    expect(tokensNamed('DC-Case-1').map((t) => t.client_id)).toEqual([body.client_id]);
    expect((await machines()).find((m) => m.name === 'DC-Case-1')?.state).toBe('pending');
    expect(await keyOf(id)).toMatchObject({ uses: 1, machines: [{ name: 'DC-Case-1', state: 'pending' }] });

    // Its first authenticated request confirms it, as any machine's does.
    const machine = new MachineClient(hub, 'DC-Case-1', { clientId: body.client_id, clientSecret: body.client_secret });
    await machine.connect();
    expect((await keyOf(id)).machines).toEqual([{ name: 'DC-Case-1', state: 'active' }]);
    await machine.close();
  });

  it('refuses a name not under the prefix, binding nothing', async () => {
    const { id, token } = await newKey();
    const response = await redeem(token, 'build-3');
    expect(response.status).toBe(403);
    const answer = (await response.json()) as { error: string; message: string };
    expect(answer.error).toBe('prefix-mismatch');
    expect(answer.message).toContain('dc-');
    expect(tokensNamed('build-3')).toHaveLength(0);
    expect((await keyOf(id)).uses).toBe(0);
  });

  it('refuses through a revoked key before anything about the name, and through an expired one', async () => {
    const revoked = await newKey();
    await revokeKey(revoked.id);
    expect(await refusal(await redeem(revoked.token, 'dc-revoked-1'))).toBe('410 key-revoked');
    expect(await refusal(await redeem(revoked.token, 'not-under-it'))).toBe('410 key-revoked');

    const expired = await newKey();
    await hub.backdate({ key: { id: expired.id, expires: ago(1) } });
    expect(await refusal(await redeem(expired.token, 'dc-expired-1'))).toBe('410 key-expired');
    expect(await refusal(await redeem(expired.token, 'not-under-it'))).toBe('410 key-expired');
    expect(tokensNamed('dc-revoked-1')).toHaveLength(0);
    expect(tokensNamed('dc-expired-1')).toHaveLength(0);
  });

  it('still refuses a secret nobody issued, and a malformed body, as before', async () => {
    expect(await refusal(await redeem('B'.repeat(43), 'dc-ghost'))).toBe('404 unknown-token');
    expect(await refusal(await redeem((await newKey()).token, 'hub'))).toBe('400 bad-name');
  });

  it('refuses a name an active machine holds, or a pending one of a one-time token or of another key, binding nothing', async () => {
    const { id, token } = await newKey();
    const other = await newKey();
    const active = new MachineClient(hub, 'dc-held-1', await enrollThrough(hub, other.token, 'dc-held-1'));
    await active.connect();
    expect((await redeem(await enrollmentToken(hub, ADMIN), 'dc-held-2')).status).toBe(200);
    expect((await redeem(other.token, 'dc-held-3')).status).toBe(200);
    for (const name of ['dc-held-1', 'DC-HELD-2', 'dc-held-3']) {
      const response = await redeem(token, name);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: 'name-taken', message: expect.stringContaining('another name') });
    }
    expect(await keyOf(id)).toMatchObject({ uses: 0, machines: [] });
    // A one-time token never rotates a key's pending name either.
    expect(await refusal(await redeem(await enrollmentToken(hub, ADMIN), 'dc-held-3'))).toBe('409 name-taken');
    expect(tokensNamed('dc-held-3')).toHaveLength(1);
    await active.close();
  });

  it("rotates its own pending machine's credential when redeemed again under the name, counting no use", async () => {
    const { id, token } = await newKey();
    const lost = await enrollThrough(hub, token, 'dc-rotate-1');
    const again = await redeem(token, 'dc-rotate-1');
    expect(again.status).toBe(200);
    const fresh = (await again.json()) as { client_id: string; client_secret: string };
    expect(fresh.client_id).not.toBe(lost.clientId);
    expect(tokensNamed('dc-rotate-1').map((t) => t.client_id)).toEqual([fresh.client_id]);
    expect((await keyOf(id)).uses).toBe(1);
    // The lost answer's token is gone at Cloudflare: Access refuses it.
    expect(await refusal(await self(lost))).toBe('401 access');
    expect((await self({ clientId: fresh.client_id, clientSecret: fresh.client_secret })).status).toBe(200);
    // Once confirmed, the name is an active machine's, and redeeming under it is refused.
    expect(await refusal(await redeem(token, 'dc-rotate-1'))).toBe('409 name-taken');
  });

  it("is answered busy while its own pending machine's mint is in flight", async () => {
    const { token } = await newKey();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    hub.faults.push((request) => {
      if (!isCreate(request) || held) return null;
      held = true;
      return gate.then(() => null);
    });
    const first = redeem(token, 'dc-busy-1');
    await waitFor(() => (held ? true : undefined));
    expect(await refusal(await redeem(token, 'dc-busy-1'))).toBe('409 busy');
    release();
    expect((await first).status).toBe(200);
    expect(tokensNamed('dc-busy-1')).toHaveLength(1);
  });

  it('is refused once the key has made its max_uses enrollments; a rotation under it still completes', async () => {
    const { id, token } = await newKey({ max_uses: 1 });
    const first = await enrollThrough(hub, token, 'dc-cap-1');
    expect(await refusal(await redeem(token, 'dc-cap-2'))).toBe('410 key-exhausted');
    const rotated = await redeem(token, 'dc-cap-1');
    expect(rotated.status).toBe(200);
    expect(((await rotated.json()) as { client_id: string }).client_id).not.toBe(first.clientId);
    expect(await keyOf(id)).toMatchObject({ uses: 1, machines: [{ name: 'dc-cap-1', state: 'pending' }] });
    expect(tokensNamed('dc-cap-2')).toHaveLength(0);
  });

  it('counts uses under a race: two redemptions at once under a key of one use, one enrolls, one is refused', async () => {
    const { id, token } = await newKey({ max_uses: 1 });
    const answers = await Promise.all([redeem(token, 'dc-race-1'), redeem(token, 'dc-race-2')]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 410]);
    expect(await refusal(answers.find((a) => a.status === 410)!)).toBe('410 key-exhausted');
    const names = (await machines()).map((m) => m.name).filter((n) => n.startsWith('dc-race-'));
    expect(names).toHaveLength(1);
    expect(await keyOf(id)).toMatchObject({ uses: 1, machines: [{ name: names[0], state: 'pending' }] });
  });

  it("recovers from a lost mint: the orphan is found by name and deleted when the same redemption is retried", async () => {
    const { id, token } = await newKey();
    hub.faults.push((request) => (isCreate(request) ? 'lost' : null));
    expect(await refusal(await redeem(token, 'dc-lost-1'))).toBe('502 mint-failed');
    expect(tokensNamed('dc-lost-1')).toHaveLength(1);
    hub.faults.length = 0;
    const retried = await redeem(token, 'dc-lost-1');
    expect(retried.status).toBe(200);
    expect(tokensNamed('dc-lost-1').map((t) => t.client_id)).toEqual([((await retried.json()) as { client_id: string }).client_id]);
    expect((await keyOf(id)).uses).toBe(1);
  });

  it('makes a pending enrollment that expires as a token\'s does: the row gone, the name free, the token deleted, the use kept', async () => {
    const { id, token } = await newKey();
    const lapsed = await enrollThrough(hub, token, 'dc-lapse-1');
    expect(tokensNamed('dc-lapse-1')).toHaveLength(1);
    await hub.backdate({ enrollment: { machine: 'dc-lapse-1', expires: ago(1) } });
    await waitFor(() => (tokensNamed('dc-lapse-1').length === 0 ? true : undefined), 8000);
    expect((await machines()).map((m) => m.name)).not.toContain('dc-lapse-1');
    expect(await keyOf(id)).toMatchObject({ uses: 1, machines: [] });
    expect(await refusal(await self(lapsed))).toBe('401 access');
    // The name is free: the key enrolls it anew, a new use.
    await enrollThrough(hub, token, 'dc-lapse-1');
    expect((await keyOf(id)).uses).toBe(2);
  });

  it("revoking the key stops new enrollments only: its pending machine confirms, its active machine stays, neither rotates", async () => {
    const { id, token } = await newKey();
    const active = new MachineClient(hub, 'dc-stay-1', await enrollThrough(hub, token, 'dc-stay-1'));
    await active.connect();
    const pending = await enrollThrough(hub, token, 'dc-stay-2');
    expect((await revokeKey(id)).status).toBe(200);
    expect(await refusal(await redeem(token, 'dc-stay-3'))).toBe('410 key-revoked');
    // A pending machine of the revoked key cannot rotate (check 2 before check 6) …
    expect(await refusal(await redeem(token, 'dc-stay-2'))).toBe('410 key-revoked');
    // … and still confirms when it connects.
    const confirmed = await self(pending);
    expect(confirmed.status).toBe(200);
    expect(((await confirmed.json()) as MachineSelf).state).toBe('active');
    expect(active.isEnded).toBe(false);
    expect((await keyOf(id)).machines).toEqual([
      { name: 'dc-stay-1', state: 'active' },
      { name: 'dc-stay-2', state: 'active' },
    ]);
    await active.close();
  });
});

describe("a machine's own enrollment", () => {
  it('is answered to the machine, and its asking confirms a pending machine', async () => {
    const { token } = await newKey();
    const creds = await enrollThrough(hub, token, 'dc-self-1');
    const response = await self(creds);
    expect(response.status).toBe(200);
    const record = (await response.json()) as MachineSelf;
    expect(record).toEqual({ org: ORG, machine: 'dc-self-1', state: 'active', confirmed: expect.any(String) });
    expect((await machines()).find((m) => m.name === 'dc-self-1')?.state).toBe('active');
    // Asked again, it changes nothing.
    expect(await (await self(creds)).json()).toEqual(record);
  });

  it("is not a member's route", async () => {
    expect(await refusal(await hub.fetchAs(ADMIN, '/machine/enrollment'))).toBe('404 not-found');
    expect(await refusal(await hub.fetchAs(ADMIN, '/machine/enrollment', { method: 'DELETE' }))).toBe('404 not-found');
  });

  it('is revoked by the machine: its stream ends, its record and token go, its machine project retires; Access refuses it after', async () => {
    const { id, token } = await newKey();
    const machine = new MachineClient(hub, 'dc-leave-1', await enrollThrough(hub, token, 'dc-leave-1'));
    await machine.connect();
    const response = await leave(machine.creds);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: 'dc-leave-1' });
    await waitFor(() => (machine.isEnded ? true : undefined));
    expect((await machines()).map((m) => m.name)).not.toContain('dc-leave-1');
    expect(tokensNamed('dc-leave-1')).toHaveLength(0);
    const projects = ((await (await hub.fetchAs(ADMIN, '/api/projects')).json()) as { projects: Array<{ name: string; kind: string; retired: boolean }> }).projects;
    expect(projects.find((p) => p.kind === 'machine' && p.name === 'dc-leave-1')?.retired).toBe(true);
    expect((await keyOf(id)).machines).toEqual([]);
    // Its token deleted, Access answers the credential before the Worker sees it: a lost 200 asked again.
    expect(await refusal(await leave(machine.creds))).toBe('401 access');
    expect(await refusal(await self(machine.creds))).toBe('401 access');
  });

  it("refuses the credential not-enrolled from the Worker while its token's deletion is owed, and Access's 401 once it is through", async () => {
    const { token } = await newKey();
    const creds = await enrollThrough(hub, token, 'dc-leave-2');
    hub.faults.push((request) => (isDelete(request) ? 'fail' : null));
    expect((await leave(creds)).status).toBe(200);
    expect(tokensNamed('dc-leave-2')).toHaveLength(1);
    expect(await refusal(await self(creds))).toBe('403 not-enrolled');
    expect(await refusal(await leave(creds))).toBe('403 not-enrolled');
    hub.faults.length = 0;
    // The next redemption sweeps the orphan.
    await enroll(hub, ADMIN, 'dc-sweeper-2');
    await waitFor(() => (tokensNamed('dc-leave-2').length === 0 ? true : undefined));
    expect(await refusal(await self(creds))).toBe('401 access');
  });

  it('is bound to the enrollment: a revoke-and-replace of the name between resolve and leave leaves the replacement be', async () => {
    const { id, token } = await newKey();
    const first = new MachineClient(hub, 'dc-x', await enrollThrough(hub, token, 'dc-x'));
    await first.connect();
    await hub.holdNextLeave();
    const leaving = leave(first.creds);
    // The Worker resolved the first machine's credential; the Registry's revocation waits. Meanwhile an admin removes
    // the machine and the name is enrolled anew.
    await waitFor(async () => ((await hub.leaveHeld()) ? true : undefined));
    expect((await hub.fetchAs(ADMIN, '/api/machines/dc-x', { method: 'DELETE' })).status).toBe(200);
    const replacement = new MachineClient(hub, 'dc-x', await enrollThrough(hub, token, 'dc-x'));
    await replacement.connect();
    await hub.releaseLeave();
    const answered = await leaving;
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ revoked: 'dc-x' });
    // The replacement is untouched: its record, its token, its stream; and its credential still opens a stream.
    expect((await machines()).find((m) => m.name === 'dc-x')).toMatchObject({ state: 'active', client_id: replacement.creds.clientId });
    expect(tokensNamed('dc-x').map((t) => t.client_id)).toEqual([replacement.creds.clientId]);
    expect(replacement.isEnded).toBe(false);
    await replacement.close();
    await replacement.connect();
    expect(replacement.isEnded).toBe(false);
    expect((await keyOf(id)).machines).toEqual([{ name: 'dc-x', state: 'active' }]);
    await replacement.close();
    await first.close();
  });
});
