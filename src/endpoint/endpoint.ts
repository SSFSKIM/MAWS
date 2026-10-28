// The endpoint module (O10; Interfaces §F): the one object `mawsd` starts, asks for its status and hands its
// `mawsd endpoint` commands. M2 holds its state, its enrollment, its org state and its policy; M3 the hub link (RL1) with
// the machine's listings, endpoint record and notifications; M4 the devices' channels (RL2) over the hub's multiplex and
// the direct listener; M5–M8 add authorization, RL10, actions and subscriptions beside them, each fed by the org state's
// adoptions.
//
// The hub link runs while the machine is `org-listed` (the hub refuses RL1 to a machine the head doesn't list): from
// start when it already is, else from the sync that lists it. Its welcome and each `state` notice read the org state at
// once, besides the 10-minute sync. A verdict that stops it (`re-enroll`, `revoked`, `replaced`) is `status().refusing`
// until an enrollment writes new credentials.
//
// Channels are served while the machine speaks for its ref (M4): its standing, derived from the head, the certificate
// set and the key on disk (`speaksFor`), judged at start, at each adoption, at each new certificate set, at each new key
// and after each sync; the `org-listed` marker follows it (for `status()`, the CLI and the hub link). Relayed channels
// come as the hub opens them, direct ones on the tailnet listener, which a `unit` daemon binds, and a `private` one only
// under `MAWS_ENDPOINT_DIRECT=1`. The listener's addresses go into the endpoint record. `stop()` closes every channel
// (`restart`) before the hub link.
//
// Every request a channel carries is decided by the authorizer (M5) before its executor sees it (`gate`), from the offer
// table, O1's grades, the session's record and the known checkouts (two sources RL10 fills), the machine's grants and
// policy, and the device's class.
//
// RL10 (M6), the sminos daemon's local socket, is served while the machine speaks for its ref and is `org-listed`, and
// not once the hub link stops for good with `re-enroll` or `revoked`: `rl10.json` and the socket exist only then.
//
// Actions (M7) are checked for freshness and replay before the gate authorizes them, then handed to the side that runs
// them, each keeping its ledger: the engine host (lane B), sminos (lane A, over RL10) or the endpoint itself
// (`endpoint.grant`, `endpoint.state`, under `<stateDir>/ops.jsonl`). A query routes to the executor it names and is
// answered against the binding the executor stored.
//
// Subscriptions and reads (M8): a `sub` is registered at once and authorized by the gate, then streamed by its lane's
// plane (lane A from sminos's session plane over RL10, lane B from the engine host's events and journal); each is
// authorized again at every record change and every new head. A `call` the gate lets through is read by calls.ts. A
// device's lane B subscriptions are interest (OX5).
import { homedir, networkInterfaces } from 'node:os';
import { importSigningKey, isListingGone, stateHash, type MachineIdentity, type OrgState, type Right, type Rl1Refusal, type SignedOrgState, type SigningKey } from 'org-protocol';
import { Authorizer, type AuthorizeContext } from './authorize';
import { Calls } from './calls';
import { Channels } from './channels';
import { DirectListener, type DirectListenerOptions } from './direct-listener';
import { Actions } from './actions';
import { runCli } from './cli';
import { EndpointActions, type EffectResult } from './endpoint-actions';
import { speaksFor, syncAndPromote, type EnrollContext, type EnrollmentState } from './enroll';
import { Freshness } from './freshness';
import { Gate } from './gate';
import { acceptGrant, dropRevokedGrants, machineOwnerMembers, machineRights } from './grants';
import type { HubDeps } from './hub-http';
import { HubLink } from './hub-link';
import { Interest } from './interest';
import { EndpointRecords, Listings, RecordRetries, type RecordsContext } from './listings';
import { Notifier } from './notify';
import { EndpointOrg, type OrgChange } from './org-sync';
import { PlaneA } from './plane-a';
import { PlaneB } from './plane-b';
import { EndpointPolicy, settingsDefaultMode } from './policy';
import { completeProvisioning, provisionInto, type DelegatedInput } from './provision';
import { retireInto, type Retired } from './retire';
import { Queries } from './queries';
import { Rl10 } from './rl10/link';
import type { EndpointModule, EndpointServices } from './services';
import type { CheckoutSource, RecordSource, SessionTarget } from './sources';
import { EndpointState } from './state/store';
import { Subscriptions } from './subscriptions';
import { endpointStatus, NO_LINKS, type EndpointLinks, type EndpointStatus } from './status';
import { directPort, type InterfaceTable } from './tailnet';

