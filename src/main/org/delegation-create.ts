// A delegation's create transaction (P5 O8 M4c, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4c's "The
// create transaction"; the refresh's items 8, 13 and 14; Interfaces §S). One of the two state owners behind
// delegations.ts (the other, delegation-hub.ts, owns the hub halves and the key list): this one owns the run, and the
// run alone owns the custody.
//
// - One run at a time, reserved before its first await (a second create answers `busy`), in admin.ts's order: (1) the
//   prefix, the composition's own checks, the destination and gcloud's preflight, before anything is minted; (2) the
//   mint, held to `mintDisagrees` (a disagreement revokes the key and refuses); (3) the key pair made here and
//   `delegation.add` signed into the slot unsent (`Edit.hold`), the one Touch ID; (4) the code encoded in memory and
//   added as a new version of the destination's secret, on gcloud's stdin alone; (5) that version's metadata read back
//   (`describe`, never `access`); (6) `publishHeld(hash)`, after which settlement owns the slot.
// - Every await's answer is judged against its run (`live`): the current run, the sign-in it began under, no sign-out
//   (`fence`), Discard or `close` since. A late answer from an ended run acts on nothing. A minted key no state names (a
//   refused or cancelled sign) is revoked at once; one an ending left (the hub isn't asked once the sign-in ended), or
//   whose revoke failed, shows as a stray key, which the view derives from the hub's list.
// - Until its slot exists, the run reserves its key (`reservation`): by id once the mint answered, and while the mint
//   is out by its prefix and its start. A reserved key is no stray, and no Revoke takes it.
// - Custody: the run's `custody` is the one owner of the minted token, the key pair and the code (a `ProvisioningCode`,
//   alive only while `versions add` is out). Ending the run (`end`: a sign-out, a Discard, `close`, a replacing run)
//   drops them all and aborts the run's gcloud child; custody is also released just before `publishHeld`, since from
//   there on nothing needs it (a published slot is never written again). None of it reaches a log, a status, an
//   answer, a file or an error: every line here names ids, prefixes and versions.
// - A failure at (4) or (5) leaves the slot unsent with its reason, and "Write the code again" (`rewrite`) runs (4) to
//   (6) again while this run holds the key pair. After a sign-out or a relaunch only Discard is offered.
// - Every answer names the run it belongs to (`DelegationRun`: the generation, the minted id, the held slot's hash) and
//   the phase the transaction stopped in (`refused`, `minted`, `held`, `published`), read off the run itself, so a sheet
//   words what happened and acts only on its own run (Task 5's fix wave, I1 and I4). A rewrite names the run, the id
//   and the hash it was shown, and anything else answers `stale`.
// - Fix wave 2: `published` only on the signer's own word that this publish cleared the marker (`PublishOutcome`), so a
//   slot discarded or replaced ahead of the publish answers `discarded`, never `published`; and every answer that ran
//   carries the status revision (`rev`) published after its final slot was in place, which the sheet waits for before
//   reading a slot it doesn't see as gone.
//
// Electron-free: the session injects the signer, the hub (through delegation-hub.ts), gcloud's custody and the
// destination's file.
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
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';
import type { DelegationCreateInput, DelegationPhase, DelegationResult, DelegationRewriteInput, OrgChange, ProvisioningSecret, SignResult } from '@shared/ipc/schema/org';
import type { DelegationHub } from './delegation-hub';
import { hubWords } from './delegation-hub';
import type { DelegationsContext } from './delegations';
import { composeChange, type ChangeEdit } from './edits';
import type { Unsent } from './files';
import type { MintedProvisioningKey, ProvisioningKey } from './hub-client';
import type { ProvisioningSecretStore } from './provisioning-secret-store';
import { ProvisioningCode, type SecretStore } from './secret-store';
import { StaleEdit, type OrgSigner, type SignOutcome } from './signer';

