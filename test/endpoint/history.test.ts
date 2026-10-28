// History re-attestation from the endpoint (O14 M4, `mawsd endpoint attest-history`) against desk-hub's local runner: a
// Mac wrote two projects on DX2 under its current name and a former one, then cut over (re-enrolled in place, listed);
// its endpoint attests each of its writers against the hub's inventory, skipping a writer with an event whose code fails,
// changes nothing when run again, and `--check` tells `verified`, `mismatch`, `missing` and `uncovered` apart. The hub's
// altered or withheld answers come through the endpoint's own `fetch`.
import { base64urlEncode, type HistoryAttestations, type HistoryLogPage } from 'org-protocol';
import { GENERATION_HEADER, importOrgKey, seal } from 'desk-hub/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { fakeServices, type FakeServices } from './fake-services';
import { LOCAL_ORG, startLocalHub, type LocalHub, type Member } from './local-hub';

let hub: LocalHub;
let member: Member;
const started: Array<{ endpoint: Endpoint; services: FakeServices }> = [];

const ORG_KEY = new Uint8Array(32).fill(7);
const P1 = '1a0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const P2 = '2a0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const P3 = '3a0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const P4 = '4a0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const S = 'e0ad139c-18bc-45bd-9489-be8653145f80';
const writer = (name: string) => `${name}/${S}`;

/** A phase-1 `say` under `name`'s writer in `project`, sealed under the org key (or a code that fails, when `forged`). */
async function say(project: string, name: string, seq: number, forged = false) {
  const event = { ts: `2026-10-15T08:00:${String(seq).padStart(2, '0')}.000Z`, writer: writer(name), seq, kind: 'say', from: name, to: '*', text: `${name} says ${seq}` };
  const sealed = await seal(await importOrgKey(ORG_KEY), 'log', project, event);
  return forged ? { ...sealed, mac: { ...sealed.mac, value: base64urlEncode(new Uint8Array(32).fill(1)) } } : sealed;
}

/**
 * A DX2 machine as sminos was in phase 1: redeems a one-time token under `name`, opens its stream, and for each project
 * says `hello` and uploads its events once the hub's `have` came back. The stream is closed after.
 */
async function phaseOne(name: string, writes: Record<string, unknown[]>): Promise<void> {
  const token = await hub.person().enrollmentToken();
  const redeemed = await fetch(`${hub.url}/machine/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, machine: name }) });
  const { client_id, client_secret } = (await redeemed.json()) as { client_id: string; client_secret: string };
  const headers = { 'CF-Access-Client-Id': client_id, 'CF-Access-Client-Secret': client_secret };
  const controller = new AbortController();
  const stream = await fetch(`${hub.url}/machine/stream`, { headers, signal: controller.signal });
  const reader = stream.body!.getReader();
  const frames: Array<Record<string, unknown>> = [];
  let buffer = '';
  const until = async (match: (f: Record<string, unknown>) => boolean) => {
    for (let found = frames.find(match); found === undefined; found = frames.find(match)) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`${name}'s stream ended`);
      buffer += new TextDecoder().decode(value);
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const data = /^data: (.*)$/m.exec(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (data) frames.push(JSON.parse(data[1]) as Record<string, unknown>);
      }
    }
    return frames.find(match)!;
  };
  const generation = String((await until((f) => f.t === 'welcome')).generation);
  const post = async (frame: unknown) => {
    const response = await fetch(`${hub.url}/machine/frames`, { method: 'POST', headers: { ...headers, 'content-type': 'application/x-ndjson', [GENERATION_HEADER]: generation }, body: JSON.stringify(frame) });
    if (response.status !== 200) throw new Error(`${name}: ${response.status} ${await response.text()}`);
  };
  for (const [project, events] of Object.entries(writes)) {
    await post({ t: 'hello', project, name: `project ${project.slice(0, 2)}`, have: {} });
    await until((f) => f.t === 'have' && f.project === project);
    await post({ t: 'events', project, events });
  }
  controller.abort();
}

/** What the hub answers on its way to the endpoint, for a test to alter, and where it reads it from (`redirect`). */
let rewrite: ((path: string, body: unknown) => unknown) | null = null;
let redirect: ((path: string) => string) | null = null;
const posts: string[] = [];
const through: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (init?.method === 'POST' && url.pathname.endsWith('/attestations')) posts.push(url.pathname);
  if (redirect !== null) url.pathname = redirect(url.pathname);
  const response = await fetch(url, init);
  if (rewrite === null || response.status !== 200 || !url.pathname.startsWith('/machine/projects/')) return response;
  const body = rewrite(url.pathname, await response.json());
  return Response.json(body, { status: 200 });
};

