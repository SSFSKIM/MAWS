// The delegations this Mac creates, renews and drops (P5 O8 M4c, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// M4c's "The create transaction", "Renew", "Drop" and Proves; the refresh's items 7, 8, 9 and 14; Interfaces §S).
//
// Composed as the session composes it, over real parts: the held view (held.ts over real files in a temporary profile),
// the signing store and the signer with its unsent slot, the state signer behind an injected confirmation (no system
// prompt), Task 3's secret store over a fake `gcloud` first on a scratch PATH that records its argv and stdin to files
// the tests read, and the destination's own file. The hub answers from its own state as the real routes do: it takes a
// post `verifySuccessor` accepts, mints `201 {key, token}`, lists revoked keys, revokes softly, and renews from the head
// it holds, by §S's rules. A sign-out is the session's: the signer fenced and the part fenced, the context gone.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  base64urlEncode,
  decodeProvisioningCodeV2,
  generateSigningKey,
  keyId,
  MAX_PROVISIONING_KEY_TTL_S,
  MAX_PROVISIONING_KEY_USES,
  MIN_PROVISIONING_KEY_TTL_S,
  NEVER_OFFLINE,
  NO_CERTIFICATES,
  NO_USE_CAP,
  signOrgState,
  verifySuccessor,
  type Device,
  type OrgState,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';

vi.mock('electron', () => ({ systemPreferences: { promptTouchID: () => Promise.reject(new Error('no system prompt in the suites')) } }));

import { DELEGATION_MAX_USES, DELEGATION_TTL_DAYS, DelegationResultSchema, OrgViewSchema, type DelegationCreateInput, type DelegationResult, type OrgChange, type OrgView, type ProvisioningSecret, type SignResult } from '@shared/ipc/schema/org';
import { createStateSigner, type Confirmation, type StepUpPrompt } from '../device/step-up';
import { checkSuccessor } from './checks';
import { createDelegations, type Delegations } from './delegations';
import { composeChange } from './edits';
import { orgFiles, type Anchor, type OrgFiles } from './files';
import { startHeldOrg, type HeldOrg } from './held';
import type { HubClient, HubResult, ProvisioningKey, ProvisioningKeyRoutes, Served } from './hub-client';
import { openProvisioningSecret, PROVISIONING_SECRET_FILE } from './provisioning-secret-store';
import { ProvisioningCode, resolveGcloud, secretStore } from './secret-store';
import { heldOrgSession, type SignedIn } from './session';
import { createOrgSigner, noChangeEdit, RefusedEdit, StaleEdit, successorDraft, type OrgSigner } from './signer';
import { createSigningStore, type SigningStore } from './signing-store';
import { orgView } from './view';

const ORG = 'org-delegations';
const HUB_URL = 'https://hub.example.test';
const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const DEST: ProvisioningSecret = { project: 'maws-example-prod', secret: 'desk-provisioning-v2', account: 'cli-owner@maws-example-prod.iam.gserviceaccount.com' };
const OWNER = hex();
const SELF = { member: OWNER, device: 'dev-app' };

// ---- the org: this Mac's device, a root of an admin; the recovery key ----

type TestDevice = { device: Device; channel: SigningKey; stepUp: SigningKey };
let org: { app: TestDevice; recovery: SigningKey } | null = null;
async function keys() {
  if (org === null) {
    const channel = await generateSigningKey();
    const stepUp = await generateSigningKey();
    org = { app: { channel, stepUp, device: { id: SELF.device, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } }, recovery: await generateSigningKey() };
  }
  return org;
}

