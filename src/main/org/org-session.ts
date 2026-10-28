// The app's production org session (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M1 and
// Interfaces §A): this profile signed in to the person's org from a pairing code, as O7's `OrgSession` (session.ts, O7
// §B) for the RL2 links and as `org.*`'s service for the Org section.
//
// - Registration: Access's login (access-login.ts), `/api/me` naming the code's org and member, the device keys made
//   here for the first time on this profile, the chain from genesis verified against the code's pins, the entry posted
//   with the code's MAC and its fingerprint shown, then the approving device's successor. Files are written last, in
//   the order chain.json, access.json, registration.json: until the registration file lands, the profile reads `none`.
// - Being signed in is the registration plus the held head listing this device under its member with this profile's
//   keys. The Access token gates only the hub: an ended token sets `hub` to null and leaves the links on their direct
//   carrier. A hub that stops admitting the member (a `4403` close, `403 not-a-member`) reads `denied` and changes no
//   trust state: only a verified head does.
// - Following the hub: the Registry feed (registry-feed.ts) is attached; at its open and at each announced version above
//   the held head the session reads the chain since the head and adopts it (held.ts), and every CERTS_REFRESH_MS it
//   reads the head, the transitions and the certificates.
// - Sign-out's commit point is the `signedOut` marker in registration.json, written before access.json is deleted; a
//   registration with no readable access.json also reads signed out, so a failed marker write that still removes the
//   token starts signed out. A running attempt is fenced by a generation counter that cancel and sign-out advance.
// - One commit queue carries every write of registration.json and access.json and every change of the held chain's trust
//   (`commit`): each operation takes the registration as it stands at its turn and checks its fence there, so no write
//   lands a snapshot another has outdated, and none queued before a sign-out lands after it.
// - A profile that never signs in has no keys, no `<userData>/org/` and makes no request.
//
// M3 (the app as the org's signer; M3's Decisions, Interfaces §K) composes over the session, once a registration is held:
// the signing store (signing-store.ts, signing.json's one writer, over this commit queue; its registration flag written
// in the queue's turn), the signer (signer.ts, settled at start and at each feed open), the weekly asking (weekly.ts)
// and the direct deliveries (deliveries.ts), all on the held view; the status carries their `signer` part. And `rekey`:
// new keys registered with a fresh pairing code beside the old device, then promoted in one recoverable transaction in
// the commit queue (registration.json's `rekey` intent, the two renames, the new device id), fenced by the attempt's
// generation until the intent is on disk and irreversible from then; the load replays an intent a crash cut off before
// the missing-keys check. The old device's retired key file is destroyed once the held head lists neither of its keys.
//
// Electron-free: the browser opener, the step-up signer, the state signer, focus, notifications and the RL2 links are
// injected from main.
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  advanceHead,
  base64urlDecode,
  canonicalize,
  decodePairingCode,
  keyId,
  pairingFingerprint,
  pairingMac,
  stateHash,
  verifyPinnedChain,
  type Certificates,
  type Device,
  type OrgPins,
  type OrgState,
  type PairingCode,
  type RootTransition,
  type Signed,
  type SignedOrgState,
} from '../../../apps/org-protocol/src/index.ts';
import type { DiscardResult, OrgAttempt, OrgRefusal, OrgSignerStatus, OrgStatus, SignResult } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import {
  createNextDeviceKeys,
  destroyRetiredDeviceKeys,
  deviceKeyIds,
  DeviceKeysError,
  discardNextDeviceKeys,
  findDeviceKeys,
  loadDeviceKeys,
  promoteNextDeviceKeys,
  type DeviceKeyIds,
  type DeviceKeys,
  type DeviceKeysDeps,
} from '../device/keys';
import type { StateSigner } from '../device/step-up';
import { cloudflareLoginTransfer, hubAdmission, hubHeaders, standinLogin, tokenClaims, AccessLoginError, type AccessLogin, type HubCredential } from './access-login';
import {
  ACCESS_FILE,
  isAccessFile,
  isRegistrationFile,
  orgFiles,
  REGISTRATION_FILE,
  type AccessFile,
  type Anchor,
  type OrgFiles,
  type RegistrationFile,
} from './files';
import { describeHolder, supersededRevocations } from './checks';
import { createDeliveries, type Deliveries, type DeliveryLink } from './deliveries';
import { rereadFrom, startHeldOrg, type HeldOrg } from './held';
import { hubClient, type HubClient, type HubResult, type Me, type Served } from './hub-client';
import type { RegistryFeedHooks } from './registry-feed';
import type { OrgSession, SignedIn } from './session';
import { createOrgSigner, supersededEdit, type OrgSigner, type SignOutcome } from './signer';
import { createSigningStore, type SigningStore } from './signing-store';
import { orgTiming, type OrgTiming } from './timing';
import { startWeekly, type Weekly } from './weekly';

export interface OrgSessionService extends OrgSession {
  status(): OrgStatus;
  onStatus(listener: (status: OrgStatus) => void): () => void;
  /** Starts; progress and the outcome arrive as statuses. A code for the held registration's org is a sign-in. */
  register(code: string): OrgAttempt;
  /** A held registration: the login transfer alone. */
  signIn(): OrgAttempt;
  /** Only in `held-chain`; else refused `busy`. */
  reanchor(code: string): OrgAttempt;
  cancel(): void;
  signOut(): Promise<void>;
  /** The feed's notices: open, close, state, removed, credentials ended. */
  attach(feed: RegistryFeedHooks): () => void;
  close(): Promise<void>;
  /** Resolves once the files read at startup are read (the tests' and main's wait; nothing needs it). */
  readonly loaded: Promise<void>;
  /** M3: "Re-sign now": the no-change successor, signed at once (Touch ID asks). */
  resign(): Promise<SignResult>;
  /** M3: one successor carrying the superseded states' revocations the recovered line lost (P5 Decision Log 30). */
  revokeSuperseded(): Promise<SignResult>;
  /** M3: new keys, registered with a fresh pairing code beside the old device; offered unmarked or removed. */
  rekey(code: string): OrgAttempt;
  /** M3: the pending slot abandoned, on the owner's confirmation, while the hub's chain doesn't hold it. */
  discardPending(confirmed: true): Promise<DiscardResult>;
  /** M3: a fresh signing.json, on the owner's confirmation, in `problem: 'signing'` only. */
  resetSigning(confirmed: true): Promise<void>;
}

/** M3: what the signer needs of main, injected so this module stays Electron-free. Without it nothing is signed. */
export type OrgSigningDeps = {
  /** The device module's state signer over these keys' step-up key (step-up.ts's `createStateSigner`: Touch ID first). */
  stateSigner(keys: DeviceKeys): Promise<StateSigner>;
  /** An app window has focus. */
  focused(): boolean;
  /** An app window gained focus (`browser-window-focus`): the weekly successor's moment to ask. */
  onFocus(listener: () => void): () => void;
  /** One notification (`clientPort.notify`), whose click brings the app to the front. */
  notify(text: string): void;
  /** O7's RL2 roster (`Machines.onRemote`) and its links (`Machines.remote`), for the direct deliveries. */
  roster(): readonly MachineRef[];
  onRoster(listener: () => void): () => void;
  link(ref: MachineRef): DeliveryLink | null;
};

/** M3: the key files a rekey moves (src/main/device/keys.ts's; tests inject one that pauses between its steps). */
export type DeviceKeyFiles = {
  createNext(profile: string, deps: DeviceKeysDeps): Promise<DeviceKeys>;
  discardNext(profile: string): Promise<void>;
  promote(profile: string): Promise<void>;
  destroyRetired(profile: string): Promise<void>;
  find(profile: string, device: string): Promise<'current' | 'next' | null>;
  retired(profile: string): Promise<DeviceKeyIds | null>;
};

export interface OrgSessionDeps {
  userData: string;
  build: string;
  packaged: boolean;
  /** MAWS_DEV_STANDIN_USER, honoured unpackaged only. */
  env: NodeJS.ProcessEnv;
  /** main's openExternalUrl. */
  openExternal(url: string): boolean;
  stepUp(keys: DeviceKeys, device: { org: string; device: string }): SignedIn['stepUp'];
  /** Tests inject one with excludeFromBackup stubbed. */
  loadKeys?: typeof loadDeviceKeys;
  excludeFromBackup?(path: string): Promise<boolean>;
  /** The Access login; the transfer by default (the stand-in is chosen by the code's hub). */
  login?: AccessLogin;
  fetch?: typeof fetch;
  /** Tests inject files whose writes fail. */
  files?: OrgFiles;
  /** M3's signer; main always passes it. */
  signing?: OrgSigningDeps;
  /** M3: the rekey's key files; keys.ts's by default. */
  keyFiles?: Partial<DeviceKeyFiles>;
  now?(): number;
  timing?: Partial<OrgTiming>;
  log(line: string): void;
}