export type DelegationCreateDeps = {
  context(): DelegationsContext | null;
  standing(): SignResult | null;
  busy(): boolean;
  signer(): Pick<OrgSigner, 'sign' | 'publishHeld' | 'pending'> | null;
  check(change: OrgChange): Promise<SignResult | null>;
  secrets: SecretStore | null;
  destination: ProvisioningSecretStore | null;
  hub: Pick<DelegationHub, 'revokeKey' | 'readKeys'>;
  changed(): void;
  /** The status's `delegations.rev` as it stands (each `changed` publishes the next). */
  rev(): number;
  now(): number;
  log(line: string): void;
};

/**
 * The key a create under way holds before its slot names it: `id` once the mint answered; before that (the mint out),
 * any key of its `prefix` created at or after `since` (ISO).
 */
export type Reservation = { id: string | null; prefix: string; since: string };

/** Whether `reservation` holds key `id` (`key`: its entry in a read of the hub's list, when there is one). */
export function reservedBy(reservation: Reservation | null, id: string, key: Pick<ProvisioningKey, 'prefix' | 'created'> | null): boolean {
  if (reservation === null) return false;
  if (reservation.id !== null) return reservation.id === id;
  return key !== null && key.prefix === reservation.prefix && Date.parse(key.created) >= Date.parse(reservation.since);
}

export interface DelegationCreate {
  /** A create (or a rewrite) under way. */
  creating(): boolean;
  create(input: DelegationCreateInput): Promise<DelegationResult>;
  rewrite(input: DelegationRewriteInput): Promise<DelegationResult>;
  /** A Discard's marker: the run holding that slot ends (its custody dropped, its gcloud stopped). */
  discarded(marker: Unsent | null): void;
  reservation(): Reservation | null;
  unsent(): { id: string; rewrite: boolean; writing: boolean; problem: string | null; generation: number } | null;
  fence(): void;
  close(): void;
}

/**
 * A run's custody, its one owner: the minted token from the mint's answer on, the key pair once made, and the code only
 * while `versions add` is out. Ending the run drops it whole.
 */
type Custody = { token: string; pair: SigningKey | null; code: ProvisioningCode | null };
type Run = {
  generation: number;
  signIn: number;
  prefix: string;
  /** When the run was reserved, less `CLOCK_SLACK_MS` (the hub stamps `created` by its own clock). */
  since: number;
  /** The minted key's id, once minted. */
  id: string | null;
  custody: Custody | null;
  /** Aborted when the run ends: its gcloud child, if one is out, is killed. */
  stop: AbortController;
  /** The held slot's hash (`HeldSigned.hash`), once signed. */
  hash: string | null;
  /** Why its code isn't stored, or why its publish was refused (shown under its row). */
  problem: string | null;
  /** A create or a rewrite of it is under way. */
  working: boolean;
  /** The mint was asked and its answer lost: a key may have been minted (a stray, if so). */
  mintLost: boolean;
  /** The held sign's version, once signed. */
  version: number | null;
  /** Its code is in the secret, confirmed by describe. */
  stored: boolean;
  /** `publishHeld` cleared its marker (its own word): settlement owns the slot. */
  published: boolean;
  /** Its held slot was discarded or replaced before its publish: nothing was published. */
  discarded: boolean;
};

const DAY_S = 86_400;
/** How far before the run's start a key the mint is out for may be stamped, by a hub clock behind this Mac's. */
const CLOCK_SLACK_MS = 60_000;
const NOT_SIGNED_IN: SignResult = { ok: false, reason: 'not-root', detail: 'this Mac is not signed in to the org' };
const ENDED = 'the delegation\'s run ended (a sign-out, a Discard, or the app quit)';
const DISCARDED: SignResult = { ok: false, reason: 'stale', detail: 'its slot was discarded: nothing was published' };

