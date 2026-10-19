// P3-HD M3c1: MAWS's own OAuth provider, main-only (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, "OAuth
// custody and owner controls", M3 and Decision Log 13, 18, 19, 21 and 22; P3 co-work Decision Log 98). It joins the
// sealed store (./oauth-store.ts) and the explicit flow (./oauth-flow.ts) into the lifecycle of one saved grant per
// configured identity (./oauth-types.ts: the exact request URL plus server, scope, config file and entry path), and is
// route D's credential preparation (./direct-route.ts's `DirectCredentialPreparation`) as well as the owner's Connect,
// Reconnect and Disconnect. Refresh tokens, registrations and safeStorage stay here; the engine host receives only an
// access token under a credential epoch, for one operation the route prepared.
//
// - Lazy: nothing touches the store (so safeStorage) until a demand, a state query, a listing or an owner action.
// - Grant authority. While an owned grant exists for the identity it is the only credential: unusable, it means no
//   credential at all (`{ok: false}`), never the entry's own header or none. Only where the store proves no owned grant
//   is `credential: null` answered. A store that cannot say (safeStorage unavailable with records saved, an unreadable
//   record whose identity is unknown) or two saved grants for the exact identity (never ranked) prove nothing: refused.
// - Attachment memory, never persisted: `withdrawn` (the owner's Disconnect, or a failed Reconnect: blocked until an
//   explicit Connect), `needsConnect` (no owned grant, and the server refused the credential-less request: a cold 401),
//   `needsReconnect` (the owned grant's refresh was rejected, or it expired without a refresh token).
// - Access epochs are immutable: an epoch names one access token, a new token gets a new, higher epoch, and a 401
//   reported for an epoch marks it unusable for good (the next demand refreshes; nothing is replayed here).
// - Demand refresh only, single-flight per identity and grant generation (panel correction: work a withdrawal left
//   behind is never joined, so its stalled save cannot hold a replacement), never aborted by a caller (a rotation the
//   server already made must not be lost): the rotated grant is persisted, then the host confirms the old epoch closed (`closeHost`, the
//   engine host's `connectors.directClose`) when it was ever delivered, and only then is the new epoch released. An
//   unsaved rotation or an unconfirmed close holds the release; the next demand retries that step, never the refresh,
//   and (P3-F F-connectors 4) retries it before refreshing a replacement that has since come within the margin, so a
//   transient refresh failure never strands a still-valid replacement behind a close the host would now confirm.
// - Fences. Every await is followed by checks: the identity's generation (advanced synchronously by Disconnect, a
//   Reconnect's withdrawal and stop) for saved state; the caller's signal and the host attachment for a delivery; an
//   owner action's own signal, generation and attachment, captured before its lookup. Store saves use a claim taken
//   before the work that leads to them, so a removal meanwhile makes them stale.
// - Owner flows. Connect reuses a usable saved grant without a browser, answers `needsReconnect` over an unusable one,
//   and runs the browser flow only where no owned grant exists (including a withdrawn identity). Its connection id is
//   allocated and claimed at its start, so a Disconnect of that id cancels it and stales its save. A flow whose
//   lifetime ends (the owner's signal, Disconnect, `hostLost`, `stop`) while its grant is being saved removes that
//   connection (a save not yet committed goes stale; one already committed is unlinked) and revokes the grant: an ended
//   flow installs nothing, and (panel correction) frees its slot at once rather than when the encryption answers.
//   Reconnect withdraws the old grant first and replaces it under a new connection id; failing, it leaves the identity
//   withdrawn.
// - Retirement. Withdrawing a connection (Disconnect, Reconnect) closes it in the host with an explicit floor, the
//   highest epoch main ever issued for it (`connectors.directClose` without one fences only the epochs the host has
//   seen, and a prepared credential can still be on its way). Until that close is confirmed, or the host's attachment
//   ends, no credential of the same identity is delivered, through a failed replacement and any later Connect; the
//   retirement stays visible (`disconnecting`) and every demand of that identity retries it. Disconnect is
//   idempotent and begins blocking, the retirement and the local removal at once; revocation is best effort.
// - A connection being forgotten is not proof of absence: a listing that still shows it withdraws its identity, and
//   one forgotten without its identity learned (unreadable, or its read past its bound) leaves every source without an
//   owned grant withdrawn for automatic use in this main's lifetime, never switched to its own configuration; an
//   explicit Connect may still establish a new grant, unless a record that may be its own is still saved unreadable.
// - Lifetime: `hostLost` (main's attachment to the engine host ended; the host runs that attachment's cleanup before it
//   serves another's requests) ends every waiting demand and owner flow and drops pending closes, whose epochs end with
//   that attachment; a refresh in flight still persists its rotation under its claim, for the next attachment's
//   demand. `stop` (main stopping) ends everything and refuses later work.
// - P3-HD M3c2 correction: the owner's rows hear `onChange` (no payload) when something they show may differ, and read
//   `withdrawnUnattributed` as this provider's own flag. Neither grants, fences or delivers anything.
import { randomUUID } from 'node:crypto';
import type { DirectSource } from '@shared/ipc/schema/connectors';
import type { DirectCredentialPreparation, DirectCredentialPrepared } from './direct-route';
import { ConnectorOAuthError, type ConnectorOAuthFailure, type ConnectorOAuthFlow } from './oauth-flow';
import { ConnectorOAuthStoreError, type ConnectorOAuthClaim, type ConnectorOAuthSaved, type ConnectorOAuthStore } from './oauth-store';
import { oauthIdentityOf, sameOAuthIdentity, type ConnectorOAuthGrant, type ConnectorOAuthIdentity, type ConnectorOAuthRecord, type ConnectorOAuthTokens } from './oauth-types';

