// The built `mawsd` with its endpoint module, as processes (P5 O10 M10's Proves; docs/doperpowers/plans/2026-10-27-p5-o10-
// endpoint.md): `out/main/mawsd.js` under plain Node on scratch profiles (a scratch HOME and SMINOS_HOME each), against
// desk-hub's Worker in Miniflare on loopback (test/endpoint/miniflare-hub.ts). A daemon enrolls with its code on stdin,
// `keys --json` shows it listed, a test device opens a channel over the hub's multiplex and over the direct listener,
// `mawsd restart` closes both with `restart`, and the device resumes by cursor on the daemon that comes back. The O6 scene
// beside it: two private daemons on one machine, each enrolled, neither binding the direct listener, each with its own
// state and key.
//
// The direct listener binds only tailnet addresses, which a test host may not have and must never offer: each daemon
// is started with a preload (`fakeTailnet`) that gives it a one-address interface table, a tailnet-shaped address that
// it listens on through 127.0.0.1. Nothing binds a real interface, so no firewall prompt is raised. Skipped without a
// build, as the bundle guard is; class 1a builds first.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect, createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { base64urlEncode, generateSigningKey, keyId, memoryOrgView, signRecord, SIGNING_DOMAINS, type ByteDuplex, type Channel, type ChannelMessage, type Grant, type SignedOrgState } from 'org-protocol';
import { encodeEnrollmentCodeV2, type EnrollmentIssued, type EnrollmentKey, type MachineEndpoint } from 'desk-hub/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestDevice as Device } from '../../apps/org-protocol/test-support/test-device.ts';
import { readLock } from '../engine-host/supervisor-files';
import { RelayDialer, dialDirect } from '../../test/endpoint/carriers';
import { ADMIN, credentials, ORG, startMiniflareHub, type LocalHub } from '../../test/endpoint/miniflare-hub';
import { genesis, newDevice, successor, type TestDevice } from '../../test/endpoint/org-fixtures';
import { FakeSminos, type Frame } from '../../test/endpoint/rl10/fake-sminos';
import { CHECKOUT, counter, laneAMember, PROJECT, serve } from '../../test/endpoint/sub-harness';

const MAWSD = resolve(__dirname, '../../out/main/mawsd.js');
const TAILNET = '100.101.102.104';
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
/** `what` names the wait; a function is read at the timeout (a log's state then). */
async function until<T>(check: () => T | null | undefined | false | Promise<T | null | undefined | false>, what: string | (() => string), ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = await check();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`no ${typeof what === 'function' ? what() : what} within ${ms} ms`);
    await sleep(50);
  }
}

// --- the scene: a hub, an org with its admin's device, scratch profiles -------------------------------------------

let scratch: string;
let hub: LocalHub;
let stopHub: () => Promise<void>;
let A: string;
let a1: TestDevice;
const chain: SignedOrgState[] = [];
const daemons: ChildProcess[] = [];
const profiles: string[] = [];

async function publish(state: SignedOrgState): Promise<void> {
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: state });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  chain.push(state);
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-mpe-'));
  // The preload each daemon runs under: its interface table is one tailnet-shaped address, listened on through loopback.
  writeFileSync(
    join(scratch, 'fake-tailnet.cjs'),
    `const os = require('node:os');
const net = require('node:net');
const FAKE = ${JSON.stringify(TAILNET)};
os.networkInterfaces = () => ({ utun99: [{ address: FAKE, netmask: '255.255.255.255', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: FAKE + '/32' }] });
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (args[0] && typeof args[0] === 'object' && args[0].host === FAKE) args[0] = { ...args[0], host: '127.0.0.1' };
  return listen.apply(this, args);
};
`,
  );
  if (!existsSync(MAWSD)) return;
  ({ hub, stop: stopHub } = await startMiniflareHub());
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  await publish(await genesis(ORG, A, a1, await generateSigningKey()));
});