/**
 * `build` is `mawsd`'s build id, as RL1's hello and RL2's h2 name it (M10 passes it); `now` is the module's clock;
 * `fetch` and `sleep` are the suites' seams for faults and fast retries; `env` is where `MAWS_ENDPOINT_DIRECT` and
 * `MAWS_ENDPOINT_PORT` are read (the process's); `pingMs` and `direct` are the suites' seams for channel liveness and
 * the listener (its interface table, how it listens, its limits). `authorization` holds the sources authorization reads
 * (RL10's members and presences unless a suite gives others) and the machine's `defaultMode` (read from the user's
 * settings), and the suites' seams for another offer table, grade declaration or registry.
 */
export type EndpointOptions = {
  build?: string;
  now?(): number;
  fetch?: typeof fetch;
  sleep?(ms: number): Promise<void>;
  env?: Record<string, string | undefined>;
  pingMs?: readonly [number, number];
  direct?: { interfaces?(): InterfaceTable } & Pick<DirectListenerOptions, 'listen' | 'limits' | 'rescanMs'>;
  authorization?: { records?: RecordSource; checkouts?: CheckoutSource; settingsMode?(): string } & Pick<AuthorizeContext, 'offers' | 'gradeOf' | 'registry'>;
  /** The suites' seams for subscriptions: the resume window, lane A's ring and the unsent stream's bound. */
  subscriptions?: { resumeMs?: number; ringBytes?: number; backlogBytes?: number; recheckRetryMs?: readonly number[]; transmitDeadlineMs?: number };
};