type HubAccessState = Extract<OrgStatus, { state: 'registered' }>['hubAccess'];
type Problem = Extract<OrgStatus, { state: 'registered' }>['problem'];
type Registering = { step: 'browser' | 'checking' | 'approval'; org: string; hub: string; fingerprint: string | null; expires: string | null };
type Rekeying = NonNullable<NonNullable<OrgSignerStatus>['rekeying']>;
/** What the status and the signer read of this profile's keys, computed once per key set. */
type KeyFacts = { channelKid: string; stepUpKid: string; fingerprint: string };
/** M3's parts, composed once a registration is held. */
type Composed = { store: SigningStore; signer: OrgSigner; deliveries: Deliveries; weekly: Weekly; offs: Array<() => void> };
const DAY_MS = 86_400_000;

/** A refusal thrown inside an attempt; anything else thrown is reported as `hub`. */
class Refusal extends Error {
  constructor(readonly refusal: OrgRefusal) {
    super(refusal.code);
  }
}
function refuse(code: OrgRefusal['code'], detail?: string): never {
  throw new Refusal(detail === undefined ? { code } : { code, detail });
}
class Fenced extends Error {}

const MAX_TIMER_MS = 2 ** 31 - 1;

/** The same registration as trust goes: this device of this member in this org, holding the same anchor and pins. */
const sameTrust = (a: RegistrationFile, b: RegistrationFile): boolean =>
  a.hub === b.hub && a.org === b.org && a.member.id === b.member.id && a.device === b.device && canonicalize(a.anchor) === canonicalize(b.anchor) && canonicalize(a.pins) === canonicalize(b.pins);

/** The device entry this profile's keys make: its id is the channel key's id, so it changes exactly when the keys do. */
async function deviceEntry(keys: DeviceKeys): Promise<Omit<Device, 'endorsement'>> {
  return { id: await keyId(keys.channel.pub), class: 'native-mac', keyStorage: 'software', channelPub: keys.channel.pub, stepUpPub: keys.stepUp.pub };
}

/** Whether `head` lists `device` under `member` with exactly these keys. */
function lists(head: SignedOrgState, member: string, device: { id: string; channelPub: string; stepUpPub?: string }): boolean {
  const listed = head.state.members.find((m) => m.id === member)?.devices.find((d) => d.id === device.id);
  return listed !== undefined && listed.class === 'native-mac' && listed.channelPub === device.channelPub && listed.stepUpPub === device.stepUpPub;
}

/** Whether `head` lists either key of `ids` (or its device id) as a current device key. */
function keysCurrent(head: SignedOrgState, ids: DeviceKeyIds): boolean {
  const pubs = new Set([ids.channelPub, ids.stepUpPub]);
  return head.state.members.some((m) => m.devices.some((d) => d.id === ids.device || pubs.has(d.channelPub) || (d.stepUpPub !== undefined && pubs.has(d.stepUpPub))));
}

/** `reg` with no rekey intent. */
function withoutRekey(reg: RegistrationFile): RegistrationFile {
  const next = { ...reg };
  delete next.rekey;
  return next;
}

/** Why this entry can never be listed with these keys: a key left the org, or its id is someone else's or other keys'. */
async function removedReason(head: SignedOrgState, member: string, entry: Omit<Device, 'endorsement'>): Promise<string | null> {
  const kids = [await keyId(entry.channelPub), await keyId(entry.stepUpPub!)];
  const gone = new Set([...head.state.revoked.map((r) => r.keyId), ...head.state.retired.map((r) => r.keyId)]);
  if (kids.some((kid) => gone.has(kid))) return 'this device\'s keys were removed from the org';
  for (const m of head.state.members) {
    const d = m.devices.find((x) => x.id === entry.id);
    if (d === undefined) continue;
    if (m.id !== member) return 'this device is listed under another member';
    if (!lists(head, member, entry)) return 'this device is listed with other keys';
  }
  return null;
}