async function genesis(): Promise<SignedOrgState> {
  const { app, recovery } = await keys();
  const state: OrgState = {
    org: ORG,
    version: 1,
    prev: null,
    issued: iso(Date.now() - 10 * DAY_MS),
    root: { keys: [await keyId(app.stepUp.pub)], recoveryPub: recovery.pub },
    members: [{ id: OWNER, email: 'owner@example.com', role: 'admin', devices: [app.device] }],
    machines: [],
    machineNames: [],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
  return signOrgState(state, [app.stepUp]);
}

// ---- the hub ----

type Answer<T> = HubResult<T> | undefined;
const status = (code: number, error: string): HubResult<never> => ({ ok: false, kind: 'status', status: code, error });

/** The hub's org chain (posts judged by `verifySuccessor`) and its provisioning keys, answered as the Worker's routes do. */
class FakeHub implements HubClient, ProvisioningKeyRoutes {
  states: SignedOrgState[];
  posts: SignedOrgState[] = [];
  keys: Array<ProvisioningKey & { token: string }> = [];
  mints: unknown[] = [];
  renews: string[] = [];
  revokes: string[] = [];
  /** Runs at a mint before it is answered (a test holds it open here). */
  beforeMint: (() => Promise<void> | void) | null = null;
  mintAnswer: ((key: ProvisioningKey, token: string) => Answer<{ key: ProvisioningKey; token: string }>) | null = null;
  renewAnswer: ((id: string) => Answer<ProvisioningKey> | 'lost') | null = null;
  revokeAnswer: ((id: string) => Answer<'revoked' | 'absent'>) | null = null;
  listAnswer: (() => Answer<{ keys: ProvisioningKey[] }>) | null = null;
  /** Each held open by a test before it is answered: a renew, a DELETE, a post. */
  beforeRenew: (() => Promise<void> | void) | null = null;
  beforeRevoke: (() => Promise<void> | void) | null = null;
  beforePost: (() => Promise<void> | void) | null = null;
  beforeList: (() => Promise<void> | void) | null = null;
  /** Every request made through `as(credential)`, with the credential (the sign-in) it carried. */
  calls: Array<{ method: string; credential: number }> = [];

  constructor(states: SignedOrgState[]) {
    this.states = [...states];
  }

  get head(): SignedOrgState {
    return this.states.at(-1)!;
  }

  /** This hub as one sign-in's credential reaches it: each request recorded with `credential`. */
  as(credential: number): FakeHub {
    return new Proxy(this, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== 'function' || !REQUESTS.has(String(property))) return value;
        return (...args: unknown[]) => {
          target.calls.push({ method: String(property), credential });
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  }

  async postState(signed: SignedOrgState): Promise<HubResult<{ version: number }>> {
    await this.beforePost?.();
    this.posts.push(signed);
    const verdict = await verifySuccessor(this.head, signed, []);
    if (!verdict.ok) return status(409, verdict.code);
    this.states.push(signed);
    return { ok: true, value: { version: signed.state.version } };
  }

  async chain(since: number): Promise<HubResult<Served>> {
    return { ok: true, value: { chain: this.states.filter((s) => s.state.version > since), head: this.head, transitions: [], certificates: NO_CERTIFICATES } };
  }

  async mintProvisioningKey(body: { label: string; prefix: string; ttl_s: number; max_uses?: number }) {
    this.mints.push(structuredClone(body));
    // minted (and listed) before its answer arrives
    const now = Date.now();
    const key: ProvisioningKey = { id: hex(), label: body.label, prefix: body.prefix, created: iso(now), expires: iso(now + body.ttl_s * 1000), max_uses: body.max_uses ?? null, uses: 0, revoked: null };
    const token = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    this.keys.push({ ...key, token });
    await this.beforeMint?.();
    return this.mintAnswer?.(key, token) ?? { ok: true as const, value: { key, token } };
  }

  async renewProvisioningKey(id: string): Promise<HubResult<ProvisioningKey>> {
    this.renews.push(id);
    await this.beforeRenew?.();
    const override = this.renewAnswer?.(id);
    if (override !== undefined && override !== 'lost') return override;
    const key = this.keys.find((k) => k.id === id);
    if (key === undefined) return status(404, 'unknown-key');
    if (key.revoked !== null) return status(410, 'key-revoked');
    if (Date.parse(key.expires) <= Date.now()) return status(410, 'key-expired');
    // §S: the new expiry is the head's delegation's, verbatim, and only a later one
    const delegation = this.head.state.delegations.find((d) => d.id === id);
    if (delegation === undefined || Date.parse(delegation.expires) <= Date.parse(key.expires)) return status(409, 'not-renewed');
    if (Date.parse(delegation.expires) > Date.now() + MAX_PROVISIONING_KEY_TTL_S * 1000) return status(409, 'too-long');
    key.expires = delegation.expires;
    if (override === 'lost') return { ok: false, kind: 'unreachable', detail: 'the answer was lost' };
    return { ok: true, value: listed(key) };
  }

  async revokeProvisioningKey(id: string): Promise<HubResult<'revoked' | 'absent'>> {
    this.revokes.push(id);
    await this.beforeRevoke?.();
    const override = this.revokeAnswer?.(id);
    if (override !== undefined) return override;
    const key = this.keys.find((k) => k.id === id);
    if (key === undefined) return { ok: true, value: 'absent' };
    key.revoked ??= iso(Date.now());
    return { ok: true, value: 'revoked' };
  }

  async provisioningKeys(): Promise<HubResult<{ keys: ProvisioningKey[] }>> {
    // the list as it stands when asked, answered once the test lets it
    const keys = this.keys.map(listed);
    await this.beforeList?.();
    return this.listAnswer?.() ?? { ok: true, value: { keys } };
  }

  key(id: string | null | undefined) {
    return this.keys.find((k) => k.id === id);
  }

  me(): never {
    throw new Error('unused');
  }
  state(): never {
    throw new Error('unused');
  }
  postPending(): never {
    throw new Error('unused');
  }
  pendingOf(): never {
    throw new Error('unused');
  }
  mintEnrollment(): never {
    throw new Error('unused');
  }
  enrollmentKey(): never {
    throw new Error('unused');
  }
  machines(): never {
    throw new Error('unused');
  }
  deleteMachine(): never {
    throw new Error('unused');
  }
}
/** The requests `as` records. */
const REQUESTS = new Set(['postState', 'chain', 'mintProvisioningKey', 'renewProvisioningKey', 'revokeProvisioningKey', 'provisioningKeys']);
const listed = ({ id, label, prefix, created, expires, max_uses, uses, revoked }: ProvisioningKey): ProvisioningKey => ({ id, label, prefix, created, expires, max_uses, uses, revoked });

// ---- the fake gcloud (Task 3's, with a call that waits for the test) ----

// One line of argv per call, stdin appended to stdin.log. What it does is read from `act-<op>`: `ok` (the default),
// `fail:<line>` (after reading stdin), `early:<line>` (before reading it), `wait` (writes `waiting-<op>`, then answers
// as `ok` once `release-<op>` exists), `hold` (its stdin left unread, its pid in `hold-<op>.pid`, until it is killed).
const FAKE = `#!/bin/sh
dir=$(cd "$(dirname "$0")" && pwd)
{ printf 'gcloud'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> "$dir/argv.log"
case "$1 $2 $3" in
  "auth print-access-token "*) op=auth ;;
  "secrets describe "*) op=describe ;;
  "secrets versions add") op=add ;;
  "secrets versions describe") op=version ;;
  "secrets versions access") op=access ;;
  *) op=other ;;
esac
act=$(cat "$dir/act-$op" 2>/dev/null || echo ok)
case "$act" in
  early:*) printf 'ERROR: (gcloud.%s) %s\\n' "$op" "\${act#early:}" >&2; exit 1 ;;
  hold) echo $$ > "$dir/hold-$op.pid"; exec sleep 30 ;;
esac
cat >> "$dir/stdin.log"
case "$act" in
  wait) : > "$dir/waiting-$op"; while [ ! -f "$dir/release-$op" ]; do sleep 0.02; done; rm -f "$dir/release-$op" "$dir/waiting-$op" ;;
  fail:*) printf 'ERROR: (gcloud.%s) %s\\n' "$op" "\${act#fail:}" >&2; exit 1 ;;
esac
case "$op" in
  auth) printf 'ya29.fake-access-token\\n' ;;
  describe) printf 'name: projects/123456/secrets/%s\\n' "$3" ;;
  add) n=$(( $(cat "$dir/versions" 2>/dev/null || echo 6) + 1 )); echo "$n" > "$dir/versions"
    printf 'Created version [%s] of the secret [%s].\\n' "$n" "$4" >&2 ;;
  version) printf '{\\n  "createTime": "2026-11-08T12:00:00.123456Z",\\n  "name": "projects/123456/secrets/%s/versions/%s",\\n  "state": "ENABLED"\\n}\\n' "$6" "$4" ;;
esac
exit 0
`;

// ---- the composition ----

type Harness = {
  profile: string;
  bin: string;
  hub: FakeHub;
  held: HeldOrg;
  store: SigningStore;
  signer: OrgSigner;
  part: Delegations;
  logs: string[];
  prompts: StepUpPrompt[];
  /** What the person answers; `during` runs while they are asked. */
  answer: Confirmation;
  during: (() => Promise<void> | void) | null;
  /** The answers every create, rewrite and hub half gave, kept to search for the code. */
  answers: unknown[];
  /** Every code holder handed to gcloud's \`versions add\`. */
  codes: ProvisioningCode[];
  /** When set, gcloud's resolver waits on it (a test holds a step's resolver open). */
  resolving: (() => Promise<void>) | null;
  online: boolean;
  signedIn: boolean;
  signIn: number;
  create(input?: Partial<DelegationCreateInput>): Promise<DelegationResult>;
  /** "Write the code again" for `id`, naming the run and the slot as the page would show them now. */
  rewrite(id: string): Promise<DelegationResult>;
  view(): Promise<OrgView>;
  signOut(): void;
  signInAgain(): void;
  close(): Promise<void>;
  /** The next start of the same profile: the files read again; a new held view, store, signer and part. `crash`: the old run is never closed. */
  restart(options?: { crash?: boolean }): Promise<Harness>;
  discard(): Promise<void>;
  /** A change signed through the signer as `org.change` signs it (renew, drop). */
  change(change: OrgChange): Promise<SignResult>;
};

const INPUT: DelegationCreateInput = { label: 'devcloud VMs', prefix: 'dc-', ttlDays: 30, maxUses: null, owners: [OWNER] };
const scratches: string[] = [];
afterEach(async () => {
  await Promise.all(scratches.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function harness(options: { destination?: ProvisioningSecret | null; gcloud?: boolean } = {}): Promise<Harness> {
  const g = await genesis();
  const profile = await mkdtemp(join(tmpdir(), 'maws-delegations-'));
  scratches.push(profile);
  const bin = join(profile, 'scratch-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'gcloud'), FAKE);
  await chmod(join(bin, 'gcloud'), 0o755);
  const destination = openProvisioningSecret(join(profile, PROVISIONING_SECRET_FILE));
  if (options.destination !== null) destination.write(options.destination ?? DEST);
  const files: OrgFiles = orgFiles({ userData: profile, log: () => {} });
  expect(await files.ensure()).toEqual({ ok: true });
  let anchor: Anchor | null = null;
  const saveAnchor = async (next: Anchor) => void (anchor = next);
  const first = await startHeldOrg({ files, anchor: null, saveAnchor, pins: { roots: g.state.root.keys, recoveryPub: g.state.root.recoveryPub }, first: { chain: [g], transitions: [], certificates: NO_CERTIFICATES }, log: () => {} });
  if (!first.ok) throw new Error(first.reason);
  const hub = new FakeHub([g]);
  const logs: string[] = [];
  const registration: { signing?: true } = {};
  const resolver = { wait: null as (() => Promise<void>) | null };
  const codes: ProvisioningCode[] = [];
  const custody = secretStore({
    gcloud: async () => {
      await resolver.wait?.();
      return resolveGcloud({ loginPath: async () => (options.gcloud === false ? join(profile, 'no-gcloud-here') : `${bin}:/usr/bin:/bin`), home: profile, fallbacks: [] });
    },
    log: (line) => void logs.push(line),
    timeoutMs: 20_000,
  });
  const secrets: typeof custody = { ...custody, addVersion: (dest, code, signal) => (codes.push(code), custody.addVersion(dest, code, signal)) };

  async function compose(held: HeldOrg, carried?: Partial<Harness>): Promise<Harness> {
    let commits: Promise<unknown> = Promise.resolve();
    const commit = <T>(body: () => Promise<T>): Promise<T> => {
      const turn = commits.then(body);
      commits = turn.catch(() => {});
      return turn;
    };
    const store = await createSigningStore({
      files,
      commit,
      registration: () => registration,
      markRegistration: async () => {
        await files.write('registration.json', { signing: true });
        registration.signing = true;
      },
    });
    const session = heldOrgSession({} as SignedIn);
    held.onAdopted(() => session.changed());
    const h = { profile, bin, hub, held, store, logs, prompts: [] as StepUpPrompt[], answer: { ok: true } as Confirmation, during: null, answers: carried?.answers ?? [], codes, online: true, signedIn: true, signIn: carried?.signIn ?? 1 } as unknown as Harness;
    Object.defineProperty(h, 'resolving', { get: () => resolver.wait, set: (wait: (() => Promise<void>) | null) => void (resolver.wait = wait) });
    const stateSigner = await createStateSigner({
      key: (await keys()).app.stepUp,
      confirm: async (prompt) => {
        h.prompts.push(prompt);
        await h.during?.();
        return h.answer;
      },
    });
    h.signer = createOrgSigner({
      session,
      held: () => held,
      signer: () => stateSigner,
      marked: () => true,
      hub: () => (h.online ? hub.as(h.signIn) : null),
      store,
      deliveries: { obligation: () => null, send: async () => {} },
      settled: (slot) => h.part.settled(slot),
      log: (line) => void logs.push(line),
    });
    h.part = createDelegations({
      context: () => (h.signedIn ? { hub: HUB_URL, self: SELF, head: held.head(), certificates: held.certificates(), client: h.online ? hub.as(h.signIn) : null, signIn: h.signIn } : null),
      standing: () => (h.signedIn ? null : { ok: false, reason: 'not-root', detail: 'this Mac is not signed in to the org' }),
      busy: () => false,
      signer: () => h.signer,
      // the session's preview path: composed on a fresh draft of the head and checked as the signer checks it
      async check(change) {
        const head = held.head();
        try {
          const edit = await composeChange(head.state, change, SELF, held.certificates());
          const draft = await successorDraft(head, Date.now());
          await edit.apply(draft);
          const refusals = (await checkSuccessor(head.state, draft, held.superseded(), new Date(), { certificates: held.certificates() })).filter((f) => f.level === 'refuse');
          return refusals.length === 0 ? null : { ok: false, reason: 'refused', detail: refusals.map((f) => f.detail).join('; ') };
        } catch (error) {
          if (error instanceof RefusedEdit) return { ok: false, reason: 'refused', detail: error.message };
          if (error instanceof StaleEdit) return { ok: false, reason: 'stale', detail: error.message };
          return { ok: false, reason: 'invalid', detail: (error as Error).message };
        }
      },
      stateAt: (version) => held.since(version - 1).states.find((s) => s.state.version === version)?.state ?? null,
      slotState: () => {
        const file = store.get();
        return file === 'damaged' || file.pending === null ? null : file.pending.signed.state;
      },
      secrets,
      destination,
      changed: () => {},
      log: (line) => void logs.push(line),
    });
    const kept = <T>(answer: Promise<T>) => answer.then((a) => (h.answers.push(a), a));
    h.create = (input = {}) => kept(h.part.create({ ...INPUT, ...input }));
    h.rewrite = (id) => kept(h.part.rewrite({ id, generation: h.part.viewInputs().unsent?.generation ?? 1, hash: h.signer.pending()?.hash ?? 'no-slot' }));
    h.view = async () => {
      await h.part.readKeys();
      const file = store.get();
      const slot = file === 'damaged' || file.pending === null ? null : { state: file.pending.signed.state, unsent: file.pending.unsent };
      const history = (id: string) => [...held.since(0).states].reverse().find((s) => s.state.delegations.some((d) => d.id === id))?.state.delegations.find((d) => d.id === id);
      const view = await orgView(held.head().state, SELF, h.signer.maySign(), held.certificates(), new Date(), null, { ...h.part.viewInputs(), slot, history });
      expect(OrgViewSchema.parse(view)).toEqual(view);
      h.answers.push(view);
      return view;
    };
    h.signOut = () => {
      h.signedIn = false;
      h.signIn++;
      session.set(null);
      h.signer.fence();
      h.part.fence();
    };
    h.signInAgain = () => {
      h.signedIn = true;
      session.set({} as SignedIn);
    };
    h.close = async () => {
      await Promise.all([h.signer.close(), h.part.close()]);
    };
    h.restart = async ({ crash = false } = {}) => {
      if (!crash) await h.close();
      const again = await startHeldOrg({ files, anchor, saveAnchor, log: () => {} });
      if (!again.ok) throw new Error(again.reason);
      const next = await compose(again.held, { answers: h.answers, signIn: h.signIn + 1 });
      await next.signer.settle();
      return next;
    };
    h.discard = async () => {
      const slot = h.signer.pending();
      if (slot === null) throw new Error('nothing to discard');
      const outcome = await h.signer.discardPending(true, slot.hash);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) await h.part.discarded(outcome.marker);
    };
    h.change = async (change) => {
      const edit = await composeChange(held.head().state, change, SELF, held.certificates());
      const outcome = await h.signer.sign(edit);
      await h.part.idle();
      return outcome.ok ? { ok: true, version: outcome.version } : { ok: false, reason: outcome.reason === 'refused' ? 'refused' : outcome.reason };
    };
    return h;
  }
  return compose(first.held);
}

const recorded = async (h: Harness, name: string) => readFile(join(h.bin, name), 'utf8').catch(() => '');
const argv = async (h: Harness) => (await recorded(h, 'argv.log')).split('\n').filter((l) => l !== '');
const act = (h: Harness, op: string, what: string) => writeFile(join(h.bin, `act-${op}`), what);
async function waiting(h: Harness, op: string): Promise<void> {
  await until(() => existsSync(join(h.bin, `waiting-${op}`)), `gcloud's ${op} to be out`);
}
const release = (h: Harness, op: string) => writeFile(join(h.bin, `release-${op}`), '');
async function until(check: () => boolean | Promise<boolean>, what: string, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
/** A gate a test opens: `wait()` resolves once `open()` is called. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  let reached!: () => void;
  const atGate = new Promise<void>((resolve) => (reached = resolve));
  return {
    wait: () => {
      reached();
      return opened;
    },
    open,
    reached: atGate,
  };
}
const inEffect = (h: Harness, id: string | undefined) => h.hub.head.state.delegations.some((d) => d.id === id);
const lastMinted = (h: Harness) => h.hub.keys.at(-1);
/** Every file under `dir`, recursively, as text. */
async function everyFile(dir: string): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await everyFile(path)));
    else if (entry.isFile()) out.push({ path, text: await readFile(path, 'utf8') });
  }
  return out;
}

describe('the sheet\'s bounds', () => {
  it("are org-protocol's: whole days from MIN to MAX_PROVISIONING_KEY_TTL_S, a cap up to MAX_PROVISIONING_KEY_USES", () => {
    expect(DELEGATION_TTL_DAYS.min * DAY_MS >= MIN_PROVISIONING_KEY_TTL_S * 1000).toBe(true);
    expect((DELEGATION_TTL_DAYS.min - 1) * DAY_MS < MIN_PROVISIONING_KEY_TTL_S * 1000 || DELEGATION_TTL_DAYS.min === 1).toBe(true);
    expect(DELEGATION_TTL_DAYS.max).toBe(Math.floor(MAX_PROVISIONING_KEY_TTL_S / 86_400));
    expect(DELEGATION_MAX_USES).toBe(MAX_PROVISIONING_KEY_USES);
  });
});

describe('the create transaction', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('mints as delegationCreate does, signs the delegation unsent with one Touch ID, stores its code by describe, then publishes and settles', async () => {
    const before = Date.now();
    const answer = await h.create();
    const after = Date.now();
    expect(DelegationResultSchema.parse(answer)).toEqual(answer);
    const minted = lastMinted(h)!;
    expect(h.hub.mints).toEqual([{ label: 'devcloud VMs', prefix: 'dc-', ttl_s: 30 * 86_400 }]); // uncapped: no max_uses
    expect(answer).toEqual({ ok: true, version: 2, secret: { version: '7', createTime: '2026-11-08T12:00:00.123Z' }, run: { generation: 1, id: minted.id, hash: expect.any(String) }, rev: h.part.status().rev });
    // one Touch ID, naming the destination in its lines
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0].summary).toBe('create delegation dc-');
    expect(h.prompts[0].text).toContain(`${DEST.project}/${DEST.secret}`);
    // the signed delegation, as admin's: expires from the time taken just before the mint; no cap and never offline
    const delegation = h.hub.head.state.delegations.find((d) => d.id === minted.id)!;
    expect(Date.parse(delegation.expires)).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(Date.parse(delegation.expires)).toBeLessThanOrEqual(after + 30 * DAY_MS);
    expect(delegation).toMatchObject({ prefix: 'dc-', maxUses: NO_USE_CAP, offlineRevokeS: NEVER_OFFLINE, owners: [OWNER] });
    // gcloud: the preflight, the version added with the code on stdin, its metadata read, never its value
    expect(await argv(h)).toEqual([
      `gcloud auth print-access-token --account ${DEST.account}`,
      `gcloud secrets describe ${DEST.secret} --project ${DEST.project} --account ${DEST.account}`,
      `gcloud secrets versions add ${DEST.secret} --project ${DEST.project} --account ${DEST.account} --data-file=-`,
      `gcloud secrets versions describe 7 --secret ${DEST.secret} --project ${DEST.project} --account ${DEST.account} --format=json`,
    ]);
    // the code the store received: the hub, the org's pins, the minted token and the private half of the signed key
    const code = decodeProvisioningCodeV2((await recorded(h, 'stdin.log')).trim());
    expect(code).toMatchObject({ hub: HUB_URL, org: ORG, roots: h.hub.head.state.root.keys, recoveryPub: h.hub.head.state.root.recoveryPub, token: minted.token, delegation: { id: minted.id, prefix: 'dc-' } });
    const pub = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: code.delegation.privateJwk.x, y: code.delegation.privateJwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    expect(base64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pub)))).toBe(delegation.pub);
    // published and settled: the held head holds it, the slot is empty
    expect(h.held.head().state.version).toBe(2);
    expect(h.signer.pending()).toBeNull();
    expect(inEffect(h, minted.id)).toBe(true);
    const view = await h.view();
    expect(view.delegations).toEqual([
      { id: minted.id, prefix: 'dc-', owners: [OWNER], expires: delegation.expires, maxUses: null, machines: [], hub: { expires: minted.expires, uses: 0, revoked: false }, state: 'in-effect', unsent: null, hubBehind: null, hubProblem: null },
    ]);
    expect(view.strayKeys).toEqual([]);
  });

  it('sends a chosen cap as max_uses and signs it', async () => {
    expect(await h.create({ maxUses: 25, ttlDays: 7 })).toMatchObject({ ok: true });
    expect(h.hub.mints).toEqual([{ label: 'devcloud VMs', prefix: 'dc-', ttl_s: 7 * 86_400, max_uses: 25 }]);
    expect(h.hub.head.state.delegations[0].maxUses).toBe(25);
    expect((await h.view()).delegations[0].maxUses).toBe(25);
  });

  it('keeps the code on the fake gcloud\'s stdin and nowhere else: no log, no file of the profile, no answer or view, no argv', async () => {
    expect(await h.create()).toMatchObject({ ok: true });
    await h.view();
    // a failing store and a rewrite too, so the failure's words are searched as well
    await act(h, 'add', 'fail:INTERNAL: something broke');
    await h.create({ prefix: 'ci-' });
    await act(h, 'add', 'ok');
    await h.rewrite(lastMinted(h)!.id);
    await h.view();
    const stdin = await recorded(h, 'stdin.log');
    const codes = stdin.split('\n').filter((line) => line.startsWith('smns-provision-v2.'));
    expect(codes).toHaveLength(3);
    const secrets = codes.flatMap((text) => {
      const decoded = decodeProvisioningCodeV2(text);
      return [text, decoded.token, decoded.delegation.privateJwk.d!];
    });
    const files = (await everyFile(h.profile)).filter((f) => !f.path.endsWith('stdin.log'));
    const places = [...files.map((f) => [f.path, f.text] as const), ['log', h.logs.join('\n')] as const, ['answers', JSON.stringify(h.answers)] as const, ['argv', (await argv(h)).join('\n')] as const];
    for (const [where, text] of places) for (const secret of secrets) expect(text.includes(secret), `${where} holds a piece of the code`).toBe(false);
  });

  it('a failed store leaves the slot unsent with the reason; "Write the code again" stores and publishes it', async () => {
    await act(h, 'add', 'fail:INTERNAL: the backend is down');
    const failed = await h.create();
    expect(failed).toMatchObject({ ok: false, reason: 'unsent' });
    expect((failed as { detail: string }).detail).toContain('INTERNAL: the backend is down');
    const id = lastMinted(h)!.id;
    expect(h.signer.pending()).toMatchObject({ unsent: { kind: 'delegation', id } });
    expect(h.hub.posts).toEqual([]);
    const row = (await h.view()).delegations.find((d) => d.id === id)!;
    expect(row).toMatchObject({ state: 'unsent', unsent: { rewrite: true, problem: (failed as { detail: string }).detail }, hubBehind: null });
    expect((await h.view()).strayKeys).toEqual([]); // the unsent slot names it
    await act(h, 'add', 'ok');
    expect(await h.rewrite(id)).toMatchObject({ ok: true, secret: { version: '7' } });
    expect(inEffect(h, id)).toBe(true);
    expect(h.prompts).toHaveLength(1); // no second Touch ID
    expect((await h.view()).delegations.find((d) => d.id === id)).toMatchObject({ state: 'in-effect', unsent: null });
  });

  it('a may-have-succeeded store is confirmed by describe before it counts as stored', async () => {
    // gcloud announces the version, then fails its own checksum check: the version is confirmed, then published
    await writeFile(join(h.bin, 'act-add'), 'ok');
    const fake = await readFile(join(h.bin, 'gcloud'), 'utf8');
    await writeFile(join(h.bin, 'gcloud'), fake.replace("  fail:*) printf", "  created-fail) printf 'Created version [9] of the secret [%s].\\nERROR: (gcloud.secrets.versions.add) Secret version was created, but the data checksum could not be confirmed.\\n' \"$4\" >&2; exit 1 ;;\n  fail:*) printf"));
    await act(h, 'add', 'created-fail');
    expect(await h.create()).toMatchObject({ ok: true, secret: { version: '9' } });
    expect((await argv(h)).at(-1)).toContain('versions describe 9');
    // a failed describe of an announced version leaves it unsent
    await act(h, 'version', 'fail:NOT_FOUND: no such version');
    expect(await h.create({ prefix: 'ci-' })).toMatchObject({ ok: false, reason: 'unsent' });
    expect(h.signer.pending()?.unsent).toMatchObject({ kind: 'delegation' });
  });

  it('a publish refused while the run stands, before its marker cleared: the reason kept, Discard alone, a rewrite stale, and Discard revokes the minted key', async () => {
    // The signer's own refusal, its update clearing nothing: the record of the slot this run held is gone (as a
    // sign-out drops it) while the create's run still stands.
    const publishHeld = h.signer.publishHeld;
    h.signer.publishHeld = (hash) => {
      h.signer.fence();
      return publishHeld(hash);
    };
    const refused = await h.create();
    h.signer.publishHeld = publishHeld;
    const id = lastMinted(h)!.id;
    const slot = h.signer.pending()!;
    expect(slot).toMatchObject({ unsent: { kind: 'delegation', id }, exposed: false });
    expect(h.hub.posts).toEqual([]);
    // The kept reason: stored, then refused, so only Discard; the key pair went before the publish.
    expect(refused).toMatchObject({ ok: false, reason: 'unsent', phase: 'held', stored: true, run: { id, hash: slot.hash } });
    const reason = (refused as { detail: string }).detail;
    expect(reason).toBe('its code is stored (version 7), but the publish was refused: this slot was held by a run that has ended: only Discard; only Discard');
    expect((await h.view()).delegations).toMatchObject([{ id, state: 'unsent', unsent: { rewrite: false, problem: reason } }]);
    // "Write the code again", the signer publishing again, is stale: no gcloud runs, nothing is posted, the slot stays held.
    const calls = (await argv(h)).length;
    const rewritten = await h.rewrite(id);
    expect(rewritten).toMatchObject({ ok: false, reason: 'stale' });
    expect((rewritten as { detail: string }).detail).toContain("no longer holds the delegation's key pair");
    expect(await argv(h)).toHaveLength(calls);
    expect(h.hub.posts).toEqual([]);
    expect(h.signer.pending()).toMatchObject({ hash: slot.hash, unsent: { kind: 'delegation', id } });
    // Discard takes the slot, and the minted key with it.
    expect(h.hub.key(id)?.revoked).toBeNull();
    await h.discard();
    expect(h.hub.key(id)?.revoked).not.toBeNull();
    const view = await h.view();
    expect(view.delegations).toEqual([]);
    expect(view.strayKeys).toEqual([]);
    expect(h.hub.posts).toEqual([]);
  });

  it('after a relaunch only Discard is offered; Discard revokes its hub key', async () => {
    await act(h, 'add', 'fail:INTERNAL: down');
    await h.create();
    const id = lastMinted(h)!.id;
    expect((await h.view()).delegations[0].unsent).toMatchObject({ rewrite: true });
    const again = await h.restart();
    h = again;
    expect((await h.view()).delegations).toMatchObject([{ id, state: 'unsent', unsent: { rewrite: false, problem: null } }]);
    await act(h, 'add', 'ok');
    expect(await h.rewrite(id)).toMatchObject({ ok: false, reason: 'stale' });
    expect(h.signer.pending()?.unsent).toEqual({ kind: 'delegation', id });
    await h.discard();
    expect(h.hub.key(id)?.revoked).not.toBeNull();
    const view = await h.view();
    expect(view.delegations).toEqual([]);
    expect(view.strayKeys).toEqual([]);
    expect(h.hub.posts).toEqual([]);
  });

  it('a held slot survives the start, a feed\'s reopen and another signing attempt unposted', async () => {
    await act(h, 'add', 'fail:INTERNAL: down');
    await h.create();
    await h.signer.settle();
    await h.signer.settle();
    expect(await h.signer.sign(noChangeEdit())).toMatchObject({ ok: false, reason: 'pending' });
    expect(await h.create({ prefix: 'ci-' })).toMatchObject({ ok: false, reason: 'pending' });
    expect(h.hub.mints).toHaveLength(1); // the second create minted nothing
    h = await h.restart();
    await h.signer.settle();
    expect(h.hub.posts).toEqual([]);
    expect(h.signer.pending()?.unsent).not.toBeNull();
  });

  it('a store answering after Discard publishes nothing, and nothing after a replacement slot', async () => {
    await act(h, 'add', 'wait');
    const creating = h.create();
    await waiting(h, 'add');
    const id = lastMinted(h)!.id;
    await h.discard();
    // another proposal takes the slot meanwhile (the hub unreachable, so it stays pending)
    h.online = false;
    expect(await h.signer.sign(noChangeEdit())).toMatchObject({ ok: false, reason: 'hub' });
    const replacement = h.signer.pending()!.hash;
    h.online = true;
    await release(h, 'add');
    expect(await creating).toMatchObject({ ok: false });
    expect(h.signer.pending()?.hash).toBe(replacement);
    expect(h.hub.posts.some((s) => s.state.delegations.some((d) => d.id === id))).toBe(false);
    expect(h.hub.key(id)?.revoked).not.toBeNull(); // Discard revoked it
  });

  it('a crash before publish leaves it unsent (only Discard after the relaunch); after publish\'s write, an ordinary slot that settles', async () => {
    await act(h, 'version', 'wait');
    void h.create();
    await waiting(h, 'version');
    const id = lastMinted(h)!.id;
    h = await h.restart(); // the app quit with describe out
    await release(h, 'version');
    expect((await h.view()).delegations).toMatchObject([{ id, state: 'unsent', unsent: { rewrite: false } }]);
    await h.discard();
    // the publish clears the marker, then its post finds no hub: the slot is ordinary, and settles at the next start
    await act(h, 'version', 'ok');
    await act(h, 'add', 'wait');
    const publishing = h.create({ prefix: 'ci-' });
    await waiting(h, 'add');
    h.online = false;
    await release(h, 'add');
    const answer = await publishing;
    expect(answer).toMatchObject({ ok: false, reason: 'hub' });
    const second = lastMinted(h)!.id;
    expect(h.signer.pending()).toMatchObject({ unsent: null });
    h = await h.restart();
    expect(inEffect(h, second)).toBe(true);
    expect(h.signer.pending()).toBeNull();
  });
});

