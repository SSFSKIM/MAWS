// One frame at a time, across a replacement too (src/endpoint/rl10/link.ts): the link takes nothing of a new sminos
// connection, neither its welcome (the restatement it opens) nor its frames, until the replaced connection's handler in
// flight has settled. A real `Rl10` and two scripted sminos sockets; the first socket's lane change waits at its
// withdrawal while the second connects (docs/doperpowers/plans/2026-11-18-mw-sminos-channels.md, M2's branch panel).
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, type Certificates, type OrgState } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionReport } from '../../../src/endpoint/listings';
import { EndpointPolicy } from '../../../src/endpoint/policy';
import { Rl10 } from '../../../src/endpoint/rl10/link';
import { EndpointState } from '../../../src/endpoint/state/store';
import { genesis, memberId, newDevice } from '../org-fixtures';
import { FakeSminos } from './fake-sminos';

const ORG = 'org-replacement';
const REF = 'r7Kp2Wv9Hc0Lm8Tr1Xy7Za';
const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
/** A declared channel's id (version 8): a member naming it as its project is refused. */
const C = '5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c';
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const APP = 'b4d1e2f3-0a1b-4c2d-9e3f-4a5b6c7d8e9f';
const NO_CERTS: Certificates = { certs: [], retirements: [] };

const dirs: string[] = [];
const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const until = async (holds: () => boolean, what: string) => {
  for (const deadline = Date.now() + 3000; !holds(); await sleep(5)) if (Date.now() > deadline) throw new Error(`not within 3 s: ${what}`);
};

const memberFrame = (session: string, lane: 'A' | 'B', fields: Record<string, unknown> = {}) => ({ t: 'member', session, alias: 'main', project: P, lane, state: 'idle', title: 'the main session', cwd: '/w', owners: ['@machine'], ownersProof: [], origin: { kind: 'terminal' }, ...fields });

/**
 * A real RL10 server over a scratch state directory, enrolled in a one-member org, whose engine host joins S1 to APP and
 * whose spine holds no record. `listed`: the listings kept, as `Listings` keeps them; `gate()` holds every withdrawal
 * from then on until the returned `open()`, and `withdrawing` counts the withdrawals begun.
 */
async function endpoint() {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rl10-replacement-'));
  fs.chmodSync(dir, 0o700);
  dirs.push(dir);
  const state = EndpointState.open(dir);
  const head = await genesis(ORG, memberId(), await newDevice('a1'), await generateSigningKey());
  const listed = new Map<string, SessionReport>();
  let held: Promise<void> | null = null;
  let withdrawing = 0;
  const rl10 = new Rl10({
    stateDir: () => dir,
    build: 'replacement',
    state: () => state,
    head: () => ({ state: head.state as OrgState, certificates: NO_CERTS }),
    identity: () => ({ org: ORG, hub: 'http://127.0.0.1:1', name: 'host', ref: REF, enrolled: '2026-10-27T18:00:00.000Z' }),
    key: () => null,
    policy: new EndpointPolicy(() => state),
    hub: { openProject: () => () => {}, send: () => true },
    listings: {
      report: async (report) => void listed.set(report.session, report),
      gone: async (session) => {
        withdrawing += 1;
        await held;
        listed.delete(session);
      },
      refresh: async () => {},
      listedSessions: () => [...listed.keys()],
    },
    notifier: { pendingSet: () => {}, requestMessage: () => {}, hostMessage: () => {}, forget: () => {} },
    machineOwners: async () => [],
    dispatch: async (_owner, name) =>
      name === 'engine.sessions'
        ? { t: 'res', id: '0', ok: true, value: [{ engineSessionId: S1, appSessionId: APP }] }
        : { t: 'res', id: '0', ok: false, error: { code: 'unknown_command', message: name } },
    now: Date.now,
    log: () => {},
  });
  await rl10.serve();
  closers.push(() => rl10.unserve());
  /** sminos connected: its hello sent, its welcome not waited for (a replacement's waits for the last one's handler). */
  const connect = async () => {
    const info = JSON.parse(fs.readFileSync(join(dir, 'rl10.json'), 'utf8')) as { socket: string; token: string };
    const sminos = await FakeSminos.open(info.socket);
    closers.push(() => sminos.close());
    sminos.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: ['channels'], token: info.token, sminos: { version: 'replacement' }, policy: { read_only: false, ceiling: 'settings' } });
    return sminos;
  };
  const gate = () => {
    let open!: () => void;
    held = new Promise<void>((resolve) => (open = resolve));
    return open;
  };
  return { rl10, connect, gate, listed, withdrawing: () => withdrawing };
}

