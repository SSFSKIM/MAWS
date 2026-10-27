// The endpoint module (O10; Interfaces §F): the one object `mawsd` starts, asks for its status and hands its
// `mawsd endpoint` commands. M2 holds its state, its enrollment, its org state and its policy; M3 the hub link (RL1) with
// the machine's listings, endpoint record and notifications; M4–M8 add the channels, authorization, RL10, actions and
// subscriptions beside them, each fed by the org state's adoptions.
//
// The hub link runs while the machine is `org-listed` (the hub refuses RL1 to a machine the head doesn't list): from
// start when it already is, else from the sync that lists it. Its welcome and each `state` notice read the org state at
// once, besides the 10-minute sync. A verdict that stops it (`re-enroll`, `revoked`, `replaced`) is `status().refusing`
// until an enrollment writes new credentials.
import { importSigningKey, stateHash, type OrgState, type Rl1Refusal, type SigningKey } from 'org-protocol';
import { runCli } from './cli';
import { enrollDelegatedInto, promoteIfListed, syncAndPromote, type DelegatedInput, type EnrollContext, type EnrollmentState } from './enroll';
import { dropRevokedGrants } from './grants';
import type { HubDeps } from './hub-http';
import { HubLink } from './hub-link';
import { EndpointRecords, Listings, RecordRetries, type RecordsContext } from './listings';
import { Notifier } from './notify';
import { EndpointOrg, type OrgChange } from './org-sync';
import { EndpointPolicy } from './policy';
import type { EndpointModule, EndpointServices } from './services';
import { EndpointState } from './state/store';
import { endpointStatus, NO_LINKS, type EndpointLinks, type EndpointStatus } from './status';

/**
 * `build` is `mawsd`'s build id, as RL1's hello names it (M10 passes it); `now` is the module's clock; `fetch` and
 * `sleep` are the suites' seams for faults and fast retries.
 */
export type EndpointOptions = { build?: string; now?(): number; fetch?: typeof fetch; sleep?(ms: number): Promise<void> };

/** The org state is read again this often, besides at RL1's welcome and each `state` notice (M3). */
export const SYNC_EVERY_MS = 10 * 60_000;