describe('refusals before anything is minted', () => {
  it('a gcloud signed out, a missing secret, gcloud not found, or no or a damaged destination refuses secret-store', async () => {
    const cases: Array<[string, (h: Harness) => Promise<void>, Parameters<typeof harness>[0]]> = [
      ['not signed in as', (h) => act(h, 'auth', 'early:There was a problem refreshing your current auth tokens'), {}],
      ['no secret desk-provisioning-v2', (h) => act(h, 'describe', 'early:NOT_FOUND: Secret [desk-provisioning-v2] not found'), {}],
      ['gcloud not found', async () => {}, { gcloud: false }],
      ['no destination', async () => {}, { destination: null }],
      ['damaged', (h) => writeFile(join(h.profile, PROVISIONING_SECRET_FILE), '{"version": 9}'), {}],
    ];
    for (const [words, arrange, options] of cases) {
      const h = await harness(options);
      await arrange(h);
      const answer = await h.create();
      expect(answer, words).toMatchObject({ ok: false, reason: 'secret-store' });
      expect((answer as { detail: string }).detail, words).toContain(words);
      expect(h.hub.mints, words).toEqual([]);
      expect(h.prompts, words).toEqual([]);
      await h.close();
    }
  });

  it("the prefix's refusal, and a composition the checks refuse (an owner the org doesn't list)", async () => {
    const h = await harness();
    expect(await h.create()).toMatchObject({ ok: true });
    expect(await h.create({ prefix: 'dc-vm' })).toMatchObject({ ok: false, reason: 'refused', detail: expect.stringContaining('nests with') });
    expect(await h.create({ prefix: 'ci-', owners: [hex()] })).toMatchObject({ ok: false, reason: 'refused' });
    expect(h.hub.mints).toHaveLength(1);
    expect(h.prompts).toHaveLength(1);
    await h.close();
  });
});