/** The whole handshake of a direct connection is this long at most (M4). */
export const DIRECT_HANDSHAKE_MS = 10_000;

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
  /** The devices' channels, over either carrier (M4); M5–M8 set its routes. */
  readonly channels: Channels;
  /** Every remote request's decision (M5); M7 and M8 ask it too (a query's binding, a subscription's re-check). */
  readonly authorizer: Authorizer;
  /** The channel's `call`, `act` and `sub` routes behind the authorizer; M7 and M8 set its executors. */
  readonly gate: Gate;
  /** RL10 (M6): the sminos daemon's socket; its members are the records and checkouts authorization reads. */
  readonly rl10: Rl10;
  /** Actions to their executing side (M7), and the endpoint's own under its ledger. */
  readonly actions: Actions;
  readonly own: EndpointActions;
  /** RL4's queries (M7), answered against the binding the executor stored. */
  readonly queries: Queries;
  /** Subscriptions (M8): the table, lane A's and lane B's planes, and the interest they report. */
  readonly subscriptions: Subscriptions;
  readonly planeA: PlaneA;
  readonly planeB: PlaneB;
  readonly interest: Interest;
  /** Remote reads (M8). */
  readonly calls: Calls;
  /** What `start` subscribed to on mawsd's seam, let go at `stop`. */
  readonly #unseam: Array<() => void> = [];
  readonly #options: EndpointOptions;
  #direct: DirectListener | null = null;
  #directStarted = false;
  #services: EndpointServices | null = null;
  #state: EndpointState | null = null;
  #org: EndpointOrg | null = null;
  #key: SigningKey | null = null;
  /** The latest judgment of the machine's standing (`#judge`): what admits a channel. */
  #speaks = false;
  /** Judgments begun: only the latest one's verdict is taken. */
  #judgments = 0;
  #headHash: string | null = null;
  /** Why the engine host's operation ledger is closed, as its last ledger answer said; null while it answers. */
  #engineHostLedger: string | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #syncing: Promise<unknown> | null = null;
  /** `stop()` was called: nothing in flight then (a sync, an adoption) opens the link or a timer again. */
  #stopped = false;
  /** Records the hub refused for now, tried again while the connection lasts. */
  readonly #retries = new RecordRetries();
  /** The changes of the enrollment begun, one after another (`EnrollContext.lifecycle`). */
  #lifecycle: Promise<unknown> = Promise.resolve();

  constructor(options: EndpointOptions = {}) {
    this.#options = options;
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
          this.rl10.hubWelcomed();
          void this.syncNow();
          void this.endpointRecords.issue();
          void this.listings.welcome().then(() => this.notifier.welcome());
        },
        ended: () => {
          this.links.hub = { connected: false };
          this.#retries.clear();
        },
        state: (version) => void this.#syncTo(version),
        stopped: () => this.#syncRl10(),
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
    this.rl10 = new Rl10({
      stateDir: () => {
        if (this.#services === null) throw new Error('the endpoint has not started');
        return this.#services.machine.stateDir;
      },
      build: options.build ?? 'unknown',
      state: () => this.#state,
      head: () => (this.#org?.ready ? { state: this.#org.head().state, certificates: this.#org.certificates() } : null),
      identity: () => {
        const enrollment = this.#state?.enrolled ? this.#state.enrollment : null;
        if (enrollment?.state !== 'org-listed' || this.#services === null) return null;
        return { org: enrollment.org, hub: enrollment.hub, name: enrollment.name, ref: this.#services.machine.ref, enrolled: enrollment.at };
      },
      key: () => records.key(),
      policy: this.policy,
      hub: this.hub,
      listings: {
        report: (report) => this.listings.report(report),
        gone: (session) => this.listings.gone(session),
        refresh: () => this.listings.refresh(),
        listedSessions: () => Object.entries(this.#state?.listings ?? {}).flatMap(([session, entry]) => (isListingGone(entry.record.body) ? [] : [session])),
      },
      notifier: this.notifier,
      machineOwners: () => {
        const org = this.#org;
        if (!org?.ready || this.#services === null) return Promise.resolve([]);
        return machineOwnerMembers(org.head().state, org.certificates(), this.#services.machine.ref, new Date(this.deps.now()));
      },
      dispatch: (owner, name, input) => {
        if (this.#services === null) return Promise.reject(new Error('the endpoint has not started'));
        return this.#services.dispatch(owner, name, input);
      },
      now: this.deps.now,
      log,
    });
    this.channels = new Channels({
      identity: () => this.#identity(),
      org: () => (this.#identity() === null ? null : this.#org),
      adopt: (states, transitions) => this.#org?.adopt(states, transitions) ?? Promise.resolve(),
      rights: (member) => this.#rights(member),
      hold: (reason) => this.#services?.hold(reason) ?? (() => {}),
      counts: (counts) => (this.links.channels = counts),
      log,
      now: this.deps.now,
      pingMs: options.pingMs,
    });
    this.hub.setChannels(this.channels.relay(this.hub));
    const authorization = options.authorization ?? {};
    this.authorizer = new Authorizer({
      ref: () => this.#services?.machine.ref ?? null,
      org: () => {
        const org = this.#org;
        return org?.ready ? { head: org.head().state, certificates: org.certificates(), tooOld: org.actionsRefusal() !== null } : null;
      },
      rights: (member) => this.#rights(member),
      policy: () => this.policy.current(),
      settingsMode: authorization.settingsMode ?? (() => settingsDefaultMode(homedir())),
      records: authorization.records ?? this.rl10.members,
      checkouts: authorization.checkouts ?? this.rl10.members,
      dispatch: (owner, name, input) => {
        if (this.#services === null) return Promise.reject(new Error('the endpoint has not started'));
        return this.#services.dispatch(owner, name, input);
      },
      webauthn: {
        origin: () => this.#webOrigin(),
        counter: (credentialId) => this.#state?.webauthn[credentialId] ?? 0,
        setCounter: (credentialId, counter) => this.#state?.setWebAuthn({ ...this.#state.webauthn, [credentialId]: counter }),
      },
      stamp: () => this.#state?.ledger,
      offers: authorization.offers,
      gradeOf: authorization.gradeOf,
      registry: authorization.registry,
    });
    this.gate = new Gate({ authorize: (request, who, now) => this.authorizer.authorize(request, who, now), now: this.deps.now, log });
    const dispatch: EndpointServices['dispatch'] = (owner, name, input) => {
      if (this.#services === null) return Promise.reject(new Error('the endpoint has not started'));
      return this.#services.dispatch(owner, name, input);
    };
    this.own = new EndpointActions({
      stateDir: () => {
        if (this.#services === null) throw new Error('the endpoint has not started');
        return this.#services.machine.stateDir;
      },
      grant: (value) => this.#grant(value),
      deliver: (states, transitions) => this.#deliver(states, transitions),
      now: this.deps.now,
      log: (line) => log(line),
    });
    this.actions = new Actions({
      freshness: new Freshness(),
      own: this.own,
      rl10: this.rl10,
      dispatch,
      hold: (reason) => this.#services?.hold(reason) ?? (() => {}),
      engineHostLedger: (closed) => (this.#engineHostLedger = closed),
      offers: authorization.offers,
      now: this.deps.now,
      log,
    });
    this.queries = new Queries({
      authorize: (request, who, now) => this.authorizer.authorize(request, who, now),
      own: this.own,
      rl10: this.rl10,
      dispatch,
      engineHostLedger: (closed) => (this.#engineHostLedger = closed),
      now: this.deps.now,
      log,
    });
    this.rl10.onResult((result) => this.actions.result(result));
    const seams = options.subscriptions ?? {};
    const recordSource = authorization.records ?? this.rl10.members;
    this.interest = new Interest({ interest: () => this.#services?.interest ?? null, log, resumeMs: seams.resumeMs });
    this.planeA = new PlaneA({
      send: (frame) => this.rl10.send(frame),
      connected: () => this.rl10.connected,
      member: (session) => {
        const member = this.rl10.members.get(session);
        return member === null ? null : { project: member.project, lane: member.lane, ...(member.launch === undefined ? {} : { launch: member.launch }) };
      },
      log,
      ringBytes: seams.ringBytes,
      backlogBytes: seams.backlogBytes,
      resumeMs: seams.resumeMs,
    });
    this.planeB = new PlaneB({ dispatch, log, backlogBytes: seams.backlogBytes });
    this.rl10.onSession((message) => this.planeA.message(message));
    this.rl10.onPending((project, raised) => this.planeA.pendingSet(project, raised));
    this.rl10.onLink((connected) => connected || this.planeA.linkLost());
    this.subscriptions = new Subscriptions({
      recheckRetryMs: seams.recheckRetryMs,
      transmitDeadlineMs: seams.transmitDeadlineMs,
      authorize: (request, who, now) => this.authorizer.authorize(request, who, now),
      planes: { A: this.planeA, B: this.planeB },
      interest: this.interest,
      records: recordSource,
      now: this.deps.now,
      log,
    });
    this.calls = new Calls({
      dispatch,
      subscription: (channel, sub) => this.subscriptions.get(channel, sub),
      upstreamOf: (sub) => this.planeA.upstreamOf(sub),
      toSminos: (frame) => this.rl10.send(frame),
      members: () =>
        this.rl10.members.sessions().flatMap((session) => {
          const member = this.rl10.members.get(session);
          if (member === null) return [];
          const listingId = this.rl10.members.listingId(session);
          const target: SessionTarget = member.lane === 'A' ? { lane: 'A', session } : { lane: 'B', session, appSessionId: listingId ?? '' };
          return [{ member, listingId, target }];
        }),
      records: recordSource,
      machineOwners: () => {
        const org = this.#org;
        if (!org?.ready || this.#services === null) return Promise.resolve([]);
        return machineOwnerMembers(org.head().state, org.certificates(), this.#services.machine.ref, new Date(this.deps.now()));
      },
      recordFor: (report) => this.listings.recordFor(report),
      offers: authorization.offers,
      log,
    });
    this.gate.setExecutors({
      act: (channel, m, decision) => this.actions.execute(channel, m, decision),
      call: (channel, m) => this.calls.execute(channel, m),
      sub: (channel, m, decision) => this.subscriptions.start(channel, m, decision),
      subRefused: (channel, m, reason) => this.subscriptions.refused(channel, m, reason),
    });
    const gated = this.gate.routes();
    this.channels.setRoutes({
      ...gated,
      act: (channel, m) => this.actions.receive(channel, m, gated.act),
      query: (channel, m) => this.queries.route(channel, m),
      sub: (channel, m) => this.subscriptions.receive(channel, m, gated.sub),
      credit: (channel, m) => this.subscriptions.credit(channel, m),
      unsub: (channel, m) => this.subscriptions.unsub(channel, m),
    });
  }

  async start(services: EndpointServices): Promise<void> {
    this.#services = services;
    const log = (line: string) => services.log(line);
    const state = EndpointState.open(services.machine.stateDir, { log, now: this.deps.now });
    const org = new EndpointOrg(state, { log, now: this.deps.now });
    org.onAdopted((change) => this.#adopted(change));
    org.onCertificates(() => {
      void this.#judge();
      void this.rl10.adopted();
    });
    this.#state = state;
    this.#org = org;
    // Lane B's live events and the app's attachment (none at start, O2's seam), for the subscriptions.
    this.#unseam.push(
      services.onEvent((owner, message) => this.planeB.event(owner, message)),
      services.onAttachment((attached) => this.planeB.attachment(attached)),
    );
    this.notifier.restore();
    if (state.refusing !== null) return;
    // A provisioning interrupted mid-set (O14 M1) is whole again before anything below reads the directory.
    await completeProvisioning(state, org, log, () => this.rl10.forgetRecords());
    this.own.open();
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
      // So is legacy.json, which follows the head's retirement of the DX1 key.
      this.#followLegacy(org.head().state, false, log);
    }
    // The standing is judged from what is on disk before anything is admitted: the marker a crash left may be stale.
    await this.#judge();
    const env = this.#options.env ?? process.env;
    if (services.machine.kind === 'unit' || env.MAWS_ENDPOINT_DIRECT === '1') this.#direct = this.#listener(env);
    if (state.enrolled) this.#keepSynced();
    this.#ensureLink();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#retries.clear();
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    // No action more; those in flight record their results first (up to 2 s), then the subscriptions and channels close.
    await this.actions.stop();
    this.subscriptions.stop();
    for (const off of this.#unseam.splice(0)) off();
    // Each channel's sealed `restart` goes out before the carriers end: the hub link and the listener close after.
    await this.channels.closeAll('restart');
    await this.#direct?.stop();
    this.links.listener = { bound: false };
    this.rl10.members.stop();
    await this.rl10.unserve();
    await this.hub.stop();
  }

  /** The direct listener, when this daemon binds one (a suite reads its addresses again through it). */
  get direct(): DirectListener | null {
    return this.#direct;
  }

  status(): EndpointStatus {
    this.links.rl10 = { connected: this.rl10.connected };
    const stopped = this.hub.stopped;
    const links = this.links.refusing === undefined && stopped !== null ? { ...this.links, refusing: stopped } : this.links;
    return endpointStatus(this.#state, this.#headHash, links, { endpoint: this.own.closed, engineHost: this.#engineHostLedger });
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
      lifecycle: (run) => this.#serialLifecycle(run),
      recordsMoved: () => {
        this.rl10.forgetRecords();
        parts.services.log('endpoint: RL10\'s kept signatures and replay index were another authority\'s: moved aside');
      },
      keyChanged: (key) => {
        this.#key = key;
        // The new key speaks for the machine once it is judged to; the channels the old key authenticated end, their
        // devices meeting the new key once the head lists it.
        this.#judgments++;
        this.#speaks = false;
        this.#syncRl10();
        this.channels.keyReplaced(key.pub);
        void this.#judge();
        // New credentials: the link under the old ones ends, and a stop it came to is cleared; it opens again once the
        // new key is listed.
        void this.hub.stop();
        this.hub.reset();
        this.links.hub = { connected: false };
        this.#keepSynced();
      },
    };
  }

  /** Delegated enrollment (O14 M1's `provision` with no wait): `org-listed` once the certificate is live. */
  async enrollDelegated(input: DelegatedInput): Promise<EnrollmentState> {
    return (await provisionInto(this.enrollContext(), { ...input, waitMs: 0 })).result;
  }

  /**
   * `mawsd endpoint unenroll` (O14 M1): the endpoint taken back to `enrollment: none` on this machine alone, whatever the
   * hub knows. The state directory's private keys are destroyed and the rest moved aside first (`EndpointState.unenroll`,
   * in the org view's queue so no adoption in flight writes after it), so nothing judged meanwhile can serve again; then
   * RL10 is unserved (`rl10.json` and the socket gone, so sminos sees no endpoint), every channel closes `removed`, and
   * the hub link and the direct listener stop. The profile's `machine.json` is kept: a later enrollment takes a new key
   * under the same ref.
   */
  unenroll(): Promise<{ aside: string; keyIds: string[] }> {
    return this.#serialLifecycle(() => this.#unenroll());
  }

  /** `mawsd endpoint retire` (O14 M1, retire.ts), after any change of the enrollment begun; its own unenroll runs inside it. */
  retire(input: { notAfter?: string }): Promise<Retired> {
    return this.#serialLifecycle(() => retireInto(this.enrollContext(), () => this.#unenroll(), input));
  }

  #serialLifecycle<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#lifecycle.then(run);
    this.#lifecycle = next.catch(() => {});
    return next;
  }

  async #unenroll(): Promise<{ aside: string; keyIds: string[] }> {
    const parts = this.parts;
    if (parts === null) throw new Error('the endpoint has not started');
    const result = await parts.org.exclusive(() => parts.state.unenroll(this.deps.now()));
    this.#judgments++;
    this.#speaks = false;
    this.#key = null;
    this.#headHash = null;
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    await this.rl10.unserve();
    await this.channels.closeAll('removed');
    await this.#direct?.stop();
    this.#directStarted = false;
    this.links.listener = { bound: false };
    await this.hub.stop();
    this.hub.reset();
    this.links.hub = { connected: false };
    parts.services.log(`endpoint: unenrolled; ${result.keyIds.length} private key(s) destroyed, the rest of the state moved aside to ${result.aside}`);
    return result;
  }

  /** Reads the hub's org state now (one at a time); a failure is logged and waits for the next. */
  syncNow(): Promise<unknown> {
    const parts = this.parts;
    if (parts === null || !parts.state.enrolled || this.#stopped) return Promise.resolve();
    this.#syncing ??= syncAndPromote(this.enrollContext()).finally(() => {
      this.#syncing = null;
      // Judged again after every read: a delegation that expired since the last change is noticed here.
      void this.#judge();
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

  /** Opens the hub link when the machine is listed and nothing stops it, and the direct listener once it can serve. */
  #ensureLink(): void {
    if (this.#stopped) return;
    const enrollment = this.#state?.enrolled ? this.#state.enrollment : null;
    if (enrollment?.state === 'org-listed' && this.#key !== null && this.#state?.refusing === null && this.links.refusing === undefined) this.hub.start();
    if (this.#direct !== null && !this.#directStarted && this.#identity() !== null) {
      this.#directStarted = true;
      void this.#direct.start();
    }
  }

  /** The machine as RL2's `h2` signs it, while it serves channels: it speaks for its ref, its state sound. */
  #identity(): MachineIdentity | null {
    if (this.#stopped || this.#services === null || this.#key === null || !this.#speaks || this.#state?.refusing !== null || this.#org?.ready !== true) return null;
    return { ref: this.#services.machine.ref, key: this.#key, build: this.#options.build ?? 'unknown', capabilities: [] };
  }

  #listener(env: Record<string, string | undefined>): DirectListener {
    const log = (line: string) => this.#services?.log(line);
    const { port, ignored } = directPort(env);
    if (ignored !== undefined) log(`endpoint: MAWS_ENDPOINT_PORT names no port (${ignored.slice(0, 32)}); the direct listener takes ${port}`);
    const seams = this.#options.direct ?? {};
    return new DirectListener({
      port,
      interfaces: seams.interfaces ?? networkInterfaces,
      listen: seams.listen,
      limits: seams.limits,
      rescanMs: seams.rescanMs,
      now: this.deps.now,
      log,
      connection: (io) => void this.channels.accept('direct', io, { deadlineMs: DIRECT_HANDSHAKE_MS }),
      addresses: (urls) => {
        this.links.listener = { bound: urls.length > 0 };
        void this.endpointRecords.setAddresses(urls);
      },
    });
  }

  /** The member's grades on this machine: all three for an owner, else what a grant in force gives. */
  #rights(member: string): Promise<Right[]> {
    const org = this.#org;
    if (this.#state === null || this.#services === null || !org?.ready) return Promise.resolve([]);
    return machineRights(this.#state, org.head().state, org.certificates(), this.#services.machine.ref, member, new Date(this.deps.now()));
  }

  /** `endpoint.grant`'s effect: the grant kept by the ledger's rule, and the devices told their new grades. */
  async #grant(value: unknown): Promise<EffectResult> {
    const parts = this.parts;
    if (parts === null) return { ok: false, error: { code: 'unavailable' } };
    const result = await acceptGrant(parts.state, parts.org, parts.services.machine.ref, value, new Date(this.deps.now()));
    if (!result.ok) return { ok: false, error: { code: result.reason } };
    this.channels.refreshCaps();
    const g = result.grant.body;
    return { ok: true, value: { member: g.member, version: g.version, rights: g.rights } };
  }

  /**
   * `endpoint.state`'s effect: an admin's delivered state adopted as any delivery is, answered once the new head is on
   * disk; a delivery whose newest state is the head already held is done too.
   */
  async #deliver(states: unknown, transitions: unknown): Promise<EffectResult> {
    const org = this.#org;
    if (org === null || !org.ready) return { ok: false, error: { code: 'unavailable' } };
    const result = await org.adopt(states, transitions ?? []);
    const head = org.head().state;
    if (result.adopted > 0) return { ok: true, value: { version: head.version, ...(result.rewound ? { rewound: true } : {}) } };
    const held = Array.isArray(states) ? (states as SignedOrgState[]).find((s) => s?.state?.version === head.version) : undefined;
    if (held !== undefined && (await stateHash(held.state)) === (await stateHash(head))) return { ok: true, value: { version: head.version } };
    return { ok: false, error: { code: result.refused ?? 'not-newer' } };
  }

  /** The origin a web-cards device's code is served from, which its assertions name: the hub's (RL §5.10). */
  #webOrigin(): string | null {
    const hub = this.#state?.enrolled ? this.#state.enrollment?.hub : undefined;
    if (hub === undefined) return null;
    try {
      return new URL(hub).origin;
    } catch {
      return null;
    }
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
    // Removal closes at once, before anything else hears of the new head (M4): the machine's own standing first, then
    // each device's.
    if (!this.#plainlyStands(change.head)) {
      this.#judgments++;
      this.#stand(false);
    }
    this.channels.adopted(change.head.state);
    const log = (line: string) => parts.services.log(line);
    void stateHash(change.head.state).then((hash) => (this.#headHash = hash));
    const { members, devices, keys } = change.removed;
    if (members.length + devices.length + keys.length > 0) {
      log(`endpoint: org state ${change.head.state.version}${change.rewound ? ' (a recovery rewind)' : ''} removed ${members.length} member(s), ${devices.length} device(s), revoked ${keys.length} key(s)`);
    }
    this.#endRevokedGrants(change.head.state, log);
    this.#followLegacy(change.head.state, change.previous === null, log);
    void this.#judge();
    // The machine's owners or the admins may have changed: `@machine` listings are re-issued.
    void this.listings.refresh();
    // sminos hears the head's revocation set and directory where they changed.
    void this.rl10.adopted();
    // Every subscription, and every resumable cursor, is authorized again under the new head (M8).
    this.subscriptions.recheck();
  }

  /**
   * What a new head plainly says of the machine's standing, with no signature to check: false when the key on disk is
   * revoked or retired, or the head lists the ref under another key or not at all (attended), or drops or lets expire
   * the certificate's delegation (delegated, RL §5.2). True here only means `#judge` decides.
   */
  #plainlyStands(head: SignedOrgState): boolean {
    const enrollment = this.#state?.enrolled ? this.#state.enrollment : null;
    const kid = this.#state?.machineKey?.keyId;
    if (enrollment === null || kid === undefined || this.#key === null) return false;
    const s = head.state;
    const pub = this.#key.pub;
    if (s.revoked.some((r) => r.keyId === kid) || s.retired.some((r) => r.keyId === kid)) return false;
    const cert = enrollment.cert?.body;
    if (cert === undefined) return s.machines.some((m) => m.ref === enrollment.ref && m.pub === pub);
    const delegation = s.delegations.find((d) => d.id === cert.delegation);
    return cert.pub === pub && delegation !== undefined && Date.parse(delegation.expires) > this.deps.now();
  }

  /**
   * Judges the machine's standing from the head, the certificate set and the key on disk (`speaksFor`, as a device judges
   * it) and takes the verdict, unless a later judgment began meanwhile (each change to those begins one).
   */
  async #judge(): Promise<void> {
    const n = ++this.#judgments;
    const state = this.#state;
    const org = this.#org;
    const enrollment = state?.enrolled ? state.enrollment : null;
    const kid = state?.machineKey?.keyId;
    const speaks = enrollment !== null && kid !== undefined && this.#key !== null && org?.ready === true && (await speaksFor(org.head(), org.certificates(), enrollment, kid, new Date(this.deps.now())));
    if (n === this.#judgments && !this.#stopped) this.#stand(speaks);
  }

  /**
   * Takes a verdict on the standing; the `org-listed` marker follows it. Losing it closes every channel `removed` and
   * admits none until a head and certificate set let the machine speak again.
   */
  #stand(speaks: boolean): void {
    const was = this.#speaks;
    this.#speaks = speaks;
    const state = this.#state;
    const enrollment = state?.enrolled ? state.enrollment : null;
    const version = this.#org?.ready ? this.#org.head().state.version : 0;
    if (state !== null && enrollment !== null && speaks && enrollment.state !== 'org-listed') {
      state.setEnrollment({ ...enrollment, state: 'org-listed' });
      this.#services?.log(`endpoint: ${enrollment.name} is listed in the org state at version ${version}`);
    }
    if (state !== null && enrollment !== null && !speaks && enrollment.state === 'org-listed') {
      state.setEnrollment({ ...enrollment, state: 'hub-confirmed' });
      this.#services?.log(`endpoint: the org state at version ${version} no longer lets ${enrollment.name} speak for its ref with its key; it serves no channel until it does again`);
    }
    if (speaks) this.#ensureLink();
    else if (was) void this.channels.closeAll('removed');
    this.#syncRl10();
  }

  /**
   * RL10 served exactly while the machine speaks for its ref, is `org-listed`, its state sound, and the hub link has not
   * stopped for good on a verdict that the machine is no longer enrolled (`re-enroll`, `revoked`).
   */
  #syncRl10(): void {
    const enrollment = this.#state?.enrolled ? this.#state.enrollment : null;
    const stopped = this.hub.stopped;
    const serve = !this.#stopped && this.#speaks && enrollment?.state === 'org-listed' && this.#state?.refusing === null && stopped !== 're-enroll' && stopped !== 'revoked';
    if (serve && !this.rl10.serving) void this.rl10.serve();
    else if (!serve && this.rl10.serving) void this.rl10.unserve();
  }

  /**
   * `legacy.json` made the head's (O14 M5a; rl10/legacy.ts): a tombstone under its `legacyRetired`, the key again without
   * it. `first`: the head is this enrollment's first, under which a machine has no bytes to keep. RL10 hears of it with
   * the adoption (`rl10.adopted`), which judges the v1 events held for want of a key again.
   */
  #followLegacy(head: OrgState, first: boolean, log: (line: string) => void): void {
    const legacy = this.rl10.legacy;
    try {
      const was = legacy.retired;
      if (!legacy.follow(head, first) || legacy.retired === was) return;
      log(
        legacy.retired
          ? `endpoint: the org state at version ${head.version} retires the legacy org key: events go out v2-only, and v1 events come down unchecked`
          : `endpoint: the org state at version ${head.version} no longer retires the legacy org key${legacy.held ? ': it is in use again' : ''}`,
      );
    } catch (error) {
      log(`endpoint: legacy.json could not follow the org state at version ${head.version}: ${(error as Error).message}`);
    }
  }

  #endRevokedGrants(head: OrgState, log: (line: string) => void): void {
    const ended = dropRevokedGrants(this.#state!, head);
    if (ended.length > 0) log(`endpoint: ${ended.length} grant(s) ended with their signer's revoked key`);
  }
}
