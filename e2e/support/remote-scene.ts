// e2e:remote's scene (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M2's "The e2e scene",
// Interfaces §Q): two machines on one Mac, joined the way production joins them, over RL2.
//
// - The org: desk-hub's local runner (local-org.ts), its admin the member both machines belong to.
// - Profile B, the remote machine: a private `mawsd` with no app (profile-daemon.ts), its endpoint's direct listener on
//   (`MAWS_ENDPOINT_DIRECT=1`, `MAWS_ENDPOINT_PORT`) behind a fake tailnet table: a `--require` preload gives it one
//   tailnet-shaped interface, which it listens on through 127.0.0.1 (src/mawsd/process-endpoint.test.ts's pattern), so
//   its endpoint record advertises `ws://<tailnet>:<port>` and nothing binds a real interface. B is enrolled as `B` with
//   its own code on its command line's stdin, and the admin lists it.
// - sminos on B's RL10 socket (fake-sminos.ts): the only source of B's lane B records and listings, as in production.
//   `sminos.list` states the session's project and its `member` frame once B's engine host runs the session (the
//   endpoint joins a lane B member to its appSessionId through `engine.sessions` at the frame).
// - Profile A, the app under test: its own device keys made first (`loadDeviceKeys`, the Time Machine exclusion
//   stubbed), listed by the admin as one of the member's devices; `devOrgDir` writes its `MAWS_DEV_ORG` directory
//   (dev-session.ts): the org's chain and pins, the local hub with the admin as the stand-in's user, and a `directMap`
//   from B's advertised address to the loopback one the link dials instead. A spec launches A once per carrier, since the
//   map is read once at the session's load: `directMap: true` maps B's address to its listener (the direct carrier);
//   `false` maps it to a closed loopback port, so the direct dial fails at once and the link goes through the hub (the
//   relay), with no dial leaving this Mac.
// - P5 O7 M8: optionally a second app of the same member (`secondUserData`): its own device keys, listed beside A's, and
//   its own `MAWS_DEV_ORG` directory (`devOrgDir(…, 'second')`), on the same pipe to the hub, so two clients are attached
//   to B at once, each over its own channel.
// - A's way to the hub (P5 O7 M4): a loopback TCP pipe in front of the hub (test/support/loopback-pipe.ts), which
//   `devOrgDir` names as A's hub, so a spec cuts A off from B (and from the hub) and joins it again, as a lost network
//   would: the pipe ends every connection through it and refuses new ones until restored. B's own hub link does not go
//   through it. With the relay launch's direct dial failing at once, the cut leaves A no carrier to B. P5 O15 M2b §I:
//   the pipe can also leave a sleep's state behind, its connections dead and silent and a new connect refused (`stall`),
//   or answer TCP and forward nothing (`hold`), and it records each connection's first line (`requests`).
//
// The scene changes nothing the machine checks: the device keys, the handshakes, the endpoint's authorization and the
// listings are all production's. Nothing reaches beyond 127.0.0.1.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';
import { build } from 'esbuild';
import type { MachineRef } from '../../src/shared/machine/ref';
import { pipeTo, type LoopbackPipe } from '../../test/support/loopback-pipe';
import { startFakeSminos, type FakeSminos, type LaneAPlane, type LaneASession } from './fake-sminos';
import { startLocalOrg, type LocalOrg } from './local-org';
import { startProfileDaemon, type ProfileDaemon } from './profile-daemon';

const REPO_ROOT = resolve(__dirname, '../..');
/** B's name in the org state, and the machine sminos names in its presence. */
export const B_NAME = 'B';
/** The tailnet-shaped address B's interface table holds (in 100.64.0.0/10, the range the link dials directly). */
const TAILNET = '100.101.102.105';
const ENDPOINT_WITHIN_MS = 60_000; // B's hub link and listener after its enrollment, a cold Miniflare included