describe('the mint', () => {
  it('a disagreement revokes the minted key and refuses; one whose revoke fails shows as a stray key', async () => {
    const h = await harness();
    h.hub.mintAnswer = (key, token) => ({ ok: true, value: { key: { ...key, expires: iso(Date.parse(key.expires) + 2 * DAY_MS) }, token } });
    const answer = await h.create();
    expect(answer).toMatchObject({ ok: false, reason: 'refused', detail: expect.stringContaining('in its expiry') });
    expect(lastMinted(h)!.revoked).not.toBeNull();
    expect(h.prompts).toEqual([]);
    h.hub.revokeAnswer = () => ({ ok: false, kind: 'unreachable', detail: 'down' });
    expect(await h.create({ prefix: 'ci-' })).toMatchObject({ ok: false, reason: 'refused', detail: expect.stringContaining('stray') });
    const stray = lastMinted(h)!;
    expect((await h.view()).strayKeys).toEqual([{ id: stray.id, prefix: 'ci-', label: 'devcloud VMs', created: stray.created, expires: stray.expires, young: true }]);
    await h.close();
  });

  it("a mint answer whose prefix is the token: the answer, the log and the view name the field, never the hub's value (branch fix wave, R1)", async () => {
    const h = await harness();
    h.hub.mintAnswer = (key, token) => ({ ok: true, value: { key: { ...key, prefix: token }, token } });
    const answer = await h.create();
    const { token, id } = h.hub.keys.at(-1)!;
    expect(answer).toMatchObject({ ok: false, reason: 'refused', detail: expect.stringContaining('disagrees with what was asked in its prefix') });
    expect(h.hub.key(id)!.revoked).not.toBeNull();
    expect(JSON.stringify(answer)).not.toContain(token);
    expect(h.logs.join('\n')).not.toContain(token);
    expect(JSON.stringify(await h.view())).not.toContain(token);
    await h.close();
  });

  it("a 201 whose body doesn't read may have minted: the minted phase, and the key list read again so its stray shows (branch fix wave, R3)", async () => {
    const h = await harness();
    h.hub.mintAnswer = () => ({ ok: false, kind: 'status', status: 201, error: 'malformed' });
    const answer = await h.create();
    const minted = lastMinted(h)!;
    expect(answer).toMatchObject({ ok: false, reason: 'hub', phase: 'minted', detail: expect.stringContaining('a key may have been minted') });
    expect(h.part.viewInputs().keys?.list.map((k) => k.id), 'read by the create itself').toContain(minted.id);
    expect((await h.view()).strayKeys.map((k) => k.id)).toEqual([minted.id]);
    await h.close();
  });

  it('a second create while one runs answers busy, and mints nothing', async () => {
    const h = await harness();
    const held = gate();
    h.hub.beforeMint = held.wait;
    const first = h.create();
    await held.reached;
    expect(await h.create({ prefix: 'ci-' })).toMatchObject({ ok: false, reason: 'busy' });
    expect(h.part.status().creating).toBe(true);
    held.open();
    expect(await first).toMatchObject({ ok: true });
    expect(h.hub.mints).toHaveLength(1);
    expect(h.part.status().creating).toBe(false);
    await h.close();
  });
});