/** A gcloud `createTime` (RFC 3339, microseconds) as ISO millis; as it came when it reads as no instant. */
function instant(text: string): string {
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? text : new Date(ms).toISOString();
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The fields of the hub's mint answer that `mintDisagrees` refuses, by name alone (the branch fix wave, R1): the
 * package's sentences quote the hub's values, and a value is the hub's word (a prefix could carry the token), so the
 * app's answer and its log never repeat one. Each field is judged by the package itself, set into an answer that
 * otherwise agrees.
 */
function disagreeingFields(answer: MintedProvisioningKey, asked: { prefix: string; ttl: number; maxUses: number | null; before: number; after: number }): string[] {
  const agreeing = { id: '0'.repeat(32), prefix: asked.prefix, expires: new Date(asked.before + asked.ttl * 1000).toISOString(), max_uses: asked.maxUses };
  const judged = (key: typeof agreeing, token: string) => mintDisagrees({ key, token }, asked).length > 0;
  const fields: string[] = (
    [
      ['id', 'id'],
      ['prefix', 'prefix'],
      ['expires', 'expiry'],
      ['max_uses', 'use cap'],
    ] as const
  ).flatMap(([field, name]) => (judged({ ...agreeing, [field]: answer.key[field] }, 'a-token') ? [name] : []));
  if (judged(agreeing, answer.token)) fields.push('token');
  return fields.length === 0 ? ['answer'] : fields;
}

/** Where `r` stopped (null: before any run was reserved). */
function phaseOf(r: Run | null): DelegationPhase {
  if (r === null) return 'refused';
  if (r.published) return 'published';
  if (r.discarded) return 'discarded';
  if (r.hash !== null) return 'held';
  return r.id !== null || r.mintLost ? 'minted' : 'refused';
}

/** `result` as the answer of run `r` (null: refused before one was reserved): the run's identities, its phase, and `rev`. */
function answerOf(r: Run | null, result: SignResult, rev: number): DelegationResult {
  const run = r === null ? null : { generation: r.generation, id: r.id, hash: r.hash };
  if (result.ok) return { ...result, run: run!, rev };
  return { ...result, phase: phaseOf(r), stored: r?.stored ?? false, ...(r?.version == null ? {} : { version: r.version }), run, rev };
}

/** A sign or publish outcome as `org.*` carries it (`signResult`'s rules; a held sign's hash never leaves). */
function asResult(outcome: SignOutcome, more?: string): SignResult {
  if (outcome.ok) return { ok: true, version: outcome.version };
  const detail = outcome.reason === 'refused' ? outcome.findings.filter((f) => f.level === 'refuse').map((f) => f.detail).join('; ') : outcome.detail;
  const words = [detail, more].filter((w) => w !== undefined && w !== '').join(': ');
  return words === '' ? { ok: false, reason: outcome.reason } : { ok: false, reason: outcome.reason, detail: words };
}

export function createDelegationCreate(deps: DelegationCreateDeps): DelegationCreate {
  const { now, log, changed } = deps;
  let closed = false;
  let generations = 0;
  let run: Run | null = null;

  /** `r` still stands: the current run, the sign-in it began under, nothing ended it. */
  function live(r: Run): boolean {
    if (run !== r || closed) return false;
    return deps.context()?.signIn === r.signIn;
  }

  /** `r`'s custody let go: the code's holder emptied, the token and the key pair unreferenced. */
  function release(r: Run): void {
    r.custody?.code?.drop();
    r.custody = null;
  }

  /** `r` ends: its custody dropped, its gcloud child stopped. */
  function end(r: Run): void {
    release(r);
    r.stop.abort();
    if (run !== r) return;
    run = null;
    changed();
  }

  const stopped = (what: string): SignResult => ({ ok: false, reason: 'not-root', detail: `${ENDED}: ${what}` });
  /** An answer given before anything changed: the status as it stands covers it. */
  const answer = (r: Run | null, result: SignResult) => answerOf(r, result, deps.rev());
  /** An answer once a run worked: one more status publication, after its final slot, and its revision. */
  const finalAnswer = (r: Run, result: SignResult) => {
    changed();
    // A Discard that ended the run, wherever the run stood (the branch fix wave, R4): its answer is the Discard's.
    const said = r.discarded && !result.ok && result.reason !== 'stale' ? DISCARDED : result;
    return answerOf(r, said, deps.rev());
  };
  const strayLeft = (id: string) => `nothing was signed; the key it minted (${id}) shows as a stray key`;

  async function create(input: DelegationCreateInput): Promise<DelegationResult> {
    const refused = reserve(input);
    if (!('run' in refused)) return answer(null, refused);
    const r = refused.run;
    let result: SignResult;
    try {
      result = await createRun(r, input, refused.ttl, refused.dest, refused.secrets);
    } finally {
      settleRun(r);
    }
    return finalAnswer(r, result);
  }

  /** The create's refusals before anything is minted, then its run, reserved synchronously (before the create's first await). */
  function reserve(input: DelegationCreateInput): SignResult | { run: Run; ttl: number; dest: ProvisioningSecret; secrets: SecretStore } {
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
    const r: Run = {
      generation: ++generations,
      signIn: ctx.signIn,
      prefix: input.prefix,
      since: now() - CLOCK_SLACK_MS,
      id: null,
      custody: null,
      stop: new AbortController(),
      hash: null,
      problem: null,
      working: true,
      mintLost: false,
      version: null,
      stored: false,
      published: false,
      discarded: false,
    };
    run = r;
    log(`${r.generation}: creating delegation ${input.prefix}`);
    changed();
    return { run: r, ttl, dest: dest.value, secrets: deps.secrets };
  }

  /** After a create or a rewrite: the run stays only while it holds an unsent slot (its key pair, or its reason). */
  function settleRun(r: Run): void {
    if (run !== r) {
      release(r);
      return;
    }
    r.working = false;
    if (r.hash === null || (r.custody === null && r.problem === null)) end(r);
    else changed();
  }

  /** The destination as its file holds it, or the create's refusal. */
  function destination(): { ok: true; value: ProvisioningSecret } | { ok: false; refusal: SignResult } {
    const read = deps.destination?.read() ?? { ok: true as const, value: null };
    if (!read.ok) return { ok: false, refusal: { ok: false, reason: 'secret-store', detail: `secret-store: the destination's file is damaged (${read.damaged}): reset it, then set it again` } };
    if (read.value === null) return { ok: false, refusal: { ok: false, reason: 'secret-store', detail: 'secret-store: no destination is set: name the project, secret and account first' } };
    return { ok: true, value: read.value };
  }

  /** A minted key no state names, revoked now for `r`'s sign-in; the words for the answer. */
  async function revokeMinted(r: Run, id: string): Promise<string> {
    const answer = await deps.hub.revokeKey(id, r.signIn);
    if (answer?.ok === true) {
      log(`key ${id}, minted for no signed delegation, was revoked`);
      return `the key it minted (${id}) was revoked`;
    }
    const why = answer === null ? 'the sign-in ended' : hubWords(answer);
    log(`key ${id}, minted for no signed delegation, was not revoked (${why}): it shows as a stray key`);
    return `the key it minted (${id}) was not revoked (${why}): it shows as a stray key`;
  }

  /**
   * (2) The mint, as delegationCreate makes it, held to `mintDisagrees`. On success the run reserves the key by id and
   * holds its token (the answer itself goes no further than this call).
   */
  async function mint(r: Run, input: DelegationCreateInput, ttl: number): Promise<{ ok: true; id: string; before: number } | { ok: false; result: SignResult }> {
    const { label, prefix, maxUses } = input;
    const client = deps.context()?.client ?? null;
    if (client === null) return { ok: false, result: { ok: false, reason: 'hub', detail: 'the hub sign-in has ended: nothing was minted' } };
    const before = now();
    const minted = await client.mintProvisioningKey({ label, prefix, ttl_s: ttl, ...(maxUses === null ? {} : { max_uses: maxUses }) });
    const after = now();
    if (!minted.ok) {
      // A mint whose answer was lost, or answered 2xx and didn't read (the branch fix wave, R3), may still have minted:
      // such a key shows as a stray key, once the key list is read again.
      r.mintLost = minted.kind === 'unreachable' || (minted.kind === 'status' && minted.status >= 200 && minted.status < 300);
      log(`${r.generation}: the hub ${r.mintLost ? 'may have minted' : 'did not mint'} (${hubWords(minted)})`);
      if (!live(r)) return { ok: false, result: stopped('nothing was signed') };
      if (!r.mintLost) return { ok: false, result: { ok: false, reason: 'hub', detail: `the hub did not mint the delegation's key (${hubWords(minted)}): nothing was signed` } };
      await deps.hub.readKeys();
      return { ok: false, result: { ok: false, reason: 'hub', detail: `the hub's answer to the mint was lost or didn't read (${hubWords(minted)}): a key may have been minted, and it shows as a stray key; nothing was signed` } };
    }
    const id = minted.value.key.id;
    if (!live(r)) {
      log(`${r.generation}: key ${id} was minted after the run ended: it shows as a stray key`);
      return { ok: false, result: stopped(strayLeft(id)) };
    }
    r.id = id;
    const asked = { prefix, ttl, maxUses, before, after };
    if (mintDisagrees(minted.value, asked).length > 0) {
      const fields = disagreeingFields(minted.value, asked).join(', ');
      log(`${r.generation}: the hub's answer to the mint disagrees with what was asked in its ${fields}`);
      const revoked = await revokeMinted(r, id);
      return { ok: false, result: { ok: false, reason: 'refused', detail: `the hub's answer to the mint disagrees with what was asked in its ${fields}: nothing was signed; ${revoked}` } };
    }
    r.custody = { token: minted.value.token, pair: null, code: null };
    return { ok: true, id, before };
  }

  /** (3)'s key pair, made here into `r`'s custody: its public key, or null once the run ended. */
  async function makePair(r: Run): Promise<string | null> {
    const pair = await generateSigningKey(true);
    if (!live(r) || r.custody === null) return null;
    r.custody.pair = pair;
    return pair.pub;
  }

  async function createRun(r: Run, input: DelegationCreateInput, ttl: number, dest: ProvisioningSecret, secrets: SecretStore): Promise<SignResult> {
    const nothing = 'nothing was minted';
    const { prefix, maxUses, owners } = input;
    // (1) The composition the checks would refuse costs no hub key: it is checked first with a stand-in id and key.
    const probeKey = await generateSigningKey();
    const probe: OrgChange = { kind: 'delegation.add', id: randomHex(16), pub: probeKey.pub, prefix, expires: new Date(now() + ttl * 1000).toISOString(), maxUses: maxUses ?? NO_USE_CAP, offlineRevokeS: NEVER_OFFLINE, owners };
    const checked = await deps.check(probe);
    if (!live(r)) return stopped(nothing);
    if (checked !== null && !checked.ok) return { ...checked, detail: [checked.detail, nothing].filter((w) => w !== undefined).join(': ') };
    const ready = await secrets.preflight(dest, r.stop.signal);
    if (!live(r)) return stopped(nothing);
    if (!ready.ok) return { ok: false, reason: 'secret-store', detail: `${ready.detail}: ${nothing}` };

    const minted = await mint(r, input, ttl);
    if (!minted.ok) return minted.result;
    const { id, before } = minted;

    // (3) The key pair, made here, and the delegation signed into the slot unsent.
    const pub = await makePair(r);
    if (pub === null) {
      log(`${r.generation}: the run ended with key ${id} minted: it shows as a stray key`);
      return stopped(strayLeft(id));
    }
    const at = deps.context()!;
    const change: OrgChange = { kind: 'delegation.add', id, pub, prefix, expires: new Date(before + ttl * 1000).toISOString(), maxUses: maxUses ?? NO_USE_CAP, offlineRevokeS: NEVER_OFFLINE, owners };
    let composed: ChangeEdit;
    try {
      composed = await composeChange(at.head.state, change, at.self, at.certificates);
    } catch (error) {
      const revoked = live(r) ? await revokeMinted(r, id) : `the key it minted (${id}) shows as a stray key`;
      return { ok: false, reason: 'refused', detail: `${(error as Error).message}: nothing was signed; ${revoked}` };
    }
    const signer = deps.signer();
    if (!live(r) || signer === null) return stopped(strayLeft(id));
    const outcome = await signer.sign({
      summary: composed.summary,
      lines: [...composed.lines, `Its provisioning code goes to ${dest.project}/${dest.secret} as a new version, never shown`],
      live: () => live(r),
      hold: { kind: 'delegation', id },
      async apply(draft) {
        if (!live(r)) throw new StaleEdit(`${ENDED}: nothing was signed`);
        await composed.apply(draft);
      },
    });
    if (!outcome.ok) {
      if (!live(r)) {
        log(`${r.generation}: the run ended while delegation ${id} was signed: its key shows as a stray key`);
        return asResult(outcome, `the key it minted (${id}) shows as a stray key`);
      }
      // A minted key no state names: revoked at once.
      return asResult(outcome, `nothing was signed; ${await revokeMinted(r, id)}`);
    }
    if (!('hash' in outcome)) return { ok: false, reason: 'invalid', detail: 'the delegation was signed but not held: nothing was stored' };
    r.hash = outcome.hash;
    r.version = outcome.version;
    log(`${r.generation}: delegation ${id} signed at version ${outcome.version}, held unsent until its code is stored`);
    changed();
    if (!live(r)) return stopped('the delegation is signed and held unsent, its code not stored: only Discard');
    return storeAndPublish(r, dest, secrets);
  }

  /** (4)'s code, encoded in memory from `r`'s custody into a holder the custody owns: null once the run ended. */
  async function encode(r: Run, ctx: DelegationsContext): Promise<ProvisioningCode | null> {
    const custody = r.custody;
    if (custody === null || custody.pair === null) return null;
    const jwk = (await crypto.subtle.exportKey('jwk', custody.pair.privateKey)) as JsonWebKey;
    if (!live(r) || r.custody !== custody) return null;
    const { root } = ctx.head.state;
    // As admin's stdout carries it, a newline after.
    custody.code = new ProvisioningCode(
      `${encodeProvisioningCodeV2({
        hub: ctx.hub,
        org: ctx.head.state.org,
        roots: [...root.keys],
        recoveryPub: root.recoveryPub,
        token: custody.token,
        delegation: { id: r.id!, prefix: r.prefix, privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } },
      })}\n`,
    );
    return custody.code;
  }

  /** Steps 4 to 6 for `r`, which holds its key pair and an unsent slot. */
  async function storeAndPublish(r: Run, dest: ProvisioningSecret, secrets: SecretStore): Promise<SignResult> {
    const held = (problem: string): SignResult => {
      r.problem = problem;
      log(`${r.generation}: delegation ${r.id}'s code was not stored or published; it waits unsent (${problem})`);
      return { ok: false, reason: 'unsent', detail: problem };
    };
    const unpublished = 'the delegation is held unsent; nothing was published: only Discard';
    r.problem = null;
    changed();
    const ctx = deps.context();
    if (!live(r) || ctx === null) return stopped(unpublished);
    const code = await encode(r, ctx);
    if (code === null) return stopped(unpublished);
    const added = await secrets.addVersion(dest, code, r.stop.signal);
    // The write answered: the code is needed no more (a rewrite encodes it again from the key pair).
    code.drop();
    if (r.custody !== null) r.custody.code = null;
    if (!live(r)) return stopped(unpublished);
    // A store that may have succeeded with an announced version is confirmed like any other (refresh item 14).
    const version = added.ok ? added.value.version : added.outcome === 'may-have-succeeded' ? (added.version ?? null) : null;
    if (version === null) return held((added as { detail: string }).detail);
    // (5) Its metadata, never its value.
    const described = await secrets.describeVersion(dest, version, r.stop.signal);
    if (!live(r)) return stopped(unpublished);
    if (!described.ok) return held(added.ok ? described.detail : `${added.detail}; ${described.detail}`);
    r.stored = true;
    // (6) Published. Custody goes first: from here on nothing needs it, since a published slot is never written again.
    const signer = deps.signer();
    if (signer === null) return stopped(unpublished);
    release(r);
    changed();
    const published = await signer.publishHeld(r.hash!);
    // Published only on the signer's word that this publish cleared the marker; a slot merely gone is not that.
    r.published = published.published === true;
    const slot = deps.signer()?.pending() ?? null;
    const stillHeld = !r.published && slot !== null && slot.hash === r.hash && slot.unsent !== null;
    r.discarded ||= !r.published && (slot === null || slot.hash !== r.hash);
    if (r.discarded) {
      const refusal = asResult(published);
      log(`${r.generation}: delegation ${r.id}'s slot was discarded or replaced before its publish: nothing was published`);
      return { ok: false, reason: 'stale', detail: `its slot was discarded or replaced before its publish (${refusal.ok ? 'it answered nothing' : (refusal.detail ?? refusal.reason)}): nothing was published` };
    }
    if (!live(r)) return stopped(stillHeld ? unpublished : 'its publish began before the run ended: it settles as any pending proposal');
    if (stillHeld) {
      const refusal = asResult(published);
      return held(`its code is stored (version ${version}), but the publish was refused: ${refusal.ok ? 'it answered nothing' : (refusal.detail ?? refusal.reason)}; only Discard`);
    }
    log(`${r.generation}: delegation ${r.id} published; its code is version ${version} of ${dest.project}/${dest.secret}`);
    if (published.ok) return { ok: true, version: published.version, secret: { version, createTime: instant(described.value.createTime) } };
    return asResult(published, `the delegation is published and its code stored (version ${version}): it settles as any pending proposal`);
  }

  async function rewrite(asked: DelegationRewriteInput): Promise<DelegationResult> {
    const { generation, id, hash } = asked;
    if (closed) return answer(null, { ok: false, reason: 'busy', detail: 'the org session is closed' });
    const r = run;
    // Only the run, the delegation and the slot the asker was shown: another run's (a replacement since) is never written.
    if (r === null || r.generation !== generation || r.id !== id || r.hash !== hash) {
      return answer(null, { ok: false, reason: 'stale', detail: 'that create is no longer the one this Mac runs (a Discard, a new create, a sign-out or a relaunch since): nothing was written' });
    }
    const gone: SignResult = { ok: false, reason: 'stale', detail: "this Mac no longer holds the delegation's key pair (a sign-out, a relaunch or a refused publish since it was signed): only Discard" };
    if (r.custody === null) return answer(r, gone);
    if (r.working) return answer(r, { ok: false, reason: 'busy', detail: 'its code is being written' });
    const slot = deps.signer()?.pending() ?? null;
    if (!live(r) || slot === null || slot.hash !== r.hash || slot.unsent === null) {
      end(r);
      return answer(r, gone);
    }
    const dest = destination();
    if (!dest.ok) return answer(r, dest.refusal);
    if (deps.secrets === null) return answer(r, { ok: false, reason: 'secret-store', detail: 'secret-store: this build stores no provisioning code' });
    r.working = true;
    log(`${r.generation}: writing delegation ${id}'s code again`);
    let result: SignResult;
    try {
      result = await storeAndPublish(r, dest.value, deps.secrets);
    } finally {
      settleRun(r);
    }
    return finalAnswer(r, result);
  }

  function fence(): void {
    if (run !== null) end(run);
  }

  return {
    creating: () => run?.working ?? false,
    create,
    rewrite,
    discarded(marker) {
      if (marker === null || marker.kind !== 'delegation' || run === null || run.id !== marker.id) return;
      // Recorded before the run ends, so whatever step it was in answers the Discard (the branch fix wave, R4).
      run.discarded = true;
      end(run);
    },
    reservation: () => (run === null || run.hash !== null ? null : { id: run.id, prefix: run.prefix, since: new Date(run.since).toISOString() }),
    unsent: () =>
      run === null || run.id === null || run.hash === null
        ? null
        : { id: run.id, rewrite: run.custody !== null && !run.working && live(run), writing: run.working && live(run), problem: run.problem, generation: run.generation },
    fence,
    close() {
      fence();
      closed = true;
    },
  };
}