async function endpointOn(): Promise<Endpoint> {
  const services = fakeServices();
  const endpoint = createEndpoint({ fetch: through, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))) });
  await endpoint.start(services);
  started.push({ endpoint, services });
  return endpoint;
}

let mini: Endpoint;

beforeAll(async () => {
  hub = await startLocalHub();
  member = await hub.admin();
  // Phase 1: the Mac as `mini` and, before a rename, as `oldmini`; `other` writes a project of its own.
  await phaseOne('mini', { [P1]: [await say(P1, 'mini', 1), await say(P1, 'mini', 2), await say(P1, 'mini', 3)] });
  await phaseOne('oldmini', { [P1]: [await say(P1, 'oldmini', 1), await say(P1, 'oldmini', 2)], [P2]: [await say(P2, 'oldmini', 1), await say(P2, 'oldmini', 2, true)], [P4]: [await say(P4, 'oldmini', 1)] });
  await phaseOne('other', { [P3]: [await say(P3, 'other', 1)] });
  // The cutover: `mini` re-enrolled in place, listed, and holding the legacy key sminos handed over.
  mini = await endpointOn();
  const issued = await member.code('mini');
  const enrolling = mini.cli('enroll', ['--name', 'mini', '--replace', '--wait', '30'], issued.code);
  await member.awaitPosted(issued.enrollment);
  await member.list(issued.enrollment, issued.k);
  expect((await enrolling).code).toBe(0);
  mini.parts!.state.setLegacy({ org: LOCAL_ORG, key: base64urlEncode(ORG_KEY) });
}, 180_000);
afterAll(async () => {
  for (const { endpoint, services } of started) {
    await endpoint.stop();
    services.cleanup();
  }
  await hub?.stop();
});

const lines = (out: string) => out.split('\n');

describe('mawsd endpoint attest-history', () => {
  it('signs nothing over a position the hub serves twice, a forged event beside the genuine one', async () => {
    // A second event at seq 1 under a code that verifies (the hub holds sealed events), served after the genuine one.
    const forged = { ts: '2026-10-15T08:00:01.000Z', writer: writer('oldmini'), seq: 1, kind: 'say', from: 'oldmini', to: '*', text: 'never said' };
    const sealed = await seal(await importOrgKey(ORG_KEY), 'log', P4, forged);
    rewrite = (path, body) => (path.endsWith('/log') ? { ...(body as HistoryLogPage), events: [...(body as HistoryLogPage).events, sealed] } : body);
    try {
      const result = await mini.cli('attest-history', ['--former', 'oldmini', '--project', P4]);
      expect(result.code).toBe(1);
      expect(lines(result.out)).toContain(`skipped ${P4}/${writer('oldmini')}: seq 1 is served twice`);
      expect(posts).toEqual([]);
    } finally {
      rewrite = null;
    }
  });

  it('attests every writer of the inventory under the current and the claimed former name, skipping one whose code fails', async () => {
    const result = await mini.cli('attest-history', ['--former', 'oldmini']);
    expect(result.code).toBe(1);
    expect(lines(result.out)).toEqual(
      expect.arrayContaining([
        `attested ${P1}/${writer('mini')} through 3`,
        `attested ${P1}/${writer('oldmini')} through 2`,
        `skipped ${P2}/${writer('oldmini')}: seq 2 fails its code`,
      ]),
    );
    expect(result.out).not.toContain(P3);
    expect(lines(result.out)).toContain(`attested ${P4}/${writer('oldmini')} through 1`);
    expect(posts).toHaveLength(3);
  });

  it('changes nothing when run again', async () => {
    posts.length = 0;
    const result = await mini.cli('attest-history', ['--former', 'oldmini', '--project', P1, '--json']);
    expect(result.code).toBe(0);
    const view = JSON.parse(result.out) as { names: string[]; writers: Array<{ project: string; writer: string; outcome: string; upTo: number }> };
    expect(view.names).toEqual(['mini', 'oldmini']);
    expect(view.writers).toEqual([
      { project: P1, writer: writer('mini'), outcome: 'already', upTo: 3 },
      { project: P1, writer: writer('oldmini'), outcome: 'already', upTo: 2 },
    ]);
    expect(posts).toEqual([]);
  });

  it('refuses a former name that is no machine name, and an endpoint not enrolled', async () => {
    expect((await mini.cli('attest-history', ['--former', 'hub'])).code).toBe(1);
    const fresh = await endpointOn();
    const unenrolled = await fresh.cli('attest-history', []);
    expect(unenrolled.code).toBe(1);
    expect(unenrolled.out).toMatch(/not enrolled/);
  });
});