describe('Touch ID refused', () => {
  it('revokes the minted key at once; one whose revoke fails shows as a stray key', async () => {
    const h = await harness();
    h.answer = { ok: false, reason: 'cancelled' };
    expect(await h.create()).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(lastMinted(h)!.revoked).not.toBeNull();
    expect(h.signer.pending()).toBeNull();
    h.hub.revokeAnswer = () => status(503, 'hub-updating');
    expect(await h.create({ prefix: 'ci-' })).toMatchObject({ ok: false, reason: 'cancelled' });
    const stray = lastMinted(h)!;
    expect((await h.view()).strayKeys.map((k) => k.id)).toEqual([stray.id]);
    // its Revoke, once the hub answers
    h.hub.revokeAnswer = null;
    expect(await h.part.revokeHub(stray.id)).toEqual({ ok: true });
    expect((await h.view()).strayKeys).toEqual([]);
    await h.close();
  });
});

describe('mid-flight endings', () => {
  type Ending = 'sign-out' | 'close';
  /** After the ending, what this Mac reads: the same profile signed in again (sign-out) or started again (close). */
  async function after(h: Harness, ending: Ending): Promise<Harness> {
    if (ending === 'sign-out') {
      h.signInAgain();
      return h;
    }
    return h.restart();
  }
  const end = async (h: Harness, ending: Ending) => (ending === 'sign-out' ? h.signOut() : h.close());

  for (const ending of ['sign-out', 'close'] as const) {
    it(`${ending} while the mint is out: nothing signed or published; the minted key a stray`, async () => {
      let h = await harness();
      const held = gate();
      h.hub.beforeMint = held.wait;
      const creating = h.create();
      await held.reached;
      await end(h, ending);
      held.open();
      expect(await creating).toMatchObject({ ok: false });
      expect(h.prompts).toEqual([]);
      h = await after(h, ending);
      expect(h.signer.pending()).toBeNull();
      expect(h.hub.posts).toEqual([]);
      expect((await h.view()).strayKeys.map((k) => k.id)).toEqual([lastMinted(h)!.id]);
      await h.close();
    });

    it(`${ending} during Touch ID: nothing kept or published; the minted key a stray`, async () => {
      let h = await harness();
      // not awaited: a close joins the sign that is asking
      h.during = () => void end(h, ending);
      expect(await h.create()).toMatchObject({ ok: false });
      h = await after(h, ending);
      h.during = null;
      expect(h.signer.pending()).toBeNull();
      expect(h.hub.posts).toEqual([]);
      expect((await h.view()).strayKeys.map((k) => k.id)).toEqual([lastMinted(h)!.id]);
      await h.close();
    });

    if (ending === 'sign-out') {
      it('sign-out and a sign-in again while the mint is out: its late answer acts on nothing under the new sign-in', async () => {
        const h = await harness();
        const held = gate();
        h.hub.beforeMint = held.wait;
        const creating = h.create();
        await held.reached;
        h.signOut();
        expect(h.part.status().creating, 'the sign-out ends the run at once, not at its late answer').toBe(false);
        h.signInAgain();
        held.open();
        expect(await creating).toMatchObject({ ok: false });
        expect(h.prompts).toEqual([]);
        expect(h.signer.pending()).toBeNull();
        expect((await argv(h)).filter((line) => line.includes('versions'))).toEqual([]);
        expect((await h.view()).strayKeys.map((k) => k.id)).toEqual([lastMinted(h)!.id]);
        await h.close();
      });
    }

    for (const op of ['add', 'version'] as const) {
      it(`${ending} while ${op === 'add' ? 'versions add' : 'describe'} is out: held, unpublished, its key pair dropped (only Discard)`, async () => {
        let h = await harness();
        await act(h, op, 'wait');
        const creating = h.create();
        await waiting(h, op);
        const id = lastMinted(h)!.id;
        await end(h, ending);
        if (ending === 'sign-out') h.signInAgain(); // signed in again before the late answer
        const calls = (await argv(h)).length;
        const publish = vi.spyOn(h.signer, 'publishHeld');
        await release(h, op);
        expect(await creating).toMatchObject({ ok: false });
        expect(await argv(h), 'no gcloud call after the ending').toHaveLength(calls);
        expect(publish, 'no publish after the ending').not.toHaveBeenCalled();
        h = await after(h, ending);
        await act(h, op, 'ok');
        expect(h.hub.posts).toEqual([]);
        expect(h.signer.pending()?.unsent).toEqual({ kind: 'delegation', id });
        const view = await h.view();
        expect(view.delegations).toMatchObject([{ id, state: 'unsent', unsent: { rewrite: false } }]);
        expect(view.strayKeys).toEqual([]);
        expect(await h.rewrite(id)).toMatchObject({ ok: false, reason: 'stale' });
        expect(await h.signer.publishHeld(h.signer.pending()!.hash)).toMatchObject({ ok: false, reason: 'stale' });
        expect(h.hub.posts).toEqual([]);
        await h.close();
      });
    }
  }
});