afterEach(() => {
  for (const child of daemons.splice(0)) if (child.exitCode === null) child.kill('SIGKILL');
  // A host something woke is the profile's to end (nothing here should wake one).
  for (const profile of profiles.splice(0)) {
    const pid = readLock(join(profile, 'supervisor'))?.pid;
    if (pid !== undefined) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // gone
      }
    }
  }
});

afterAll(async () => {
  await stopHub?.();
  rmSync(scratch, { recursive: true, force: true });
});

function newProfile(name: string): { profile: string; env: NodeJS.ProcessEnv } {
  const profile = join(scratch, name);
  for (const dir of ['home', 'sminos']) mkdirSync(join(profile, dir), { recursive: true });
  profiles.push(profile);
  return { profile, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(profile, 'home'), SMINOS_HOME: join(profile, 'sminos'), MAWS_USER_DATA: profile } };
}

const log = (profile: string) => {
  try {
    return readFileSync(join(profile, 'mawsd', 'mawsd.log'), 'utf8');
  } catch {
    return '';
  }
};

type Daemon = { child: ChildProcess; exited: Promise<number | null> };

/** A private mawsd on `profile`, serving (its `nth` start over the profile's log). */
async function runDaemon(profile: string, env: NodeJS.ProcessEnv, nth = 1): Promise<Daemon> {
  const child = spawn(process.execPath, ['--disable-sigusr1', '--require', join(scratch, 'fake-tailnet.cjs'), MAWSD, 'run', '--private', '--dir', join(profile, 'mawsd')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  daemons.push(child);
  let output = '';
  child.stdout!.on('data', (chunk: Buffer) => void (output += chunk.toString()));
  child.stderr!.on('data', (chunk: Buffer) => void (output += chunk.toString()));
  const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));
  const serving = () => log(profile).split('\n').filter((line) => line.includes(' serving;')).length;
  await until(() => serving() >= nth || child.exitCode !== null, () => `mawsd serving:\n${output}\n${log(profile)}`);
  expect(child.exitCode, `${output}\n${log(profile)}`).toBeNull();
  return { child, exited };
}