// A token this close to its expiry is refreshed on demand (and used meanwhile while still valid).
export const OAUTH_REFRESH_MARGIN_MS = 60_000;
// The host's acknowledgment of a credential close, past which it counts as unconfirmed.
export const OAUTH_HOST_CLOSE_TIMEOUT_MS = 10_000;
// Disconnect's best-effort revocation, both requests together.
export const OAUTH_REVOKE_TIMEOUT_MS = 30_000;
// Disconnect's read of a record main does not hold (for its revocation); past it, the record is forgotten unrevoked.
export const OAUTH_FORGET_READ_TIMEOUT_MS = 10_000;
// Identities held in attachment memory at once; past it, idle ones without state are dropped, else work is refused.
export const OAUTH_PROVIDER_IDENTITY_LIMIT = 1_024;

export interface ConnectorOAuthProviderDeps {
  store: ConnectorOAuthStore;
  flow: ConnectorOAuthFlow;
  // The engine host's `connectors.directClose` for one connection: `credentialEpoch` and every earlier one (the
  // provider always names the floor). True only when the host acknowledged it.
  closeHost(target: { connectionId: string; credentialEpoch?: number }): Promise<boolean>;
  now?: () => number;
  newConnectionId?: () => string;
  log?: (line: string) => void;
}

// One identity's MAWS connection, main-only (an owner answer selects its own safe fields).
export type ConnectorOAuthState =
  | { state: 'disconnected' } // no owned grant: the entry's own configuration applies
  | { state: 'connecting'; connectionId: string }
  | { state: 'connected'; connectionId: string; refreshable: boolean; expiresAt?: number }
  | { state: 'needsReconnect'; connectionId: string }
  | { state: 'withdrawn' }
  | { state: 'needsConnect' }
  // `store`: the store cannot be read; `unknown`: an unreadable record may be this identity's; `duplicate`: two are
  | { state: 'unavailable'; why: 'store' | 'unknown' | 'duplicate' };

export type ConnectorOAuthConnectFailure = ConnectorOAuthFailure | 'busy' | 'needsReconnect' | 'unavailable' | 'notHttp' | 'stopped' | 'capacity' | 'failed';
export type ConnectorOAuthConnectResult = { ok: true; connectionId: string; reused: boolean } | { ok: false; why: ConnectorOAuthConnectFailure };
export interface ConnectorOAuthDisconnectResult {
  local: 'forgotten' | 'absent' | 'failed';
  host: 'confirmed' | 'unconfirmed';
  revocation: 'revoked' | 'unsupported' | 'failed' | 'none';
}

export interface ConnectorOAuthProvider extends DirectCredentialPreparation {
  state(identity: ConnectorOAuthIdentity): Promise<ConnectorOAuthState>;
  // The saved connections, forgotten ones excepted; with safeStorage unavailable, their ids alone (as unreadable).
  // Null: not even the ids could be read.
  saved(): Promise<ConnectorOAuthSaved[] | null>;
  // The owner's Connect for a verified HTTP source: answers when the connection is made, reused or refused.
  connect(source: DirectSource, signal?: AbortSignal): Promise<ConnectorOAuthConnectResult>;
  // The owner's explicit replacement: the old grant is withdrawn first.
  reconnect(source: DirectSource, signal?: AbortSignal): Promise<ConnectorOAuthConnectResult>;
  // A saved (or connecting) connection, by id alone: needs no current source and no decryption.
  disconnect(connectionId: string): Promise<ConnectorOAuthDisconnectResult>;
  // A withdrawn connection's retirement still unanswered (`pending`) or answered without confirmation (`unconfirmed`):
  // until it clears, its identity is delivered nothing.
  disconnecting(connectionId: string): 'pending' | 'unconfirmed' | null;
  // P3-F F-connectors 7: every connection whose retirement is still pending or unconfirmed, the owner's Disconnects and
  // a Reconnect's retirement of the record it replaced alike, so the owner can show each (and its Retry).
  retirements(): string[];
  // P3-HD M3c2 correction (the owner's seam, main-only): `listener` hears, with nothing in the notice, that something an
  // owner's row shows may differ (a flow begun or ended, a source parked, withdrawn or reconnect-bound, a retirement's
  // state, a forgotten record, the unattributed withdrawal). The owner reads the state again; nothing here is authority.
  onChange(listener: () => void): () => void;
  // Whether a connection was forgotten without its identity learned in this main's lifetime (Decision Log 33).
  withdrawnUnattributed(): boolean;
  hostLost(): void;
  stop(): void;
}