describe('stray keys', () => {
  it('a crash between the mint and the sign leaves one, with its created; a young one is marked young', async () => {
    let h = await harness();
    h.during = () => new Promise<void>(() => {}); // Touch ID never answers: the app quits there
    void h.create();
    await until(() => h.prompts.length === 1, 'Touch ID asked');
    const minted = lastMinted(h)!;
    h.during = null;
    h = await h.restart({ crash: true });
    const strays = (await h.view()).strayKeys;
    expect(strays).toEqual([{ id: minted.id, prefix: 'dc-', label: 'devcloud VMs', created: minted.created, expires: minted.expires, young: true }]);
    // an old one is not young
    h.hub.keys.find((k) => k.id === minted.id)!.created = iso(Date.now() - 60 * 60_000);
    expect((await h.view()).strayKeys[0].young).toBe(false);
    await h.close();
  });

  it("Discard's failed revoke leaves one, never a blocked Discard", async () => {
    const h = await harness();
    await act(h, 'add', 'fail:INTERNAL: down');
    await h.create();
    const id = lastMinted(h)!.id;
    h.hub.revokeAnswer = () => ({ ok: false, kind: 'unreachable', detail: 'down' });
    await h.discard();
    expect(h.signer.pending()).toBeNull();
    expect((await h.view()).strayKeys.map((k) => k.id)).toEqual([id]);
    await h.close();
  });

  it('are none of the head\'s delegations, revoked holders or the unsent slot\'s; revoked and expired keys are none', async () => {
    const h = await harness();
    expect(await h.create()).toMatchObject({ ok: true });
    await act(h, 'add', 'fail:INTERNAL: down');
    await h.create({ prefix: 'ci-' });
    const now = Date.now();
    h.hub.keys.push({ id: hex(), label: 'old', prefix: 'x-', created: iso(now - DAY_MS), expires: iso(now - 1000), max_uses: null, uses: 0, revoked: null, token: 't' });
    h.hub.keys.push({ id: hex(), label: 'gone', prefix: 'y-', created: iso(now - DAY_MS), expires: iso(now + DAY_MS), max_uses: null, uses: 0, revoked: iso(now - 1000), token: 't' });
    expect((await h.view()).strayKeys).toEqual([]);
    await h.close();
  });

  it('a delegation published and not yet settled is no stray, and is not revoked from here', async () => {
    const h = await harness();
    await act(h, 'add', 'wait');
    const creating = h.create();
    await waiting(h, 'add');
    h.online = false; // the publish clears the marker; its post finds no hub
    await release(h, 'add');
    expect(await creating).toMatchObject({ ok: false, reason: 'hub' });
    h.online = true;
    const id = lastMinted(h)!.id;
    expect(h.signer.pending()).toMatchObject({ unsent: null });
    expect((await h.view()).strayKeys).toEqual([]);
    expect(await h.part.revokeHub(id)).toMatchObject({ ok: false, reason: 'none' });
    expect(h.hub.revokes).toEqual([]);
    await h.close();
  });

  it("a failed key read shows as failed, never as no keys; the last good read stays, with its time", async () => {
    const h = await harness();
    expect(await h.create()).toMatchObject({ ok: true });
    const good = await h.view();
    expect(good.hubKeys).toMatchObject({ failed: false });
    expect(good.hubKeys.at).not.toBeNull();
    h.hub.listAnswer = () => status(503, 'hub-updating');
    const failed = await h.view();
    expect(failed.hubKeys).toEqual({ at: good.hubKeys.at, failed: true });
    expect(failed.delegations[0].hub).not.toBeNull();
    await h.close();
  });
});

describe('renew\'s hub half', () => {
  async function created() {
    const h = await harness();
    expect(await h.create()).toMatchObject({ ok: true });
    const id = lastMinted(h)!.id;
    const expires = h.hub.head.state.delegations[0].expires;
    const later = iso(Date.parse(expires) + 30 * DAY_MS);
    return { h, id, later };
  }

  it('follows the edit\'s settlement: the hub key takes the head\'s expiry', async () => {
    const { h, id, later } = await created();
    expect(await h.change({ kind: 'delegation.renew', id, expires: later })).toMatchObject({ ok: true });
    expect(h.hub.renews).toEqual([id]);
    expect(h.hub.key(id)!.expires).toBe(later);
    expect((await h.view()).delegations[0]).toMatchObject({ expires: later, hub: { expires: later }, hubBehind: null, hubProblem: null });
    await h.close();
  });

  it('409 not-renewed followed by a key list showing equality is done (a lost 200, then Retry)', async () => {
    const { h, id, later } = await created();
    // the key list doesn't read through the lost answer, so the last good read still shows the key behind
    h.hub.renewAnswer = () => 'lost';
    h.hub.listAnswer = () => status(503, 'hub-updating');
    await h.change({ kind: 'delegation.renew', id, expires: later });
    expect(h.part.viewInputs().hubProblems.get(id)).toMatchObject({ reason: 'hub' });
    expect(h.part.viewInputs().keys?.list.find((k) => k.id === id)?.expires).not.toBe(later);
    h.hub.renewAnswer = null;
    h.hub.listAnswer = null;
    const reads = h.hub.calls.filter((c) => c.method === 'provisioningKeys').length;
    expect(await h.part.renewHub(id)).toEqual({ ok: true });
    expect(h.hub.renews).toEqual([id, id]); // the route alone, answered 409 not-renewed the second time
    expect(h.hub.calls.filter((c) => c.method === 'provisioningKeys').length, "Retry's own read after the 409").toBeGreaterThan(reads);
    expect(h.part.viewInputs().hubProblems.has(id)).toBe(false);
    expect((await h.view()).delegations[0]).toMatchObject({ hubBehind: null, hubProblem: null });
    await h.close();
  });

  it('409 not-renewed while the hub is still behind stays half-done, with Retry', async () => {
    const { h, id, later } = await created();
    h.hub.renewAnswer = () => status(409, 'not-renewed');
    await h.change({ kind: 'delegation.renew', id, expires: later });
    expect((await h.view()).delegations[0]).toMatchObject({ hubBehind: 'renew', hubProblem: { reason: 'not-renewed' } });
    expect(await h.part.renewHub(id)).toMatchObject({ ok: false, reason: 'not-renewed' });
    h.hub.renewAnswer = null;
    expect(await h.part.renewHub(id)).toEqual({ ok: true });
    await h.close();
  });

  it('503 is retried, 410 ends it with its words, and 404 not-found reads "this hub can\'t renew its key yet"', async () => {
    const { h, id, later } = await created();
    h.hub.renewAnswer = () => status(503, 'hub-updating');
    await h.change({ kind: 'delegation.renew', id, expires: later });
    expect((await h.view()).delegations[0]).toMatchObject({ hubBehind: 'renew', hubProblem: { reason: 'updating' } });
    h.hub.renewAnswer = () => status(404, 'not-found');
    expect(await h.part.renewHub(id)).toMatchObject({ ok: false, reason: 'no-route', detail: expect.stringContaining("this hub can't renew its key yet") });
    expect((await h.view()).delegations[0].hubProblem).toMatchObject({ reason: 'no-route' });
    h.hub.renewAnswer = () => status(410, 'key-expired');
    expect(await h.part.renewHub(id)).toMatchObject({ ok: false, reason: 'ended', detail: expect.stringContaining('expired') });
    h.hub.renewAnswer = () => status(409, 'too-long');
    expect(await h.part.renewHub(id)).toMatchObject({ ok: false, reason: 'too-long' });
    h.hub.renewAnswer = null;
    expect(await h.part.renewHub(id)).toEqual({ ok: true });
    expect((await h.view()).delegations[0]).toMatchObject({ hubBehind: null, hubProblem: null });
    await h.close();
  });

  it('a relaunch shows hubBehind from the comparison alone, and Retry calls the route alone', async () => {
    const made = await created();
    const { id, later } = made;
    let h = made.h;
    h.hub.renewAnswer = () => ({ ok: false, kind: 'unreachable', detail: 'down' });
    await h.change({ kind: 'delegation.renew', id, expires: later });
    h = await h.restart();
    h.hub.renewAnswer = null;
    expect((await h.view()).delegations[0]).toMatchObject({ hubBehind: 'renew', hubProblem: null });
    const posts = h.hub.posts.length;
    expect(await h.part.renewHub(id)).toEqual({ ok: true });
    expect(h.hub.posts).toHaveLength(posts); // nothing signed
    expect((await h.view()).delegations[0].hubBehind).toBeNull();
    await h.close();
  });

  it('Retry answers none for a delegation the head does not hold', async () => {
    const h = await harness();
    expect(await h.part.renewHub(hex())).toMatchObject({ ok: false, reason: 'none' });
    await h.close();
  });
});

describe("drop's hub half", () => {
  it('revokes the hub key once the drop settles; a failed DELETE shows the dropped row with Retry, which calls the route alone', async () => {
    const h = await harness();
    expect(await h.create()).toMatchObject({ ok: true });
    const id = lastMinted(h)!.id;
    h.hub.revokeAnswer = () => status(503, 'hub-updating');
    expect(await h.change({ kind: 'delegation.drop', id })).toMatchObject({ ok: true });
    expect(h.hub.revokes).toEqual([id]);
    const dropping = await h.view();
    const row = dropping.delegations.find((d) => d.id === id)!;
    expect(row).toMatchObject({ state: 'dropped', prefix: 'dc-', owners: [OWNER], hubBehind: 'revoke', hubProblem: { reason: 'updating' }, hub: { revoked: false } });
    expect(dropping.strayKeys).toEqual([]); // the head's revoked holder names it
    h.hub.revokeAnswer = null;
    const posts = h.hub.posts.length;
    expect(await h.part.revokeHub(id)).toEqual({ ok: true });
    expect(h.hub.posts).toHaveLength(posts);
    expect(h.hub.key(id)!.revoked).not.toBeNull();
    expect((await h.view()).delegations).toEqual([]);
    await h.close();
  });

  it('404 unknown-key counts as gone, and a delegation in effect is never revoked from here', async () => {
    const h = await harness();
    expect(await h.create()).toMatchObject({ ok: true });
    const id = lastMinted(h)!.id;
    expect(await h.part.revokeHub(id)).toMatchObject({ ok: false, reason: 'none' });
    expect(h.hub.revokes).toEqual([]);
    h.hub.keys = h.hub.keys.filter((k) => k.id !== id);
    expect(await h.change({ kind: 'delegation.drop', id })).toMatchObject({ ok: true });
    expect(h.hub.revokes).toEqual([id]);
    expect((await h.view()).delegations).toEqual([]);
    await h.close();
  });
});

