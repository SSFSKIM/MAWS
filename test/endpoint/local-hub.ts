// desk-hub's local runner for the endpoint's suites (O10 Constraints, "A hub in the suites"): `apps/desk-hub/local/run.ts`
// (the hub in wrangler dev's Miniflare behind its stand-in for Access) on a free loopback port with a scratch state
// directory, and the member's side through `apps/desk-hub/deploy/org-admin.ts`'s `OrgAdmin`, signed in by the stand-in's
// test identity. The stand-in admits a machine's service token as Access does, so the endpoint reaches the hub with its
// own credentials. Nothing here reaches beyond 127.0.0.1.
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { base64urlEncode, keyId, verifyEnrollmentMac, type OrgState, type SignedOrgState } from 'org-protocol';
import { encodeEnrollmentCodeV2, type EnrollmentIssued, type EnrollmentKey } from 'desk-hub/protocol';
import { Person } from '../../apps/desk-hub/deploy/hub';
import { newAdminDevice, OrgAdmin, type AdminDevice } from '../../apps/desk-hub/deploy/org-admin';

const RUNNER = resolve(import.meta.dirname, '../../apps/desk-hub/local/run.ts');
/** The local runner's org and its configured admin (local/run.ts). */
export const LOCAL_ORG = 'local';
export const LOCAL_ADMIN = 'owner@example.com';
const IDENTITY_HEADER = 'x-desk-standin-user'; // local/standin.ts

/** A person signed in through the stand-in's test identity, in place of an Access token. */
class StandinPerson extends Person {
  readonly #email: string;
  constructor(hub: string, email: string) {
    super(hub, 'unused');
    this.#email = email;
  }
  override get headers(): Record<string, string> {
    return { [IDENTITY_HEADER]: this.#email };
  }
}

export type LocalHub = {
  url: string;
  person(email?: string): Person;
  /** The org's admin, its device the genesis's root (posted at the first call). */
  admin(): Promise<Member>;
  stop(): Promise<void>;
};

const answers = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = connect({ host: '127.0.0.1', port }, () => (socket.destroy(), done(true)));
    socket.on('error', () => done(false));
  });

