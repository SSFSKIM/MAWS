// The local org the O8 suites share (P5 O8 M1 to M3, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// "Proves"): desk-hub's Worker in Miniflare (test/endpoint/miniflare-hub.ts) behind the stand-in for Access, rooted by
// O13's real `deployment admin` (`init`, `genesis`), whose verbs the suites run as the approving side and as the org's
// other root. Beside it: the app's org session with the suites' injections (the stand-in's identity, Touch ID answered,
// the backup exclusion stubbed: no browser, no prompt, no osascript), its registration through `pair --class
// native-mac`, a real endpoint's enrollment in the same org, and O7's link to it over the hub's relay.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { base64urlEncode, keyId, signOrgState, type Certificates, type OrgState, type RootTransition, type Signed, type SignedOrgState } from 'org-protocol';
import { encodeEnrollmentCodeV2, type EnrollmentIssued, type EnrollmentKey } from 'desk-hub/protocol';
import { runAdmin, type AdminIo } from '../../apps/desk-hub/deploy/admin.ts';
import { readAdminKeys, readText, volumeOf } from '../../apps/desk-hub/deploy/admin-device.ts';
import { successor } from '../../apps/desk-hub/deploy/org-admin.ts';
import type { Endpoint } from '../../src/endpoint';
import { loadDeviceKeys } from '../../src/main/device/keys';
import { createStepUp } from '../../src/main/device/step-up';
import { createEndpointRecords, ENDPOINT_RECORDS_FILE } from '../../src/main/machines/remote/endpoint-records';
import { openRelaySocket } from '../../src/main/machines/remote/carriers';
import { createRemoteLink, type RemoteLink } from '../../src/main/machines/remote/link';
import type { RemoteTiming } from '../../src/main/machines/remote/timing';
import { createOrgSession, type OrgSessionDeps, type OrgSessionService } from '../../src/main/org/org-session';
import type { OrgSession } from '../../src/main/org/session';
import type { OrgStatus } from '../../src/shared/ipc/schema/org';
import type { MachineRef } from '../../src/shared/machine/ref';
import { ADMIN, ORG, startMiniflareHub, type LocalHub } from '../endpoint/miniflare-hub';

export { ADMIN, ORG };

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `check`'s first value that is not null, false or undefined, polled every 20 ms for up to `ms`. */
export async function until<T>(check: () => T | null | false | undefined | Promise<T | null | false | undefined>, what: string, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value !== null && value !== false && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(20);
  }
}

/** One suite's scratch directory under the system's temporary one, and named directories in it. */
export function scratchDir(prefix: string): { root: string; dir(name: string): string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return {
    root,
    dir(name) {
      const path = join(root, name);
      mkdirSync(path, { recursive: true });
      return path;
    },
  };
}

/** `deployment admin`'s world, recorded; the terminal is never asked (every verb runs with --yes). */
export function adminIo(scratch: string): { io: AdminIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: AdminIo = {
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    openTerminal: () => ({ write: () => {}, readLine: async () => '' }),
    secrets: async () => ({}),
    exec: async () => {},
    volumeOf,
    removableVolume: () => false,
    readText,
    placement: { home: join(scratch, 'home'), tmpRoots: [join(scratch, 'swept')] },
    env: {},
    appDir: join(import.meta.dirname, '../../apps/desk-hub'),
    sleep: (ms) => sleep(Math.min(ms, 50)),
    readStdin: async () => '',
    secretOut: async () => {
      throw new Error('no verb here writes a secret to stdout');
    },
    stdoutIsTerminal: false,
  };
  return { io, out, err };
}

/** The hub's answer to `GET /api/org/state?since=0`. */
export type Served = { head: SignedOrgState; chain: SignedOrgState[]; transitions: Signed<RootTransition>[]; certificates: Certificates };

export interface LocalOrg {
  hub: LocalHub;
  /** The deployment admin's key file; its anchor is beside it (`<keys>.org.json`). */
  adminKeys: string;
  /** The deployment admin's member. */
  member: string;
  /** The org's recovery key, as `genesis` wrote it to the (local) removable volume. */
  recovery: string;
  /**
   * A verb run against the local deployment (`--hub`, `--user`, `--keys` added before any `--`), its lines readable as it
   * runs. A device id goes after `--`, options before it.
   */
  start(...args: string[]): { status: Promise<number>; out: string[]; err: string[] };
  /** A verb run to its end; a non-zero status throws. */
  admin(...args: string[]): Promise<{ out: string[]; err: string[] }>;
  served(as?: string): Promise<Served>;
  /** A successor of the hub's head, signed by the deployment admin's device and posted. */
  amend(edit: (state: OrgState) => void): Promise<SignedOrgState>;
  stop(): Promise<void>;
}

