// A remote panel's subagent follow (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Decision Log "A
// subagent follow is owned by the client that started it"; Constraints: "the offer table is the only door, and each row
// is tested"). `fs.agentEvents` (offered since M4) starts a follow on the engine host under the channel's `ClientRef`,
// which ends with the channel, so the follow it started ends with it; `fs.unfollow` is offered for an agent the caller
// names, which the engine host lets go only of the caller's own hold (src/engine-host/fs/follow.test.ts proves the
// ownership itself). The session-wide form (`agentId: null`) stops every client's follow of the session, so no remote
// caller may send it.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ClientRef } from '@shared/ipc/client';
import { OFFERS } from '../../src/endpoint/offers';
import { drop, makeOrg, openRemote, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

const APP = 'app-1';
const AGENT = 'a014f6be436bed86b';

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}

async function setup(): Promise<{ f: Fixture; a: Remote; b: Remote }> {
  const f = await startEndpoint(org, started);
  const s = f.host.add(APP);
  f.spine.set(APP, s.engineSessionId);
  f.records.set({ lane: 'B', session: s.engineSessionId!, owners: ['@machine'] }, APP);
  // the engine host's answers: a follow's first page, and an unfollow's nothing
  f.host.reads.set('fs.agentEvents', () => ({ events: [], complete: true }));
  f.host.reads.set('fs.unfollow', () => undefined);
  return { f, a: await openRemote(f, org.a1, org.A), b: await openRemote(f, org.b1, org.B) };
}

const reached = (f: Fixture, name: string, from = 0) => f.host.calls.slice(from).filter((c) => c.owner === 'engine-host' && c.name === name);

describe('a remote panel’s subagent follow', () => {
  it('offers `fs.unfollow` as a lane B call', () => {
    expect(OFFERS.commands['fs.unfollow']).toMatchObject({ kind: 'call', executor: 'engine-host', target: 'appSessionId' });
  });

  it('lets go of an agent the caller names, on the engine host, as the caller’s channel', async () => {
    const { f, a } = await setup();
    const from = f.host.calls.length;
    expect(await call(a, 'fs.unfollow', { appSessionId: APP, agentId: AGENT })).toMatchObject({ ok: true });
    const [unfollow] = reached(f, 'fs.unfollow', from);
    expect(unfollow?.input).toEqual({ appSessionId: APP, agentId: AGENT });
    expect(unfollow?.client).toBeDefined();
  });

  it('refuses the session-wide form, which would stop every client’s follow of the session, and reaches nothing', async () => {
    const { f, a } = await setup();
    const from = f.host.calls.length;
    expect(await call(a, 'fs.unfollow', { appSessionId: APP, agentId: null })).toMatchObject({ ok: false, error: { code: 'malformed' } });
    expect(reached(f, 'fs.unfollow', from)).toEqual([]);
  });

  it('refuses a caller who holds nothing on the session', async () => {
    const { f, b } = await setup();
    const from = f.host.calls.length;
    expect(await call(b, 'fs.unfollow', { appSessionId: APP, agentId: AGENT })).toMatchObject({ ok: false, error: { code: 'grade' } });
    expect(reached(f, 'fs.unfollow', from)).toEqual([]);
  });

  it('starts a follow as the caller’s channel, whose end reaches the engine host as that client’s end', async () => {
    const { f, a } = await setup();
    const from = f.host.calls.length;
    await call(a, 'fs.agentEvents', { appSessionId: APP, agentId: AGENT });
    const client = reached(f, 'fs.agentEvents', from)[0]?.client as ClientRef | undefined;
    expect(client).toBeDefined();
    let ended = false;
    client!.onGone(() => (ended = true));
    expect(ended).toBe(false);
    drop(a);
    await until(() => ended, 'the channel’s client ended');
  });
});