interface Epoch {
  readonly connectionId: string;
  readonly credentialEpoch: number;
  readonly accessToken: string;
  readonly expiresAt?: number;
  unusable: boolean; // a 401 was reported for it: one-way
  deliveredTo: AbortSignal | null; // the attachment it was last delivered to: while that stands, its replacement waits for its close
}
interface Held {
  record: ConnectorOAuthRecord; // as main knows it: a rotation not yet saved included
  readonly claim: ConnectorOAuthClaim; // taken before the record was read or the flow began
  unsaved: boolean;
}
interface Slot {
  readonly identity: ConnectorOAuthIdentity;
  readonly key: string;
  generation: number;
  held: Held | null;
  issued: Epoch | null;
  closing: { connectionId: string; credentialEpoch: number }[];
  // P3-HD panel correction: the single-flight work of one grant generation; a withdrawn generation's is never joined
  work: { readonly generation: number; readonly done: Promise<void> } | null;
  // P3-HD panel correction: aborted when this generation ends (`advance`), so a demand waiting on its lookup or work
  // is refused at the withdrawal rather than when a stalled step of it answers; nothing shared is cancelled by it
  ended: AbortController;
  refresh: AbortController | null;
  flow: { connectionId: string; controller: AbortController } | null;
  blocked: 'withdrawn' | 'needsConnect' | 'needsReconnect' | null;
  users: number;
}
// `unattributed`: no owned grant, but a connection was forgotten without its identity learned (a gate for automatic use
// only: an explicit Connect may establish a new grant); `unknown`: a record still saved may be this identity's.
type Found = 'held' | 'none' | 'unattributed' | 'stale' | 'store' | 'unknown' | 'duplicate';
// A withdrawn connection's host close: `floor` covers every epoch main issued for it; `key` the identity it blocks
// (null: none was ever issued, so none can be in the host).
interface Retirement {
  readonly key: string | null;
  readonly floor: number;
  state: 'pending' | 'unconfirmed';
}

const REFUSED: DirectCredentialPrepared = { ok: false };
const NONE: DirectCredentialPrepared = { ok: true, credential: null };
const keyOf = (identity: ConnectorOAuthIdentity) => JSON.stringify([identity.requestUrl, identity.server, identity.scope, identity.configPath, identity.entryPath]);
const grantOf = ({ issuer, resource, redirectUri, authorizationServer, client, tokens }: ConnectorOAuthRecord): ConnectorOAuthGrant => ({ issuer, resource, redirectUri, authorizationServer, client, tokens });

// `work`'s answer, or 'ended' once `signal` aborts first.
function untilFlowEnded<T>(work: Promise<T>, signal: AbortSignal): Promise<T | 'ended'> {
  if (signal.aborted) return Promise.resolve('ended');
  return new Promise((resolve) => {
    const onAbort = () => resolve('ended');
    signal.addEventListener('abort', onAbort, { once: true });
    void work.then((value) => {
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    });
  });
}

// Resolves once `work` settles or any signal aborts.
function settledOrEnded(work: Promise<unknown>, ...signals: AbortSignal[]): Promise<void> {
  return new Promise((resolve) => {
    if (signals.some((signal) => signal.aborted)) return resolve();
    const done = () => {
      for (const signal of signals) signal.removeEventListener('abort', done);
      resolve();
    };
    for (const signal of signals) signal.addEventListener('abort', done, { once: true });
    work.then(done, done);
  });
}

