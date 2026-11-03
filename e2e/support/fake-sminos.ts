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
import { goneFrame, helloFrame, memberFrame, projectFrames, restatedFrame, type LaneBMember } from '../../test/support/sminos-frames';

const REPO_ROOT = resolve(__dirname, '../..');
const FAKE_SMINOS = join(REPO_ROOT, 'test/endpoint/rl10/fake-sminos.ts');

type Frame = { t: string } & Record<string, unknown>;
type Harness = { send(frame: object): void; close(): void; closed: boolean; received: Frame[] };
type FakeSminosModule = { FakeSminos: { open(path: string): Promise<Harness> } };

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
  await build({ entryPoints: [FAKE_SMINOS], outfile, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'error', alias: { '@shared': join(REPO_ROOT, 'src/shared') } });
  const { FakeSminos } = createRequire(__filename)(outfile) as FakeSminosModule;
  const s = await FakeSminos.open(info.socket);
  s.send(helloFrame(info.token, 'e2e-remote'));
  await expect.poll(() => s.received.some((frame) => frame.t === 'welcome'), { timeout: 15_000, message: 'the endpoint’s welcome' }).toBe(true);
  s.send(restatedFrame());
  const present = new Set<string>();
  return {
    project(project, checkouts) {
      if (present.has(project)) return;
      present.add(project);
      for (const frame of projectFrames(project, machine, checkouts)) s.send(frame);
    },
    member: (project, m) => s.send(memberFrame(project, m)),
    gone: (engine) => s.send(goneFrame(engine)),
    said: () => s.received.map((frame) => JSON.stringify(frame).slice(0, 300)).join('\n'),
    close: () => s.close(),
  };
}