/** S1 held in lane A and listed on a first connection, then its update to lane B sent and paused at the withdrawal. */
async function paused() {
  const e = await endpoint();
  const first = await e.connect();
  await first.next((f) => f.t === 'welcome', 'the first welcome');
  first.send(memberFrame(S1, 'A'));
  await until(() => e.listed.has(S1), 'S1 listed');
  const open = e.gate();
  first.send(memberFrame(S1, 'B'));
  await until(() => e.withdrawing() === 1, 'the lane change’s withdrawal begun');
  return { e, open, first };
}

/**
 * The replacement's frames sent, then `open()`; done once the replacement's welcome came and a sentinel lane A member
 * sent after them (S2) is listed, and a continuation that would write late has had its turn.
 */
async function released(e: Awaited<ReturnType<typeof endpoint>>, second: FakeSminos, open: () => void) {
  await sleep(50); // what the endpoint takes of the replacement before the release, it has taken
  open();
  await second.next((f) => f.t === 'welcome', 'the replacement’s welcome');
  second.send(memberFrame(S2, 'A'));
  await until(() => e.listed.has(S2), 'the sentinel listed');
  await sleep(50);
}

describe('a replacement connection while the replaced one’s handler waits', () => {
  it('a refusal of the same session on the replacement leaves it not held, not joined, unlisted, and with no owner to authorize', async () => {
    const { e, open } = await paused();
    const second = await e.connect();
    second.send(memberFrame(S1, 'B', { project: C }));
    await released(e, second, open);
    const target = { lane: 'B' as const, session: S1, appSessionId: APP };
    expect(e.rl10.members.get(S1)).toBeNull();
    expect(e.rl10.members.appSessionId(S1)).toBeNull();
    expect(e.rl10.members.sessions()).toEqual([S2]);
    expect([...e.listed.keys()]).toEqual([S2]);
    // what authorization reads (authorize.ts, `recordOf`): no record, and handed off, so no bridge to a spawner
    expect(e.rl10.members.record(target)).toBeNull();
    expect(e.rl10.members.recordOf(S1)).toBeNull();
    expect(e.rl10.members.handedOff(target)).toBe(true);
  });

  it('an empty restatement on the replacement leaves the session not held and not listed', async () => {
    const { e, open } = await paused();
    const second = await e.connect();
    second.send({ t: 'restated' });
    await released(e, second, open);
    expect(e.rl10.members.get(S1)).toBeNull();
    expect(e.rl10.members.sessions()).toEqual([S2]);
    expect([...e.listed.keys()]).toEqual([S2]);
    expect(e.rl10.sminosView()?.restating).toBe(false);
  });

  it('a replacement that closed while it waited is not welcomed: the link stays down, with no restatement open', async () => {
    const { e, open, first } = await paused();
    const links: boolean[] = [];
    e.rl10.onLink((connected) => void links.push(connected));
    const second = await e.connect();
    await until(() => first.closed, 'the replaced connection closed by the replacement’s hello');
    second.close();
    await until(() => links.includes(false), 'the link down');
    open();
    await sleep(50);
    expect(links).toEqual([false]);
    expect(e.rl10.connected).toBe(false);
    expect(e.rl10.members.restating).toBe(false);
  });
});