describe('the view\'s three row states', () => {
  it('in effect, unsent and dropped, side by side', async () => {
    const h = await harness();
    expect(await h.create()).toMatchObject({ ok: true });
    const kept = lastMinted(h)!.id;
    expect(await h.create({ prefix: 'ci-' })).toMatchObject({ ok: true });
    const dropped = lastMinted(h)!.id;
    h.hub.revokeAnswer = () => status(503, 'hub-updating');
    await h.change({ kind: 'delegation.drop', id: dropped });
    await act(h, 'add', 'fail:INTERNAL: down');
    await h.create({ prefix: 'gpu-' });
    const unsent = lastMinted(h)!.id;
    const rows = (await h.view()).delegations.map((d) => [d.id, d.state]);
    expect(rows).toEqual([
      [kept, 'in-effect'],
      [unsent, 'unsent'],
      [dropped, 'dropped'],
    ]);
    await h.close();
  });
});

// ---- the fix wave: each ending lands while the operation it ends is still out ----

/** The pid the fake gcloud's `hold` wrote for `op`, once it is out. */
async function heldPid(h: Harness, op: string): Promise<number> {
  let pid = 0;
  await until(async () => (pid = Number((await recorded(h, `hold-${op}.pid`)).trim()) || 0) > 0, `gcloud's ${op} to hold its stdin`);
  return pid;
}
/** Whether `pid` is gone within a second. */
async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}
/** The provisioning-key requests (not the signer's chain reads) a credential other than `asked` carried. */
const carriedBy = (h: Harness, asked: number) => h.hub.calls.filter((c) => c.credential !== asked && c.method !== 'chain');

describe('the fix wave: custody ends with its run (I1)', () => {
  type Ending = 'sign-out' | 'close' | 'discard';
  const end = async (h: Harness, ending: Ending) => (ending === 'sign-out' ? h.signOut() : ending === 'close' ? h.close() : h.discard());

  for (const ending of ['sign-out', 'close', 'discard'] as const) {
    it(`${ending} while versions add's resolver is out: its holder dropped, no gcloud runs, nothing published`, async () => {
      const h = await harness();
      const held = gate();
      h.during = () => void (h.resolving = held.wait); // after the preflight: the add's resolver is the next
      const creating = h.create();
      await held.reached;
      await end(h, ending);
      expect(h.codes).toHaveLength(1);
      expect(() => h.codes[0].reveal(), 'dropped by the ending, the resolver still out').toThrow();
      held.open();
      expect(await creating).toMatchObject({ ok: false });
      expect((await argv(h)).filter((line) => line.includes('versions add'))).toEqual([]);
      expect(h.hub.posts).toEqual([]);
      if (ending !== 'close') await h.close();
    });

    it(`${ending} while versions add's child holds its stdin unread: the child killed, its holder dropped, nothing published`, async () => {
      const h = await harness();
      await act(h, 'add', 'hold');
      const creating = h.create();
      const pid = await heldPid(h, 'add');
      await end(h, ending);
      expect(await creating).toMatchObject({ ok: false });
      expect(await gone(pid)).toBe(true);
      expect(() => h.codes[0].reveal()).toThrow();
      expect(h.hub.posts).toEqual([]);
      if (ending !== 'close') await h.close();
    });
  }

  it("a sign-out and a sign-in again while publishHeld's post is out: custody went before the post; the ended run claims nothing, and nothing rides the new credential", async () => {
    const h = await harness();
    const held = gate();
    h.hub.beforePost = held.wait;
    const creating = h.create();
    await held.reached;
    const id = lastMinted(h)!.id;
    expect(() => h.codes[0].reveal()).toThrow();
    expect(await h.rewrite(id), 'no key pair left to write the code from').toMatchObject({ ok: false, reason: 'stale' });
    const asked = h.signIn;
    h.signOut();
    h.signInAgain();
    held.open();
    const answer = await creating;
    expect(answer, "the ended run's answer says so, not the publish's own").toMatchObject({ ok: false, reason: 'not-root', detail: expect.stringContaining('run ended') });
    expect(answer).not.toHaveProperty('secret');
    expect(h.hub.calls.find((c) => c.method === 'postState')?.credential).toBe(asked);
    expect(carriedBy(h, asked).filter((c) => c.method !== 'postState')).toEqual([]);
    await h.close();
  });
});

describe('the fix wave: a create under way holds its key (I2)', () => {
  it('Touch ID held open: the key it minted is no stray, and no Revoke takes it; the create then completes with it unrevoked', async () => {
    const h = await harness();
    const held = gate();
    h.during = held.wait;
    const creating = h.create();
    await held.reached;
    const id = lastMinted(h)!.id;
    expect((await h.view()).strayKeys).toEqual([]);
    expect(await h.part.revokeHub(id)).toMatchObject({ ok: false, reason: 'none' });
    expect(h.hub.revokes).toEqual([]);
    held.open();
    expect(await creating).toMatchObject({ ok: true });
    expect(h.hub.key(id)?.revoked).toBeNull();
    expect(inEffect(h, id)).toBe(true);
    await h.close();
  });

  it("while the mint is out: a key of its prefix minted since its start is held; another prefix's is a stray", async () => {
    const h = await harness();
    const held = gate();
    h.hub.beforeMint = held.wait;
    const creating = h.create();
    await held.reached;
    const id = lastMinted(h)!.id;
    const other = { ...lastMinted(h)!, id: hex(), prefix: 'x-', token: 'unused' };
    h.hub.keys.push(other);
    expect((await h.view()).strayKeys.map((k) => k.id)).toEqual([other.id]);
    expect(await h.part.revokeHub(id)).toMatchObject({ ok: false, reason: 'none' });
    held.open();
    expect(await creating).toMatchObject({ ok: true });
    expect(h.hub.key(id)?.revoked).toBeNull();
    await h.close();
  });
});

describe('the fix wave: a hub continuation belongs to the sign-in that asked (I3)', () => {
  it('a renew half deferred across a sign-out and a sign-in, and one queued behind it, run nothing under the new credential', async () => {
    const h = await harness();
    expect(await h.create()).toMatchObject({ ok: true });
    const id = lastMinted(h)!.id;
    const held = gate();
    h.hub.beforeRenew = held.wait;
    const first = h.part.renewHub(id);
    const second = h.part.renewHub(id); // queued behind the first
    await held.reached;
    const asked = h.signIn;
    h.signOut();
    h.signInAgain();
    held.open();
    expect(await first).toMatchObject({ ok: false, reason: 'hub' });
    expect(await second).toMatchObject({ ok: false, reason: 'hub' });
    expect(h.hub.renews).toEqual([id]);
    expect(carriedBy(h, asked)).toEqual([]);
    expect((await h.view()).delegations[0].hubProblem).toBeNull();
    await h.close();
  });

  it("the next sign-in's halves wait for none of the last one's: a Retry runs while the old half is still out", async () => {
    const h = await harness();
    expect(await h.create()).toMatchObject({ ok: true });
    const id = lastMinted(h)!.id;
    const held = gate();
    h.hub.beforeRenew = () => {
      h.hub.beforeRenew = null; // the old sign-in's renew alone is held
      return held.wait();
    };
    const old = h.part.renewHub(id);
    await held.reached;
    h.signOut();
    h.signInAgain();
    // the head isn't ahead of the hub's key: the hub answers 409 not-renewed, then the key list says it is level
    expect(await h.part.renewHub(id)).toEqual({ ok: true });
    held.open();
    expect(await old).toMatchObject({ ok: false, reason: 'hub' });
    await h.close();
  });

  it("a key read out across a sign-out and a sign-in is adopted by neither: the new sign-in's own read stands", async () => {
    const h = await harness();
    const held = gate();
    h.hub.beforeList = () => {
      h.hub.beforeList = null;
      return held.wait();
    };
    const old = h.part.readKeys();
    await held.reached;
    h.signOut();
    h.signInAgain();
    await h.hub.mintProvisioningKey({ label: 'cli', prefix: 'x-', ttl_s: 30 * 86_400 }); // a CLI's key, since the old read was asked
    const minted = lastMinted(h)!.id;
    await h.part.readKeys();
    held.open();
    await old;
    expect(h.part.viewInputs().keys?.list.map((k) => k.id)).toEqual([minted]);
    await h.close();
  });

  for (const which of ['discard', 'touch-id'] as const) {
    it(`${which === 'discard' ? "Discard's revoke" : "a refused Touch ID's revoke"} deferred across a sign-out and a sign-in reads nothing under the new credential`, async () => {
      const h = await harness();
      const held = gate();
      let pending: Promise<unknown>;
      if (which === 'discard') {
        await act(h, 'add', 'fail:INTERNAL: the backend is down');
        expect(await h.create()).toMatchObject({ ok: false, reason: 'unsent' });
        h.hub.beforeRevoke = held.wait;
        pending = h.discard();
      } else {
        h.answer = { ok: false, reason: 'cancelled' };
        h.hub.beforeRevoke = held.wait;
        pending = h.create();
      }
      await held.reached;
      const asked = h.signIn;
      h.signOut();
      h.signInAgain();
      held.open();
      await pending;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(carriedBy(h, asked)).toEqual([]);
      await h.close();
    });
  }
});