/** The command line as a process; `input` on its stdin. */
function cli(env: NodeJS.ProcessEnv, args: string[], input = '', cwd?: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [MAWSD, ...args], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => void (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => void (stderr += chunk.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.once('exit', (status) => {
      clearTimeout(timer);
      done({ status, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

type EndpointStatus = { enrollment: string; hub: { connected: boolean }; listener: { bound: boolean }; channels: { relayed: number; direct: number }; rl10: { connected: boolean } };

async function endpointStatus(env: NodeJS.ProcessEnv): Promise<EndpointStatus> {
  const answer = await cli(env, ['endpoint', 'status', '--json']);
  expect(answer.status, answer.stderr).toBe(0);
  return JSON.parse(answer.stdout) as EndpointStatus;
}

/** `name` enrolled on `profile`'s running daemon with its code on stdin, the member listing it as its app would. */
async function enroll(profile: string, env: NodeJS.ProcessEnv, name: string): Promise<{ ref: string; stdout: string }> {
  const issued = (await (await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as EnrollmentIssued;
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token: issued.token, roots: [await keyId(a1.stepUp.pub)], recoveryPub: chain[0].state.root.recoveryPub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const enrolling = cli(env, ['enroll', '--name', name, '--wait', '60', '--json'], `${code}\n`);
  const key = await until(async () => {
    const response = await hub.fetchAs(ADMIN, `/api/enrollments/${issued.enrollment.id}/key`);
    return response.status === 200 ? ((await response.json()) as EnrollmentKey) : (await response.body?.cancel(), null);
  }, 'the posted key');
  await publish(
    await successor(chain[chain.length - 1], [a1], (state) => {
      state.machines.push({ name, ref: key.ref, pub: key.pub, owners: [A] });
      state.machineNames.push({ name, ref: key.ref });
    }),
  );
  const done = await enrolling;
  expect(done.status, `${done.stdout}${done.stderr}\n${log(profile)}`).toBe(0);
  expect(JSON.parse(done.stdout)).toMatchObject({ enrollment: 'org-listed', name, org: ORG, ref: key.ref });
  // The code reached the daemon on stdin and over machine.sock alone: no log line holds it.
  expect(log(profile)).not.toContain(code);
  return { ref: key.ref, stdout: done.stdout };
}

// --- sminos and the device ---------------------------------------------------------------------------------------

/** A fake sminos on the endpoint's RL10 socket, welcomed and restated with lane A `sessions` (owned by `@machine`). */
async function sminosOn(profile: string, sessions: string[]): Promise<FakeSminos> {
  const path = join(profile, 'mawsd', 'endpoint', 'rl10.json');
  await until(() => existsSync(path), 'rl10.json');
  const info = JSON.parse(readFileSync(path, 'utf8')) as { socket: string; token: string };
  const s = await FakeSminos.open(info.socket);
  s.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'test' }, policy: { read_only: false, ceiling: 'settings' } });
  await s.next((x) => x.t === 'welcome', 'welcome');
  s.send({ t: 'session', message: { project: PROJECT, machine: 'mini', session: null, kind: 'machine', sub: null, n: null, body: { online: true, policy: { read_only: false, ceiling: 'settings' }, checkouts: [{ path: CHECKOUT, branch: 'main' }], desk: {} } } });
  for (const session of sessions) s.send({ t: 'member', ...laneAMember({ session }) });
  s.send({ t: 'restated' });
  return s;
}

type Remote = { channel: Channel; inbox: Array<ChannelMessage & Record<string, unknown>>; closed: Promise<string> };

async function openRemote(ref: string, dial: () => Promise<ByteDuplex>): Promise<Remote> {
  const device = new Device({ identity: { org: ORG, member: A, device: a1.device.id, clientClass: a1.device.class, channelKey: a1.channel, build: 'm10', capabilities: [] }, org: memoryOrgView({ chain: [...chain] }) });
  const channel = await device.open(dial, ref);
  const inbox: Remote['inbox'] = [];
  channel.onMessage((m) => void inbox.push(m as Remote['inbox'][number]));
  const closed = new Promise<string>((done) => channel.onClose((reason) => done(reason)));
  return { channel, inbox, closed };
}

const of = (r: Remote, sub: string, t: string) => r.inbox.filter((m) => m.sub === sub && m.t === t);

/**
 * A lane A subscription, answered by sminos's snapshot. The endpoint hears sminos's members on RL10 while the device's
 * `sub` comes over the channel, so a `sub` that arrives first is ended (no record yet) and is sent again, for 10 s.
 */
async function subscribe(r: Remote, s: FakeSminos, sub: string, session: string, cursor: { epoch: string; seq: number } | null): Promise<{ subbed: Record<string, unknown>; upstream: Frame }> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const from = r.inbox.length;
    await r.channel.send({ t: 'sub', sub, session: { lane: 'A', id: session }, view: 'full', cursor, credit: 4 * 1024 * 1024 });
    const answer = await until(() => r.inbox.slice(from).find((m) => m.sub === sub && (m.t === 'subbed' || m.t === 'ended')), `the answer to ${sub}`, 10_000);
    if (answer.t === 'subbed') return { subbed: answer, upstream: await serve(s, session) };
    if (Date.now() > deadline) throw new Error(`${sub} was ended: ${JSON.stringify(answer)}`);
    await sleep(100);
  }
}

// --- the scenes --------------------------------------------------------------------------------------------------

describe.skipIf(!existsSync(MAWSD))('the built mawsd with its endpoint', () => {
  it('enrolls with the code on stdin, serves a device over the relay and the direct listener, and is resumed by cursor across a restart', async () => {
    const { profile, env: base } = newProfile('one');
    const port = await freePort();
    const env = { ...base, MAWS_ENDPOINT_DIRECT: '1', MAWS_ENDPOINT_PORT: String(port) };
    const first = await runDaemon(profile, env);

    // Unenrolled, the daemon has not loaded the endpoint (lever (a)): daemon.status says unenrolled from the seam, and so
    // do the read-only commands, which leave it unloaded; the module's chunk comes with the first command that needs it.
    const daemonStatus = await cli(env, ['status', '--json']);
    expect(JSON.parse(daemonStatus.stdout)).toMatchObject({ endpoint: { present: true, detail: { enrollment: 'none', hub: { connected: false }, listener: { bound: false } } } });
    expect(log(profile)).not.toContain('loading the endpoint');
    expect(await endpointStatus(env)).toMatchObject({ enrollment: 'none', hub: { connected: false }, listener: { bound: false }, rl10: { connected: false } });
    const unlisted = await cli(env, ['keys', '--json']);
    expect(unlisted.status, unlisted.stderr).toBe(0);
    expect(JSON.parse(unlisted.stdout)).toEqual({ enrollment: 'none', ref: (JSON.parse(daemonStatus.stdout) as { machine: string }).machine, delegated: false });
    expect(log(profile)).not.toContain('loading the endpoint');
    expect(existsSync(join(profile, 'mawsd', 'endpoint', 'rl10.json'))).toBe(false);

    const { ref } = await enroll(profile, env, 'm10-mini');
    expect(log(profile)).toContain('loading the endpoint for its first command');
    const keys = await cli(env, ['keys', '--json']);
    expect(keys.status, keys.stderr).toBe(0);
    const shown = JSON.parse(keys.stdout) as Record<string, unknown>;
    expect(shown).toMatchObject({ enrollment: 'org-listed', name: 'm10-mini', org: ORG, ref, delegated: false, heldKeys: 1 });
    // No path and no key material: the machine key's private half, the service token's secret and the profile's paths
    // appear nowhere in what `keys` says.
    const stateDir = join(profile, 'mawsd', 'endpoint');
    const jwk = (JSON.parse(readFileSync(join(stateDir, 'machine-key.json'), 'utf8')) as { jwk: { d: string; x: string; y: string } }).jwk;
    const secret = (JSON.parse(readFileSync(join(stateDir, 'enrollment.json'), 'utf8')) as { credentials: { clientSecret: string } }).credentials.clientSecret;
    for (const hidden of [jwk.d, jwk.x, jwk.y, secret, profile, scratch]) expect(keys.stdout).not.toContain(hidden);

    // Listed: the hub link up, the listener bound on the tailnet address, and the hub serving the record that names it.
    await until(async () => {
      const s = await endpointStatus(env);
      return s.hub.connected && s.listener.bound;
    }, () => `hub link and listener:\n${log(profile)}`);
    const record = await until(async () => {
      const response = await hub.fetchAs(ADMIN, `/api/machines/${ref}/endpoint`);
      if (response.status !== 200) return void (await response.body?.cancel());
      const served = (await response.json()) as MachineEndpoint;
      return served.record.body.addresses.length > 0 ? served.record : null;
    }, 'the endpoint record');
    expect(record.body.addresses).toEqual([`ws://${TAILNET}:${port}`]);
    const direct = () => dialDirect(`ws://127.0.0.1:${port}`); // the record's address, reached through loopback

    let s = await sminosOn(profile, ['la-relayed', 'la-direct']);
    let relay = await RelayDialer.open(hub.url, ref, credentials(ADMIN));
    const relayed = await openRemote(ref, () => relay.dial());
    const straight = await openRemote(ref, direct);
    // The h2 names mawsd's build: the bundle's own id, which the endpoint was built with.
    const buildId = /build ([0-9a-f]{16}) starting/.exec(log(profile))?.[1];
    expect(buildId).toBeDefined();
    expect(relayed.channel.peer.build).toBe(buildId);
    expect(straight.channel.peer.build).toBe(buildId);
    expect(await endpointStatus(env)).toMatchObject({ channels: { relayed: 1, direct: 1 }, rl10: { connected: true } });

    // Each device subscribes to its session; sminos's snapshot, then two live messages each.
    const cursors = new Map<string, { epoch: string; seq: number }>();
    for (const [r, sub, session] of [
      [relayed, 'r1', 'la-relayed'],
      [straight, 'd1', 'la-direct'],
    ] as const) {
      const { subbed, upstream } = await subscribe(r, s, sub, session, null);
      expect(subbed).toMatchObject({ mode: 'snapshot' });
      const next = counter(session);
      for (const text of ['one', 'two']) s.send(next(upstream.sub as string, 'row', { uuid: `${session}-${text}` }));
      const evs = await until(() => (of(r, sub, 'ev').length >= 2 ? of(r, sub, 'ev') : null), `${sub}'s live messages`);
      expect(evs.map((m) => (m.body as { body: { uuid: string } }).body.uuid)).toEqual([`${session}-one`, `${session}-two`]);
      cursors.set(sub, { epoch: evs[1].epoch as string, seq: evs[1].seq as number });
    }

    // `mawsd restart`: both channels end with the endpoint's sealed `restart`, and the daemon exits 75 as a unit restarts.
    const restart = await cli(env, ['restart']);
    expect(restart.status, restart.stderr).toBe(0);
    expect(await relayed.closed).toBe('restart');
    expect(await straight.closed).toBe('restart');
    await expect(first.exited).resolves.toBe(75);
    s.close();
    relay.close();

    // The daemon comes back (as its unit would start it), enrolled from its state, and the device resumes by cursor. A
    // restart loses the endpoint's rings, so each resume is a snapshot under a new epoch: nothing lost, nothing doubled.
    await runDaemon(profile, env, 2);
    expect(log(profile)).toContain('loading the endpoint: an enrollment is on disk'); // at its start, before any command
    await until(async () => {
      const status = await endpointStatus(env);
      return status.enrollment === 'org-listed' && status.hub.connected && status.listener.bound;
    }, () => `hub link and listener again:\n${log(profile)}`);
    s = await sminosOn(profile, ['la-relayed', 'la-direct']);
    relay = await RelayDialer.open(hub.url, ref, credentials(ADMIN));
    const back = await openRemote(ref, () => relay.dial());
    const backDirect = await openRemote(ref, direct);
    for (const [r, sub, session] of [
      [back, 'r1', 'la-relayed'],
      [backDirect, 'd1', 'la-direct'],
    ] as const) {
      const before = cursors.get(sub)!;
      const { subbed, upstream } = await subscribe(r, s, sub, session, before);
      expect(subbed.mode).toBe('snapshot');
      expect(subbed.epoch).not.toBe(before.epoch);
      s.send(counter(session)(upstream.sub as string, 'row', { uuid: `${session}-three` }));
      const evs = await until(() => (of(r, sub, 'ev').length >= 1 ? of(r, sub, 'ev') : null), `${sub}'s message after the resume`);
      expect(evs.map((m) => [m.epoch, (m.body as { body: { uuid: string } }).body.uuid])).toEqual([[subbed.epoch, `${session}-three`]]);
    }
    back.channel.close('done');
    backDirect.channel.close('done');
    s.close();
    relay.close();
  });

  it('runs every endpoint command through the command line, on a scratch profile', async () => {
    const { profile, env } = newProfile('commands');
    await runDaemon(profile, env);
    const home = join(profile, 'home');
    const run = async (args: string[], code = 0, input = '') => {
      const answer = await cli(env, ['endpoint', ...args], input, home); // run from the scratch home, as a person's shell would
      expect(answer.status, `${args.join(' ')}: ${answer.stdout}${answer.stderr}`).toBe(code);
      return answer.stdout;
    };
    expect(JSON.parse(await run(['keys', '--json']))).toMatchObject({ enrollment: 'none' });
    expect(await run(['legacy', 'status'])).toBe('none\n');
    const { ref } = await enroll(profile, env, 'm10-commands');
    const shown = JSON.parse(await run(['keys', '--json'])) as { enrollment: string; keyId: string };
    expect(shown).toMatchObject({ enrollment: 'org-listed', ref });
    expect(await run(['status'])).toMatch(/^enrollment: org-listed/);

    // The policy, set and read back, as `sminos daemon policy` does it.
    expect(JSON.parse(await run(['policy', '--read-only', 'on', '--ceiling', 'plan', '--json']))).toEqual({ read_only: true, ceiling: 'plan', source: 'set' });
    expect(await run(['policy'])).toMatch(/read-only/);
    expect(JSON.parse(await run(['policy', '--read-only', 'off', '--ceiling', 'settings', '--json']))).toEqual({ read_only: false, ceiling: 'settings', source: 'set' });

    // A signed state delivered by hand (a revocation's path), from a file named relative to the caller's directory (the
    // scratch home; the daemon runs in this suite's): the daemon reads the path the command line made absolute.
    const next = await successor(chain[chain.length - 1], [a1]);
    writeFileSync(join(home, 'state.json'), JSON.stringify(next), { mode: 0o600 });
    expect(await run(['revoke', 'state.json'])).toBe(`adopted: the org state is at version ${next.state.version}\n`);
    await publish(next);
    // And one on stdin.
    const after = await successor(next, [a1]);
    expect(await run(['revoke', '-'], 0, JSON.stringify(after))).toBe(`adopted: the org state is at version ${after.state.version}\n`);
    await publish(after);
    // A grant the owner signs for the machine's key, on stdin.
    const grant: Grant = { org: ORG, machine: ref, machineKey: shown.keyId, member: A, rights: ['shell'], version: 1, issued: new Date().toISOString() };
    expect(await run(['grant', '-'], 0, JSON.stringify(await signRecord(SIGNING_DOMAINS.grant, grant, a1.stepUp.privateKey, a1.stepUp.pub)))).toBe(`kept: version 1 for member ${A}, shell\n`);
    // The hub holds no phase-1 history for this machine: nothing to check, and the check says so.
    await run(['attest-history', '--check', '--json']);

    // Unenrolled on this machine alone, then nothing to retire.
    expect(JSON.parse(await run(['unenroll', '--json']))).toMatchObject({ enrollment: 'none', destroyed: [shown.keyId] });
    expect(JSON.parse(await run(['keys', '--json']))).toMatchObject({ enrollment: 'none', ref });
    expect(JSON.parse(await run(['retire', '--json']))).toMatchObject({ kind: 'nothing' });
  });

  it('two private daemons on one machine (O6’s two profiles): each enrolled under its own key and state, neither binding the direct listener', async () => {
    const port = await freePort();
    const one = newProfile('first');
    const two = newProfile('second');
    const envs = [one, two].map(({ env }) => ({ ...env, MAWS_ENDPOINT_PORT: String(port) })); // no MAWS_ENDPOINT_DIRECT
    await runDaemon(one.profile, envs[0]);
    await runDaemon(two.profile, envs[1]);
    const refs = [(await enroll(one.profile, envs[0], 'o6-first')).ref, (await enroll(two.profile, envs[1], 'o6-second')).ref];
    expect(refs[0]).not.toBe(refs[1]);
    const keys: string[] = [];
    for (const [i, { profile }] of [one, two].entries()) {
      // Listed and linked, with a tailnet address in sight: a private daemon still binds nothing.
      await until(async () => (await endpointStatus(envs[i])).hub.connected, () => `hub link of ${profile}:\n${log(profile)}`);
      expect(await endpointStatus(envs[i])).toMatchObject({ enrollment: 'org-listed', listener: { bound: false } });
      expect(log(profile)).not.toContain('the direct listener is bound');
      const stateDir = join(profile, 'mawsd', 'endpoint');
      expect(statSync(stateDir).mode & 0o777).toBe(0o700);
      expect(statSync(join(stateDir, 'machine-key.json')).mode & 0o777).toBe(0o600);
      keys.push((JSON.parse((await cli(envs[i], ['keys', '--json'])).stdout) as { keyId: string }).keyId);
    }
    expect(keys[0]).not.toBe(keys[1]);
    expect(readFileSync(join(one.profile, 'mawsd', 'endpoint', 'machine-key.json'), 'utf8')).not.toBe(readFileSync(join(two.profile, 'mawsd', 'endpoint', 'machine-key.json'), 'utf8'));
    await expect(answers(port)).resolves.toBe(false);
  });
});

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

function answers(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port }, () => (socket.destroy(), done(true)));
    socket.on('error', () => done(false));
  });
}