/** The hub in Miniflare, the deployment admin's device made (`init`) and the org rooted by it (`genesis`). */
export async function startLocalOrg(scratch: { root: string; dir(name: string): string }): Promise<LocalOrg> {
  const { hub, stop } = await startMiniflareHub();
  const adminKeys = join(scratch.dir('admin'), 'keys.json');
  const recovery = join(scratch.dir('volume'), 'recovery.json');
  const local = () => ['--hub', hub.url, '--user', ADMIN, '--keys', adminKeys];
  const start = (...args: string[]) => {
    const run = adminIo(scratch.root);
    // The local options go before a `--`, after which every argument is a positional (a device id may start with '-').
    const end = args.indexOf('--');
    const argv = end < 0 ? [...args, ...local()] : [...args.slice(0, end), ...local(), ...args.slice(end)];
    return { status: runAdmin(argv, run.io), out: run.out, err: run.err };
  };
  const admin = async (...args: string[]) => {
    const run = start(...args);
    const status = await run.status;
    if (status !== 0) throw new Error(`deployment admin ${args[0]}: ${status} ${run.err.join(' | ')}`);
    return { out: run.out, err: run.err };
  };
  const served = async (as = ADMIN) => (await (await hub.fetchAs(as, '/api/org/state?since=0')).json()) as Served;
  try {
    await admin('init');
    const member = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
    await admin('genesis', '--recovery', recovery, '--yes');
    return {
      hub,
      adminKeys,
      member,
      recovery,
      start,
      admin,
      served,
      async amend(edit) {
        const keys = await readAdminKeys(adminKeys);
        const next = await signOrgState(await successor((await served()).head.state, edit), [keys.stepUp]);
        const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: next });
        if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
        return next;
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** The app's org session as the suites run it: the stand-in's identity, Touch ID answered, the exclusion stubbed. */
export function orgSession(deps: Pick<OrgSessionDeps, 'userData' | 'build' | 'log'> & Partial<OrgSessionDeps>): OrgSessionService {
  return createOrgSession({
    packaged: false,
    env: { MAWS_DEV_STANDIN_USER: ADMIN },
    openExternal: () => {
      throw new Error('the stand-in opens no browser');
    },
    stepUp: (keys, device) => createStepUp({ device, key: keys.stepUp, confirm: async () => ({ ok: true }) }),
    loadKeys: (profile) => loadDeviceKeys(profile, { excludeFromBackup: async () => true }),
    excludeFromBackup: async () => true,
    ...deps,
    timing: { APPROVAL_POLL_MS: 200, ...deps.timing },
  });
}

/** The status while it reads `registered`, else null. */
export function registered(session: Pick<OrgSessionService, 'status'>): Extract<OrgStatus, { state: 'registered' }> | null {
  const status = session.status();
  return status.state === 'registered' ? status : null;
}

/** `session` registered in the org through `pair --class native-mac`, which approves it; resolves once signed in. */
export async function registerThroughPair(org: LocalOrg, session: OrgSessionService): Promise<{ device: string; out: string[] }> {
  const pairing = org.start('pair', '--class', 'native-mac', '--ttl', '60', '--yes');
  const line = await until(() => pairing.out.find((l) => l.startsWith('pairing code: ')), 'the pairing code');
  await session.loaded;
  const attempt = session.register(line.slice('pairing code: '.length));
  if (!attempt.ok) throw new Error(`register: ${attempt.reason.code}`);
  const status = await pairing.status;
  if (status !== 0) throw new Error(`deployment admin pair: ${status} ${pairing.err.join(' | ')}`);
  const signedIn = await until(() => session.current(), 'the app signed in');
  return { device: signedIn.identity.device, out: pairing.out };
}

/**
 * A started endpoint enrolled in the org by a v2 enrollment code and listed by the deployment admin's successor, owned
 * by `owners` (the admin's member by default); resolves once its `enroll` has ended.
 */
export async function enrollEndpoint(org: LocalOrg, endpoint: Endpoint, ref: string, name: string, owners: string[] = [org.member]): Promise<void> {
  const keys = await readAdminKeys(org.adminKeys);
  const head = (await org.served()).head;
  const issued = (await (await org.hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as EnrollmentIssued;
  const code = encodeEnrollmentCodeV2({ hub: org.hub.url, token: issued.token, roots: [await keyId(keys.stepUp.pub)], recoveryPub: head.state.root.recoveryPub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const enrolling = endpoint.cli('enroll', ['--name', name, '--wait', '30', '--json'], code);
  const key = await until(async () => {
    const response = await org.hub.fetchAs(ADMIN, `/api/enrollments/${issued.enrollment.id}/key`);
    if (response.status === 200) return (await response.json()) as EnrollmentKey;
    await response.body?.cancel();
    return null;
  }, 'the posted machine key');
  await org.amend((state) => {
    state.machines.push({ name, ref, pub: key.pub, owners });
    state.machineNames.push({ name, ref });
  });
  const ended = await enrolling;
  if (ended.code !== 0) throw new Error(`mawsd enroll: ${ended.code}`);
}

/** O7's link to `machine` over the hub's relay (a direct dial is refused), its endpoint records in `profile`. */
export function relayLink(input: { session: OrgSession; machine: { ref: string; name: string }; profile: string; timing?: Partial<RemoteTiming>; log(line: string): void }): RemoteLink {
  return createRemoteLink({
    machine: { ref: input.machine.ref as MachineRef, name: input.machine.name },
    session: input.session,
    records: createEndpointRecords({ file: join(input.profile, ENDPOINT_RECORDS_FILE), log: input.log }),
    dialDirect: async (url) => {
      throw new Error(`${url} refused: this suite goes through the hub`);
    },
    openRelay: (url, headers) => openRelaySocket(url, headers),
    ...(input.timing === undefined ? {} : { timing: input.timing }),
    log: input.log,
  });
}