describe("Task 5's fix wave: every answer names its run and its phase (I1, I4)", () => {
  it('a create answers the run main issued (generation, id, hash) and where it stopped: refused, minted, held, held and stored, published', async () => {
    // refused before anything was minted: no run
    const none = await harness({ destination: null });
    expect(await none.create()).toMatchObject({ ok: false, reason: 'secret-store', phase: 'refused', stored: false, run: null });
    await none.close();

    const h = await harness();
    // minted and not signed: Touch ID refused, the key revoked
    h.answer = { ok: false, reason: 'cancelled' };
    const cancelled = await h.create();
    expect(DelegationResultSchema.parse(cancelled)).toEqual(cancelled);
    expect(cancelled).toMatchObject({ ok: false, reason: 'cancelled', phase: 'minted', stored: false, run: { generation: 1, id: lastMinted(h)!.id, hash: null } });
    h.answer = { ok: true };
    // signed and held, its code not stored
    await act(h, 'add', 'fail:INTERNAL: down');
    const held = await h.create({ prefix: 'ci-' });
    expect(held).toMatchObject({ ok: false, reason: 'unsent', phase: 'held', stored: false, version: 2, run: { generation: 2, id: lastMinted(h)!.id, hash: h.signer.pending()!.hash } });
    await h.discard();
    await act(h, 'add', 'ok');
    // signed and held, its code stored, its publish refused while the run stands: Discard only
    const publishHeld = h.signer.publishHeld;
    h.signer.publishHeld = async () => ({ ok: false, reason: 'stale', detail: 'refused for the test' });
    const stored = await h.create({ prefix: 'gpu-' });
    expect(stored).toMatchObject({ ok: false, reason: 'unsent', phase: 'held', stored: true, run: { generation: 3, hash: h.signer.pending()!.hash } });
    expect((await h.view()).delegations.find((d) => d.state === 'unsent')?.unsent).toMatchObject({ rewrite: false, generation: 3 });
    h.signer.publishHeld = publishHeld;
    await h.discard();
    // published, the post's answer failed: settlement owns it, an ordinary pending slot
    await act(h, 'version', 'wait');
    const published = h.create({ prefix: 'web-' });
    await waiting(h, 'version');
    h.online = false;
    await release(h, 'version');
    const answer = await published;
    expect(answer).toMatchObject({ ok: false, phase: 'published', stored: true, run: { generation: 4 } });
    expect(h.signer.pending()).toMatchObject({ unsent: null });
    await h.close();
  });

  it("a rewrite acts only on the run, delegation and slot it names: the first window's identity, after a Discard and a replacement create, is stale and writes nothing", async () => {
    const h = await harness();
    await act(h, 'add', 'fail:INTERNAL: down');
    const first = await h.create();
    expect(first).toMatchObject({ ok: false, phase: 'held', run: { generation: 1 } });
    const shown = (first as Extract<DelegationResult, { ok: false }>).run!;
    // another window discards it and creates its own
    await h.discard();
    const second = await h.create({ prefix: 'ci-' });
    const replaced = (second as Extract<DelegationResult, { ok: false }>).run!;
    expect(replaced).toMatchObject({ generation: 2 });
    await act(h, 'add', 'ok');
    const adds = (await argv(h)).filter((l) => l.includes('versions add')).length;
    for (const asked of [
      { generation: shown.generation, id: shown.id!, hash: shown.hash! },
      { generation: shown.generation, id: replaced.id!, hash: replaced.hash! },
      { generation: replaced.generation, id: shown.id!, hash: replaced.hash! },
      { generation: replaced.generation, id: replaced.id!, hash: shown.hash! },
    ]) {
      expect(await h.part.rewrite(asked)).toMatchObject({ ok: false, reason: 'stale', run: null });
    }
    expect((await argv(h)).filter((l) => l.includes('versions add'))).toHaveLength(adds); // nothing written
    expect(h.signer.pending()?.unsent).toEqual({ kind: 'delegation', id: replaced.id });
    // the replacement's own identity writes it
    expect(await h.part.rewrite({ generation: replaced.generation, id: replaced.id!, hash: replaced.hash! })).toMatchObject({ ok: true, run: { generation: 2, id: replaced.id } });
    await h.close();
  });
});

describe("Task 5's fix wave 2: an answer's finality", () => {
  it('a Discard queued ahead of the publish answers discarded, never published: nothing is posted, the slot stays gone', async () => {
    const h = await harness();
    const publishHeld = h.signer.publishHeld;
    // Another window's Discard reaches the signer's queue first: by the publish's turn the slot is gone.
    h.signer.publishHeld = async (hash) => {
      await h.discard();
      return publishHeld(hash);
    };
    const answer = await h.create();
    expect(DelegationResultSchema.parse(answer)).toEqual(answer);
    expect(answer).toMatchObject({ ok: false, reason: 'stale', phase: 'discarded', stored: true, run: { generation: 1 } });
    expect((answer as Extract<DelegationResult, { ok: false }>).detail).toMatch(/discarded or replaced before its publish.*nothing was published/);
    expect(h.signer.pending()).toBeNull();
    expect(h.hub.posts).toEqual([]);
    h.signer.publishHeld = publishHeld;
    await h.close();
  });

  it('an answer that ran carries the status revision published after its final slot; one refused at once, the revision standing', async () => {
    const h = await harness();
    await act(h, 'add', 'fail:INTERNAL: down');
    const before = h.part.status().rev;
    const held = await h.create();
    expect(held).toMatchObject({ ok: false, phase: 'held', rev: h.part.status().rev });
    expect(held.rev).toBeGreaterThan(before);
    const refused = await h.create({ prefix: 'ci-' }); // a signed state is pending: refused before anything changed
    expect(refused).toMatchObject({ ok: false, reason: 'pending', phase: 'refused', run: null, rev: h.part.status().rev });
    expect(refused.rev).toBe(held.rev);
    await act(h, 'add', 'ok');
    const written = await h.rewrite(lastMinted(h)!.id);
    expect(written).toMatchObject({ ok: true, rev: h.part.status().rev });
    expect(written.rev).toBeGreaterThan(held.rev);
    await h.close();
  });
});

describe("Task 5's fix wave: a failed key read's Retry reads now (I3)", () => {
  it('within the freshness window after a failure, a forced read asks the hub again (the page\'s ifStale read does not), under its own sign-in', async () => {
    const h = await harness();
    expect(await h.create()).toMatchObject({ ok: true });
    h.hub.listAnswer = () => status(503, 'hub-updating');
    await h.part.readKeys();
    expect(h.part.viewInputs().keysFailed).toBe(true);
    h.hub.listAnswer = null;
    const lists = () => h.hub.calls.filter((c) => c.method === 'provisioningKeys').length;
    const before = lists();
    await h.part.readKeys({ ifStale: true }); // the page shown again within 30 s: no read
    expect(lists()).toBe(before);
    expect(h.part.viewInputs().keysFailed).toBe(true);
    await h.part.readKeys(); // Retry
    expect(lists()).toBe(before + 1);
    expect(h.part.viewInputs().keysFailed).toBe(false);
    expect(h.hub.calls.at(-1)).toEqual({ method: 'provisioningKeys', credential: h.signIn });
    await h.close();
  });
});

describe("Task 5's fix wave: what the renderer receives of a failed write (Minor 1)", () => {
  it("a create whose gcloud stderr carried the code answers a detail without it", async () => {
    const h = await harness();
    // versions add reads the code, then echoes it back on stderr and fails
    const fake = await readFile(join(h.bin, 'gcloud'), 'utf8');
    await writeFile(join(h.bin, 'gcloud'), fake.replace('  fail:*) printf', '  echo-fail) printf \'ERROR: (gcloud.secrets.versions.add) INVALID_ARGUMENT: bad payload %s\\n\' "$(tail -n 1 "$dir/stdin.log")" >&2; exit 1 ;;\n  fail:*) printf'));
    await act(h, 'add', 'echo-fail');
    const answer = await h.create();
    expect(DelegationResultSchema.parse(answer)).toEqual(answer);
    expect(answer).toMatchObject({ ok: false, reason: 'unsent', phase: 'held' });
    const code = (await recorded(h, 'stdin.log')).split('\n').find((line) => line.startsWith('smns-provision-v2.'))!;
    expect(code).toBeDefined();
    const decoded = decodeProvisioningCodeV2(code);
    const sent = JSON.stringify([answer, await h.view()]);
    for (const piece of [code, code.slice(18, 34), decoded.token, decoded.delegation.privateJwk.d!]) expect(sent.includes(piece), 'a piece of the code in what the renderer receives').toBe(false);
    await h.close();
  });
});

describe('the branch fix wave: a Discard during a gcloud step answers the Discard (R4)', () => {
  for (const op of ['add', 'version'] as const) {
    it(`a Discard while ${op === 'add' ? 'versions add' : 'describe'} is out answers the discarded phase, never held`, async () => {
      const h = await harness();
      await act(h, op, 'wait');
      const creating = h.create();
      await waiting(h, op);
      await h.discard();
      const answer = await creating;
      expect(answer).toMatchObject({ ok: false, reason: 'stale', phase: 'discarded', detail: 'its slot was discarded: nothing was published' });
      expect(h.signer.pending()).toBeNull();
      expect(h.hub.posts).toEqual([]);
      await h.close();
    });
  }
});

describe('the branch fix wave: a write under way is not a lost key pair (R5)', () => {
  it('while versions add is out the unsent row reads writing, with no rewrite; once the write fails, rewrite and not writing', async () => {
    const h = await harness();
    await act(h, 'add', 'wait');
    const creating = h.create();
    await waiting(h, 'add');
    const id = lastMinted(h)!.id;
    expect((await h.view()).delegations).toMatchObject([{ id, state: 'unsent', unsent: { writing: true, rewrite: false } }]);
    await act(h, 'version', 'fail:INTERNAL: the backend is down'); // the add answers; its describe then fails
    await release(h, 'add');
    expect(await creating).toMatchObject({ ok: false, reason: 'unsent' });
    expect((await h.view()).delegations).toMatchObject([{ id, state: 'unsent', unsent: { writing: false, rewrite: true } }]);
    await h.close();
  });
});