export function createOrgSession(deps: OrgSessionDeps): OrgSessionService {
  const timing = orgTiming(deps.timing);
  const now = deps.now ?? Date.now;
  const log = (line: string) => deps.log(`[org] ${line}`);
  const files = deps.files ?? orgFiles({ userData: deps.userData, excludeFromBackup: deps.excludeFromBackup, log });
  const loadKeys = deps.loadKeys ?? loadDeviceKeys;
  const transfer = deps.login ?? cloudflareLoginTransfer({ openExternal: deps.openExternal, fetch: deps.fetch, timing: deps.timing, log: (line) => deps.log(`[org-login] ${line}`) });
  const keyFiles: DeviceKeyFiles = {
    createNext: createNextDeviceKeys,
    discardNext: (profile) => discardNextDeviceKeys(profile),
    promote: (profile) => promoteNextDeviceKeys(profile),
    destroyRetired: (profile) => destroyRetiredDeviceKeys(profile),
    find: (profile, device) => findDeviceKeys(profile, device),
    retired: (profile) => deviceKeyIds(profile, 'retired'),
    ...deps.keyFiles,
  };
  const keyDeps = (): DeviceKeysDeps => (deps.excludeFromBackup === undefined ? {} : { excludeFromBackup: deps.excludeFromBackup });

  const changeListeners = new Set<() => void>();
  const statusListeners = new Set<(status: OrgStatus) => void>();

  let closed = false;
  /** The files read at startup are read: until then no attempt starts, since a held registration may be on disk. */
  let ready = false;
  let registration: RegistrationFile | null = null;
  let credential: HubCredential | null = null;
  let keys: DeviceKeys | null = null;
  let held: HeldOrg | null = null;
  let unheld: (() => void) | null = null;
  let problem: Problem = null;
  let hubAccess: HubAccessState = 'connecting';
  let feedOpen = false;
  let refused: OrgRefusal | undefined;
  let registering: Registering | null = null;
  let signingIn = false;
  /** A sign-out between its marker and the token's removal: an attempt now would have its token removed under it. */
  let signingOut = false;
  /** Advanced by cancel and sign-out: an attempt that started under another generation writes nothing. */
  let generation = 0;
  let attempt: AbortController | null = null;
  // Each attempt is numbered and logged at its start (with this process's pid, so a second main process on the same
  // profile shows in a shared log) and at its end, however it ends: two browser trips in a log always say why.
  let attempts = 0;
  let attemptNo = 0;
  let attemptEnded = false;
  const endAttempt = (how: string) => {
    if (attemptEnded) return;
    attemptEnded = true;
    log(`attempt ${attemptNo}: ${how}`);
  };
  let value: SignedIn | null = null;
  let valueKey = '';
  let tokenTimer: ReturnType<typeof setTimeout> | null = null;
  let certsTimer: ReturnType<typeof setInterval> | null = null;
  let recoverTimer: ReturnType<typeof setInterval> | null = null;
  let syncing: Promise<void> | null = null;
  let syncAgain = false;
  let lastStatus = '';
  let commits: Promise<unknown> = Promise.resolve();
  // ---- M3 ----
  let facts: KeyFacts | null = null;
  let stateSigner: StateSigner | null = null;
  let composed: Composed | null = null;
  let composing = false;
  /** The superseded states' revocations, as the status shows them; recomputed at each change of the session. */
  let offer: NonNullable<OrgSignerStatus>['offer'] = null;
  let offerTurn = 0;
  /** The hub's last refusal of the pending state, this run. */
  let pendingRefused: { version: number; detail: string } | null = null;
  let rekeying: Rekeying | null = null;
  /** A rekey's old keys (keys.retired.json) while the held head still lists them. */
  let retired: DeviceKeyIds | null = null;
  /** One rekey's key files at a time: an attempt a cancel ended may still be cleaning up when the next one starts. */
  let keyWork: Promise<void> = Promise.resolve();
  let retiredWork: Promise<void> = Promise.resolve();

  /**
   * Runs `body` after every commit queued before it. Nothing run here may wait on a held view's adoption queue, whose
   * anchor writes wait here: a view made inside is given an `anchorSaver` that keeps its anchor until the view is held.
   */
  function commit<T>(body: () => Promise<T>): Promise<T> {
    const turn = commits.then(body);
    commits = turn.catch(() => {});
    return turn;
  }

  /** A read the feed or a timer starts: a failure (a chain.json write, say) is logged, and the held state stays as it was. */
  function background(what: string, task: () => Promise<void>): void {
    task().catch((error: unknown) => log(`${what} failed: ${(error as Error).message}`));
  }

  // ---- what the session answers ----

  const listed = (): boolean => {
    if (registration === null || keys === null || held === null || !held.ready()) return false;
    return lists(held.head(), registration.member.id, { id: registration.device, channelPub: keys.channel.pub, stepUpPub: keys.stepUp.pub });
  };

  const hubLive = (): boolean => credential !== null && hubAccess !== 'expired' && hubAccess !== 'denied';

  function hubAccessFor(cred: HubCredential, hub: string): SignedIn['hub'] {
    const headers = hubHeaders(cred);
    return { url: hub, headers: () => Promise.resolve({ ...headers }) };
  }

  /** O7 §B's value, rebuilt when what it carries changes. */
  /** current() is non-null: read without rebuilding its value, so a status read never stands in for `changed()`. */
  const answering = (): boolean => !closed && registration !== null && !registration.signedOut && problem !== 'held-chain' && problem !== 'directory' && listed();

  function computeCurrent(): SignedIn | null {
    if (registration === null || !answering()) return null;
    const reg = registration;
    const k = keys!;
    const live = hubLive() && credential !== null;
    const key = `${reg.org}|${reg.member.id}|${reg.device}|${live ? JSON.stringify(credential) : ''}`;
    if (value === null || key !== valueKey) {
      valueKey = key;
      value = {
        identity: { org: reg.org, member: reg.member.id, device: reg.device, clientClass: 'native-mac', channelKey: k.channel, build: deps.build, capabilities: [] },
        view: held!,
        stepUp: deps.stepUp(k, { org: reg.org, device: reg.device }),
        hub: live ? hubAccessFor(credential!, reg.hub) : null,
      };
    }
    return value;
  }

  function status(): OrgStatus {
    if (registering !== null) return { state: 'registering', ...registering };
    if (registration === null) return refused === undefined ? { state: 'none' } : { state: 'none', refused };
    const reg = registration;
    const head = held !== null && held.ready() ? held.head().state : null;
    const session = reg.signedOut ? 'signed-out' : held !== null && head !== null && keys !== null && !listed() ? 'removed' : 'signed-in';
    const access: HubAccessState = signingIn ? 'signing-in' : credential === null ? 'expired' : hubAccess === 'connecting' && feedOpen ? 'connected' : hubAccess;
    return {
      state: 'registered',
      org: reg.org,
      hub: reg.hub,
      member: { ...reg.member },
      device: reg.device,
      session,
      hubAccess: access,
      head: head === null ? null : { version: head.version, issued: head.issued },
      problem: problem ?? (composed?.store.get() === 'damaged' ? 'signing' : null),
      ...(refused === undefined ? {} : { refused }),
      signer: signerStatus(),
    };
  }

  /** The status's `signer` part: null until a head is held and this profile's keys are known. */
  function signerStatus(): OrgSignerStatus {
    if (registration === null || held === null || !held.ready() || facts === null) return null;
    const head = held.head().state;
    const c = composed;
    const slot = c?.signer.pending() ?? null;
    const file = c?.store.get();
    return {
      root: head.root.keys.includes(facts.stepUpKid),
      maySign: c !== null && maySign(c.signer),
      fingerprint: facts.fingerprint,
      stepUpKid: facts.stepUpKid,
      due: c?.weekly.due() ?? false,
      ageDays: Math.floor((now() - Date.parse(head.issued)) / DAY_MS),
      pending: slot === null ? null : { version: slot.version, fork: slot.fork, exposed: slot.exposed, refused: pendingRefused?.version === slot.version ? pendingRefused.detail : null },
      offer,
      owing: c?.deliveries.owing() ?? [],
      abandoned: file === undefined || file === 'damaged' ? [] : file.abandoned.map((a) => ({ version: a.version, hub: a.hub, machines: [...a.machines] })),
      rekey: keys !== null && !keys.excludedFromBackupAtCreation ? 'unmarked' : null,
      rekeying,
      oldDevice: retired?.device ?? null,
    };
  }

  /** The signer may sign, and this device is signed in: a signed-out root asks nothing and signs nothing. */
  const maySign = (signer: OrgSigner): boolean => answering() && signer.maySign();

  /** Tells every listener what changed: `onChanged` when the session's value did (or `force`), the status when it did. */
  function changed(force = false): void {
    if (closed) return;
    const before = value;
    const beforeKey = valueKey;
    const current = computeCurrent();
    if (current === null) {
      value = null;
      valueKey = '';
    }
    if (force || current !== before || valueKey !== beforeKey) tell(changeListeners);
    const next = status();
    const text = JSON.stringify(next);
    if (text !== lastStatus) {
      lastStatus = text;
      for (const listener of [...statusListeners]) {
        try {
          listener(next);
        } catch (error) {
          log(`a status listener failed: ${(error as Error).message}`);
        }
      }
    }
    armTimers();
  }

  function tell(listeners: Set<() => void>): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        log(`an onChanged listener failed: ${(error as Error).message}`);
      }
    }
  }

  // ---- the hub credential ----

  function client(hub: string, cred: HubCredential): HubClient {
    return hubClient({ url: hub, headers: () => Promise.resolve(hubHeaders(cred)), fetch: deps.fetch, timing: deps.timing });
  }

  function credentialEnded(why: string): void {
    if (credential === null || hubAccess === 'expired') return;
    log(`the hub sign-in has ended (${why}); the device stays signed in`);
    hubAccess = 'expired';
    feedOpen = false;
    changed(true);
  }

  function denied(why: string): void {
    if (hubAccess === 'denied') return;
    log(`the hub no longer admits this member (${why}); the org state this Mac holds is unchanged`);
    hubAccess = 'denied';
    feedOpen = false;
    changed(true);
  }

  /** What a failed hub answer says of the credential, after any other attempt's: true when it ended the hub. */
  function hubFailed(result: Exclude<HubResult<unknown>, { ok: true }>): void {
    if (result.kind === 'credentials') credentialEnded(`Access answered ${result.status}`);
    else if (result.kind === 'denied') denied('403 not-a-member');
    else if (result.kind === 'unreachable') {
      if (hubAccess === 'connecting' && !feedOpen) {
        hubAccess = 'unreachable';
        changed();
      }
    } else log(`the hub answered ${result.status}${result.error === null ? '' : ` ${result.error}`}`);
  }

  function armTimers(): void {
    if (tokenTimer !== null) clearTimeout(tokenTimer);
    tokenTimer = null;
    const live = !closed && registration !== null && !registration.signedOut && hubLive();
    if (live && credential!.kind === 'access') {
      const end = Date.parse(credential!.expires) - timing.TOKEN_SKEW_MS;
      const wait = Math.max(0, Math.min(end - now(), MAX_TIMER_MS));
      tokenTimer = setTimeout(() => {
        tokenTimer = null;
        if (credential?.kind === 'access' && Date.parse(credential.expires) - timing.TOKEN_SKEW_MS <= now()) credentialEnded('its time ran out');
        else armTimers();
      }, wait);
      (tokenTimer as { unref?: () => void }).unref?.();
    }
    const following = live && computeCurrent() !== null;
    if (following && certsTimer === null) {
      certsTimer = setInterval(() => background('the certificate refresh', refreshCertificates), timing.CERTS_REFRESH_MS);
      (certsTimer as { unref?: () => void }).unref?.();
    } else if (!following && certsTimer !== null) {
      clearInterval(certsTimer);
      certsTimer = null;
    }
    // A held chain closed by its load check is retried from the hub on the same clock while a credential lives (the
    // feed never opens while current() is null, so nothing else would ask again before a sign-in or a restart).
    const recovering = live && problem === 'held-chain';
    if (recovering && recoverTimer === null) {
      recoverTimer = setInterval(() => background('taking the hub\'s chain', recoverFromHub), timing.CERTS_REFRESH_MS);
      (recoverTimer as { unref?: () => void }).unref?.();
    } else if (!recovering && recoverTimer !== null) {
      clearInterval(recoverTimer);
      recoverTimer = null;
    }
  }

  /** A token fresh from the login may be refused by Access for a while (staging: 5 s to about a minute): try again. */
  async function meWithGrace(hub: HubClient, signal: AbortSignal): Promise<HubResult<Me>> {
    const started = now();
    for (let i = 0; ; i++) {
      const answer = await hub.me(signal);
      if (answer.ok || answer.kind !== 'credentials' || now() - started >= timing.FRESH_TOKEN_GRACE_MS) return answer;
      const steps = timing.FRESH_TOKEN_RETRY_MS;
      const wait = Math.min(steps[Math.min(i, steps.length - 1)], Math.max(0, timing.FRESH_TOKEN_GRACE_MS - (now() - started)));
      log(`Access refused the fresh sign-in (${answer.status}); trying again in ${wait} ms`);
      await sleep(wait, signal);
    }
  }

  // ---- following the hub ----

  async function sync(): Promise<void> {
    if (syncing !== null) {
      syncAgain = true;
      return syncing;
    }
    syncing = (async () => {
      do {
        syncAgain = false;
        await syncOnce();
      } while (syncAgain && !closed);
    })().finally(() => (syncing = null));
    return syncing;
  }

  async function syncOnce(): Promise<void> {
    const reg = registration;
    const cred = credential;
    const view = held;
    if (closed || reg === null || reg.signedOut || cred === null || !hubLive() || view === null || !view.ready()) return;
    const hub = client(reg.hub, cred);
    const version = view.head().state.version;
    let read = await hub.chain(version);
    if (credential !== cred || held !== view) return;
    if (!read.ok) return hubFailed(read);
    // A recovery from below the held head needs the states from its `fromVersion` on, which `?since=<head>` leaves out;
    // and a served head below the held one is judged with the whole chain, which tells a rewind from a rollback.
    const from = rereadFrom(view, read.value);
    if (from !== null) {
      read = await hub.chain(from);
      if (credential !== cred || held !== view) return;
      if (!read.ok) return hubFailed(read);
    }
    await adopt(view, read.value);
  }

  async function refreshCertificates(): Promise<void> {
    const reg = registration;
    const cred = credential;
    const view = held;
    if (closed || reg === null || cred === null || !hubLive() || view === null || !view.ready()) return;
    const read = await client(reg.hub, cred).state();
    if (credential !== cred || held !== view) return;
    if (!read.ok) return hubFailed(read);
    const served = read.value;
    if (served.head !== null && typeof served.head.state?.version === 'number' && served.head.state.version !== view.head().state.version) return sync();
    await adopt(view, { chain: [], head: served.head, transitions: served.transitions, certificates: served.certificates });
  }

  async function adopt(view: HeldOrg, served: Served): Promise<void> {
    const result = await view.adoptServed(served);
    if (held !== view) return;
    const before = problem;
    if (result.refused === 'rollback' || result.refused === 'fork') problem = result.refused;
    else if (result.adopted > 0 && (problem === 'rollback' || problem === 'fork')) problem = null;
    if (result.certificatesChanged) changed(true);
    else if (problem !== before) changed();
  }

  function attach(feed: RegistryFeedHooks): () => void {
    const offs = [
      feed.onOpen(() => {
        feedOpen = true;
        if (hubAccess === 'unreachable' || hubAccess === 'connecting') hubAccess = 'connecting';
        changed();
        background('following the hub', sync);
        // M3: a pending state is settled at each open (posted again if the hub holds no successor of its parent).
        const c = composed;
        if (c !== null) {
          background('settling the pending state', () => c.signer.settle());
          background('delivering', () => c.deliveries.send());
        }
      }),
      feed.onClose(() => {
        feedOpen = false;
        changed();
      }),
      feed.onState((version) => {
        if (held !== null && held.ready() && version > held.head().state.version) background('following the hub', sync);
      }),
      feed.onRemoved(() => denied('the feed closed 4403')),
      feed.onCredentialsEnded(() => credentialEnded('Access answered the feed\'s upgrade')),
    ];
    return () => offs.forEach((off) => off());
  }

  // ---- the held chain ----

  /** Holds `view` as the session's, its adoptions telling the session's listeners after they are on disk. */
  function hold(view: HeldOrg | null): void {
    unheld?.();
    unheld = null;
    held = view;
    if (view !== null) unheld = view.onAdopted(() => changed(true));
  }

  /** Writes `anchor` onto the registration as it stands, in the commit queue, while `view` is the held one. */
  function writeAnchor(view: HeldOrg, anchor: Anchor): Promise<void> {
    return commit(async () => {
      if (held !== view || registration === null) return;
      await files.write(REGISTRATION_FILE, { ...registration, anchor });
      registration = { ...registration!, anchor };
    });
  }

  /**
   * A view's anchor saver: until `hold(view)` it keeps the anchor, which whoever holds the view writes with the
   * registration; from then on each adoption writes its anchor (`writeAnchor`).
   */
  function anchorSaver(): { save(anchor: Anchor): Promise<void>; kept(): Anchor | null; hold(view: HeldOrg): void } {
    let kept: Anchor | null = null;
    let mine: HeldOrg | null = null;
    return {
      save: async (anchor) => {
        if (mine === null) kept = anchor;
        else await writeAnchor(mine, anchor);
      },
      kept: () => kept,
      hold: (view) => {
        mine = view;
        hold(view);
      },
    };
  }

  /**
   * The held chain failed its load: the hub's is taken only if it holds the anchored state on its own line. Taking it
   * is a trust change, so it is made in the commit queue, and only while the chain is still closed on the registration
   * it was read for: a re-anchoring that landed first stands.
   */
  async function recoverFromHub(): Promise<void> {
    const reg = registration;
    const cred = credential;
    if (closed || reg === null || cred === null || !hubLive() || problem !== 'held-chain') return;
    const read = await client(reg.hub, cred).chain(0);
    if (!read.ok) return hubFailed(read);
    const served = read.value;
    await commit(async () => {
      if (closed || problem !== 'held-chain' || held !== null || registration === null || !sameTrust(registration, reg)) return;
      const saver = anchorSaver();
      const started = await startHeldOrg({
        files,
        anchor: reg.anchor,
        saveAnchor: saver.save,
        first: { chain: served.chain, transitions: served.transitions, certificates: served.certificates ?? { certs: [], retirements: [] } },
        log,
      });
      if (!started.ok) return log(`the hub's chain does not hold the anchored state (${started.reason}); closed until a re-anchor`);
      const anchor = saver.kept()!;
      try {
        await files.write(REGISTRATION_FILE, { ...registration, anchor });
        registration = { ...registration, anchor };
      } catch (error) {
        // chain.json holds the anchored state on its own line, so the next load takes it and moves the anchor up
        log(`the anchor did not move with the hub's chain: ${(error as Error).message}`);
      }
      saver.hold(started.held);
      problem = null;
      log(`the held chain was taken again from the hub, at version ${started.held.head().state.version}`);
      changed(true);
    });
  }

  // ---- M3: the signer's composition ----

  /** The view the signer reads: the held one, once it holds a verified chain. */
  const heldView = (): HeldOrg | null => (held !== null && held.ready() ? held : null);
  const sessionApi: OrgSession = { current: () => computeCurrent(), onChanged };

  /** Inside the commit queue's turn (the signing store's first write): registration.json gains `signing: true`. */
  async function markRegistration(): Promise<void> {
    if (registration === null) throw new Error('no registration to mark');
    await files.write(REGISTRATION_FILE, { ...registration, signing: true });
    registration = { ...registration, signing: true };
  }

  /** The hub as the signer reaches it: a credential's end or a denial in its answers is the session's, as any read's. */
  function signerHub(): HubClient | null {
    const reg = registration;
    const cred = credential;
    if (closed || reg === null || reg.signedOut || cred === null || !hubLive()) return null;
    const inner = client(reg.hub, cred);
    const watched = <T>(answer: Promise<HubResult<T>>): Promise<HubResult<T>> =>
      answer.then((result) => {
        if (!result.ok && (result.kind === 'credentials' || result.kind === 'denied') && credential === cred) hubFailed(result);
        return result;
      });
    return {
      me: (signal) => watched(inner.me(signal)),
      state: (signal) => watched(inner.state(signal)),
      chain: (since, signal) => watched(inner.chain(since, signal)),
      postPending: (entry, signal) => watched(inner.postPending(entry, signal)),
      postState: (signed, signal) => watched(inner.postState(signed, signal)),
    };
  }

  /** Keeps the hub's refusal of the pending state for the status, so the Org section can say why it waits. */
  async function tracked(sign: Promise<SignOutcome>): Promise<SignOutcome> {
    const outcome = await sign;
    const slot = composed?.signer.pending() ?? null;
    if (!outcome.ok && outcome.reason === 'hub' && slot !== null) {
      pendingRefused = { version: slot.version, detail: outcome.detail ?? 'the hub did not take it' };
      changed();
    }
    return outcome;
  }

  /** The signer, the weekly asking and the deliveries over one signing store, once a registration is held. */
  function compose(): void {
    const s = deps.signing;
    if (s === undefined || composed !== null || composing || closed || registration === null || problem === 'directory') return;
    composing = true;
    void (async () => {
      const store = await createSigningStore({ files, commit, registration: () => registration, markRegistration, log });
      if (closed) return;
      const deliveries = createDeliveries({ store, roster: s.roster, onRoster: s.onRoster, link: s.link, view: heldView, timing: deps.timing, now: deps.now, log });
      const signer = createOrgSigner({
        session: sessionApi,
        held: heldView,
        signer: () => stateSigner,
        marked: () => keys?.excludedFromBackupAtCreation === true,
        hub: signerHub,
        store,
        deliveries,
        now: deps.now,
        log,
      });
      const weekly = startWeekly({
        signer: { maySign: () => maySign(signer), pending: () => signer.pending(), sign: (edit) => tracked(signer.sign(edit)), onChanged: (listener) => signer.onChanged(listener) },
        head: () => heldView()?.head() ?? null,
        store,
        focused: s.focused,
        onFocus: s.onFocus,
        notify: s.notify,
        timing: deps.timing,
        now: deps.now,
        log,
      });
      const tell = () => changed();
      composed = { store, signer, deliveries, weekly, offs: [signer.onChanged(tell), deliveries.onChanged(tell), weekly.onChanged(tell)] };
      changed();
      refreshOffer();
      background('settling the pending state', () => signer.settle());
      background('delivering', () => deliveries.send());
    })()
      .catch((error: unknown) => log(`the signer did not start: ${(error as Error).message}`))
      .finally(() => (composing = false));
  }

  /** The superseded states' revocations as the status shows them (the keys a signature revokes; the withheld, named). */
  function refreshOffer(): void {
    const turn = ++offerTurn;
    const view = heldView();
    const f = facts;
    void (async () => {
      let next: typeof offer = null;
      if (view !== null && f !== null && view.superseded().length > 0) {
        const head = view.head().state;
        const found = await supersededRevocations(head, view.superseded(), { channelKid: f.channelKid, stepUpKid: f.stepUpKid });
        if (found !== null) {
          const draft = structuredClone(head);
          found.edit(draft);
          const before = new Set(head.revoked.map((r) => r.keyId));
          next = { superseded: draft.revoked.filter((r) => !before.has(r.keyId)).length, withheld: found.withheld.map((w) => `${describeHolder(head, w.holder)} (${w.keyId})`) };
        }
      }
      if (turn !== offerTurn || JSON.stringify(next) === JSON.stringify(offer)) return;
      offer = next;
      changed();
    })().catch((error: unknown) => log(`the superseded offer was not computed: ${(error as Error).message}`));
  }

  /** The keys a rekey retired: destroyed once the held head lists neither of them; until then the status names them. */
  function checkRetired(): Promise<void> {
    const turn = retiredWork.then(async () => {
      if (closed || registration === null) return;
      const ids = await keyFiles.retired(deps.userData);
      const view = heldView();
      if (ids !== null && view !== null && !keysCurrent(view.head(), ids)) {
        await keyFiles.destroyRetired(deps.userData);
        log(`the retired keys of device ${ids.device.slice(0, 8)} were destroyed: the org no longer lists them`);
        retired = null;
      } else retired = ids;
      changed();
    });
    retiredWork = turn.catch(() => {});
    return turn;
  }

  /** Facts of a key set, and its state signer, made before the keys are taken into use. */
  async function prepareKeys(k: DeviceKeys, org: string, member: string): Promise<{ facts: KeyFacts; stateSigner: StateSigner | null }> {
    const entry = await deviceEntry(k);
    return {
      facts: { channelKid: entry.id, stepUpKid: await keyId(k.stepUp.pub), fingerprint: await pairingFingerprint(org, member, entry) },
      stateSigner: deps.signing === undefined ? null : await deps.signing.stateSigner(k),
    };
  }

  function signResult(outcome: SignOutcome): SignResult {
    if (outcome.ok) return outcome;
    if (outcome.reason === 'refused') return { ok: false, reason: 'refused', detail: outcome.findings.filter((f) => f.level === 'refuse').map((f) => f.detail).join('; ') };
    return outcome.detail === undefined ? { ok: false, reason: outcome.reason } : { ok: false, reason: outcome.reason, detail: outcome.detail };
  }

  const notSigning: SignResult = { ok: false, reason: 'not-root', detail: 'this Mac is not signed in to the org' };

  async function resign(): Promise<SignResult> {
    const c = composed;
    if (c === null) return notSigning;
    return signResult(await c.weekly.resign());
  }

  async function revokeSuperseded(): Promise<SignResult> {
    const c = composed;
    const view = heldView();
    const f = facts;
    if (c === null || view === null || f === null) return notSigning;
    const self = { channelKid: f.channelKid, stepUpKid: f.stepUpKid };
    const shown = await supersededRevocations(view.head().state, view.superseded(), self);
    const edit = supersededEdit(shown);
    if (edit === null) return { ok: false, reason: 'invalid', detail: 'nothing to revoke: no superseded revocation this Mac can sign' };
    // Composed again on the head the signer drafts from, and signed only if it still says what the prompt shows.
    const apply = async (draft: OrgState): Promise<void> => {
      const at = heldView();
      const fresh = at === null ? null : await supersededRevocations(at.head().state, at.superseded(), self);
      if (fresh === null || JSON.stringify(fresh.lines) !== JSON.stringify(shown!.lines)) throw new Error('the superseded revocations changed since they were shown');
      fresh.edit(draft);
    };
    return signResult(await tracked(c.signer.sign({ ...edit, apply })));
  }

  async function discardPending(confirmed: true): Promise<DiscardResult> {
    const c = composed;
    if (c === null) return { ok: false, reason: 'none' };
    const outcome = await c.signer.discardPending(confirmed);
    if (outcome.ok) pendingRefused = null;
    changed();
    return outcome;
  }

  async function resetSigning(confirmed: true): Promise<void> {
    await composed?.signer.resetSigning(confirmed);
    changed();
  }

  // ---- startup ----

  async function load(): Promise<void> {
    const check = await files.check();
    if (check === null) return; // never signed in: no keys, no files, no requests
    const read = await files.read(REGISTRATION_FILE);
    if (!isRegistrationFile(read)) {
      if (read !== null) log(`${REGISTRATION_FILE} is malformed; this profile reads as never signed in`);
      return;
    }
    let reg = read;
    registration = reg;
    if (!check.ok) {
      problem = 'directory';
      log(`${files.dir} is refused: ${check.detail}`);
      return;
    }
    // M3: a rekey a crash cut off is finished (or dropped) before the keys are looked for.
    if (reg.rekey !== undefined) {
      const target = reg.rekey.device;
      try {
        reg = await replayRekey(reg);
        registration = reg;
      } catch (error) {
        log(`the rekey to device ${target.slice(0, 8)} was not finished at load (${(error as Error).message}); it is tried again at the next start`);
      }
    }
    if (reg.signedOut) {
      await files.remove(ACCESS_FILE);
    } else {
      const access = await files.read(ACCESS_FILE);
      if (isAccessFile(access) && access.hub === reg.hub) credential = fromAccessFile(access);
      else {
        log(`${ACCESS_FILE} is absent or not this hub's: signed out`);
        registration = { ...reg, signedOut: true };
      }
    }
    if (credential?.kind === 'access' && Date.parse(credential.expires) - timing.TOKEN_SKEW_MS <= now()) hubAccess = 'expired';
    const keyFile = join(deps.userData, 'device', 'keys.json');
    const present = await lstat(keyFile).then(
      () => true,
      () => false,
    );
    if (!present) {
      refused = { code: 'keys', detail: `${keyFile} is gone` };
      log(`${keyFile} is gone: this device can't sign in`);
    } else {
      try {
        const loadedKeys = await loadKeys(deps.userData, keyDeps());
        const prepared = await prepareKeys(loadedKeys, reg.org, reg.member.id);
        keys = loadedKeys;
        facts = prepared.facts;
        stateSigner = prepared.stateSigner;
      } catch (error) {
        refused = { code: 'keys', detail: error instanceof DeviceKeysError ? error.reason : (error as Error).message };
        log(`the device keys don't load: ${(error as Error).message}`);
      }
    }
    const saver = anchorSaver();
    const started = await startHeldOrg({ files, anchor: reg.anchor, saveAnchor: saver.save, log });
    if (started.ok) {
      saver.hold(started.held);
      // A crash between chain.json and the anchor left the anchor below the held head: it is moved up.
      const moved = saver.kept();
      if (moved !== null) await writeAnchor(started.held, moved).catch((error: unknown) => log(`the anchor was not moved up at load: ${(error as Error).message}`));
    } else {
      problem = 'held-chain';
      log(`the held org chain fails its check (${started.reason}): closed until the hub's chain holds the anchored state, or a re-anchor`);
    }
  }

  /**
   * The rekey's replay (M3, "New keys"): the file holding the intent's device id is found among keys.json and
   * keys.next.json, the renames completed as far as they got, and step 4 written; with no file holding it (the next keys
   * were lost before step 2) the intent is dropped and the old registration stands.
   */
  async function replayRekey(reg: RegistrationFile): Promise<RegistrationFile> {
    const target = reg.rekey!.device;
    const where = await keyFiles.find(deps.userData, target);
    let next: RegistrationFile;
    if (where === null) {
      next = withoutRekey(reg);
      log(`no key file holds device ${target.slice(0, 8)} a rekey named: the rekey is dropped and device ${reg.device.slice(0, 8)} stands`);
    } else {
      await keyFiles.promote(deps.userData);
      next = { ...withoutRekey(reg), device: target };
      log(`a rekey a crash cut off was finished: device ${reg.device.slice(0, 8)} is now ${target.slice(0, 8)}`);
    }
    await commit(() => files.write(REGISTRATION_FILE, next));
    return next;
  }

  const fromAccessFile = (file: AccessFile): HubCredential =>
    file.kind === 'access' ? { kind: 'access', token: file.token, expires: file.expires, email: file.email } : { kind: 'standin', user: file.user };
  const toAccessFile = (hub: string, cred: HubCredential): AccessFile =>
    cred.kind === 'access' ? { version: 1, hub, kind: 'access', token: cred.token, expires: cred.expires, email: cred.email } : { version: 1, hub, kind: 'standin', user: cred.user };

  // ---- attempts ----

  function loginFor(hub: string): AccessLogin | null {
    const admission = hubAdmission(hub, { packaged: deps.packaged, env: deps.env });
    if (admission === null) return null;
    return admission.kind === 'standin' ? standinLogin(admission.user) : transfer;
  }

  /** Runs `body` as the one attempt: fenced, cancellable, its refusal reported on the status. */
  function run(what: string, body: (signal: AbortSignal, fence: () => void) => Promise<void>, onEnd: () => void): void {
    const controller = new AbortController();
    attempt = controller;
    attemptNo = ++attempts;
    attemptEnded = false;
    const no = attemptNo;
    log(`attempt ${no}: ${what}, pid ${process.pid}`);
    const ended = (how: string) => {
      if (attemptNo === no) endAttempt(how);
    };
    const mine = generation;
    const fence = () => {
      if (generation !== mine || closed) throw new Fenced();
    };
    void body(controller.signal, fence)
      .then(() => ended('done'))
      .catch((error: unknown) => {
        if (error instanceof Fenced || generation !== mine || closed) {
          ended('fenced');
          return;
        }
        if (error instanceof Refusal) refused = error.refusal;
        else if (error instanceof AccessLoginError) refused = error.reason === 'cancelled' ? undefined : { code: 'access', detail: error.reason };
        else if (controller.signal.aborted) refused = undefined;
        else {
          refused = { code: 'hub', detail: (error as Error).message };
          log(`an attempt failed: ${(error as Error).message}`);
        }
        if (refused !== undefined) log(`refused ${refused.code}${refused.detail === undefined ? '' : ` (${refused.detail})`}`);
        ended(refused === undefined ? 'ended' : `refused ${refused.code}`);
      })
      .finally(() => {
        if (attempt === controller) attempt = null;
        if (generation !== mine) return;
        onEnd();
        changed();
      });
  }

  /** `/api/me` must name `org` and `member`, else `not-member` (naming the email Access signed in, when known). */
  async function checkMe(hub: HubClient, cred: HubCredential, org: string, member: string, signal: AbortSignal): Promise<Me> {
    const answer = await meWithGrace(hub, signal);
    const email = (named: string | null | undefined) => named ?? tokenEmail(cred) ?? undefined;
    if (!answer.ok) {
      if (answer.kind === 'denied') refuse('not-member', email(null));
      if (answer.kind === 'credentials') refuse('access', `Access refused the sign-in (${answer.status})`);
      if (answer.kind === 'unreachable') refuse('hub', answer.detail);
      if (answer.kind === 'status') refuse('hub', `${answer.status}${answer.error === null ? '' : ` ${answer.error}`}`);
    }
    if (answer.value.org.id !== org || answer.value.member.id !== member) refuse('not-member', answer.value.member.email);
    return answer.value;
  }

  /** The chain from genesis, verified as one whole run against `pins`. */
  async function pinnedChain(hub: HubClient, org: string, pins: OrgPins, signal: AbortSignal): Promise<{ chain: SignedOrgState[]; transitions: Signed<RootTransition>[]; certificates: Certificates; head: SignedOrgState }> {
    const read = await hub.chain(0, signal);
    if (!read.ok) {
      if (read.kind === 'credentials') refuse('access', `Access answered ${read.status}`);
      if (read.kind === 'denied') refuse('not-member');
      return refuse('hub', read.kind === 'unreachable' ? read.detail : `${read.status}${read.error === null ? '' : ` ${read.error}`}`);
    }
    const served = read.value;
    const verdict = await verifyPinnedChain(served.chain, served.transitions, pins);
    if (!verdict.ok) refuse('chain', verdict.code);
    const run = verdict as Extract<typeof verdict, { ok: true }>;
    if (run.adopted.length !== served.chain.length) refuse('chain', `the run stops at version ${run.head.state.version} of ${served.chain.length}`);
    if (served.head === null || (await stateHash(served.head.state)) !== (await stateHash(run.head.state))) refuse('chain', 'the served head is not the run\'s last state');
    if (run.head.state.org !== org) refuse('chain', `the chain is org ${run.head.state.org}`);
    return { chain: run.adopted, transitions: run.transitions, certificates: served.certificates ?? { certs: [], retirements: [] }, head: run.head };
  }

  function register(text: string): OrgAttempt {
    if (closed || !ready || attempt !== null || signingOut) return { ok: false, reason: { code: 'busy' } };
    const code = decodePairingCode(text.trim());
    if (code === null || loginFor(code.hub) === null) return { ok: false, reason: { code: 'bad-code' } };
    if (registration !== null) {
      if (code.org !== registration.org || code.hub !== registration.hub) return { ok: false, reason: { code: 'other-org' } };
      return signIn();
    }
    if (problem === 'directory') return { ok: false, reason: { code: 'directory' } };
    refused = undefined;
    registering = { step: 'browser', org: code.org, hub: code.hub, fingerprint: null, expires: null };
    changed();
    run(
      `register (org ${code.org})`,
      (signal, fence) => registerWith(code, signal, fence),
      () => (registering = null),
    );
    return { ok: true };
  }

  async function registerWith(code: PairingCode, signal: AbortSignal, fence: () => void): Promise<void> {
    const step = (next: Partial<Registering>) => {
      fence();
      registering = { ...registering!, ...next };
      changed();
    };
    const cred = await loginFor(code.hub)!(code.hub, { signal });
    step({ step: 'checking' });
    const hub = client(code.hub, cred);
    const me = await checkMe(hub, cred, code.org, code.member, signal);
    fence();
    let made: DeviceKeys;
    try {
      made = await loadKeys(deps.userData, keyDeps());
    } catch (error) {
      return refuse('keys', error instanceof DeviceKeysError ? error.reason : (error as Error).message);
    }
    const entry = await deviceEntry(made);
    const pins: OrgPins = { roots: code.roots, recoveryPub: code.recoveryPub };
    const first = await pinnedChain(hub, code.org, pins, signal);
    fence();
    let head = first.head;
    const chain = [...first.chain];
    const transitions = [...first.transitions];
    let certificates = first.certificates;
    if (!lists(head, code.member, entry)) {
      const removed = await removedReason(head, code.member, entry);
      if (removed !== null) refuse('removed', removed);
      const mac = await pairingMac(base64urlDecode(code.k), { org: code.org, member: code.member, device: entry });
      const posted = await hub.postPending({ deviceId: entry.id, class: 'native-mac', keyStorage: 'software', channelPub: entry.channelPub, stepUpPub: entry.stepUpPub!, mac }, signal);
      if (!posted.ok) refuse('hub', posted.kind === 'status' ? `${posted.status}${posted.error === null ? '' : ` ${posted.error}`}` : posted.kind);
      const expires = (posted as Extract<typeof posted, { ok: true }>).value.pending.expires;
      step({ step: 'approval', fingerprint: await pairingFingerprint(code.org, code.member, entry), expires });
      log(`posted this device's entry ${entry.id.slice(0, 8)}; waiting for approval until ${expires}`);
      while (!lists(head, code.member, entry)) {
        if (now() >= Date.parse(expires)) refuse('expired');
        await sleep(Math.min(timing.APPROVAL_POLL_MS, Math.max(0, Date.parse(expires) - now())), signal);
        fence();
        const read = await hub.chain(head.state.version, signal);
        fence();
        if (!read.ok) {
          if (read.kind === 'unreachable') continue;
          if (read.kind === 'credentials') refuse('access', `Access answered ${read.status}`);
          if (read.kind === 'denied') refuse('not-member', me.member.email);
          continue;
        }
        const advanced = await advanceHead(head, read.value.chain, read.value.transitions, transitions.map((t) => t.body));
        chain.push(...advanced.adopted);
        transitions.push(...advanced.transitions);
        head = advanced.head;
        if (read.value.certificates !== null) certificates = read.value.certificates;
      }
    }
    const prepared = await prepareKeys(made, code.org, code.member);
    fence();
    // Done: chain.json, access.json, then registration.json, the commit point.
    await commit(async () => {
      fence();
      const dir = await files.ensure();
      if (!dir.ok) refuse('directory', dir.detail);
      const saver = anchorSaver();
      const started = await startHeldOrg({ files, anchor: null, pins, first: { chain, transitions, certificates }, saveAnchor: saver.save, log });
      if (!started.ok) refuse('chain', started.reason);
      fence();
      await files.write(ACCESS_FILE, toAccessFile(code.hub, cred));
      fence();
      const reg: RegistrationFile = {
        version: 1,
        hub: code.hub,
        org: code.org,
        member: { id: code.member, email: me.member.email },
        device: entry.id,
        pins,
        anchor: saver.kept()!,
        registered: new Date(now()).toISOString(),
        signedOut: false,
      };
      await files.write(REGISTRATION_FILE, reg);
      const view = (started as Extract<typeof started, { ok: true }>).held;
      try {
        fence();
      } catch (error) {
        // Cancelled while the commit point was being written: take it back, so a cancel writes nothing.
        await files.remove(REGISTRATION_FILE).catch(() => {});
        throw error;
      }
      registration = reg;
      credential = cred;
      keys = made;
      facts = prepared.facts;
      stateSigner = prepared.stateSigner;
      hubAccess = 'connecting';
      problem = null;
      refused = undefined;
      registering = null;
      saver.hold(view);
      log(`registered device ${entry.id.slice(0, 8)} in org ${code.org}, at version ${view.head().state.version}`);
      changed(true);
    });
    compose();
  }

  function signIn(): OrgAttempt {
    if (closed || !ready || attempt !== null || signingOut) return { ok: false, reason: { code: 'busy' } };
    const reg = registration;
    if (reg === null) return { ok: false, reason: { code: 'busy', detail: 'no registration to sign in to' } };
    if (problem === 'directory') return { ok: false, reason: { code: 'directory' } };
    const login = loginFor(reg.hub);
    if (login === null) return { ok: false, reason: { code: 'bad-code', detail: 'this build does not admit the registration\'s hub' } };
    refused = undefined;
    signingIn = true;
    changed();
    run(
      `sign in (org ${reg.org})`,
      async (signal, fence) => {
        const cred = await login(reg.hub, { signal });
        fence();
        await checkMe(client(reg.hub, cred), cred, reg.org, reg.member.id, signal);
        // Only the marker is this attempt's: the registration is read at the commit's turn, so an anchor an adoption
        // wrote meanwhile stays. A sign-out since then fences it before each write.
        await commit(async () => {
          fence();
          await files.write(ACCESS_FILE, toAccessFile(reg.hub, cred));
          fence();
          await files.write(REGISTRATION_FILE, { ...registration!, signedOut: false });
          fence();
          registration = { ...registration!, signedOut: false };
          credential = cred;
          hubAccess = 'connecting';
          signingIn = false;
          log('signed in to the hub again');
          changed(true);
        });
        if (problem === 'held-chain') background('taking the hub\'s chain', recoverFromHub);
      },
      () => (signingIn = false),
    );
    return { ok: true };
  }

  function reanchor(text: string): OrgAttempt {
    if (closed || !ready || attempt !== null || signingOut || problem !== 'held-chain' || registration === null) return { ok: false, reason: { code: 'busy' } };
    const reg = registration;
    const code = decodePairingCode(text.trim());
    if (code === null || loginFor(code.hub) === null) return { ok: false, reason: { code: 'bad-code' } };
    if (code.org !== reg.org || code.hub !== reg.hub || code.member !== reg.member.id) return { ok: false, reason: { code: 'other-org' } };
    if (keys === null) return { ok: false, reason: { code: 'keys' } };
    const k = keys;
    refused = undefined;
    signingIn = !hubLive();
    changed();
    run(
      `re-anchor (org ${reg.org})`,
      async (signal, fence) => {
        const cred = hubLive() ? credential! : await loginFor(code.hub)!(code.hub, { signal });
        fence();
        const hub = client(code.hub, cred);
        await checkMe(hub, cred, code.org, code.member, signal);
        const pins: OrgPins = { roots: code.roots, recoveryPub: code.recoveryPub };
        const first = await pinnedChain(hub, code.org, pins, signal);
        fence();
        const entry = await deviceEntry(k);
        if (entry.id !== reg.device || !lists(first.head, code.member, entry)) refuse('removed', 'the org state doesn\'t list this device with its keys');
        await commit(async () => {
          fence();
          // A recovery that took the hub's chain first stands: there is nothing left to re-anchor.
          if (problem !== 'held-chain' || held !== null || registration === null || !sameTrust(registration, reg)) {
            log('the held chain was opened again before the re-anchor\'s turn; it writes nothing');
            throw new Fenced();
          }
          const saver = anchorSaver();
          const started = await startHeldOrg({ files, anchor: null, pins, first, saveAnchor: saver.save, log });
          if (!started.ok) refuse('chain', started.reason);
          fence();
          if (cred !== credential) {
            await files.write(ACCESS_FILE, toAccessFile(reg.hub, cred));
            fence();
          }
          const next: RegistrationFile = { ...registration, pins, anchor: saver.kept()!, signedOut: false };
          await files.write(REGISTRATION_FILE, next);
          fence();
          registration = next;
          credential = cred;
          hubAccess = 'connecting';
          signingIn = false;
          problem = null;
          saver.hold((started as Extract<typeof started, { ok: true }>).held);
          log(`re-anchored at version ${first.head.state.version}`);
          changed(true);
        });
      },
      () => (signingIn = false),
    );
    return { ok: true };
  }

  /**
   * M3's new keys: offered for a key file without the backup mark, or a device the org removed. The old device stays
   * signed in until the held head lists the new entry; then the promotion runs as one transaction (the file's header).
   */
  function rekey(text: string): OrgAttempt {
    if (closed || !ready || attempt !== null || signingOut) return { ok: false, reason: { code: 'busy' } };
    const reg = registration;
    if (reg === null || reg.signedOut) return { ok: false, reason: { code: 'busy', detail: 'sign in to the org first' } };
    // A promotion that failed after its intent was written is the next start's to finish: new keys now would replace its own.
    if (reg.rekey !== undefined) return { ok: false, reason: { code: 'busy', detail: 'a rekey is still being finished: restart MAWS' } };
    if (problem === 'directory') return { ok: false, reason: { code: 'directory' } };
    if (heldView() === null) return { ok: false, reason: { code: 'busy', detail: 'no org state is held: re-anchor first' } };
    const code = decodePairingCode(text.trim());
    if (code === null || loginFor(code.hub) === null) return { ok: false, reason: { code: 'bad-code' } };
    if (code.org !== reg.org || code.hub !== reg.hub || code.member !== reg.member.id) return { ok: false, reason: { code: 'other-org' } };
    const old = keys;
    if (old === null) return { ok: false, reason: { code: 'keys' } };
    if (old.excludedFromBackupAtCreation && listed()) return { ok: false, reason: { code: 'busy', detail: 'this Mac\'s keys need no replacing' } };
    refused = undefined;
    rekeying = { step: hubLive() ? 'checking' : 'browser', fingerprint: null, expires: null };
    changed();
    run(
      `rekey (org ${reg.org})`,
      (signal, fence) => rekeyWith(code, reg, old, signal, fence),
      () => (rekeying = null),
    );
    return { ok: true };
  }

  async function rekeyWith(code: PairingCode, reg: RegistrationFile, old: DeviceKeys, signal: AbortSignal, fence: () => void): Promise<void> {
    const step = (next: Partial<Rekeying>) => {
      fence();
      rekeying = { ...rekeying!, ...next };
      changed();
    };
    const prior = keyWork;
    let release!: () => void;
    keyWork = new Promise((resolve) => (release = resolve));
    let made: DeviceKeys | null = null;
    /** Step 1 is on disk: from here the promotion runs to its end, here or at the next start, whatever ends the attempt. */
    let recorded = false;
    try {
      await prior;
      fence();
      if (keys !== old || registration?.device !== reg.device) refuse('busy', 'this Mac\'s keys changed meanwhile');
      // An attempt ahead of this one may have recorded its intent and then failed to promote: its next keys are the
      // replay's, so none are made over them (the entry guard saw the registration before that intent was written).
      if (registration.rekey !== undefined) refuse('busy', 'a rekey is still being finished: restart MAWS');
      const cred = hubLive() ? credential! : await loginFor(code.hub)!(code.hub, { signal });
      step({ step: 'checking' });
      const hub = client(code.hub, cred);
      const me = await checkMe(hub, cred, code.org, code.member, signal);
      fence();
      try {
        made = await keyFiles.createNext(deps.userData, keyDeps());
      } catch (error) {
        refuse('keys', error instanceof DeviceKeysError ? error.reason : (error as Error).message);
      }
      fence();
      const entry = await deviceEntry(made);
      const startView = heldView();
      if (startView === null) refuse('chain', 'no org state is held');
      if (!lists(startView.head(), code.member, entry)) {
        const removed = await removedReason(startView.head(), code.member, entry);
        if (removed !== null) refuse('removed', removed);
        const mac = await pairingMac(base64urlDecode(code.k), { org: code.org, member: code.member, device: entry });
        const posted = await hub.postPending({ deviceId: entry.id, class: 'native-mac', keyStorage: 'software', channelPub: entry.channelPub, stepUpPub: entry.stepUpPub!, mac }, signal);
        if (!posted.ok) refuse('hub', posted.kind === 'status' ? `${posted.status}${posted.error === null ? '' : ` ${posted.error}`}` : posted.kind);
        const expires = (posted as Extract<typeof posted, { ok: true }>).value.pending.expires;
        step({ step: 'approval', fingerprint: await pairingFingerprint(code.org, code.member, entry), expires });
        log(`posted the new device entry ${entry.id.slice(0, 8)} beside ${reg.device.slice(0, 8)}; waiting for approval until ${expires}`);
        // The held view follows the hub until its head lists the new entry: the old device answers current() meanwhile.
        for (;;) {
          const view = heldView();
          if (view === null) refuse('chain', 'the held org state closed');
          if (lists(view.head(), code.member, entry)) break;
          if (now() >= Date.parse(expires)) refuse('expired');
          await sleep(Math.min(timing.APPROVAL_POLL_MS, Math.max(0, Date.parse(expires) - now())), signal);
          fence();
          await followForApproval(view, hub, signal, me.member.email);
          fence();
        }
      }
      const prepared = await prepareKeys(made, code.org, code.member);
      fence();
      await commit(async () => {
        fence();
        if (registration === null || registration.device !== reg.device || registration.rekey !== undefined) refuse('busy', 'the registration changed meanwhile');
        if ((await keyFiles.find(deps.userData, entry.id)) !== 'next') refuse('keys', 'the new keys are no longer in keys.next.json');
        fence();
        // Step 1, the intent: read, change, write, so a marker another write left stays.
        await files.write(REGISTRATION_FILE, { ...registration, rekey: { device: entry.id } });
        recorded = true;
        registration = { ...registration, rekey: { device: entry.id } };
        if (rekeying !== null) rekeying = { ...rekeying, step: 'promoting' };
        log(`rekey to device ${entry.id.slice(0, 8)} recorded; promoting its keys`);
        // Steps 2 and 3: keys.json to keys.retired.json, keys.next.json to keys.json, each synced.
        await keyFiles.promote(deps.userData);
        // Step 4, from the registration as it stands now (a sign-out's marker set meanwhile is kept).
        const promoted: RegistrationFile = { ...withoutRekey(registration), device: entry.id };
        await files.write(REGISTRATION_FILE, promoted);
        // Merged into the registration as it stands after the write: a sign-out's marker set during it stays in memory
        // (its own queued write puts it on disk).
        registration = { ...withoutRekey(registration), device: entry.id };
        keys = made;
        facts = prepared.facts;
        stateSigner = prepared.stateSigner;
        let ours = true;
        try {
          fence();
        } catch {
          ours = false;
        }
        // A fresh login's token is kept only while the attempt is still the person's (no cancel, no sign-out since).
        if (ours && cred !== credential) {
          await files.write(ACCESS_FILE, toAccessFile(reg.hub, cred));
          credential = cred;
          hubAccess = 'connecting';
        }
        // A cancel already cleared it, and a rekey started since may be showing its own.
        if (ours) rekeying = null;
        log(`rekeyed: device ${reg.device.slice(0, 8)} is now ${entry.id.slice(0, 8)}; the old device stays listed until a root removes it`);
        // Step 5: the session's value is rebuilt with the new identity, and the links re-key.
        changed(true);
      });
      background('checking the retired keys', checkRetired);
    } catch (error) {
      if (!recorded && made !== null) await keyFiles.discardNext(deps.userData).catch((e: unknown) => log(`keys.next.json could not be removed: ${(e as Error).message}`));
      throw error;
    } finally {
      release();
    }
  }

  /** One read of the hub's chain into the held view while a rekey waits for approval (a recovery read from its base). */
  async function followForApproval(view: HeldOrg, hub: HubClient, signal: AbortSignal, email: string): Promise<void> {
    let read = await hub.chain(view.head().state.version, signal);
    if (read.ok) {
      const from = rereadFrom(view, read.value);
      if (from !== null) read = await hub.chain(from, signal);
    }
    if (!read.ok) {
      if (read.kind === 'credentials') refuse('access', `Access answered ${read.status}`);
      if (read.kind === 'denied') refuse('not-member', email);
      return;
    }
    if (held === view) await adopt(view, read.value);
  }

  function cancel(): void {
    if (attempt === null) return;
    endAttempt(`cancelled at ${registering?.step ?? (rekeying !== null ? `rekey ${rekeying.step}` : signingIn ? 'sign-in' : 're-anchor')}`);
    generation++;
    attempt.abort();
    attempt = null;
    registering = null;
    rekeying = null;
    signingIn = false;
    refused = undefined;
    changed();
  }

  function signOut(): Promise<void> {
    if (registration === null) return Promise.resolve();
    // The fence moves now, so every attempt's commit queued before the marker writes nothing more; memory too, so the
    // status reads signed out at once and an anchor written before the marker's turn carries it.
    if (attempt !== null) endAttempt('ended by sign-out');
    generation++;
    attempt?.abort();
    attempt = null;
    registering = null;
    rekeying = null;
    signingIn = false;
    signingOut = true;
    registration = { ...registration, signedOut: true };
    return commit(async () => {
      try {
        try {
          await files.write(REGISTRATION_FILE, { ...registration!, signedOut: true }); // the commit point
        } catch (error) {
          log(`the sign-out marker could not be written (${(error as Error).message}); the token is removed all the same, which reads signed out`);
        }
        credential = null;
        feedOpen = false;
        hubAccess = 'expired';
        await files.remove(ACCESS_FILE).catch((error: unknown) => log(`${ACCESS_FILE} could not be removed: ${(error as Error).message}`));
      } finally {
        signingOut = false;
      }
      log('signed out');
      changed(true);
    });
  }

  function onChanged(listener: () => void): () => void {
    changeListeners.add(listener);
    return () => void changeListeners.delete(listener);
  }
  // M3: at each change of the session (an adoption, a rewind, new keys) the offer and the retired keys are judged again.
  onChanged(() => {
    refreshOffer();
    if (retired !== null) background('checking the retired keys', checkRetired);
  });

  const loaded = load()
    .catch((error: unknown) => log(`the org files did not load: ${(error as Error).message}`))
    .then(async () => {
      ready = true;
      lastStatus = '';
      changed(true);
      if (problem === 'held-chain') background('taking the hub\'s chain', recoverFromHub);
      if (registration !== null && problem !== 'directory') {
        compose();
        await checkRetired().catch((error: unknown) => log(`the retired keys were not checked: ${(error as Error).message}`));
      }
    });

  return {
    current: () => computeCurrent(),
    onChanged,
    status,
    onStatus(listener) {
      statusListeners.add(listener);
      return () => void statusListeners.delete(listener);
    },
    register,
    signIn,
    reanchor,
    cancel,
    signOut,
    attach,
    loaded,
    resign,
    revokeSuperseded,
    rekey,
    discardPending,
    resetSigning,
    async close() {
      if (closed) return;
      if (attempt !== null) endAttempt('ended by quit');
      generation++;
      attempt?.abort();
      closed = true;
      if (composed !== null) {
        composed.offs.forEach((off) => off());
        composed.weekly.close();
        composed.deliveries.close();
        composed.signer.close();
      }
      if (tokenTimer !== null) clearTimeout(tokenTimer);
      if (certsTimer !== null) clearInterval(certsTimer);
      if (recoverTimer !== null) clearInterval(recoverTimer);
      unheld?.();
      await syncing?.catch(() => {});
    },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted);
      resolve();
    }, ms);
    const aborted = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', aborted, { once: true });
  });
}

/** The token's email, for a refusal's detail (decoded, not verified). */
export const tokenEmail = (cred: HubCredential): string | null => (cred.kind === 'access' ? cred.email ?? tokenClaims(cred.token)?.email ?? null : cred.user);