export function createConnectorOAuthProvider(deps: ConnectorOAuthProviderDeps): ConnectorOAuthProvider {
  const { store, flow } = deps;
  const now = deps.now ?? Date.now;
  const newConnectionId = deps.newConnectionId ?? randomUUID;
  const log = deps.log ?? ((line: string) => console.warn(`[connectors] ${line}`));
  const slots = new Map<string, Slot>();
  const forgotten = new Set<string>(); // connection ids this main removed (or is removing)
  const discarding = new Set<string>(); // an ended flow's connection whose removal has not settled
  const issuedHigh = new Map<string, { epoch: number; key: string }>(); // per connection: the highest epoch issued
  const retirements = new Map<string, Retirement>();
  let unattributed = false; // a connection was forgotten without its identity learned
  let epochs = 0;
  let stopped = false;
  let attachment = new AbortController(); // the engine host's attachment; aborted when it ends, and at stop
  const lifetime = new AbortController(); // main's: aborted at stop
  // P3-HD M3c2 correction: the owner's change listeners, told synchronously and never trusted to succeed
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        log('connectors: an OAuth change listener failed');
      }
    }
  };

  const expiring = (tokens: { expiresAt?: number }) => tokens.expiresAt !== undefined && tokens.expiresAt - now() <= OAUTH_REFRESH_MARGIN_MS;
  const expired = (tokens: { expiresAt?: number }) => tokens.expiresAt !== undefined && tokens.expiresAt <= now();
  const epochOf = (slot: Slot, record: ConnectorOAuthRecord): Epoch => {
    const credentialEpoch = ++epochs;
    issuedHigh.set(record.connectionId, { epoch: credentialEpoch, key: slot.key });
    return {
      connectionId: record.connectionId, credentialEpoch, accessToken: record.tokens.accessToken,
      ...(record.tokens.expiresAt !== undefined && { expiresAt: record.tokens.expiresAt }), unusable: false, deliveredTo: null,
    };
  };
  const retiring = (key: string) => [...retirements.values()].some((entry) => entry.key === key);

  // ── slots: an identity's attachment memory, held while someone uses it ──

  function enter(identity: ConnectorOAuthIdentity): Slot | null {
    const key = keyOf(identity);
    let slot = slots.get(key);
    if (!slot) {
      if (slots.size >= OAUTH_PROVIDER_IDENTITY_LIMIT) {
        for (const [other, idle] of slots) {
          if (idle.users === 0 && !idle.held && !idle.flow && !idle.work && !idle.blocked && idle.closing.length === 0) slots.delete(other);
        }
        if (slots.size >= OAUTH_PROVIDER_IDENTITY_LIMIT) return null;
      }
      slot = { identity, key, generation: 0, held: null, issued: null, closing: [], work: null, refresh: null, flow: null, blocked: null, users: 0, ended: new AbortController() };
      slots.set(key, slot);
    }
    slot.users += 1;
    return slot;
  }
  async function withSlot<T>(identity: ConnectorOAuthIdentity, full: T, use: (slot: Slot) => Promise<T>): Promise<T> {
    const slot = enter(identity);
    if (!slot) return full;
    try {
      return await use(slot);
    } finally {
      slot.users -= 1;
    }
  }

  // Ends the slot's saved state at once (Disconnect, a Reconnect's withdrawal): no later step of earlier work lands.
  // A new grant generation: every waiter of the old one hears its end (P3-HD panel correction).
  function advance(slot: Slot): void {
    slot.generation += 1;
    const ended = slot.ended;
    slot.ended = new AbortController();
    ended.abort();
  }

  function withdraw(slot: Slot): void {
    const visible = slot.blocked !== 'withdrawn' || slot.held !== null || slot.flow !== null || slot.closing.length > 0; // P3-HD M3c2 correction
    advance(slot);
    slot.blocked = 'withdrawn';
    slot.refresh?.abort();
    slot.flow?.controller.abort();
    slot.flow = null;
    slot.held = null;
    slot.issued = null;
    slot.closing = [];
    if (visible) notify(); // P3-HD M3c2 correction
  }

  // The identity's saved grant into `slot.held`, or why there is none to use.
  async function adopt(slot: Slot): Promise<Found> {
    const generation = slot.generation;
    let listed: ConnectorOAuthSaved[];
    try {
      listed = await store.list();
    } catch {
      return 'store';
    }
    if (slot.generation !== generation) return 'stale';
    if (slot.held) return 'held';
    const matches = listed.filter((entry) => entry.state === 'sealed' && sameOAuthIdentity(entry.identity, slot.identity));
    if (matches.some((entry) => forgotten.has(entry.connectionId))) {
      withdraw(slot); // being forgotten: its identity is withdrawn, never read as absent
      return 'stale';
    }
    if (matches.some((entry) => discarding.has(entry.connectionId))) return 'stale'; // an ended flow's, still on disk
    if (matches.length > 1) return 'duplicate';
    if (matches.length === 0) return listed.some((entry) => entry.state === 'unreadable') ? 'unknown' : unattributed ? 'unattributed' : 'none';
    const { connectionId } = matches[0]!;
    const claim = store.claim(connectionId);
    let record: ConnectorOAuthRecord | null;
    try {
      record = await store.read(connectionId);
    } catch {
      return 'store';
    }
    if (slot.generation !== generation || forgotten.has(connectionId) || discarding.has(connectionId)) return 'stale';
    if (slot.held) return 'held';
    if (!record || !sameOAuthIdentity(record.identity, slot.identity)) return 'none';
    slot.held = { record, claim, unsaved: false };
    return 'held';
  }

  // ── demand: the serialized work that makes the held grant deliverable ──

  function deliverable(slot: Slot): Epoch | null {
    const { held, issued } = slot;
    if (!held || held.unsaved || slot.closing.length > 0 || slot.blocked || slot.flow || !issued || retiring(slot.key)) return null;
    if (issued.unusable || issued.connectionId !== held.record.connectionId || expired(issued)) return null;
    return issued;
  }

  // The generation's work, joined while it runs; work a withdrawal left behind is not (its late steps land nothing:
  // every one is checked against its generation), so it cannot hold the replacement's preparation.
  function ensure(slot: Slot): Promise<void> {
    if (slot.work?.generation === slot.generation) return slot.work.done;
    const mine = {
      generation: slot.generation,
      done: work(slot).catch(() => log('connectors: an OAuth credential step failed')).finally(() => {
        if (slot.work === mine) slot.work = null;
      }),
    };
    slot.work = mine;
    return mine.done;
  }
  const working = (slot: Slot) => slot.work?.generation === slot.generation;

  // Saves the held record under its claim; false when it did not land (stale: a removal won; else kept unsaved).
  async function persist(slot: Slot, held: Held, generation: number): Promise<boolean> {
    try {
      const saved = await store.save(held.claim, slot.identity, grantOf(held.record));
      if (slot.generation !== generation || slot.held !== held) return false;
      held.record = saved;
      held.unsaved = false;
      return true;
    } catch (error) {
      if (!(error instanceof ConnectorOAuthStoreError && error.code === 'stale')) log('connectors: a rotated OAuth grant could not be saved yet');
      return false;
    }
  }

  async function work(slot: Slot): Promise<void> {
    const generation = slot.generation;
    const held = slot.held;
    const current = () => !stopped && slot.generation === generation && slot.held === held;
    if (!held || slot.blocked) return;
    for (const [connectionId, entry] of [...retirements]) {
      if (entry.key !== slot.key) continue;
      await retire(connectionId);
      if (!current() || retirements.has(connectionId)) return;
    }
    if (held.unsaved && !(await persist(slot, held, generation))) return;
    if (!(await closePending(slot, current))) return; // P3-F F-connectors 4: an earlier rotation's close first
    slot.issued ??= epochOf(slot, held.record);
    const issued = slot.issued;
    if (issued.unusable || expiring(issued)) {
      const refreshToken = held.record.tokens.refreshToken;
      if (refreshToken === undefined) {
        if (issued.unusable || expired(issued)) {
          slot.blocked = 'needsReconnect';
          notify(); // P3-HD M3c2 correction
        }
        return; // a still-valid token is used until it expires
      }
      const controller = new AbortController();
      slot.refresh = controller;
      let rotated: ConnectorOAuthTokens;
      try {
        rotated = await flow.refresh(grantOf(held.record), controller.signal);
      } catch (error) {
        if (current() && error instanceof ConnectorOAuthError && error.code === 'rejected') {
          slot.blocked = 'needsReconnect';
          notify(); // P3-HD M3c2 correction
        }
        return;
      } finally {
        if (slot.refresh === controller) slot.refresh = null;
      }
      if (!current()) return;
      held.record = { ...held.record, tokens: rotated };
      held.unsaved = true;
      slot.issued = epochOf(slot, held.record);
      if (issued.deliveredTo && !issued.deliveredTo.aborted) slot.closing.push({ connectionId: issued.connectionId, credentialEpoch: issued.credentialEpoch });
      if (!(await persist(slot, held, generation))) return;
    }
    await closePending(slot, current);
  }

  // The slot's replaced epochs closed in the host, oldest first; false when one is unconfirmed or the work went stale.
  async function closePending(slot: Slot, current: () => boolean): Promise<boolean> {
    while (slot.closing.length > 0) {
      const target = slot.closing[0]!;
      const host = attachment.signal;
      const confirmed = await closeBounded(target);
      if (!current()) return false;
      if (host.aborted) continue; // that attachment ended, and with it the epoch (`hostLost` cleared the list)
      if (!confirmed) return false;
      slot.closing = slot.closing.filter((entry) => entry !== target);
    }
    return true;
  }

  function closeBounded(target: { connectionId: string; credentialEpoch?: number }): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), OAUTH_HOST_CLOSE_TIMEOUT_MS);
      const answer = (confirmed: boolean) => {
        clearTimeout(timer);
        resolve(confirmed);
      };
      let asked: Promise<boolean>;
      try {
        asked = deps.closeHost(target);
      } catch {
        asked = Promise.resolve(false);
      }
      asked.then((confirmed) => answer(confirmed === true), () => answer(false));
    });
  }

  async function revokeBounded(grant: ConnectorOAuthGrant): Promise<ConnectorOAuthDisconnectResult['revocation']> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OAUTH_REVOKE_TIMEOUT_MS);
    const onStop = () => controller.abort();
    lifetime.signal.addEventListener('abort', onStop, { once: true });
    if (lifetime.signal.aborted) controller.abort();
    try {
      return await flow.revoke(grant, controller.signal);
    } catch {
      return 'failed';
    } finally {
      clearTimeout(timer);
      lifetime.signal.removeEventListener('abort', onStop);
    }
  }

  // ── owner: the flow, and forgetting ──

  // The record, `absent` (no file), or `unknown` (unreadable, or no answer within the bound).
  function readBounded(connectionId: string): Promise<ConnectorOAuthRecord | 'absent' | 'unknown'> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve('unknown'), OAUTH_FORGET_READ_TIMEOUT_MS);
      store.read(connectionId).then((record) => record ?? ('absent' as const), () => 'unknown' as const).then((answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
    });
  }

  // Starts (or retries) a withdrawn connection's host close, floored at the highest epoch main issued for it, and
  // keeps it as a retirement until confirmed or the attachment ends. Answers whether the host confirmed.
  function retire(connectionId: string): Promise<boolean> {
    const issued = issuedHigh.get(connectionId);
    const entry: Retirement = { key: issued?.key ?? null, floor: issued?.epoch ?? 0, state: 'pending' };
    retirements.set(connectionId, entry);
    notify(); // P3-HD M3c2 correction
    const host = attachment.signal;
    return closeBounded({ connectionId, credentialEpoch: entry.floor }).then((confirmed) => {
      if (retirements.get(connectionId) === entry) {
        if (confirmed || host.aborted) retirements.delete(connectionId);
        else entry.state = 'unconfirmed';
        notify(); // P3-HD M3c2 correction
      }
      return confirmed;
    });
  }

  // Forgets one connection: callers have blocked it synchronously. `known`: its record when main holds it.
  function forget(connectionId: string, known: ConnectorOAuthRecord | null) {
    forgotten.add(connectionId);
    const host = retire(connectionId);
    const local = (async (): Promise<{ local: ConnectorOAuthDisconnectResult['local']; record: ConnectorOAuthRecord | null }> => {
      let record = known;
      if (!record) {
        const read = await readBounded(connectionId);
        record = typeof read === 'string' ? null : read;
        // whose grant it was is unknown: no source without its own owned grant is served for this main's lifetime
        if (read === 'unknown') {
          unattributed = true;
          notify(); // P3-HD M3c2 correction
        }
        const slot = record && enter(record.identity);
        if (slot) {
          // the identity is withdrawn too, unless main holds another connection for it
          if (!slot.held || slot.held.record.connectionId === connectionId) withdraw(slot);
          slot.users -= 1;
        }
      }
      try {
        return { local: (await store.remove(connectionId)) ? 'forgotten' : 'absent', record };
      } catch {
        forgotten.delete(connectionId); // still on disk: listed again, for another attempt
        return { local: 'failed', record };
      } finally {
        notify(); // P3-HD M3c2 correction: the saved list changed (or did not, after all)
      }
    })();
    const revocation = local.then(({ record }) => (record ? revokeBounded(grantOf(record)) : ('none' as const)));
    return { host, local: local.then(({ local: answer }) => answer), revocation };
  }

  async function runFlow(slot: Slot, replacing: ConnectorOAuthRecord | null, signal: AbortSignal | undefined): Promise<ConnectorOAuthConnectResult> {
    const { identity } = slot;
    let replaced: Promise<ConnectorOAuthDisconnectResult['local']> | null = null;
    if (replacing) {
      withdraw(slot);
      replaced = forget(replacing.connectionId, replacing).local;
    }
    const connectionId = newConnectionId();
    const claim = store.claim(connectionId); // before any await: a Disconnect of this id stales its save
    const controller = new AbortController();
    const me = { connectionId, controller };
    slot.flow = me;
    notify(); // P3-HD M3c2 correction: the flow and its connection id exist
    const onOwner = () => controller.abort();
    signal?.addEventListener('abort', onOwner, { once: true });
    if (signal?.aborted) controller.abort();
    const current = () => !stopped && slot.flow === me && !controller.signal.aborted;
    // The flow ended while its grant is being saved: the connection is removed (a save not yet committed goes stale,
    // one committed is unlinked), and kept from adoption until that settles.
    let saving = false;
    const discard = () => {
      if (!saving) return;
      saving = false;
      discarding.add(connectionId);
      store.remove(connectionId).then(() => discarding.delete(connectionId), () => log('connectors: an ended OAuth connection could not be removed'));
    };
    controller.signal.addEventListener('abort', discard, { once: true });
    try {
      if (replaced && (await replaced) === 'failed') return { ok: false, why: 'unavailable' };
      if (!current()) return { ok: false, why: 'cancelled' };
      let granted: ConnectorOAuthGrant;
      try {
        granted = await flow.connect({ requestUrl: identity.requestUrl, signal: controller.signal });
      } catch (error) {
        if (!current()) return { ok: false, why: 'cancelled' };
        return { ok: false, why: error instanceof ConnectorOAuthError ? error.code : 'failed' };
      }
      if (!current()) {
        void revokeBounded(granted);
        return { ok: false, why: 'cancelled' };
      }
      saving = true;
      // P3-HD panel correction: the save is raced against the flow's end, so an encryption still pending never holds
      // the slot (`connecting`, busy, and no preparation) past a cancellation, a Disconnect or the host's loss; `discard`
      // stales or unlinks the late save
      const save = store.save(claim, identity, granted).then((answer) => ({ record: answer }), (error: unknown) => ({ error }));
      const saved = await untilFlowEnded(save, controller.signal);
      if (saved === 'ended') {
        void revokeBounded(granted);
        return { ok: false, why: 'cancelled' };
      }
      if ('error' in saved) {
        saving = false;
        void revokeBounded(granted);
        return { ok: false, why: saved.error instanceof ConnectorOAuthStoreError && saved.error.code === 'stale' ? 'cancelled' : 'unavailable' };
      }
      const { record } = saved;
      if (!current()) {
        void revokeBounded(granted); // ended while saving: `discard` (or the Disconnect) removes it
        return { ok: false, why: 'cancelled' };
      }
      saving = false;
      slot.held = { record, claim, unsaved: false };
      slot.issued = null;
      slot.closing = [];
      slot.blocked = null;
      return { ok: true, connectionId, reused: false };
    } finally {
      signal?.removeEventListener('abort', onOwner);
      controller.signal.removeEventListener('abort', discard);
      if (slot.flow === me) slot.flow = null; // a failed replacement leaves `withdraw`'s block: nothing is revived
      notify(); // P3-HD M3c2 correction
    }
  }

  function needsReconnect(slot: Slot, held: Held): boolean {
    if (slot.blocked === 'needsReconnect') return true;
    const unusable = slot.issued?.connectionId === held.record.connectionId && slot.issued.unusable;
    return held.record.tokens.refreshToken === undefined && (unusable || expired(held.record.tokens));
  }

  // An owner action's lifetime (its signal, the identity's generation, the host attachment), captured before its
  // first await. The caller proves it synchronously at the side effect itself (reuse or `runFlow`), so an action whose
  // lifetime ended at any point meanwhile ends, rather than reading what changed as a new state to act on.
  function actionLifetime(slot: Slot, signal: AbortSignal | undefined): () => boolean {
    const generation = slot.generation;
    const host = attachment.signal;
    return () => !stopped && !host.aborted && signal?.aborted !== true && slot.generation === generation;
  }

  // An owner action's lookup of the identity's saved grant: why it cannot go on, or null (`slot.held` then says).
  async function lookUp(slot: Slot): Promise<Extract<ConnectorOAuthConnectResult, { ok: false }> | null> {
    if (slot.flow) return { ok: false, why: 'busy' };
    if (slot.held) return null;
    const found = await adopt(slot);
    if (found === 'stale') return { ok: false, why: 'cancelled' };
    if (!slot.held && unavailableOf(found)) return { ok: false, why: 'unavailable' };
    return null;
  }

  // The final proof, synchronous with the action's side effect: why it must not happen, or null.
  function admission(slot: Slot, alive: () => boolean): Extract<ConnectorOAuthConnectResult, { ok: false }> | null {
    if (stopped) return { ok: false, why: 'stopped' };
    if (!alive()) return { ok: false, why: 'cancelled' };
    if (slot.flow) return { ok: false, why: 'busy' };
    return null;
  }

  function unavailableOf(found: Found): ConnectorOAuthState | null {
    if (found === 'store' || found === 'stale') return { state: 'unavailable', why: 'store' };
    if (found === 'unknown' || found === 'duplicate') return { state: 'unavailable', why: found };
    return null;
  }

  return {
    async prepare({ source, signal }) {
      const identity = oauthIdentityOf(source);
      if (!identity) return NONE; // stdio: no OAuth
      if (stopped || signal.aborted) return REFUSED;
      const host = attachment.signal;
      return withSlot(identity, REFUSED, async (slot) => {
        const generation = slot.generation;
        const withdrawn = slot.ended.signal; // P3-HD panel correction: this generation's end, raced by every wait below
        const live = () => !stopped && !signal.aborted && !host.aborted && slot.generation === generation && !slot.blocked && !slot.flow;
        if (!live()) return REFUSED;
        if (!slot.held) {
          let found = 'stale' as Found; // until the lookup answers
          await settledOrEnded(adopt(slot).then((answer) => { found = answer; }), signal, host, withdrawn);
          if (!live()) return REFUSED;
          if (found === 'none' && !slot.held) return NONE;
          if (!slot.held) return REFUSED;
        }
        const ready = deliverable(slot);
        if (!ready || expiring(ready)) {
          const joined = working(slot);
          await settledOrEnded(ensure(slot), signal, host, withdrawn);
          if (!live()) return REFUSED;
          if (joined && !deliverable(slot)) {
            await settledOrEnded(ensure(slot), signal, host, withdrawn);
            if (!live()) return REFUSED;
          }
        }
        const issued = deliverable(slot);
        if (!issued) return REFUSED;
        issued.deliveredTo = host;
        return { ok: true, credential: { connectionId: issued.connectionId, credentialEpoch: issued.credentialEpoch, accessToken: issued.accessToken, ...(issued.expiresAt !== undefined && { expiresAt: issued.expiresAt }) } };
      });
    },

    unauthorized({ source, credential }) {
      const identity = oauthIdentityOf(source);
      if (!identity || stopped) return;
      const slot = credential === null ? enter(identity) : (slots.get(keyOf(identity)) ?? null);
      if (!slot) return;
      if (credential === null) {
        slot.users -= 1;
        // sent with none, refused: the server needs authorization; parked until the owner connects
        if (!slot.held && !slot.flow && slot.blocked === null) {
          slot.blocked = 'needsConnect';
          notify(); // P3-HD M3c2 correction
        }
        return;
      }
      const { issued, held } = slot;
      if (!issued || issued.unusable || issued.connectionId !== credential.connectionId || issued.credentialEpoch !== credential.credentialEpoch) return;
      // P3-HD panel correction: an access-only grant's rejection is its row's needsReconnect now, not at the next demand
      const before = held !== null && needsReconnect(slot, held);
      issued.unusable = true;
      if (held !== null && !before && needsReconnect(slot, held)) notify();
    },

    async state(identity) {
      return withSlot<ConnectorOAuthState>(identity, { state: 'unavailable', why: 'store' }, async (slot) => {
        if (!slot.held && !slot.flow && slot.blocked !== 'withdrawn' && slot.blocked !== 'needsConnect') {
          const found = await adopt(slot);
          if (!slot.held && !slot.flow && !slot.blocked) return unavailableOf(found) ?? { state: found === 'unattributed' ? 'withdrawn' : 'disconnected' };
        }
        if (slot.flow) return { state: 'connecting', connectionId: slot.flow.connectionId };
        if (slot.blocked === 'withdrawn' || slot.blocked === 'needsConnect') return { state: slot.blocked };
        const held = slot.held;
        if (!held) return { state: 'disconnected' };
        if (needsReconnect(slot, held)) return { state: 'needsReconnect', connectionId: held.record.connectionId };
        const { tokens, connectionId } = held.record;
        return { state: 'connected', connectionId, refreshable: tokens.refreshToken !== undefined, ...(tokens.expiresAt !== undefined && { expiresAt: tokens.expiresAt }) };
      });
    },

    async saved() {
      let listed: ConnectorOAuthSaved[];
      try {
        listed = await store.list();
      } catch {
        try {
          listed = (await store.ids()).map((connectionId) => ({ state: 'unreadable', connectionId }));
        } catch {
          return null;
        }
      }
      return listed.filter((entry) => !forgotten.has(entry.connectionId));
    },

    async connect(source, signal) {
      const identity = oauthIdentityOf(source);
      if (!identity) return { ok: false, why: 'notHttp' };
      if (stopped) return { ok: false, why: 'stopped' };
      return withSlot<ConnectorOAuthConnectResult>(identity, { ok: false, why: 'capacity' }, async (slot) => {
        const alive = actionLifetime(slot, signal);
        const refused = await lookUp(slot);
        if (refused) return refused;
        const ended = admission(slot, alive); // no await between this and the reuse or the flow below
        if (ended) return ended;
        const held = slot.held;
        if (held) {
          if (needsReconnect(slot, held)) return { ok: false, why: 'needsReconnect' };
          if (slot.blocked !== null) {
            slot.blocked = null; // an explicit Connect over a saved grant: no browser, no registration
            notify(); // P3-HD M3c2 correction
          }
          return { ok: true, connectionId: held.record.connectionId, reused: true };
        }
        return runFlow(slot, null, signal);
      });
    },

    async reconnect(source, signal) {
      const identity = oauthIdentityOf(source);
      if (!identity) return { ok: false, why: 'notHttp' };
      if (stopped) return { ok: false, why: 'stopped' };
      return withSlot<ConnectorOAuthConnectResult>(identity, { ok: false, why: 'capacity' }, async (slot) => {
        const alive = actionLifetime(slot, signal);
        const refused = await lookUp(slot);
        if (refused) return refused;
        const ended = admission(slot, alive); // no await between this and the flow
        if (ended) return ended;
        return runFlow(slot, slot.held?.record ?? null, signal);
      });
    },

    async disconnect(connectionId) {
      let known: ConnectorOAuthRecord | null = null;
      for (const slot of slots.values()) {
        if (slot.held?.record.connectionId === connectionId) {
          known = slot.held.record;
          withdraw(slot);
        } else if (slot.flow?.connectionId === connectionId) {
          withdraw(slot);
        }
      }
      const { host, local, revocation } = forget(connectionId, known);
      const [localAnswer, revoked, confirmed] = await Promise.all([local, revocation, host]);
      return { local: localAnswer, host: confirmed ? 'confirmed' : 'unconfirmed', revocation: revoked };
    },

    disconnecting(connectionId) {
      return retirements.get(connectionId)?.state ?? null;
    },
    retirements: () => [...retirements.keys()], // P3-F F-connectors 7

    // P3-HD M3c2 correction start: the owner's seam
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    withdrawnUnattributed: () => unattributed,
    // P3-HD M3c2 correction end

    hostLost() {
      attachment.abort();
      attachment = new AbortController();
      retirements.clear(); // their epochs end with that attachment: the host cleans it up before serving another
      for (const slot of slots.values()) {
        slot.closing = [];
        slot.flow?.controller.abort();
      }
      notify(); // P3-HD M3c2 correction
    },

    stop() {
      if (stopped) return;
      stopped = true;
      attachment.abort();
      lifetime.abort();
      for (const slot of slots.values()) {
        advance(slot);
        slot.refresh?.abort();
        slot.flow?.controller.abort();
      }
      listeners.clear(); // P3-HD M3c2 correction
    },
  };
}
