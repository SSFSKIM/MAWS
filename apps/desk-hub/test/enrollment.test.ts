// Enrollment (DX7) on the local runtime, through the stand-in for Access and its service-token API: a durable state
// machine in the Registry that recovers from every lost answer and failure the plan names. A v1 machine's credential is
// tried at its own enrollment's route (`GET /machine/enrollment`), the one it still has since O14 M5b took DX2's stream
// out of the hub; its first request there confirms its enrollment, as any of its requests would.
import { request as httpRequest } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { serviceTokenName, type MachineSelf } from '../src/protocol/identity';
import { enroll, enrollmentToken, refusal, type Credentials } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';

let hub: LocalHub;
beforeAll(async () => {
  hub = await startLocalHub();
});
afterAll(() => hub?.close());
afterEach(() => {
  hub.faults.length = 0;
});

const redeem = (token: string, machine: string) => hub.fetchAs(null, '/machine/enroll', { body: { token, machine } });
const tokensNamed = (machine: string) => hub.standin.tokens().filter((t) => t.name === serviceTokenName(ORG, machine));
const creds = (body: { client_id: string; client_secret: string }) => ({ clientId: body.client_id, clientSecret: body.client_secret });
const isCreate = (request: Request) => request.method === 'POST' && new URL(request.url).pathname.endsWith('/access/service_tokens');
const isDelete = (request: Request) => request.method === 'DELETE';
/** The machine's own record, its credential admitted: 200 or the test fails. */
async function admitted(credentials: Credentials): Promise<MachineSelf> {
  const response = await hub.fetchAs(credentials, '/machine/enrollment');
  expect(response.status).toBe(200);
  return (await response.json()) as MachineSelf;
}
const machines = async () => ((await (await hub.fetchAs(ADMIN, '/api/machines')).json()) as { machines: Array<{ name: string; state: string }> }).machines;

async function waitFor(check: () => boolean | Promise<boolean>, ms = 8000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('a machine enrolls', () => {
  it('redeems a one-time token for its own service token, which its first request confirms', async () => {
    const token = await enrollmentToken(hub, ADMIN);
    const response = await redeem(token, 'mini');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { org: string; machine: string; client_id: string; client_secret: string };
    expect(body).toMatchObject({ org: ORG, machine: 'mini' });
    expect(tokensNamed('mini').map((t) => t.client_id)).toEqual([body.client_id]);
    expect((await machines()).find((m) => m.name === 'mini')?.state).toBe('pending');

    expect(await admitted(creds(body))).toMatchObject({ machine: 'mini', state: 'active', confirmed: expect.any(String) as string });
    expect((await machines()).find((m) => m.name === 'mini')?.state).toBe('active');
  });

  it('is asked for by an admin only; the token is never shown again', async () => {
    const response = await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { enrollment: { state: string; machine: null; expires: string }; token: string };
    expect(body.enrollment).toMatchObject({ state: 'open', machine: null });
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await hub.fetchAs('stranger@example.com', '/api/enrollments', { body: {} })).status).toBe(403);
  });

  it('takes a JSON body of at most 64 KiB, counted in UTF-8 bytes', async () => {
    expect((await hub.fetchAs(ADMIN, '/api/enrollments', { body: { padding: 'x'.repeat(60_000) } })).status).toBe(201);
    // 30,000 characters, 90,000 bytes.
    const over = await hub.fetchAs(ADMIN, '/api/enrollments', { body: { padding: '한'.repeat(30_000) } });
    expect(over.status).toBe(400);
    expect(await over.json()).toMatchObject({ error: 'bad-shape' });
  });

  it('refuses an oversized body that stalls after its first byte within its drain deadline, not when the client gives up', async () => {
    const url = new URL('/api/enrollments', hub.url);
    const at = Date.now();
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        { host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'x-desk-standin-user': ADMIN, 'content-type': 'application/json', 'content-length': 100_000 } },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
          request.destroy();
        },
      );
      request.on('error', (error) => (Date.now() - at > 9000 ? reject(error) : undefined));
      // One byte of the promised 100,000, and the client stays open.
      request.write('{');
      setTimeout(() => {
        request.destroy();
        reject(new Error('no answer while the body stalled'));
      }, 10_000);
    });
    expect(status).toBe(400);
    expect(Date.now() - at).toBeLessThan(5000);
  });

  it('refuses a token it never issued, and a body that is not a redemption', async () => {
    expect((await redeem('A'.repeat(43), 'ghost')).status).toBe(404);
    expect((await hub.fetchAs(null, '/machine/enroll', { body: 'not json' })).status).toBe(400);
    expect((await redeem(await enrollmentToken(hub, ADMIN), 'hub')).status).toBe(400);
  });
});

