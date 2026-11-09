// The delegations this Mac creates, renews and drops (P5 O8 M4c, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// M4c's "The create transaction", "Renew", "Drop"; the refresh's items 7, 8, 13 and 14; Interfaces §S), a part of the
// org session as the enrollment is (enroll.ts).
//
// - The create transaction, one run at a time, reserved before its first await (a second create answers `busy`), in
//   admin.ts's order: (1) the prefix, the composition's own checks, the destination and gcloud's preflight, before
//   anything is minted; (2) the mint, held to `mintDisagrees` (a disagreement revokes the key and refuses); (3) the key
//   pair made here and `delegation.add` signed into the slot unsent (`Edit.hold`), the one Touch ID; (4) the code encoded
//   in memory and added as a new version of the destination's secret, on gcloud's stdin alone; (5) that version's
//   metadata read back (`describe`, never `access`); (6) `publishHeld(hash)`, after which settlement owns the slot.
// - Every await's answer is judged against its run (`live`): the current run, the sign-in it began under, no sign-out
//   (`fence`) or `close` since. A late answer from an ended run acts on nothing. A minted key no state names (a refused
//   or cancelled sign) is revoked at once; one an ending left (the hub isn't asked once the sign-in ended), or whose
//   revoke failed, shows as a stray key, which the view derives from the hub's list.
// - Custody: the minted token and the key pair live only in the run (`custody`), the code only as a `ProvisioningCode`
//   for the length of `addVersion`. They are dropped at publish, at the slot's Discard, at a sign-out and at `close`,
//   and never reach a log, a status, an answer, a file or an error: every line here names ids, prefixes and versions.
// - A failure at (4) or (5) leaves the slot unsent with its reason, and "Write the code again" (`rewrite`) runs (4) to
//   (6) again while this run holds the key pair. After a sign-out or a relaunch only Discard is offered, whose marker
//   (`discarded`) revokes the delegation's hub key; a failed revoke leaves a stray, never a held-up Discard.
// - The hub halves follow from the head, with no record of their own (refresh item 7): a settled state that extends a
//   delegation's `expires` against its parent renews its hub key; one that drops a delegation revokes it. Each runs once
//   at its settlement (the signer's `settled`), and Retry (`renewHub`, `revokeHub`) calls the route alone; a later run
//   or a relaunch reads what is left from the comparison (view.ts's `hubBehind`). `409 not-renewed` is followed by the
//   key list, and a key no longer behind is done.
// - The hub's key list is read when the Org page is shown (`readKeys({ifStale})`), after each hub half, and at each
//   settlement; the last good read is kept with its time, and a failed one says so.
//
// Electron-free: the session injects the signer, the hub, gcloud's custody and the destination's file.
import {
  encodeProvisioningCodeV2,
  generateSigningKey,
  isMachineName,
  MAX_PROVISIONING_KEY_TTL_S,
  MAX_PROVISIONING_KEY_USES,
  MIN_PROVISIONING_KEY_TTL_S,
  mintDisagrees,
  NEVER_OFFLINE,
  NO_USE_CAP,
  prefixProblem,
  type Certificates,
  type OrgState,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';
import type { DelegationCreateInput, HubHalfResult, OrgChange, OrgDelegationsStatus, ProvisioningSecret, SignResult } from '@shared/ipc/schema/org';
import { composeChange, type ChangeEdit, type EditSelf } from './edits';
import type { Pending, Unsent } from './files';
import type { HubResult, ProvisioningKey, ProvisioningKeyRoutes } from './hub-client';
import type { ProvisioningSecretStore } from './provisioning-secret-store';
import { ProvisioningCode, type SecretStore } from './secret-store';
import { StaleEdit, type OrgSigner, type SignOutcome } from './signer';
import { orgTiming, type OrgTiming } from './timing';

/** The provisioning-key routes the delegations use, as the session's hub client reaches them now. */
export type DelegationsHub = Pick<ProvisioningKeyRoutes, 'mintProvisioningKey' | 'renewProvisioningKey' | 'revokeProvisioningKey' | 'provisioningKeys'>;

/** What the part reads of the session at each step: null once this Mac is not signed in to an org it holds. */
export type DelegationsContext = {
  /** The registration's hub origin, which the code names. */
  hub: string;
  self: EditSelf;
  head: SignedOrgState;
  certificates: Certificates;
  /** Null while no hub credential lives. */
  client: DelegationsHub | null;
  /** The sign-in this is (the session's `signIns`, which only a sign-out advances). */
  signIn: number;
};

export type DelegationsDeps = {
  context(): DelegationsContext | null;
  /** Why no change is signed now (not signed in, not a root, keys unmarked, signing.json damaged), or null. */
  standing(): SignResult | null;
  /** Another of the session's attempts runs (a sign-in, a re-anchor, a rekey, a sign-out). */
  busy(): boolean;
  signer(): Pick<OrgSigner, 'sign' | 'publishHeld' | 'pending'> | null;
  /** The pending slot's signed state (held unsent or not), whose delegations no Revoke may take: null with no slot. */
  slotState(): OrgState | null;
  /** `change` composed on a fresh draft of the head and checked as the signer will check it: its refusal, or null. */
  check(change: OrgChange): Promise<SignResult | null>;
  /** The held chain's state at `version` (a settled state's parent), or null. */
  stateAt(version: number): OrgState | null;
  /** Task 3's gcloud custody; null in a build that composes none (every create refuses `secret-store`). */
  secrets: SecretStore | null;
  /** The destination's file (`<profile>/provisioning-secret.json`). */
  destination: ProvisioningSecretStore | null;
  /** What the status or the view reads changed. */
  changed(): void;
  timing?: Partial<OrgTiming>;
  now?(): number;
  log(line: string): void;
};

/** The last hub half this sign-in ran for a delegation (or a stray key) that didn't finish. */
export type HubProblem = { reason: Exclude<Extract<HubHalfResult, { ok: false }>['reason'], 'none'>; detail: string };

/** What the view joins of the part (view.ts's `DelegationSources`). */
export type DelegationViewInputs = {
  keys: { list: readonly ProvisioningKey[]; at: string } | null;
  keysFailed: boolean;
  /** This run's unsent delegation: `rewrite` while it holds the key pair, and why its code isn't stored. */
  unsent: { id: string; rewrite: boolean; problem: string | null } | null;
  hubProblems: ReadonlyMap<string, HubProblem>;
};

export interface Delegations {
  /** The status's `delegations` part. */
  status(): OrgDelegationsStatus;
  create(input: DelegationCreateInput): Promise<SignResult>;
  /** "Write the code again": steps 4 to 6 for this run's unsent delegation `id`. */
  rewrite(id: string): Promise<SignResult>;
  /** Retry of renew's hub half: the route alone. */
  renewHub(id: string): Promise<HubHalfResult>;
  /** Retry of drop's hub half, or a stray key's Revoke: the route alone. */
  revokeHub(id: string): Promise<HubHalfResult>;
  /** The signer's settlement callback: a settled state's hub halves, against its parent. */
  settled(slot: Pending): void;
  /** A Discard's marker: an unsent delegation's hub key revoked (a failure leaves it a stray). */
  discarded(marker: Unsent | null): Promise<void>;
  /** The hub's key list read again; `ifStale`, only once the last read is older than `KEYS_FRESH_MS`. */
  readKeys(options?: { ifStale?: boolean }): Promise<void>;
  viewInputs(): DelegationViewInputs;
  /** Resolves once the hub halves queued so far have ended. */
  idle(): Promise<void>;
  /** The session's sign-out: the run ends and its custody is dropped; this sign-in's hub reads and problems go. */
  fence(): void;
  /** As `fence`, for good. */
  close(): Promise<void>;
}

type Stage = 'checking' | 'minting' | 'signing' | 'storing' | 'publishing' | 'held';
type Run = {
  generation: number;
  signIn: number;
  stage: Stage;
  prefix: string;
  /** The minted key's id, once minted. */
  id: string | null;
  /** The custody: the minted token and the delegation's key pair, in this memory alone. */
  custody: { token: string; pair: SigningKey } | null;
  /** The held slot's hash (`HeldSigned.hash`), once signed. */
  hash: string | null;
  /** Why its code isn't stored (shown under its row). */
  problem: string | null;
  /** A create or a rewrite of it is under way. */
  working: boolean;
};

const DAY_S = 86_400;
const NOT_SIGNED_IN: SignResult = { ok: false, reason: 'not-root', detail: 'this Mac is not signed in to the org' };
const ENDED = 'the delegation\'s run ended (a sign-out, or the app quit)';

/** A gcloud `createTime` (RFC 3339, microseconds) as ISO millis; as it came when it reads as no instant. */
function instant(text: string): string {
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? text : new Date(ms).toISOString();
}

const hubWords = (answer: Exclude<HubResult<unknown>, { ok: true }>): string =>
  answer.kind === 'status' ? `${answer.status} ${answer.error ?? 'with no code'}` : answer.kind === 'unreachable' ? `no answer (${answer.detail})` : `Access answered ${answer.status}`;

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A sign or publish outcome as `org.*` carries it (`signResult`'s rules; a held sign's hash never leaves). */
function asResult(outcome: SignOutcome, more?: string): SignResult {
  if (outcome.ok) return { ok: true, version: outcome.version };
  const detail = outcome.reason === 'refused' ? outcome.findings.filter((f) => f.level === 'refuse').map((f) => f.detail).join('; ') : outcome.detail;
  const words = [detail, more].filter((w) => w !== undefined && w !== '').join(': ');
  return words === '' ? { ok: false, reason: outcome.reason } : { ok: false, reason: outcome.reason, detail: words };
}

export function createDelegations(deps: DelegationsDeps): Delegations {
  const timing = orgTiming(deps.timing);
  const now = deps.now ?? Date.now;
  const log = (line: string) => deps.log(`delegations: ${line}`);
  let closed = false;
  let rev = 0;
  let generations = 0;
  let run: Run | null = null;
  let keys: { list: ProvisioningKey[]; at: number } | null = null;
  let keysFailed = false;
  let keysAsked = Number.NEGATIVE_INFINITY;
  let keysReading: Promise<void> | null = null;
  const hubProblems = new Map<string, HubProblem>();
  let halves: Promise<unknown> = Promise.resolve();

  function bump(): void {
    rev++;
    deps.changed();
  }

  /** `r` still stands: the current run, the sign-in it began under, nothing ended it. */
  function live(r: Run): boolean {
    if (run !== r || closed) return false;
    return deps.context()?.signIn === r.signIn;
  }

  /** `r` leaves, its custody dropped. */
  function end(r: Run): void {
    r.custody = null;
    if (run !== r) return;
    run = null;
    bump();
  }

  const stopped = (what: string): SignResult => ({ ok: false, reason: 'not-root', detail: `${ENDED}: ${what}` });

  // ---- the create transaction ----

  async function create(input: DelegationCreateInput): Promise<SignResult> {
    if (closed) return { ok: false, reason: 'busy', detail: 'the org session is closed' };
    if (run !== null && run.working) return { ok: false, reason: 'busy', detail: 'a delegation is being created: wait for it to finish' };
    if (deps.busy()) return { ok: false, reason: 'busy', detail: 'another org attempt is under way' };
    const standing = deps.standing();
    if (standing !== null) return standing;
    const ctx = deps.context();
    const signer = deps.signer();
    if (ctx === null || signer === null) return NOT_SIGNED_IN;
    const nothing = 'nothing was minted';
    if (ctx.head.state.members.find((m) => m.id === ctx.self.member)?.role !== 'admin') {
      return { ok: false, reason: 'refused', detail: `Only an admin creates a delegation, since the hub mints its key for an admin alone: ${nothing}` };
    }
    if (signer.pending() !== null) return { ok: false, reason: 'pending', detail: `a signed proposal is pending (publish or discard it first): ${nothing}` };
    const ttl = input.ttlDays * DAY_S;
    if (!isMachineName(input.prefix)) return { ok: false, reason: 'invalid', detail: `${JSON.stringify(input.prefix)} is not an admitted machine name: ${nothing}` };
    if (!Number.isSafeInteger(ttl) || ttl < MIN_PROVISIONING_KEY_TTL_S || ttl > MAX_PROVISIONING_KEY_TTL_S) return { ok: false, reason: 'invalid', detail: `a key lives ${MIN_PROVISIONING_KEY_TTL_S} to ${MAX_PROVISIONING_KEY_TTL_S} s: ${nothing}` };
    if (input.maxUses !== null && (!Number.isSafeInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > MAX_PROVISIONING_KEY_USES)) {
      return { ok: false, reason: 'invalid', detail: `a use cap is 1 to ${MAX_PROVISIONING_KEY_USES}: ${nothing}` };
    }
    const taken = prefixProblem(ctx.head.state, input.prefix);
    if (taken !== null) return { ok: false, reason: 'refused', detail: `${taken}: ${nothing}` };
    const dest = destination();
    if (!dest.ok) return dest.refusal;
    if (deps.secrets === null) return { ok: false, reason: 'secret-store', detail: `secret-store: this build stores no provisioning code: ${nothing}` };
    if (ctx.client === null) return { ok: false, reason: 'hub', detail: `the hub sign-in has ended: sign in again to create a delegation (${nothing})` };
    // The run is reserved before the first await: a second create meanwhile answers `busy`.
    if (run !== null) end(run);
    const r: Run = { generation: ++generations, signIn: ctx.signIn, stage: 'checking', prefix: input.prefix, id: null, custody: null, hash: null, problem: null, working: true };
    run = r;
    log(`${r.generation}: creating delegation ${input.prefix}`);
    bump();
    try {
      return await createRun(r, input, ttl, dest.value, deps.secrets);
    } finally {
      settleRun(r);
    }
  }

  /** After a create or a rewrite: the run stays only while it holds an unsent slot and its key pair. */
  function settleRun(r: Run): void {
    if (run !== r) {
      r.custody = null;
      return;
    }
    r.working = false;
    if (r.hash === null || r.custody === null) end(r);
    else bump();
  }

  /** The destination as its file holds it, or the create's refusal. */
  function destination(): { ok: true; value: ProvisioningSecret } | { ok: false; refusal: SignResult } {
    const read = deps.destination?.read() ?? { ok: true as const, value: null };
    if (!read.ok) return { ok: false, refusal: { ok: false, reason: 'secret-store', detail: `secret-store: the destination's file is damaged (${read.damaged}): reset it, then set it again` } };
    if (read.value === null) return { ok: false, refusal: { ok: false, reason: 'secret-store', detail: 'secret-store: no destination is set: name the project, secret and account first' } };
    return { ok: true, value: read.value };
  }

  async function createRun(r: Run, input: DelegationCreateInput, ttl: number, dest: ProvisioningSecret, secrets: SecretStore): Promise<SignResult> {
    const nothing = 'nothing was minted';
    const { label, prefix, maxUses, owners } = input;
    // (1) The composition the checks would refuse costs no hub key: it is checked first with a stand-in id and key.
    const probeKey = await generateSigningKey();
    const probe: OrgChange = { kind: 'delegation.add', id: randomHex(16), pub: probeKey.pub, prefix, expires: new Date(now() + ttl * 1000).toISOString(), maxUses: maxUses ?? NO_USE_CAP, offlineRevokeS: NEVER_OFFLINE, owners };
    const checked = await deps.check(probe);
    if (!live(r)) return stopped(nothing);
    if (checked !== null && !checked.ok) return { ...checked, detail: [checked.detail, nothing].filter((w) => w !== undefined).join(': ') };
    const ready = await secrets.preflight(dest);
    if (!live(r)) return stopped(nothing);
    if (!ready.ok) return { ok: false, reason: 'secret-store', detail: `${ready.detail}: ${nothing}` };

    // (2) The mint, as delegationCreate makes it.
    const client = deps.context()?.client ?? null;
    if (client === null) return { ok: false, reason: 'hub', detail: `the hub sign-in has ended: ${nothing}` };
    r.stage = 'minting';
    bump();
    const before = now();
    const minted = await client.mintProvisioningKey({ label, prefix, ttl_s: ttl, ...(maxUses === null ? {} : { max_uses: maxUses }) });
    const after = now();
    if (!minted.ok) {
      // A mint whose answer was lost may still have minted: such a key shows as a stray key.
      log(`${r.generation}: the hub did not mint (${hubWords(minted)})`);
      if (!live(r)) return stopped('nothing was signed');
      return { ok: false, reason: 'hub', detail: `the hub did not mint the delegation's key (${hubWords(minted)}): nothing was signed` };
    }
    const { key, token } = minted.value;
    if (!live(r)) {
      log(`${r.generation}: key ${key.id} was minted after the run ended: it shows as a stray key`);
      return stopped(`nothing was signed; the key it minted (${key.id}) shows as a stray key`);
    }
    const disagrees = mintDisagrees(minted.value, { prefix, ttl, maxUses, before, after });
    if (disagrees.length > 0) {
      const revoked = await revokeMinted(key.id);
      return { ok: false, reason: 'refused', detail: `the hub's answer to the mint disagrees with what was asked (${disagrees.join('; ')}): nothing was signed; ${revoked}` };
    }

    // (3) The key pair, made here, and the delegation signed into the slot unsent.
    const pair = await generateSigningKey(true);
    if (!live(r)) {
      log(`${r.generation}: the run ended with key ${key.id} minted: it shows as a stray key`);
      return stopped(`nothing was signed; the key it minted (${key.id}) shows as a stray key`);
    }
    r.id = key.id;
    r.custody = { token, pair };
    const at = deps.context()!;
    const change: OrgChange = {
      kind: 'delegation.add',
      id: key.id,
      pub: pair.pub,
      prefix,
      expires: new Date(before + ttl * 1000).toISOString(),
      maxUses: maxUses ?? NO_USE_CAP,
      offlineRevokeS: NEVER_OFFLINE,
      owners,
    };
    let composed: ChangeEdit;
    try {
      composed = await composeChange(at.head.state, change, at.self, at.certificates);
    } catch (error) {
      const revoked = live(r) ? await revokeMinted(key.id) : `the key it minted (${key.id}) shows as a stray key`;
      return { ok: false, reason: 'refused', detail: `${(error as Error).message}: nothing was signed; ${revoked}` };
    }
    const signer = deps.signer();
    if (!live(r) || signer === null) return stopped(`nothing was signed; the key it minted (${key.id}) shows as a stray key`);
    r.stage = 'signing';
    bump();
    const outcome = await signer.sign({
      summary: composed.summary,
      lines: [...composed.lines, `Its provisioning code goes to ${dest.project}/${dest.secret} as a new version, never shown`],
      live: () => live(r),
      hold: { kind: 'delegation', id: key.id },
      async apply(draft) {
        if (!live(r)) throw new StaleEdit(`${ENDED}: nothing was signed`);
        await composed.apply(draft);
      },
    });
    if (!outcome.ok) {
      if (!live(r)) {
        log(`${r.generation}: the run ended while delegation ${key.id} was signed: its key shows as a stray key`);
        return asResult(outcome, `the key it minted (${key.id}) shows as a stray key`);
      }
      // A minted key no state names: revoked at once.
      return asResult(outcome, `nothing was signed; ${await revokeMinted(key.id)}`);
    }
    if (!('hash' in outcome)) return { ok: false, reason: 'invalid', detail: 'the delegation was signed but not held: nothing was stored' };
    r.hash = outcome.hash;
    log(`${r.generation}: delegation ${key.id} signed at version ${outcome.version}, held unsent until its code is stored`);
    if (!live(r)) return stopped('the delegation is signed and held unsent, its code not stored: only Discard');
    return storeAndPublish(r, dest, secrets);
  }

  /** Steps 4 to 6 for `r`, which holds its key pair and an unsent slot. */
  async function storeAndPublish(r: Run, dest: ProvisioningSecret, secrets: SecretStore): Promise<SignResult> {
    const held = (problem: string): SignResult => {
      r.problem = problem;
      r.stage = 'held';
      log(`${r.generation}: delegation ${r.id}'s code was not stored; it waits unsent (${problem})`);
      return { ok: false, reason: 'unsent', detail: problem };
    };
    const unpublished = 'the delegation is held unsent; nothing was published: only Discard';
    r.stage = 'storing';
    r.problem = null;
    bump();
    const custody = r.custody!;
    const jwk = (await crypto.subtle.exportKey('jwk', custody.pair.privateKey)) as JsonWebKey;
    const ctx = deps.context();
    if (!live(r) || ctx === null) return stopped(unpublished);
    const { root } = ctx.head.state;
    // (4) Encoded in memory, as admin's stdout carries it (a newline after), and handed to gcloud's stdin: the holder
    // lives for this one call.
    const code = new ProvisioningCode(
      `${encodeProvisioningCodeV2({
        hub: ctx.hub,
        org: ctx.head.state.org,
        roots: [...root.keys],
        recoveryPub: root.recoveryPub,
        token: custody.token,
        delegation: { id: r.id!, prefix: r.prefix, privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } },
      })}\n`,
    );
    const added = await secrets.addVersion(dest, code);
    if (!live(r)) return stopped(unpublished);
    // A store that may have succeeded with an announced version is confirmed like any other (refresh item 14).
    const version = added.ok ? added.value.version : added.outcome === 'may-have-succeeded' ? (added.version ?? null) : null;
    if (version === null) return held((added as { detail: string }).detail);
    // (5) Its metadata, never its value.
    const described = await secrets.describeVersion(dest, version);
    if (!live(r)) return stopped(unpublished);
    if (!described.ok) return held(added.ok ? described.detail : `${added.detail}; ${described.detail}`);
    // (6) Published: from the marker's clearing on, settlement owns the slot, whatever the post answers.
    const signer = deps.signer();
    if (signer === null) return stopped(unpublished);
    r.stage = 'publishing';
    bump();
    const published = await signer.publishHeld(r.hash!);
    const slot = deps.signer()?.pending() ?? null;
    if (slot !== null && slot.hash === r.hash && slot.unsent !== null) {
      if (!live(r)) return stopped(unpublished);
      const refusal = asResult(published);
      return held(`its code is stored (version ${version}), but the publish was refused: ${refusal.ok ? 'it answered nothing' : (refusal.detail ?? refusal.reason)}`);
    }
    r.custody = null;
    log(`${r.generation}: delegation ${r.id} published; its code is version ${version} of ${dest.project}/${dest.secret}`);
    if (published.ok) return { ok: true, version: published.version, secret: { version, createTime: instant(described.value.createTime) } };
    return asResult(published, `the delegation is published and its code stored (version ${version}): it settles as any pending proposal`);
  }

  async function rewrite(id: string): Promise<SignResult> {
    if (closed) return { ok: false, reason: 'busy', detail: 'the org session is closed' };
    const r = run;
    const gone: SignResult = { ok: false, reason: 'stale', detail: "this Mac no longer holds the delegation's key pair (a sign-out or a relaunch since it was signed): only Discard" };
    if (r === null || r.id !== id || r.custody === null || r.hash === null) return gone;
    if (r.working) return { ok: false, reason: 'busy', detail: 'its code is being written' };
    const slot = deps.signer()?.pending() ?? null;
    if (!live(r) || slot === null || slot.hash !== r.hash || slot.unsent === null) {
      end(r);
      return gone;
    }
    const dest = destination();
    if (!dest.ok) return dest.refusal;
    if (deps.secrets === null) return { ok: false, reason: 'secret-store', detail: 'secret-store: this build stores no provisioning code' };
    r.working = true;
    log(`${r.generation}: writing delegation ${id}'s code again`);
    try {
      return await storeAndPublish(r, dest.value, deps.secrets);
    } finally {
      settleRun(r);
    }
  }

  /** A minted key no state names, revoked now; the words for the answer. */
  async function revokeMinted(id: string): Promise<string> {
    const client = deps.context()?.client ?? null;
    const answer: HubResult<'revoked' | 'absent'> = client === null ? { ok: false, kind: 'unreachable', detail: 'no hub sign-in' } : await client.revokeProvisioningKey(id);
    void readKeys();
    if (answer.ok) {
      log(`key ${id}, minted for no signed delegation, was revoked`);
      return `the key it minted (${id}) was revoked`;
    }
    log(`key ${id}, minted for no signed delegation, was not revoked (${hubWords(answer)}): it shows as a stray key`);
    return `the key it minted (${id}) was not revoked (${hubWords(answer)}): it shows as a stray key`;
  }

  async function discarded(marker: Unsent | null): Promise<void> {
    if (marker === null || marker.kind !== 'delegation') return;
    if (run !== null && run.id === marker.id) end(run);
    const ctx = deps.context();
    const client = ctx === null ? null : ctx.client;
    const answer: HubResult<'revoked' | 'absent'> = client === null ? { ok: false, kind: 'unreachable', detail: 'no hub sign-in' } : await client.revokeProvisioningKey(marker.id);
    if (answer.ok) log(`the discarded delegation ${marker.id}'s hub key is ${answer.value === 'revoked' ? 'revoked' : 'gone'}`);
    else log(`the discarded delegation ${marker.id}'s hub key was not revoked (${hubWords(answer)}): it shows as a stray key`);
    await readKeys();
  }

  // ---- the hub halves ----

  /** `task` after every hub half queued before it, one at a time. */
  function queued<T>(task: () => Promise<T>): Promise<T> {
    const turn = halves.then(task);
    halves = turn.catch((error: unknown) => log(`a hub half failed: ${(error as Error).message}`));
    return turn;
  }

  /** The sign-in `asked` names has ended (a sign-out or close since): its answer is recorded nowhere. */
  const over = (asked: number) => closed || deps.context()?.signIn !== asked;

  function failed(id: string, asked: number, reason: HubProblem['reason'], detail: string): HubHalfResult {
    if (!over(asked)) {
      hubProblems.set(id, { reason, detail });
      bump();
    }
    log(`the hub half for ${id} did not finish (${reason}: ${detail})`);
    return { ok: false, reason, detail };
  }
  function done(id: string, asked: number, said: string): HubHalfResult {
    log(`the hub half for ${id}: ${said}`);
    if (!over(asked) && hubProblems.delete(id)) bump();
    return { ok: true };
  }

  /** Renew's hub half: `POST …/renew`, no body, by §S's answers. */
  async function renewHalf(id: string): Promise<HubHalfResult> {
    const ctx = deps.context();
    if (ctx === null) return { ok: false, reason: 'hub', detail: 'this Mac is not signed in to the org' };
    const asked = ctx.signIn;
    const delegation = ctx.head.state.delegations.find((d) => d.id === id);
    if (delegation === undefined) return { ok: false, reason: 'none', detail: `the org state holds no delegation ${id}` };
    if (ctx.client === null) return failed(id, asked, 'hub', 'the hub sign-in has ended: sign in again, then Retry');
    const answer = await ctx.client.renewProvisioningKey(id);
    if (over(asked)) return { ok: false, reason: 'hub', detail: 'the sign-in ended' };
    if (answer.ok) {
      noteKey(answer.value);
      await readKeys();
      return done(id, asked, `the hub's key now expires ${answer.value.expires}`);
    }
    const code = answer.kind === 'status' ? `${answer.status} ${answer.error}` : null;
    let result: HubHalfResult;
    if (code === '409 not-renewed') {
      // Also a renewal already applied (a lost 200): the key list says whether the hub's key is still behind.
      await readKeys();
      if (over(asked)) return { ok: false, reason: 'hub', detail: 'the sign-in ended' };
      const key = keys?.list.find((k) => k.id === id);
      if (key !== undefined && key.revoked === null && !(Date.parse(delegation.expires) > Date.parse(key.expires))) return done(id, asked, `the hub's key already expires ${key.expires}`);
      return failed(id, asked, 'not-renewed', `the hub's org state doesn't hold the renewal yet${key === undefined ? '' : `; its key still expires ${key.expires}`}`);
    }
    if (code === '503 hub-updating') result = failed(id, asked, 'updating', 'the hub is updating: Retry in a moment');
    else if (code === '404 not-found') result = failed(id, asked, 'no-route', `Renewed in the org state; this hub can't renew its key yet`);
    else if (code === '410 key-revoked') result = failed(id, asked, 'ended', "the hub's key was revoked, and a revoked key is never renewed");
    else if (code === '410 key-expired') result = failed(id, asked, 'ended', "the hub's key expired before it was renewed, and an elapsed key is never revived");
    else if (code === '409 too-long') result = failed(id, asked, 'too-long', 'the hub refuses that expiry yet (past its longest key life from now): Retry later');
    else if (answer.kind === 'status') result = failed(id, asked, 'refused', `the hub answered ${hubWords(answer)}`);
    else result = failed(id, asked, 'hub', `the hub was not reached (${hubWords(answer)}): Retry`);
    await readKeys();
    return result;
  }

  /** Drop's hub half, or a stray key's Revoke: `DELETE`, a soft revoke; `404 unknown-key` counts as gone. */
  async function revokeHalf(id: string): Promise<HubHalfResult> {
    const ctx = deps.context();
    if (ctx === null) return { ok: false, reason: 'hub', detail: 'this Mac is not signed in to the org' };
    const asked = ctx.signIn;
    if (ctx.head.state.delegations.some((d) => d.id === id)) return { ok: false, reason: 'none', detail: `delegation ${id} is in effect: drop it to revoke its key` };
    // A delegation the pending slot carries (held unsent, or published and not yet settled) is about to be in effect.
    if (deps.slotState()?.delegations.some((d) => d.id === id) === true) return { ok: false, reason: 'none', detail: `delegation ${id} is in the pending proposal: its Discard revokes its key` };
    if (ctx.client === null) return failed(id, asked, 'hub', 'the hub sign-in has ended: sign in again, then Retry');
    const answer = await ctx.client.revokeProvisioningKey(id);
    if (over(asked)) return { ok: false, reason: 'hub', detail: 'the sign-in ended' };
    await readKeys();
    if (answer.ok) return done(id, asked, answer.value === 'revoked' ? 'the hub\'s key is revoked' : 'the hub holds no such key');
    return answer.kind === 'status' ? failed(id, asked, answer.status === 503 && answer.error === 'hub-updating' ? 'updating' : 'refused', `the hub answered ${hubWords(answer)}`) : failed(id, asked, 'hub', `the hub was not reached (${hubWords(answer)}): Retry`);
  }

  function settled(slot: Pending): void {
    const state = slot.signed.state;
    const parent = deps.stateAt(state.version - 1);
    if (parent !== null) {
      for (const d of state.delegations) {
        const before = parent.delegations.find((p) => p.id === d.id);
        if (before !== undefined && Date.parse(d.expires) > Date.parse(before.expires)) void queued(() => renewHalf(d.id));
      }
      const wasDropped = new Set(parent.revoked.flatMap((r) => ('delegation' in r.holder ? [r.holder.delegation] : [])));
      for (const r of state.revoked) if ('delegation' in r.holder && !wasDropped.has(r.holder.delegation)) void queued(() => revokeHalf((r.holder as { delegation: string }).delegation));
    }
    void queued(() => readKeys());
  }

  // ---- the hub's key list ----

  function readKeys(options: { ifStale?: boolean } = {}): Promise<void> {
    // A read already out serves the page; anyone else (a hub half just answered) needs one that starts after it.
    if (keysReading !== null) return options.ifStale === true ? keysReading : keysReading.then(() => readKeys());
    if (closed || (options.ifStale === true && now() - keysAsked < timing.KEYS_FRESH_MS)) return Promise.resolve();
    keysAsked = now();
    const ctx = deps.context();
    if (ctx === null || ctx.client === null) {
      if (!keysFailed && ctx !== null) {
        keysFailed = true;
        bump();
      }
      return Promise.resolve();
    }
    const asked = ctx.signIn;
    const client = ctx.client;
    keysReading = (async () => {
      const read = await client.provisioningKeys();
      if (over(asked)) return;
      const before = JSON.stringify([keys?.list ?? null, keysFailed]);
      if (read.ok) {
        keys = { list: read.value.keys, at: now() };
        keysFailed = false;
      } else {
        keysFailed = true;
        log(`the hub's provisioning keys did not read (${hubWords(read)})`);
      }
      if (JSON.stringify([keys?.list ?? null, keysFailed]) !== before) bump();
    })().finally(() => (keysReading = null));
    return keysReading;
  }

  /** A key one answer gave (renew's), taken into the last read. */
  function noteKey(key: ProvisioningKey): void {
    if (keys === null) return;
    keys = { list: keys.list.map((k) => (k.id === key.id ? key : k)), at: keys.at };
    bump();
  }

  function fence(): void {
    if (run !== null) end(run);
    hubProblems.clear();
    keys = null;
    keysFailed = false;
    keysAsked = Number.NEGATIVE_INFINITY;
    bump();
  }

  return {
    status: () => ({ creating: run?.working ?? false, rev }),
    create,
    rewrite,
    renewHub: (id) => queued(() => renewHalf(id)),
    revokeHub: (id) => queued(() => revokeHalf(id)),
    settled,
    discarded,
    readKeys,
    viewInputs: () => ({
      keys: keys === null ? null : { list: keys.list, at: new Date(keys.at).toISOString() },
      keysFailed,
      unsent: run === null || run.id === null || run.hash === null ? null : { id: run.id, rewrite: run.custody !== null && !run.working && live(run), problem: run.problem },
      hubProblems,
    }),
    idle: () => halves.then(() => undefined),
    fence,
    close() {
      fence();
      closed = true;
      return Promise.resolve();
    },
  };
}