/** Starts the runner on a free port pair and waits (60 s at most) until the hub answers through its stand-in. */
export async function startLocalHub(): Promise<LocalHub> {
  const state = fs.mkdtempSync(join(tmpdir(), 'endpoint-hub-'));
  let child: ChildProcess | null = null;
  let url = '';
  for (let attempt = 0; attempt < 5 && child === null; attempt++) {
    const port = 20_000 + 2 * Math.floor(Math.random() * 15_000);
    if ((await answers(port)) || (await answers(port + 1))) continue;
    const started = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', RUNNER, '--port', String(port), '--state', state], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    let output = '';
    started.stdout?.on('data', (chunk) => (output += String(chunk)));
    started.stderr?.on('data', (chunk) => (output += String(chunk)));
    url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 60_000;
    for (;;) {
      if (started.exitCode !== null) break;
      const ok = await fetch(`${url}/api/me`, { headers: { [IDENTITY_HEADER]: LOCAL_ADMIN } }).then(
        (r) => r.status === 200,
        () => false,
      );
      if (ok) {
        child = started;
        break;
      }
      if (Date.now() > deadline) {
        kill(started);
        throw new Error(`the local hub did not answer within 60 s:\n${output.slice(-2000)}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (child === null) throw new Error('the local hub could not take a free port');
  const running = child;
  let admin: Promise<Member> | null = null;
  return {
    url,
    person: (email = LOCAL_ADMIN) => new StandinPerson(url, email),
    admin: () => (admin ??= Member.open(new StandinPerson(url, LOCAL_ADMIN))),
    async stop() {
      kill(running);
      await new Promise((r) => (running.exitCode !== null ? r(null) : running.once('exit', r)));
      fs.rmSync(state, { recursive: true, force: true });
    },
  };
}

function kill(child: ChildProcess): void {
  try {
    process.kill(-(child.pid as number), 'SIGTERM');
  } catch {
    // already gone
  }
}

/** A code the member's app builds, and the pairing secret it keeps to check the machine's MAC. */
export type IssuedCode = { code: string; k: Uint8Array; token: string; enrollment: string };

/**
 * The member's side of an enrollment, as the admin's app does it: a v2 code around a fresh pairing secret `k`, the MAC
 * the machine posted checked under `k` before the machine is signed into the state, and the state's successors.
 */
export class Member {
  private constructor(
    readonly person: Person,
    readonly admin: OrgAdmin,
    readonly device: AdminDevice,
  ) {}

  static async open(person: Person): Promise<Member> {
    const device = await newAdminDevice('a1');
    return new Member(person, await OrgAdmin.open(person, { org: LOCAL_ORG, throwaway: true }, device, () => {}), device);
  }

  get id(): string {
    return this.admin.member;
  }

  async head(): Promise<SignedOrgState> {
    return this.admin.read();
  }

  /** A v2 enrollment code, naming `machine` for a re-enrollment in place. */
  async code(machine?: string): Promise<IssuedCode> {
    const issued = await this.person.json<EnrollmentIssued>('/api/enrollments', { body: machine === undefined ? {} : { machine } }, 201);
    const k = crypto.getRandomValues(new Uint8Array(32));
    const { root } = (await this.head()).state;
    const code = encodeEnrollmentCodeV2({ hub: this.person.hub, token: issued.token, roots: root.keys, recoveryPub: root.recoveryPub, k: base64urlEncode(k) });
    return { code, k, token: issued.token, enrollment: issued.enrollment.id };
  }

  /** The key the hub holds for an enrollment once the machine posted it (waiting up to `waitMs`), or null. */
  async awaitPosted(enrollment: string, waitMs = 30_000): Promise<EnrollmentKey | null> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const response = await this.person.fetch(`/api/enrollments/${enrollment}/key`);
      if (response.status === 200) return (await response.json()) as EnrollmentKey;
      await response.body?.cancel();
      if (Date.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** The key the hub holds for an enrollment, and whether its MAC verifies under `k` (the member's check). */
  async posted(enrollment: string, k: Uint8Array): Promise<{ key: EnrollmentKey; macOk: boolean }> {
    const key = await this.person.json<EnrollmentKey>(`/api/enrollments/${enrollment}/key`);
    const macOk = await verifyEnrollmentMac(k, { name: key.machine, machinePub: key.pub, ref: key.ref, tokenId: enrollment }, key.mac);
    return { key, macOk };
  }

  /** Signs the machine the hub holds for `enrollment` into the state, after its MAC checks out; throws otherwise. */
  async list(enrollment: string, k: Uint8Array): Promise<SignedOrgState> {
    const { key, macOk } = await this.posted(enrollment, k);
    if (!macOk) throw new Error('the key the hub holds is not the one the machine posted under the pairing secret');
    // A re-enrolled machine's entry takes its new key, the old one retiring in the same step (RL DL 24).
    const before = (await this.head()).state.machines.find((m) => m.ref === key.ref);
    const retired = before === undefined || before.pub === key.pub ? null : { keyId: await keyId(before.pub), pub: before.pub, notAfter: new Date().toISOString(), holder: { machine: key.ref } };
    const signed = await this.amend(`${key.machine} listed`, (s) => {
      const at = s.machines.findIndex((m) => m.ref === key.ref);
      if (at >= 0) s.machines[at] = { ...s.machines[at], pub: key.pub };
      else s.machines.push({ name: key.machine, ref: key.ref, pub: key.pub, owners: [this.id] });
      if (retired !== null) s.retired.push(retired);
      if (!s.machineNames.some((n) => n.ref === key.ref)) s.machineNames.push({ name: key.machine, ref: key.ref });
    });
    return signed!;
  }

  amend(what: string, edit: (s: OrgState) => boolean | void): Promise<SignedOrgState | null> {
    return this.admin.amend(what, edit);
  }
}