describe('enrollment refuses', () => {
  it('a name already enrolled in the org, without regard to case, leaving the token free for another name', async () => {
    await enroll(hub, ADMIN, 'taken');
    const token = await enrollmentToken(hub, ADMIN);
    const refused = await redeem(token, 'TAKEN');
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: 'name-taken', message: expect.stringContaining('another name') });
    expect((await redeem(token, 'taken-2')).status).toBe(200);
  });

  it('a confirmed token, redeemed again', async () => {
    const token = await enrollmentToken(hub, ADMIN);
    const body = (await (await redeem(token, 'confirmed-1')).json()) as { client_id: string; client_secret: string };
    await admitted(creds(body));
    const again = await redeem(token, 'confirmed-1');
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'confirmed' });
    expect(tokensNamed('confirmed-1')).toHaveLength(1);
  });

  it('a used token offered for a different machine', async () => {
    const token = await enrollmentToken(hub, ADMIN);
    expect((await redeem(token, 'alpha')).status).toBe(200);
    const other = await redeem(token, 'beta');
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ error: 'token-used' });
    expect(tokensNamed('beta')).toHaveLength(0);
  });

  it("a revoked machine's credential, at once", async () => {
    const credentials = await enroll(hub, ADMIN, 'revoked-1');
    await admitted(credentials);
    const revoked = await hub.fetchAs(ADMIN, '/api/machines/revoked-1', { method: 'DELETE' });
    expect(revoked.status).toBe(200);
    expect(tokensNamed('revoked-1')).toHaveLength(0);
    // Its token deleted, Access refuses it before the Worker sees it, with its own page.
    expect(await refusal(await hub.fetchAs(credentials, '/machine/enrollment'))).toBe('401 access');
    expect((await machines()).map((m) => m.name)).not.toContain('revoked-1');
  });

  it('two removals of one machine at once, the name enrolled anew between them: the later one leaves the new machine be', async () => {
    const project = '6a1c0a8e-3b2d-4c5e-9fa1-000000000000';
    await hub.addProjects(1, '6a1c0a8e-3b2d-4c5e-9fa1');
    await admitted(await enroll(hub, ADMIN, 'overlap-1'));
    // The first removal's answer from the machine's object is held; the second removes it meanwhile.
    await hub.faultNextRevoke('overlap-1', 'hold');
    const first = hub.fetchAs(ADMIN, '/api/machines/overlap-1', { method: 'DELETE' });
    await waitFor(() => hub.revokeHeld('overlap-1'));
    expect((await hub.fetchAs(ADMIN, '/api/machines/overlap-1', { method: 'DELETE' })).status).toBe(200);
    expect((await machines()).map((m) => m.name)).not.toContain('overlap-1');
    // Enrolled again under the name, it is a project's archive machine.
    const again = await enroll(hub, ADMIN, 'overlap-1');
    await admitted(again);
    expect((await hub.fetchAs(ADMIN, `/api/projects/${project}/archive`, { method: 'PUT', body: { machine: 'overlap-1' } })).status).toBe(200);
    await waitFor(() => tokensNamed('overlap-1').length === 1);

    await hub.releaseRevoke('overlap-1');
    expect((await first).status).toBe(200);
    expect((await machines()).find((m) => m.name === 'overlap-1')?.state).toBe('active');
    expect(tokensNamed('overlap-1').map((t) => t.client_id)).toEqual([again.clientId]);
    const projects = ((await (await hub.fetchAs(ADMIN, '/api/projects')).json()) as { projects: Array<{ id: string; archive_machine: string | null }> }).projects;
    expect(projects.find((p) => p.id === project)?.archive_machine).toBe('overlap-1');
    await admitted(again);
  });

  it('a revoked machine whose service token outlived the revocation: the hub no longer knows it', async () => {
    const creds1 = await enroll(hub, ADMIN, 'revoked-2');
    await admitted(creds1);
    hub.faults.push((request) => (isDelete(request) ? 'fail' : null));
    expect((await hub.fetchAs(ADMIN, '/api/machines/revoked-2', { method: 'DELETE' })).status).toBe(200);
    // Access still admits the token (the stand-in holds it); the hub refuses it.
    expect(tokensNamed('revoked-2')).toHaveLength(1);
    const response = await hub.fetchAs(creds1, '/machine/enrollment');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'not-enrolled' });
    hub.faults.length = 0;
    // The orphan is deleted by name once the API answers again (the next enrollment sweeps orphans); Access refuses it then.
    await enroll(hub, ADMIN, 'sweeper');
    await waitFor(() => tokensNamed('revoked-2').length === 0);
    expect(await refusal(await hub.fetchAs(creds1, '/machine/enrollment'))).toBe('401 access');
  });
});

