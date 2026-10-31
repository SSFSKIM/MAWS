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
//
// The scene changes nothing the machine checks: the device keys, the handshakes, the endpoint's authorization and the
// listings are all production's. Nothing reaches beyond 127.0.0.1.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';
import { build } from 'esbuild';
import type { MachineRef } from '../../src/shared/machine/ref';
import { startFakeSminos, type FakeSminos } from './fake-sminos';
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
     * once B's engine host reports the session under `engine`. */
    list(session: { engine: string; app: string; owners: string[]; project: string; title?: string; cwd?: string }): Promise<void>;
    gone(engine: string): Promise<void>;
  };
  /** A's MAWS_DEV_ORG directory; `directMap` says whether the link may reach B's listener directly. */
  devOrgDir(directMap: boolean): string;
  stop(): Promise<void>;
}

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
export async function startRemoteScene(opts: { scratch: string; aUserData: string; b?: { env?: Record<string, string>; prepare?: (paths: { claudeConfigDir: string }) => void } }): Promise<RemoteScene> {
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

    const preload = join(scratch, 'fake-tailnet.cjs');
    writeFileSync(preload, FAKE_TAILNET);
    const directPort = await freePort();
    let deadPort = await freePort();
    while (deadPort === directPort) deadPort = await freePort();
    const bUserData = mkdtempSync(join(tmpdir(), 'maws-rb-')); // short: B's sockets stay under it
    undo.push(() => rmSync(bUserData, { recursive: true, force: true }));
    const daemon = await startProfileDaemon({
      userData: bUserData,
      env: { MAWS_MACHINE_NAME: B_NAME, MAWS_ENDPOINT_DIRECT: '1', MAWS_ENDPOINT_PORT: String(directPort), ...opts.b?.env },
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

    // Read once every amendment is made (A listed, B enrolled): what A's dev session pins and holds.
    const chain = await org.chain();
    const advertised = `ws://${TAILNET}:${directPort}`;
    const devOrgDir = (directMap: boolean): string => {
      const dir = join(scratch, directMap ? 'dev-org-direct' : 'dev-org-relay');
      mkdirSync(dir, { recursive: true });
      const session = {
        version: 1,
        org: chain.org,
        member: org.admin.member,
        device: aDevice.device,
        pins: chain.pins,
        hub: { url: org.url, standinUser: org.admin.email },
        directMap: { [advertised]: `ws://127.0.0.1:${directMap ? directPort : deadPort}` },
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
          sminos.member(session.project, { engine: session.engine, alias: session.app, title: session.title ?? session.app, cwd, owners: session.owners });
        },
        async gone(engine) {
          sminos.gone(engine);
        },
      },
      devOrgDir,
      stop: unwind,
    };
  } catch (error) {
    await unwind();
    throw error;
  }
}