export class Endpoint implements EndpointModule {
  readonly deps: HubDeps;
  readonly policy = new EndpointPolicy(() => this.#state);
  readonly links: EndpointLinks = structuredClone(NO_LINKS);
  /** RL1 (M3): the log plane's projects, the channel multiplex (M4) and the records below go through it. */
  readonly hub: HubLink;
  /** The listings of the sessions sminos reports (M6 feeds them). */
  readonly listings: Listings;
  /** The machine's endpoint record; M4's listener sets its addresses. */
  readonly endpointRecords: EndpointRecords;
  /** `notify` from the pending sets and the to-human messages (M6 feeds them). */
  readonly notifier: Notifier;
  #services: EndpointServices | null = null;
  #state: EndpointState | null = null;
  #org: EndpointOrg | null = null;
  #key: SigningKey | null = null;
  #headHash: string | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #syncing: Promise<unknown> | null = null;
  /** `stop()` was called: nothing in flight then (a sync, an adoption) opens the link or a timer again. */
  #stopped = false;
  /** Records the hub refused for now, tried again while the connection lasts. */
  readonly #retries = new RecordRetries();

  constructor(options: EndpointOptions = {}) {
    this.deps = {
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
      sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      now: options.now ?? Date.now,
    };
    const log = (line: string) => this.#services?.log(line);
    this.hub = new HubLink({
      build: options.build ?? 'unknown',
      now: this.deps.now,
      log,
      target: () => {
        const enrollment = this.#state?.enrolled ? this.#state.enrollment : null;
        if (enrollment?.state !== 'org-listed' || this.#services === null) return null;
        return { hub: enrollment.hub, credentials: enrollment.credentials, ref: this.#services.machine.ref };
      },
      hooks: {
        welcome: ({ generation }) => {
          this.links.hub = { connected: true, generation };
          void this.syncNow();
          void this.endpointRecords.issue();
          void this.listings.welcome().then(() => this.notifier.welcome());
        },
        ended: () => {
          this.links.hub = { connected: false };
          this.#retries.clear();
        },
        state: (version) => void this.#syncTo(version),
        refusal: (refusal) => {
          log(`endpoint: the hub refused a \`${refusal.frame}\` frame: ${refusal.status} ${refusal.error}`);
          this.#refused(refusal);
        },
      },
    });
    const records: RecordsContext = {
      ref: () => this.#services?.machine.ref ?? '',
      key: () => (this.#key === null || this.#state?.machineKey == null ? null : { key: this.#key, keyId: this.#state.machineKey.keyId }),
      head: () => (this.#org?.ready ? { state: this.#org.head().state, certificates: this.#org.certificates() } : null),
      now: this.deps.now,
      send: (frame) => this.hub.send(frame),
      relays: (project) => this.hub.relays(project),
      store: { read: () => this.#state?.listings ?? {}, write: (file) => this.#state?.setListings(file) },
      log,
      listedNow: (session) => this.notifier.listed(session),
      withdrawing: (session, project) => this.notifier.withdrawn(session, project),
    };
    this.listings = new Listings(records);
    this.endpointRecords = new EndpointRecords(records);
    this.notifier = new Notifier({
      send: (frame) => this.hub.send(frame),
      listed: (session) => this.listings.listed(session),
      store: { read: () => this.#state?.notified ?? {}, write: (file) => this.#state?.setNotified(file) },
      log,
    });
  }

  async start(services: EndpointServices): Promise<void> {
    this.#services = services;
    const log = (line: string) => services.log(line);
    const state = EndpointState.open(services.machine.stateDir, { log, now: this.deps.now });
    const org = new EndpointOrg(state, { log, now: this.deps.now });
    org.onAdopted((change) => this.#adopted(change));
    this.#state = state;
    this.#org = org;
    this.notifier.restore();
    if (state.refusing !== null) return;
    if (state.machineKey !== null) {
      try {
        this.#key = await importSigningKey(state.machineKey.jwk);
      } catch (error) {
        log(`endpoint: refusing its state: the machine key in ${services.machine.stateDir} does not import (${(error as Error).message})`);
        this.links.refusing = 'state-malformed';
        return;
      }
    }
    if (org.ready) {
      this.#headHash = await stateHash(org.head().state);
      // The ledger is re-read against a new head after the head is on disk; a crash between the two left it unread.
      this.#endRevokedGrants(org.head().state, log);
    }
    if (state.enrolled) this.#keepSynced();
    this.#ensureLink();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#retries.clear();
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    await this.hub.stop();
  }

  status(): EndpointStatus {
    const stopped = this.hub.stopped;
    return endpointStatus(this.#state, this.#headHash, this.links.refusing === undefined && stopped !== null ? { ...this.links, refusing: stopped } : this.links);
  }

  cli(command: string, args: readonly string[], secret?: string): Promise<{ code: number; out: string }> {
    return runCli(this, command, args, secret);
  }

  /** The started module's parts, for its commands; null before `start`. */
  get parts(): { services: EndpointServices; state: EndpointState; org: EndpointOrg } | null {
    if (this.#services === null || this.#state === null || this.#org === null) return null;
    return { services: this.#services, state: this.#state, org: this.#org };
  }

  get key(): SigningKey | null {
    return this.#key;
  }

  /** The context an enrollment runs in; after one, the module keeps the org state synced. */
  enrollContext(): EnrollContext {
    const parts = this.parts;
    if (parts === null) throw new Error('the endpoint has not started');
    return {
      state: parts.state,
      org: parts.org,
      ref: parts.services.machine.ref,
      deps: this.deps,
      log: (line) => parts.services.log(line),
      keyChanged: (key) => {
        this.#key = key;
        // New credentials: the link under the old ones ends, and a stop it came to is cleared; it opens again once the
        // new key is listed.
        void this.hub.stop();
        this.hub.reset();
        this.links.hub = { connected: false };
        this.#keepSynced();
      },
    };
  }

  enrollDelegated(input: DelegatedInput): Promise<EnrollmentState> {
    return enrollDelegatedInto(this.enrollContext(), input);
  }

  /** Reads the hub's org state now (one at a time); a failure is logged and waits for the next. */
  syncNow(): Promise<unknown> {
    const parts = this.parts;
    if (parts === null || !parts.state.enrolled || this.#stopped) return Promise.resolve();
    this.#syncing ??= syncAndPromote(this.enrollContext()).finally(() => {
      this.#syncing = null;
      this.#ensureLink();
    });
    return this.#syncing;
  }

  /** A `state {version}` notice: read until the head reaches `version` (a read in flight may have begun before it). */
  async #syncTo(version: number): Promise<void> {
    await this.syncNow();
    const org = this.#org;
    if (org?.ready && org.head().state.version < version) await this.syncNow();
  }

  /**
   * A record the hub refused for now (`503`: the Registry busy or unreachable behind an open RL1) is tried again with
   * the backoff while the connection lasts; any other refusal is the hub's verdict on the record, and stands.
   */
  #refused(refusal: Rl1Refusal): void {
    if (refusal.status !== 503 || this.#stopped) return;
    const { session, revision } = refusal;
    if (refusal.frame === 'listing' && typeof session === 'string' && typeof revision === 'number') {
      this.#retries.retry(`listing ${session} ${revision}`, () => void this.listings.resend(session, revision));
    } else if (refusal.frame === 'endpoint') this.#retries.retry('endpoint', () => void this.endpointRecords.issue());
  }

  /** Opens the hub link when the machine is listed and nothing stops it. */
  #ensureLink(): void {
    if (this.#stopped) return;
    const enrollment = this.#state?.enrolled ? this.#state.enrollment : null;
    if (enrollment?.state === 'org-listed' && this.#key !== null && this.#state?.refusing === null && this.links.refusing === undefined) this.hub.start();
  }

  #keepSynced(): void {
    if (this.#timer !== null || this.#stopped) return;
    this.#timer = setInterval(() => void this.syncNow(), SYNC_EVERY_MS);
    this.#timer.unref?.();
    void this.syncNow();
  }

  /** A new head is on disk: end what it took away. Channels, listings and RL10 (M3–M6) subscribe beside this. */
  #adopted(change: OrgChange): void {
    const parts = this.parts;
    if (parts === null) return;
    const log = (line: string) => parts.services.log(line);
    void stateHash(change.head.state).then((hash) => (this.#headHash = hash));
    const { members, devices, keys } = change.removed;
    if (members.length + devices.length + keys.length > 0) {
      log(`endpoint: org state ${change.head.state.version}${change.rewound ? ' (a recovery rewind)' : ''} removed ${members.length} member(s), ${devices.length} device(s), revoked ${keys.length} key(s)`);
    }
    this.#endRevokedGrants(change.head.state, log);
    void promoteIfListed({ state: parts.state, org: parts.org, deps: this.deps, log }).then(() => this.#ensureLink());
    // The machine's owners or the admins may have changed: `@machine` listings are re-issued.
    void this.listings.refresh();
  }

  #endRevokedGrants(head: OrgState, log: (line: string) => void): void {
    const ended = dropRevokedGrants(this.#state!, head);
    if (ended.length > 0) log(`endpoint: ${ended.length} grant(s) ended with their signer's revoked key`);
  }
}
