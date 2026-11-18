// sminos's declared channels at the endpoint (docs/doperpowers/plans/2026-11-18-mw-sminos-channels.md, Interfaces §C):
// the capability pair `channels`, and the logs a machine holds a member of, as a real `Rl10` counts them for a scripted
// sminos on its socket, with no hub. A held lane A member's `channels` count only when the connection's hello listed the
// capability; what `known` then makes of them is projects-records.test.ts's and projects.local.test.ts's.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, type Certificates, type OrgState } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { EndpointPolicy } from '../../../src/endpoint/policy';
import { Rl10 } from '../../../src/endpoint/rl10/link';
import { MEMBER_CHANNELS_MAX, memberChannels, readMember } from '../../../src/endpoint/rl10/members';
import { EndpointState } from '../../../src/endpoint/state/store';
import { genesis, memberId, newDevice } from '../org-fixtures';
import { FakeSminos } from './fake-sminos';

const ORG = 'org-channels';
const REF = 'c4Hc2Wv9Kp0Lm8Tr1Xy7Za';
const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
/** Two declared channels' ids (version 8), and a project's of version 4 that is none. */
const C = '5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c';
const D = '0123abcd-4567-8abc-a123-456789abcdef';
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const NO_CERTS: Certificates = { certs: [], retirements: [] };

const dirs: string[] = [];
const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A lane A `member` frame of `session` in P, as sminos sends one; `channels` only when given. */
const memberFrame = (session: string, fields: Record<string, unknown> = {}) => ({ t: 'member', session, alias: 'main', project: P, lane: 'A', state: 'idle', cwd: '/w', owners: ['@machine'], ownersProof: [], origin: { kind: 'terminal' }, ...fields });

/** A real RL10 server over a scratch state directory, enrolled in a one-member org; no hub behind it. */
async function endpoint() {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rl10-channels-'));
  fs.chmodSync(dir, 0o700);
  dirs.push(dir);
  const state = EndpointState.open(dir);
  const head = await genesis(ORG, memberId(), await newDevice('a1'), await generateSigningKey());
  const rl10 = new Rl10({
    stateDir: () => dir,
    build: 'channels',
    state: () => state,
    head: () => ({ state: head.state as OrgState, certificates: NO_CERTS }),
    identity: () => ({ org: ORG, hub: 'http://127.0.0.1:1', name: 'host', ref: REF, enrolled: '2026-10-27T18:00:00.000Z' }),
    key: () => null,
    policy: new EndpointPolicy(() => state),
    hub: { openProject: () => () => {}, send: () => true },
    listings: { report: async () => {}, gone: async () => {}, refresh: async () => {}, listedSessions: () => [] },
    notifier: { pendingSet: () => {}, requestMessage: () => {}, hostMessage: () => {}, forget: () => {} },
    machineOwners: async () => [],
    dispatch: () => Promise.reject(new Error('none')),
    now: Date.now,
    log: () => {},
  });
  await rl10.serve();
  closers.push(() => rl10.unserve());
  /** sminos connected with a hello listing `capabilities`; resolves with its connection and the welcome. */
  const connect = async (capabilities: string[]) => {
    const info = JSON.parse(fs.readFileSync(join(dir, 'rl10.json'), 'utf8')) as { socket: string; token: string };
    const sminos = await FakeSminos.open(info.socket);
    closers.push(() => sminos.close());
    sminos.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities, token: info.token, sminos: { version: 'channels' }, policy: { read_only: false, ceiling: 'settings' } });
    const welcome = await sminos.next((f) => f.t === 'welcome', 'the welcome');
    return { sminos, welcome };
  };
  /** The logs the endpoint counts this machine holds a member of, as the registry reads them. */
  const held = () => [...new Set(rl10.sminosView()?.sessionProjects() ?? [])].sort();
  /**
   * Waits until `held()` is `expected`, or fails with what it is. A member frame changes what is held in one step (its
   * project and its channels together), so a frame counted wrongly never passes through `expected` on its way.
   */
  const holds = async (expected: string[]) => {
    const want = [...expected].sort();
    for (const deadline = Date.now() + 3000; Date.now() < deadline; await sleep(10)) if (JSON.stringify(held()) === JSON.stringify(want)) return;
    expect(held()).toEqual(want);
  };
  return { rl10, connect, held, holds };
}

describe('the capability pair', () => {
  it('is in the welcome, last, exactly when the hello listed it', async () => {
    const e = await endpoint();
    expect((await e.connect(['audience', 'record', 'locations', 'channels'])).welcome.capabilities).toEqual(['access', 'reach', 'record', 'locations', 'channels']);
    expect((await e.connect(['audience', 'record', 'locations'])).welcome.capabilities).toEqual(['access', 'reach', 'record', 'locations']);
    expect((await e.connect(['channels'])).welcome.capabilities).toEqual(['access', 'reach', 'record', 'channels']);
    expect((await e.connect([])).welcome.capabilities).toEqual(['access', 'reach', 'record']);
  });
});

