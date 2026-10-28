// `deployment probe --retired` (deploy/probe.ts, O14 B4 step 3, the owner-token half): with the owner's Access token,
// `POST /api/org/keys` and `DELETE /api/org/keys/x` answer the Worker's 404 under the build the credential-free
// `POST /machine/enroll` names (or `--build`), and `GET /api/org/keys` answers `410 retired` or the list. Every request
// carries no body, so a hub before M5b refuses each (a bad shape, not the key's holder) and keeps nothing. Against the
// local hub, and stubs for the answers a hub before M5b, a stale build, or something in front of the Worker gives.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Person } from '../../deploy/hub.ts';
import { deployedBuild, retiredCases } from '../../deploy/probe.ts';
import { startLocalHub, type LocalHub } from '../support/local';
import { LocalPerson } from '../support/local-person';

let hub: LocalHub;
beforeAll(async () => {
  hub = await startLocalHub();
});
afterAll(() => hub?.close());

type Answer = { status: number; body?: unknown; build?: string | null };
type Sent = { path: string; method: string | undefined; body: unknown };

/** An owner whose hub answers each `METHOD path` as `answers` says (the build header `dev` unless given). */
function stubbed(answers: Record<string, Answer>) {
  const sent: Sent[] = [];
  const owner = {
    async fetch(path: string, init: { method?: string; body?: unknown } = {}) {
      sent.push({ path, method: init.method, body: init.body });
      const answer = answers[`${init.method ?? 'GET'} ${path}`] ?? { status: 404, body: { error: 'not-found' } };
      const headers = new Headers({ 'content-type': 'application/json' });
      if (answer.build !== null) headers.set('X-Desk-Build', answer.build ?? 'dev');
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status, headers });
    },
  } as unknown as Pick<Person, 'fetch'>;
  return { owner, sent };
}

/** Each case's outcome: its id with the line it passed with, or the error it failed with. */
async function outcomes(owner: Pick<Person, 'fetch'>, build: string) {
  const results: Record<string, { pass: string } | { fail: string }> = {};
  for (const c of retiredCases(owner, build)) {
    try {
      results[c.id] = { pass: await c.run() };
    } catch (error) {
      results[c.id] = { fail: (error as Error).message };
    }
  }
  return results;
}

const RETIRED_GET: Answer = { status: 410, body: { error: 'retired', message: 'the org key is retired' } };

describe('the probe’s retired-route cases', () => {
  it('pass against this build: the two removed routes answer the Worker’s 404, and GET answers the list', async () => {
    const owner = new LocalPerson(hub);
    expect(await deployedBuild(hub.url)).toBe('dev');
    const results = await outcomes(owner, 'dev');
    expect(Object.keys(results)).toEqual(['K1', 'K2', 'K3']);
    expect(results.K1).toEqual({ pass: expect.stringMatching(/POST \/api\/org\/keys.*404.*dev/) as string });
    expect(results.K2).toEqual({ pass: expect.stringMatching(/DELETE \/api\/org\/keys\/x.*404.*dev/) as string });
    expect(results.K3).toEqual({ pass: expect.stringMatching(/GET \/api\/org\/keys.*the list/) as string });
  });

  it("take a production build's whole name, the hub's and the web's ids joined by a space (deploy.ts, buildName)", async () => {
    const combined = 'hub@6e53b882 web@p5-o14-m5b.6e53b882';
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(400, { 'content-type': 'application/json', 'x-desk-build': combined });
      response.end('{"error":"bad-shape"}');
    });
    await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
    try {
      expect(await deployedBuild(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)).toBe(combined);
    } finally {
      server.close();
    }
    const { owner } = stubbed({
      'POST /api/org/keys': { status: 404, body: { error: 'not-found' }, build: combined },
      'DELETE /api/org/keys/x': { status: 404, body: { error: 'not-found' }, build: combined },
      'GET /api/org/keys': { ...RETIRED_GET, build: combined },
    });
    expect(await outcomes(owner, combined)).toMatchObject({ K1: { pass: expect.stringContaining(combined) }, K2: { pass: expect.any(String) }, K3: { pass: expect.any(String) } });
    expect(await outcomes(owner, 'hub@6e53b882')).toMatchObject({ K1: { fail: expect.stringContaining(`under build ${combined}, not hub@6e53b882`) } });
  });

  it('pass on GET’s 410 retired, as after the purge', async () => {
    const { owner } = stubbed({ 'GET /api/org/keys': RETIRED_GET });
    expect(await outcomes(owner, 'dev')).toMatchObject({ K1: { pass: expect.any(String) }, K2: { pass: expect.any(String) }, K3: { pass: expect.stringMatching(/410 retired/) } });
  });

  it('fail where the routes are still served, as a hub before M5b answers a bodyless POST and DELETE', async () => {
    const { owner } = stubbed({
      'POST /api/org/keys': { status: 400, body: { error: 'bad-shape' } },
      'DELETE /api/org/keys/x': { status: 403, body: { error: 'not-key-holder' } },
      'GET /api/org/keys': { status: 200, body: { key_check: 'c', keys: [] } },
    });
    expect(await outcomes(owner, 'dev')).toMatchObject({ K1: { fail: expect.stringMatching(/400/) }, K2: { fail: expect.stringMatching(/403/) }, K3: { pass: expect.any(String) } });
  });

  it('fail on a 404 that is not this build’s Worker: another build, no build header, or another body', async () => {
    const other = stubbed({ 'POST /api/org/keys': { status: 404, body: { error: 'not-found' }, build: 'abc1234' }, 'GET /api/org/keys': { ...RETIRED_GET, build: 'abc1234' } });
    expect(await outcomes(other.owner, 'dev')).toMatchObject({ K1: { fail: expect.stringMatching(/abc1234/) }, K2: { pass: expect.any(String) }, K3: { fail: expect.stringMatching(/abc1234/) } });
    const bare = stubbed({ 'DELETE /api/org/keys/x': { status: 404, body: { error: 'not-found' }, build: null } });
    expect(await outcomes(bare.owner, 'dev')).toMatchObject({ K2: { fail: expect.stringMatching(/no X-Desk-Build/) } });
    const named = stubbed({ 'POST /api/org/keys': { status: 404, body: { error: 'unknown-key' } } });
    expect(await outcomes(named.owner, 'dev')).toMatchObject({ K1: { fail: expect.stringMatching(/unknown-key/) } });
  });

  it('fail on a GET that is neither 410 retired nor the list', async () => {
    const refused = stubbed({ 'GET /api/org/keys': { status: 403, body: { error: 'not-member' } } });
    expect(await outcomes(refused.owner, 'dev')).toMatchObject({ K3: { fail: expect.stringMatching(/403/) } });
    const shapeless = stubbed({ 'GET /api/org/keys': { status: 200, body: { keys: 'none' } } });
    expect(await outcomes(shapeless.owner, 'dev')).toMatchObject({ K3: { fail: expect.stringMatching(/not the list/) } });
  });

  it('send three requests, each with its method named and no body, so a hub that served them keeps nothing', async () => {
    const { owner, sent } = stubbed({ 'GET /api/org/keys': RETIRED_GET });
    await outcomes(owner, 'dev');
    expect(sent).toEqual([
      { path: '/api/org/keys', method: 'POST', body: undefined },
      { path: '/api/org/keys/x', method: 'DELETE', body: undefined },
      { path: '/api/org/keys', method: 'GET', body: undefined },
    ]);
  });
});
