// sminos on a machine's RL10 socket, for e2e:remote's scene (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-
// lane-b.md, Interfaces §Q): the endpoint holds no lane B records or listings of its own, both come only from sminos's
// `member` frames, so the scene plays sminos with the endpoint harness's fake (test/endpoint/rl10/fake-sminos.ts, which
// imports only `node:net` and `desk-hub/protocol`). It connects to the socket `<profile>/mawsd/endpoint/rl10.json`
// names and says hello with that file's token; then, per project, states its `machine` presence (its checkouts) and
// opens it on the log plane (its `hello`), so the endpoint relays it and lists its sessions at the hub; and each `member`
// frame is one session's record as sminos's lane B observer would restate it.
//
// The harness's module imports `desk-hub/protocol` by its TypeScript source, which Playwright's CommonJS transform
// cannot load, so it is bundled with esbuild first, to CommonJS, and required (local-org.ts's pattern).
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';
import { build } from 'esbuild';

const REPO_ROOT = resolve(__dirname, '../..');
const FAKE_SMINOS = join(REPO_ROOT, 'test/endpoint/rl10/fake-sminos.ts');

type Frame = { t: string } & Record<string, unknown>;
type Harness = { send(frame: object): void; close(): void; closed: boolean; received: Frame[] };
type FakeSminosModule = { FakeSminos: { open(path: string): Promise<Harness> } };

/** One lane B session's record, as sminos's `member` frame carries it (src/endpoint/rl10/members.ts's `Member`). */
export interface LaneBMember {
  engine: string; // the engine session id, which sminos keys its members by
  alias: string;
  title: string;
  cwd: string;
  owners: string[];
  state?: string; // `idle` unless given
}

export interface FakeSminos {
  /** A project's `machine` presence (its checkouts here) and its log-plane `hello`, so the endpoint relays it and lists
   * its sessions at the hub; once per project. */
  project(project: string, checkouts: string[]): void;
  /** A session's `member` frame in `project`: the endpoint joins it to its appSessionId through `engine.sessions` and
   * lists it. */
  member(project: string, member: LaneBMember): void;
  /** The session left (`member {gone: true}`): its listing is withdrawn. */
  gone(engine: string): void;
  /** What the endpoint wrote, for a failure to quote. */
  said(): string;
  close(): void;
}

/**
 * sminos connected to the endpoint whose `rl10.json` is `info` (`{socket, token}`) as machine `machine`, welcomed, its
 * restatement closed with no session yet. The bundle is written under `scratch`.
 */
export async function startFakeSminos(scratch: string, info: { socket: string; token: string }, machine: string): Promise<FakeSminos> {
  const outfile = join(scratch, 'fake-sminos.cjs');
  await build({ entryPoints: [FAKE_SMINOS], outfile, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'error' });
  const { FakeSminos } = createRequire(__filename)(outfile) as FakeSminosModule;
  const s = await FakeSminos.open(info.socket);
  const policy = { read_only: false, ceiling: 'settings' };
  s.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'e2e-remote' }, policy });
  await expect.poll(() => s.received.some((frame) => frame.t === 'welcome'), { timeout: 15_000, message: 'the endpoint’s welcome' }).toBe(true);
  s.send({ t: 'restated' });
  const present = new Set<string>();
  return {
    project(project, checkouts) {
      if (present.has(project)) return;
      present.add(project);
      s.send({ t: 'session', message: { project, machine, session: null, kind: 'machine', sub: null, n: null, body: { online: true, policy, checkouts: checkouts.map((path) => ({ path, branch: 'main' })), desk: {} } } });
      s.send({ t: 'hello', project, name: machine, have: {} });
    },
    member: (project, m) =>
      s.send({ t: 'member', session: m.engine, alias: m.alias, project, lane: 'B', state: m.state ?? 'idle', title: m.title, cwd: m.cwd, owners: m.owners, ownersProof: [], origin: { kind: 'maws' }, access: 'listed' }),
    gone: (engine) => s.send({ t: 'member', session: engine, gone: true }),
    said: () => s.received.map((frame) => JSON.stringify(frame).slice(0, 300)).join('\n'),
    close: () => s.close(),
  };
}