describe('a member’s channels, with the capability listed', () => {
  it('count while the member is held: a lane A member’s channel is a log this machine holds a member of', async () => {
    const e = await endpoint();
    const { sminos } = await e.connect(['channels']);
    sminos.send(memberFrame(S1, { channels: [C] }));
    await e.holds([P, C]);
  });

  it('stop counting when the member’s next frame carries no channels, when it is gone, and when a restatement leaves it out', async () => {
    const e = await endpoint();
    const { sminos } = await e.connect(['channels']);
    sminos.send(memberFrame(S1, { channels: [C] }));
    await e.holds([P, C]);
    sminos.send(memberFrame(S1));
    await e.holds([P]);
    sminos.send(memberFrame(S1, { channels: [C] }));
    await e.holds([P, C]);
    sminos.send({ t: 'member', session: S1, gone: true });
    await e.holds([]);
    sminos.send(memberFrame(S1, { channels: [C] }));
    await e.holds([P, C]);
    // a new connection's restatement that leaves S1 out: S1 left while sminos was away
    const again = await e.connect(['channels']);
    again.sminos.send(memberFrame(S2));
    again.sminos.send({ t: 'restated' });
    await e.holds([P]);
    expect(e.rl10.sminosView()?.restating).toBe(false);
  });

  it('keep counting while a second member still states the channel', async () => {
    const e = await endpoint();
    const { sminos } = await e.connect(['channels']);
    sminos.send(memberFrame(S1, { channels: [C, D] }));
    sminos.send(memberFrame(S2, { channels: [C] }));
    await e.holds([P, C, D]);
    sminos.send({ t: 'member', session: S1, gone: true });
    await e.holds([P, C]);
    sminos.send(memberFrame(S2));
    await e.holds([P]);
  });

  it('do not count for a lane B member, for an entry that is not a channel’s id, past the bound, or when channels is no list', async () => {
    const e = await endpoint();
    const { sminos } = await e.connect(['channels']);
    sminos.send(memberFrame(S1, { lane: 'B', channels: [C] }));
    await e.holds([P]);
    sminos.send({ t: 'member', session: S1, gone: true });
    await e.holds([]);
    const projectId = '2ed02f3c-5d7b-5e0a-9b1f-6a4c8d2e0f13';
    sminos.send(memberFrame(S2, { channels: [projectId, 'desk-integration', 7, C.toUpperCase()] }));
    await e.holds([P]);
    const many = Array.from({ length: MEMBER_CHANNELS_MAX }, (_, i) => `00000000-0000-8000-8000-${String(i).padStart(12, '0')}`);
    sminos.send(memberFrame(S2, { channels: [...many, C] }));
    await e.holds([P, ...many]);
    sminos.send(memberFrame(S2, { channels: C }));
    await e.holds([P]);
  });
});

describe('a member’s channels, with the capability absent', () => {
  it('count for nothing: the logs held are the members’ projects, as on master', async () => {
    const e = await endpoint();
    const { sminos } = await e.connect(['audience', 'record', 'locations']);
    sminos.send(memberFrame(S1, { channels: [C] }));
    await e.holds([P]);
  });
});

describe('a member whose project is a declared channel’s id', () => {
  it('is not held, whether or not the hello listed the capability', async () => {
    for (const capabilities of [['channels'], ['audience', 'record', 'locations']]) {
      const e = await endpoint();
      const { sminos } = await e.connect(capabilities);
      sminos.send(memberFrame(S1));
      await e.holds([P]);
      sminos.send(memberFrame(S1, { project: C, channels: [D] }));
      await e.holds([]);
      expect(e.rl10.members.get(S1)).toBeNull();
    }
  });
});

describe('memberChannels', () => {
  const read = (channels: unknown) => memberChannels(readMember(memberFrame(S1, channels === undefined ? {} : { channels }))!);
  it('takes the entries that are channels’ ids, each once, in the frame’s order, the first MEMBER_CHANNELS_MAX of them', () => {
    expect(MEMBER_CHANNELS_MAX).toBe(128);
    expect(read(undefined)).toEqual([]);
    expect(read({ 0: C })).toEqual([]);
    expect(read([D, C, D, P, '', null, C])).toEqual([D, C]);
    const many = Array.from({ length: MEMBER_CHANNELS_MAX + 2 }, (_, i) => `00000000-0000-8000-8000-${String(i).padStart(12, '0')}`);
    expect(read(many)).toEqual(many.slice(0, MEMBER_CHANNELS_MAX));
  });

  it('is not read by readMember: a malformed list costs the member nothing', () => {
    expect(readMember(memberFrame(S1, { channels: 'not a list' }))).not.toBeNull();
    expect(readMember(memberFrame(S1, { channels: [{}] }))).not.toBeNull();
  });
});