describe('mawsd endpoint attest-history --check', () => {
  it('prints verified for each covered writer, and exits 0 only when every inventory writer is', async () => {
    const one = await mini.cli('attest-history', ['--check', '--former', 'oldmini', '--project', P1]);
    expect(one.code).toBe(0);
    expect(lines(one.out)).toEqual(expect.arrayContaining([`verified ${P1}/${writer('mini')} through 3`, `verified ${P1}/${writer('oldmini')} through 2`]));
    const all = await mini.cli('attest-history', ['--check', '--former', 'oldmini']);
    expect(all.code).toBe(1);
    expect(lines(all.out)).toEqual(expect.arrayContaining([`uncovered ${P2}/${writer('oldmini')}: no attestation reaches seq 2`]));
  });

  it('needs no legacy key', async () => {
    const held = mini.parts!.state.legacyKey!;
    mini.parts!.state.removeLegacy();
    try {
      expect((await mini.cli('attest-history', ['--check', '--former', 'oldmini', '--project', P1])).code).toBe(0);
      const attest = await mini.cli('attest-history', ['--former', 'oldmini', '--project', P1]);
      expect(attest.code).toBe(1);
      expect(attest.out).toMatch(/legacy/);
      // At a head that retired the key (M5a's tombstone, its bytes kept) nothing is attested; the check still runs.
      mini.parts!.state.setLegacy({ ...held, retired: new Date().toISOString() });
      const retired = await mini.cli('attest-history', ['--former', 'oldmini', '--project', P1]);
      expect(retired.code).toBe(1);
      expect(retired.out).toMatch(/retired the legacy org key/);
      expect((await mini.cli('attest-history', ['--check', '--former', 'oldmini', '--project', P1])).code).toBe(0);
    } finally {
      mini.parts!.state.setLegacy(held);
    }
  });

  const check = async (alter: (path: string, body: unknown) => unknown) => {
    rewrite = alter;
    try {
      return await mini.cli('attest-history', ['--check', '--project', P1]);
    } finally {
      rewrite = null;
    }
  };

  it('prints mismatch when the hub serves an event that is not the one attested', async () => {
    const result = await check((path, body) => {
      if (!path.endsWith('/log')) return body;
      const page = body as HistoryLogPage;
      return { ...page, events: page.events.map((e) => (e.seq === 2 ? { ...e, text: 'not what was said' } : e)) };
    });
    expect(result.code).toBe(1);
    expect(lines(result.out)).toContain(`mismatch ${P1}/${writer('mini')}: digest`);
  });

  it('prints missing when the hub no longer serves the events an attestation covers', async () => {
    const result = await check((path, body) => (path.endsWith('/log') ? { ...(body as HistoryLogPage), events: (body as HistoryLogPage).events.filter((e) => e.seq < 3) } : body));
    expect(result.code).toBe(1);
    expect(lines(result.out)).toContain(`missing ${P1}/${writer('mini')}: the hub serves its events short of seq 3`);
  });

  it('prints uncovered when a writer of the inventory has no attestation', async () => {
    const result = await check((path, body) => (path.endsWith('/attestations') ? { records: (body as HistoryAttestations).records.filter((r) => r.body.writer !== writer('mini')) } : body));
    expect(result.code).toBe(1);
    expect(lines(result.out)).toContain(`uncovered ${P1}/${writer('mini')}: no attestation reaches seq 3`);
  });

  it('binds each record to the project asked: one project’s record and events served under another’s routes are refused', async () => {
    redirect = (path) => path.replace(`/machine/projects/${P2}/`, `/machine/projects/${P1}/`);
    try {
      const checked = await mini.cli('attest-history', ['--check', '--former', 'oldmini', '--project', P2]);
      expect(checked.code).toBe(1);
      expect(lines(checked.out)).toContain(`mismatch ${P2}/${writer('oldmini')}: binding`);
      expect(checked.out).not.toMatch(/^verified/m);
      // Attesting takes P1's record for none of P2's, and P1's events fail their codes as P2's.
      posts.length = 0;
      const attested = await mini.cli('attest-history', ['--former', 'oldmini', '--project', P2]);
      expect(lines(attested.out)).toContain(`skipped ${P2}/${writer('oldmini')}: seq 1 fails its code`);
      expect(posts).toEqual([]);
    } finally {
      redirect = null;
    }
  });
});