export interface RemoteScene {
  org: LocalOrg;
  /** Profile B: its private mawsd, enrolled as `B`; `directPort` is its direct listener's loopback port. */
  b: ProfileDaemon & { ref: MachineRef; directPort: number };
  /** The member A signs in as (the org's admin), whom a session's owners name. */
  member: string;
  sminos: {
    /** A lane B session of B's listed through sminos: the project's presence (`cwd` its checkout), then its `member` frame
     * once B's engine host reports the session under `engine`; listed again, restated (`state` its word, `idle` unless
     * given), as sminos's observer restates a session at each change of its state. */
    list(session: { engine: string; app: string; owners: string[]; project: string; title?: string; cwd?: string; state?: string }): Promise<void>;
    gone(engine: string): Promise<void>;
    /** 2026-11-06: a terminal session of B's listed through sminos (the project's presence, `cwd` its checkout, then its
     * lane A `member` frame), its session plane served by sminos (fake-sminos.ts). */
    laneA(project: string, session: LaneASession): LaneAPlane;
    /** What B's endpoint wrote to sminos, for a failure to quote. */
    said(): string;
  };
  /** A's MAWS_DEV_ORG directory; `directMap` says whether the link may reach B's listener directly. P5 O7 M8: `client`
   * 'second' is the second device's (the scene started with `secondUserData`), the same member's, on the same hub pipe. */
  devOrgDir(directMap: boolean, client?: 'first' | 'second'): string;
  /** A's way to the hub (the pipe `devOrgDir` names): `cut` ends every connection through it and refuses new ones until
   * `restore`; P5 O15 M2b: `stall`, `hold` and `requests` as test/support/loopback-pipe.ts gives them. */
  aHub: PipeControl;
  /** P5 O7 M7: A's way to B's direct listener, a pipe as `aHub` is, which `devOrgDir(true)` maps B's address to when the
   * scene was started with `directPipe` (else null): `cut` ends every direct connection and refuses new ones until
   * `restore`, so a forced drop of the direct carrier is the network's. */
  aDirect: PipeControl | null;
  stop(): Promise<void>;
}

/** What a spec does with one of A's ways (test/support/loopback-pipe.ts). */
export type PipeControl = Pick<LoopbackPipe, 'cut' | 'stall' | 'hold' | 'restore' | 'requests'>;

// What the bundle of A's key loader gives (src/main/device/keys.ts), as far as the scene uses it.
type KeysModule = {
  loadDeviceKeys(profile: string, deps: { excludeFromBackup: (path: string) => Promise<boolean> }): Promise<unknown>;
  deviceKeyIds(profile: string, which: 'current'): Promise<{ device: string; channelPub: string; stepUpPub: string } | null>;
};

/** A's device keys, made now in A's profile, and the ids the org state lists them by. */
async function deviceOf(scratch: string, userData: string): Promise<{ device: string; channelPub: string; stepUpPub: string }> {
  // keys.ts imports org-protocol by its TypeScript source and extension, which Playwright's transform cannot load, and
  // `@shared/*` by the alias tsconfig.base.json declares
  const outfile = join(scratch, 'device-keys.cjs');
  await build({
    stdin: { contents: "export { loadDeviceKeys, deviceKeyIds } from './src/main/device/keys.ts';", resolveDir: REPO_ROOT, sourcefile: 'remote-scene-keys.ts', loader: 'ts' },
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    logLevel: 'error',
    alias: { '@shared': join(REPO_ROOT, 'src/shared') }, // the tsconfig paths esbuild does not read from the root's references
  });
  const keys = createRequire(__filename)(outfile) as KeysModule;
  await keys.loadDeviceKeys(userData, { excludeFromBackup: async () => true }); // no tmutil
  const ids = await keys.deviceKeyIds(userData, 'current');
  if (ids === null) throw new Error(`no device keys in ${userData}`);
  return ids;
}

const controlOf = (pipe: LoopbackPipe): PipeControl => ({ cut: () => pipe.cut(), stall: () => pipe.stall(), hold: () => pipe.hold(), restore: () => pipe.restore(), requests: () => pipe.requests() });

/** A loopback port free now (the listener's, or the closed one the relay launch maps B's address to). */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => done(port));
    });
  });
}