describe('enrollment recovers', () => {
  it('from two redemptions of one token at once: one mints, the other is told to retry, one token exists', async () => {
    const token = await enrollmentToken(hub, ADMIN);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    hub.faults.push((request) => {
      if (!isCreate(request) || held) return null;
      held = true;
      // Hold the first mint until the second redemption has been answered.
      return gate.then(() => null);
    });
    const first = redeem(token, 'twice');
    await waitFor(() => held);
    const second = await redeem(token, 'twice');
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: 'busy' });
    release();
    const answered = await first;
    expect(answered.status).toBe(200);
    const body = (await answered.json()) as { client_id: string; client_secret: string };
    expect(tokensNamed('twice').map((t) => t.client_id)).toEqual([body.client_id]);
    await admitted(creds(body));
  });

  it('from a failure of the service-token API: nothing is minted, and the same redemption succeeds after', async () => {
    const token = await enrollmentToken(hub, ADMIN);
    hub.faults.push((request) => (isCreate(request) ? Response.json({ success: false, errors: [{ code: 10000, message: 'down' }] }, { status: 500 }) : null));
    const failed = await redeem(token, 'api-down');
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ error: 'mint-failed' });
    expect(tokensNamed('api-down')).toHaveLength(0);
    hub.faults.length = 0;
    const retried = await redeem(token, 'api-down');
    expect(retried.status).toBe(200);
    expect(tokensNamed('api-down')).toHaveLength(1);
  });

  it('from a mint whose answer was lost: the orphan is found by name and deleted before the next mint', async () => {
    const token = await enrollmentToken(hub, ADMIN);
    hub.faults.push((request) => (isCreate(request) ? 'lost' : null));
    expect((await redeem(token, 'lost-mint')).status).toBe(502);
    expect(tokensNamed('lost-mint')).toHaveLength(1); // minted at Cloudflare, unknown to the hub
    hub.faults.length = 0;
    const retried = await redeem(token, 'lost-mint');
    expect(retried.status).toBe(200);
    const body = (await retried.json()) as { client_id: string };
    expect(tokensNamed('lost-mint').map((t) => t.client_id)).toEqual([body.client_id]);
  });

  it('from a redemption whose answer was lost: redeeming again rotates the credential', async () => {
    const token = await enrollmentToken(hub, ADMIN);
    const lost = (await (await redeem(token, 'rotated')).json()) as { client_id: string; client_secret: string };
    const again = await redeem(token, 'rotated');
    expect(again.status).toBe(200);
    const fresh = (await again.json()) as { client_id: string; client_secret: string };
    expect(fresh.client_id).not.toBe(lost.client_id);
    expect(tokensNamed('rotated').map((t) => t.client_id)).toEqual([fresh.client_id]);
    expect(await refusal(await hub.fetchAs(creds(lost), '/machine/enrollment'))).toBe('401 access');
    await admitted(creds(fresh));
  });

  it("from a revocation's cleanup racing a new enrollment of the name: the cleanup never deletes the new token", async () => {
    await admitted(await enroll(hub, ADMIN, 'reused'));
    const tokenName = serviceTokenName(ORG, 'reused');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    hub.faults.push((request) => {
      if (held || request.method !== 'GET' || new URL(request.url).searchParams.get('name') !== tokenName) return null;
      held = true;
      // The revocation's cleanup lists the name's tokens; its listing waits here.
      return gate.then(() => null);
    });
    const revocation = hub.fetchAs(ADMIN, '/api/machines/reused', { method: 'DELETE' });
    await waitFor(() => held);
    const redeemed = redeem(await enrollmentToken(hub, ADMIN), 'reused');
    // Give the redemption the time to mint and answer, as it could before cleanup and mint were one queue per name.
    await Promise.race([redeemed, new Promise((resolve) => setTimeout(resolve, 1000))]);
    release();
    expect((await revocation).status).toBe(200);
    const answered = await redeemed;
    expect(answered.status).toBe(200);
    const body = (await answered.json()) as { client_id: string; client_secret: string };
    expect(tokensNamed('reused').map((t) => t.client_id)).toEqual([body.client_id]);
    await admitted(creds(body));
  });

  it('from a pending enrollment expiring: its token is deleted, the name released, the token spent', async () => {
    const token = await enrollmentToken(hub, ADMIN, 1);
    const body = (await (await redeem(token, 'lapsed')).json()) as { client_id: string; client_secret: string };
    expect(tokensNamed('lapsed')).toHaveLength(1);
    await waitFor(() => tokensNamed('lapsed').length === 0);
    expect((await machines()).map((m) => m.name)).not.toContain('lapsed');
    expect(await refusal(await hub.fetchAs(creds(body), '/machine/enrollment'))).toBe('401 access');
    const late = await redeem(token, 'lapsed');
    expect(late.status).toBe(410);
    expect(await late.json()).toMatchObject({ error: 'expired' });
    expect((await redeem(await enrollmentToken(hub, ADMIN), 'lapsed')).status).toBe(200);
  });

  it('from an open token expiring unredeemed', async () => {
    const token = await enrollmentToken(hub, ADMIN, 1);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await redeem(token, 'never')).status).toBe(410);
  });

  it('across a restart of the runtime: a pending enrollment is still redeemable, a confirmed machine still admitted', async () => {
    const token = await enrollmentToken(hub, ADMIN);
    expect((await redeem(token, 'restarted')).status).toBe(200);
    const confirmed = await enroll(hub, ADMIN, 'confirmed-before');
    await admitted(confirmed);
    await hub.restart();
    const again = await redeem(token, 'restarted');
    expect(again.status).toBe(200);
    expect(tokensNamed('restarted')).toHaveLength(1);
    expect(await admitted(confirmed)).toMatchObject({ machine: 'confirmed-before', state: 'active' });
  });
});