// B's preload: its interface table is one tailnet-shaped address, which it listens on through loopback.
const FAKE_TAILNET = `const os = require('node:os');
const net = require('node:net');
const FAKE = ${JSON.stringify(TAILNET)};
os.networkInterfaces = () => ({ utun99: [{ address: FAKE, netmask: '255.255.255.255', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: FAKE + '/32' }] });
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (args[0] && typeof args[0] === 'object' && args[0].host === FAKE) args[0] = { ...args[0], host: '127.0.0.1' };
  return listen.apply(this, args);
};
`;

/**
 * The org, B enrolled and served, sminos on B's RL10 socket and A's device listed. `b.env` and `b.prepare` are B's
 * own (its replay fixtures, its trusted folders), as profile-daemon.ts takes them.
 */
export async function startRemoteScene(opts: { scratch: string; aUserData: string; secondUserData?: string; b?: { env?: Record<string, string>; prepare?: (paths: { claudeConfigDir: string }) => void; root?: string }; directPipe?: boolean }): Promise<RemoteScene> {
  const { scratch, aUserData } = opts;
  mkdirSync(scratch, { recursive: true });
  const undo: (() => Promise<void> | void)[] = [];
  const unwind = async () => {
    for (const step of undo.splice(0).reverse()) await step();
  };
  try {
    const org = await startLocalOrg(scratch);
    undo.push(() => org.stop());
    const aDevice = await deviceOf(scratch, aUserData);
    await org.listDevice({ id: aDevice.device, channelPub: aDevice.channelPub, stepUpPub: aDevice.stepUpPub });
    // P5 O7 M8: a second app of the member's, its own device keys in its own profile, listed beside A's
    const secondDevice = opts.secondUserData === undefined ? null : await deviceOf(scratch, opts.secondUserData);
    if (secondDevice !== null) await org.listDevice({ id: secondDevice.device, channelPub: secondDevice.channelPub, stepUpPub: secondDevice.stepUpPub });

    const preload = join(scratch, 'fake-tailnet.cjs');
    writeFileSync(preload, FAKE_TAILNET);
    const directPort = await freePort();
    let deadPort = await freePort();
    while (deadPort === directPort) deadPort = await freePort();
    // short: B's sockets stay under it (P5 O17 M10: under `b.root`, shorter still, a scene root of its own, `/tmp/mrb-…`,
    // so a session's cua socket and an app of B's own, whose cua socket is `<profile>/browser/cua/<session>.sock`, fit a
    // Unix socket's bound; realpathed, as the headless scene's `/tmp/mh-` is, so nothing of B's reads its profile through
    // the `/tmp` symlink)
    const bRoot = opts.b?.root === undefined ? null : realpathSync(mkdtempSync(join(opts.b.root, 'mrb-')));
    const bUserData = bRoot === null ? mkdtempSync(join(tmpdir(), 'maws-rb-')) : join(bRoot, 'p');
    if (bRoot !== null) mkdirSync(bUserData);
    undo.push(() => rmSync(bRoot ?? bUserData, { recursive: true, force: true }));
    const daemon = await startProfileDaemon({
      userData: bUserData,
      // under `b.root`, B's tmpdir is the scene's root too: a replay seeds its transcripts only where the config home is
      // under the process's tmpdir (src/engine-host/replay-transcript.ts), and the sockets' short fallbacks are made there;
      // whatever B leaves in it goes with the scene
      env: { MAWS_MACHINE_NAME: B_NAME, MAWS_ENDPOINT_DIRECT: '1', MAWS_ENDPOINT_PORT: String(directPort), ...(bRoot !== null && { TMPDIR: bRoot }), ...opts.b?.env },
      ...(opts.b?.prepare === undefined ? {} : { prepare: opts.b.prepare }),
      nodeArgs: ['--require', preload],
    });
    undo.push(() => daemon.stop().then(() => undefined));
    const ref = (await daemon.request<{ ref: MachineRef }>('machine.identity')).ref;
    const enrolled = await org.enroll(B_NAME, (code) => daemon.cli(['enroll', '--name', B_NAME, '--wait', '60', '--json'], `${code}\n`));
    expect(JSON.parse(enrolled.stdout), 'B is enrolled and listed').toMatchObject({ enrollment: 'org-listed', name: B_NAME, ref });
    type Status = { hub: { connected: boolean }; listener: { bound: boolean } };
    const endpointStatus = async (): Promise<Status | null> => {
      const ran = await daemon.cli(['endpoint', 'status', '--json']);
      return ran.status === 0 ? (JSON.parse(ran.stdout) as Status) : null;
    };
    await expect
      .poll(async () => {
        const status = await endpointStatus();
        return status !== null && status.hub.connected && status.listener.bound;
      }, { timeout: ENDPOINT_WITHIN_MS, message: `B's hub link and direct listener:\n${daemon.log().slice(-4000)}` })
      .toBe(true);

    const rl10 = JSON.parse(readFileSync(join(bUserData, 'mawsd', 'endpoint', 'rl10.json'), 'utf8')) as { socket: string; token: string };
    const sminos: FakeSminos = await startFakeSminos(scratch, rl10, B_NAME);
    undo.push(() => sminos.close());

    const aHub = await pipeTo(org.url);
    undo.push(() => aHub.close());
    const aDirect = opts.directPipe === true ? await pipeTo(`http://127.0.0.1:${directPort}`) : null;
    if (aDirect !== null) undo.push(() => aDirect.close());
    const directTarget = aDirect === null ? directPort : Number(new URL(aDirect.url).port);

    // Read once every amendment is made (A listed, B enrolled): what A's dev session pins and holds.
    const chain = await org.chain();
    const advertised = `ws://${TAILNET}:${directPort}`;
    const devOrgDir = (directMap: boolean, client: 'first' | 'second' = 'first'): string => {
      if (client === 'second' && secondDevice === null) throw new Error('the scene was started with no second device (secondUserData)');
      const dir = join(scratch, `${directMap ? 'dev-org-direct' : 'dev-org-relay'}${client === 'second' ? '-second' : ''}`);
      mkdirSync(dir, { recursive: true });
      const session = {
        version: 1,
        org: chain.org,
        member: org.admin.member,
        device: (client === 'second' ? secondDevice! : aDevice).device,
        pins: chain.pins,
        hub: { url: aHub.url, standinUser: org.admin.email },
        directMap: { [advertised]: `ws://127.0.0.1:${directMap ? directTarget : deadPort}` },
      };
      writeFileSync(join(dir, 'session.json'), JSON.stringify(session, null, 2));
      writeFileSync(join(dir, 'chain.json'), JSON.stringify({ chain: chain.chain, transitions: chain.transitions, certificates: chain.certificates }));
      return dir;
    };

    const said = () => `B's endpoint said to sminos:\n${sminos.said().slice(-4000)}\nB's log:\n${daemon.log().slice(-4000)}`;
    return {
      org,
      b: Object.assign(daemon, { ref, directPort }),
      member: org.admin.member,
      sminos: {
        async list(session) {
          const cwd = session.cwd ?? '/';
          sminos.project(session.project, [cwd]);
          type Live = { appSessionId: string; engineSessionId: string | null };
          await expect
            .poll(async () => (await daemon.request<Live[]>('engine.sessions')).some((s) => s.appSessionId === session.app && s.engineSessionId === session.engine), {
              timeout: 30_000,
              message: `B's engine host runs ${session.app} as ${session.engine}\n${said()}`,
            })
            .toBe(true);
          sminos.member(session.project, { engine: session.engine, alias: session.app, title: session.title ?? session.app, cwd, owners: session.owners, ...(session.state === undefined ? {} : { state: session.state }) });
        },
        async gone(engine) {
          sminos.gone(engine);
        },
        laneA(project, session) {
          sminos.project(project, [session.cwd]);
          return sminos.laneA(project, session);
        },
        said: () => sminos.said(),
      },
      devOrgDir,
      aHub: controlOf(aHub),
      aDirect: aDirect === null ? null : controlOf(aDirect),
      stop: unwind,
    };
  } catch (error) {
    await unwind();
    throw error;
  }
}
