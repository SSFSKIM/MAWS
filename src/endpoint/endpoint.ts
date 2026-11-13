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
// device's lane B subscriptions are interest (OX5). P5 O7 M4: a `sub` may name a session's `checkout` feed, streamed by
// the feeds' plane from the spine's events, within the same checkout bounds the `checkout` target rule reads. P5 O7 M6:
// or the machine's `attention` feed, cut to the sessions the member views as its rights stand (`Authorizer.ranks`, read
// again at every record change and new head), as `attention.list` and `session.search` are cut when called.
//
// P5 O7 M5a: the `artifact` target rule's placements are kept per channel (`artifactRanks`, artifacts.ts), read by the
// decisions, `library.list`'s cut and the machine's `artifacts` feed, and dropped by everything that can change what they
// say or what is decided on them: a record change naming a linked session (the record source's listener here runs before
// the subscriptions' re-check), the spine's `session.changed` of one and an artifact's relink, create or delete (before the
// feeds hear the event), a `caps` refresh and a new head. Every drop rechecks the `artifacts` feeds' queued output at once
// (ArtifactRanks' `onDropped`).
//
// P5 O7 M3: a device's streams (streams.ts) open under its acts: a terminal's bytes, read from the pty host's ring and its
// `onFrame` output, and a forwarded port's connections, each naming a forward the endpoint keeps per device for the resume
// window (forwards.ts). Both are authorized again at every refresh of the members' rights. P5 O7 M5b: or under a stream
// row (the read open: an artifact page's request through the machine's artifact endpoint), authorized again also at every
// record change and at every change the artifact cache drops a placement for (a relink, a linked session's new placement),
// the cache dropping it first.
//
// `notify`'s counts come from sminos's pending sets for lane A and from the engine host for lane B (lane-b-pending.ts):
// every session's broker items as the engine host publishes them, subscribed or not, and the whole set read again at
// each engine-host link `mawsd` reports.
//
// The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, M9; registry.ts): the machine's own
// projects record, signed from the index's declared rows (`projectsSource`, `mawsd`'s) after each change and sent at each
// welcome; the other machines' records, verified and kept; the org frame's hub projects, `complete` and `locations` for
// sminos; and the seam the machine's services ask (`registry`), whose statements are possible once the enrolled
// machine's sminos reads locations.
import { homedir, networkInterfaces } from 'node:os';
import { importSigningKey, isListingGone, NO_CERTIFICATES, stateHash, type MachineIdentity, type OrgState, type Right, type Rl1Refusal, type SignedOrgState, type SigningKey } from 'org-protocol';
import type { AppSessionId } from '@shared/graph/ids';
import type { Home } from '@shared/machine/home-folders';
import type { MachineRef } from '@shared/machine/ref';
import type { ProjectsSource, RegistryRead } from '@shared/machine/registry';
import { ArtifactRanks } from './artifacts';
import { Authorizer, type AuthorizeContext } from './authorize';
import { Calls } from './calls';
import { ClientPorts } from './client-port';
import { AssetHolds } from './asset-holds';
import { Leases } from './leases';
import { ENDPOINT_CAPABILITIES } from './capabilities';
import { Channels } from './channels';
import { ChannelCursors } from './channel-cursors';
import { DirectListener, type DirectListenerOptions } from './direct-listener';
import { Actions } from './actions';
import { runCli } from './cli';
import { EndpointActions, type EffectResult } from './endpoint-actions';
import { Forwards } from './forwards';
import { current, speaksFor, syncAndPromote, type EnrollContext, type EnrollmentState } from './enroll';
import { Freshness } from './freshness';
import { Gate } from './gate';
import { acceptGrant, dropRevokedGrants, grantsAnswer, machineOwnerMembers, machineRights, type GrantsRead, type GrantsReader, type GrantsResult } from './grants';
import type { HubDeps } from './hub-http';
import { HubLink } from './hub-link';
import { Interest } from './interest';
import { LaneBPending } from './lane-b-pending';
import { LocalDoor, type DoorCallAnswer } from './local-door';
import { EndpointRecords, Listings, RecordRetries, type RecordsContext } from './listings';
import { Notifier } from './notify';
import { EndpointOrg, type OrgChange } from './org-sync';
import { PlaneA } from './plane-a';
import { PlaneB } from './plane-b';
import { PlaneFeeds, type OwnersRead } from './plane-feeds';
import { aboveCeiling, EndpointPolicy, MachineSetup, settingsDefaultMode } from './policy';
import { completeProvisioning, provisionInto, type DelegatedInput } from './provision';
import { retireInto, type Retired } from './retire';
import { owns } from './grades';
import { Queries } from './queries';
import { placeListings, policies, unsupported, type HeldSession } from './record-policy';
import { Registry } from './registry';
import { Rl10 } from './rl10/link';
import type { RelayContext } from './rl10/log-relay';
import type { EndpointModule, EndpointServices } from './services';
import { SessionSafe } from './session-safe';
import { anyCheckout, type CheckoutSource, type RecordSource, type SessionTarget } from './sources';
import { EndpointState } from './state/store';
import { Streams } from './streams';
import { Subscriptions } from './subscriptions';
import { CheckoutBounds, placeRecord, type RecordPlacement } from './targets';
import { endpointStatus, NO_LINKS, type EndpointLinks, type EndpointStatus } from './status';
import { directPort, type InterfaceTable } from './tailnet';

/**
 * `build` is `mawsd`'s build id, as RL1's hello and RL2's h2 name it (M10 passes it); `now` is the module's clock;
 * `fetch` and `sleep` are the suites' seams for faults and fast retries; `env` is where `MAWS_ENDPOINT_DIRECT` and
 * `MAWS_ENDPOINT_PORT` are read (the process's); `pingMs` and `direct` are the suites' seams for channel liveness and
 * the listener (its interface table, how it listens, its limits). `authorization` holds the sources authorization reads
 * (RL10's members and presences unless a suite gives others) and the machine's `defaultMode` (read from the user's
 * settings), and the suites' seams for another offer table, grade declaration or registry, and (P5 O7 M9) the home and the
 * platform the setup policy reads (this process's unless a suite gives a fake home).
 */
export type EndpointOptions = {
  build?: string;
  now?(): number;
  fetch?: typeof fetch;
  sleep?(ms: number): Promise<void>;
  env?: Record<string, string | undefined>;
  pingMs?: readonly [number, number];
  direct?: { interfaces?(): InterfaceTable } & Pick<DirectListenerOptions, 'listen' | 'limits' | 'rescanMs'>;
  // `home` (2026-11-06): the machine's home as the home-root rule reads it (src/shared/machine/machine-home.ts; a suite's fake one)
  authorization?: { records?: RecordSource; checkouts?: CheckoutSource; settingsMode?(): string; setup?: Home; home?: string } & Pick<AuthorizeContext, 'offers' | 'gradeOf' | 'registry'>;
  /** MAWS's own projects as checkouts (P5 O3-D M4, `mawsd` injects them), known beside RL10's; `authorization.checkouts` replaces both. */
  projects?: CheckoutSource;
  /** The suites' seams for subscriptions: the resume window, lane A's ring and the unsent stream's bound. */
  subscriptions?: { resumeMs?: number; ringBytes?: number; backlogBytes?: number; recheckRetryMs?: readonly number[]; transmitDeadlineMs?: number };
  /** P5 O7 M5c review 1: the suites' seam for a remote acquisition's bound (acquire.ts' ACQUIRE_WITHIN_MS). */
  acquireWithinMs?: number;
  /** P5 O18 M2: the suites' seam for the log plane's uplink (uplink.ts' cap, reserve and ask wait). */
  uplink?: RelayContext['uplink'];
  /** The project registry: what the endpoint reads of the index (`mawsd` injects it); none, no record is signed. */
  projectsSource?: ProjectsSource;
};

/** The whole handshake of a direct connection is this long at most (M4). */
export const DIRECT_HANDSHAKE_MS = 10_000;

/** The org state is read again this often, besides at RL1's welcome and each `state` notice (M3). */
export const SYNC_EVERY_MS = 10 * 60_000;

/**
 * P5 O8 M6b (the desk track's review 632, P1): how many times `record.policy` through the local door reads the machine's
 * owners again when the head or certificates moved under the read, before it answers `unavailable`.
 */
const LOCAL_POLICY_READS = 3;

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
  /** Lane B's pending counts for the notifier, from the engine host's broker items. */
  readonly laneB: LaneBPending;
  /** The devices' channels, over either carrier (M4); M5–M8 set its routes. */
  readonly channels: Channels;
  /** Every remote request's decision (M5); M7 and M8 ask it too (a query's binding, a subscription's re-check). */
  readonly authorizer: Authorizer;
  /** The channel's `call`, `act` and `sub` routes behind the authorizer; M7 and M8 set its executors. */
  readonly gate: Gate;
  /** RL10 (M6): the sminos daemon's socket; its members are the records and checkouts authorization reads. */
  readonly rl10: Rl10;
  /** The checkouts a remote spawn may run in: RL10's projects' presences and MAWS's own projects. */
  readonly checkouts: CheckoutSource;
  /** Actions to their executing side (M7), and the endpoint's own under its ledger. */
  readonly actions: Actions;
  readonly own: EndpointActions;
  /** RL4's queries (M7), answered against the binding the executor stored. */
  readonly queries: Queries;
  /** Subscriptions (M8): the table, lane A's and lane B's planes, and the interest they report. */
  readonly subscriptions: Subscriptions;
  /** P5 O7 M3: the devices' streams (a terminal's bytes, a forwarded port's connections) and the forwards they name. */
  readonly streams: Streams;
  readonly forwards: Forwards;
  readonly planeA: PlaneA;
  readonly planeB: PlaneB;
  /** The feeds (P5 O7 M4): a session's `checkout` feed; the machine's `attention` feed (M6). */
  readonly planeFeeds: PlaneFeeds;
  /** Lane B sessions' checkout bounds, which the `checkout` rule and the `checkout` feed both read. */
  readonly checkoutBounds: CheckoutBounds;
  /** P5 O7 M5a: the `artifact` rule's placements per channel, which its decisions, `library.list` and the feed read. */
  readonly artifactRanks = new ArtifactRanks();
  /** P5 O7 M5a2 fix wave 1: what artifact answers say of sessions (session-safe.ts); set with the executors. */
  sessionSafe: SessionSafe | null = null;
  readonly interest: Interest;
  /** Remote reads (M8). */
  readonly calls: Calls;
  /** P5 O7 M5c: the client port across each channel (client-port.ts). */
  readonly clientPorts: ClientPorts;
  /** P5 O7 M5c: each channel's connector leases and Send to runs, re-authorized while they live (leases.ts). */
  readonly leases: Leases;
  /** P5 O7 M5c round 3: each channel's snapshot holds of a remote dashboard, re-authorized while they live (asset-holds.ts). */
  readonly assetHolds: AssetHolds;
  /** The project registry (registry.ts): the machine's projects record, the held records, and the services' seam. */
  readonly registry: Registry;
  /** The project registry's M12: `maws`'s read of the org's projects, the registry's own (Interfaces §H's RegistryRead). */
  get registryRead(): RegistryRead {
    return this.registry;
  }
  /**
   * The UX wave (U9, M2): whether the machine's ceiling, as its policy stands now, refuses a session started from another
   * machine in `mode`: what the services hold a fork from another machine to where they allocate it (mawsd hands it them).
   */
  aboveCeiling(mode: string): boolean {
    return aboveCeiling(mode, this.policy.current(), this.#settingsMode);
  }
  /** P5 O8 M6b: the local door, this machine's own app's record acts and policy read, served by `mawsd` (local-door.ts). */
  readonly local: LocalDoor;
  /** The machine's `defaultMode`, which a `settings` ceiling reads (the user's settings, or a suite's). */
  readonly #settingsMode: () => string;
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
  /** The highest version a `state` notice announced while the head is short of it (`#syncTo`); 0 when none is. */
  #target = 0;
  /** `stop()` was called: nothing in flight then (a sync, an adoption) opens the link or a timer again. */
  #stopped = false;
  /** Records the hub refused for now, tried again while the connection lasts. */
  readonly #retries = new RecordRetries();
  /** The changes of the enrollment begun, one after another (`EnrollContext.lifecycle`). */
  #lifecycle: Promise<unknown> = Promise.resolve();
  /**
   * 2026-11-06: e2e:remote's endpoint of an earlier build (MAWS_E2E=1 alone): the capabilities MAWS_E2E_ENDPOINT_WITHOUT
   * names, a comma list, withheld from its `h2`, so a scene meets a device's old-peer path against this build.
   */
  readonly #withheld: ReadonlySet<string>;

  constructor(options: EndpointOptions = {}) {
    this.#options = options;
    const env = options.env ?? process.env;
    this.#withheld = new Set(env.MAWS_E2E === '1' ? (env.MAWS_E2E_ENDPOINT_WITHOUT ?? '').split(',').filter(Boolean) : []);
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
          this.registry.hubWelcomed();
          void this.syncNow();
          void this.endpointRecords.issue();
          void this.listings.welcome().then(() => this.notifier.welcome());
        },
        ended: () => {
          this.links.hub = { connected: false };
          this.#retries.clear();
          this.#target = 0;
          this.registry.hubEnded();
        },
        projects: (frame) => this.registry.hubFrame(frame),
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
    this.laneB = new LaneBPending({
      dispatch: (owner, name, input) => {
        if (this.#services === null) return Promise.reject(new Error('the endpoint has not started'));
        return this.#services.dispatch(owner, name, input);
      },
      notifier: this.notifier,
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
      machineOwners: () => this.#machineOwners(),
      dispatch: (owner, name, input) => {
        if (this.#services === null) return Promise.reject(new Error('the endpoint has not started'));
        return this.#services.dispatch(owner, name, input);
      },
      hold: (reason) => this.#services?.hold(reason) ?? (() => {}), // U9: the listing rule's reads, an operation's hold
      behind: () => void this.#syncAfter(),
      // P5 O8 M7b: lane A's to-human entries, to the project channel's journal in the spine
      channel: { record: (entry) => this.#services?.channel.record(entry) },
      now: this.deps.now,
      log,
      ...(options.uplink === undefined ? {} : { uplink: options.uplink }),
      ...(options.authorization?.offers === undefined ? {} : { offers: options.authorization.offers }), // P5 O8 M6b: the welcome's `record`
      registry: { directory: () => this.registry.directory() },
    });
    this.registry = new Registry({
      ref: () => (this.#services?.machine.ref ?? '') as MachineRef,
      enrollment: () => {
        const enrollment = this.#state?.enrolled ? this.#state.enrollment : null;
        return enrollment === null ? null : { org: enrollment.org, name: enrollment.name };
      },
      key: () => records.key(),
      head: () => records.head(),
      now: this.deps.now,
      hub: { send: (frame) => this.hub.send(frame), capabilities: () => this.hub.capabilities },
      sminos: () => this.rl10.sminosView(),
      source: options.projectsSource ?? null,
      state: () => this.#state,
      restate: () => void this.rl10.restate(),
      locationsKept: (gen, ms) => this.rl10.locationsKept(gen, ms),
      log,
    });
    this.rl10.onLink((connected) => {
      if (connected) this.registry.sminosLinked();
      this.registry.knownMoved();
    });
    this.rl10.onProjects(() => this.registry.knownMoved());
    this.channels = new Channels({
      identity: () => this.#identity(),
      org: () => (this.#identity() === null ? null : this.#org),
      adopt: (states, transitions) => this.#org?.adopt(states, transitions) ?? Promise.resolve(),
      rights: (member) => this.#rights(member),
      hold: (reason, standing?: boolean) => this.#services?.hold(reason, standing) ?? (() => {}),
      counts: (counts) => (this.links.channels = counts),
      log,
      now: this.deps.now,
      pingMs: options.pingMs,
      refreshed: () => {
        this.planeFeeds.rightsMoved(); // P5 O7 M5c: the `artifacts` feeds' rights (an owner's sheet's events) read again
        this.artifactRanks.clear(); // P5 O7 M5a: a `caps` refresh drops every artifact placement
        this.streams.recheck();
      },
      admitted: (channel) => this.clientPorts.admit(channel), // P5 O7 M5c
    });
    this.clientPorts = new ClientPorts({ services: () => this.#services, log });
    this.hub.setChannels(this.channels.relay(this.hub));
    const authorization = options.authorization ?? {};
    const home = authorization.home;
    this.checkoutBounds = new CheckoutBounds(home === undefined ? undefined : () => [home]);
    this.checkouts = authorization.checkouts ?? (options.projects === undefined ? this.rl10.members : anyCheckout(this.rl10.members, options.projects));
    const setupHome = authorization.setup;
    const setup = new MachineSetup(setupHome === undefined ? undefined : () => setupHome); // P5 O7 M9: the authorizer's and the folder list's
    this.#settingsMode = authorization.settingsMode ?? (() => settingsDefaultMode(homedir()));
    this.authorizer = new Authorizer({
      ref: () => this.#services?.machine.ref ?? null,
      org: () => {
        const org = this.#org;
        return org?.ready ? { head: org.head().state, certificates: org.certificates(), tooOld: org.actionsRefusal() !== null } : null;
      },
      rights: (member) => this.#rights(member),
      policy: () => this.policy.current(),
      settingsMode: this.#settingsMode,
      records: authorization.records ?? this.rl10.members,
      checkouts: this.checkouts,
      checkoutBounds: this.checkoutBounds,
      artifacts: this.artifactRanks,
      leases: { lease: (client, leaseId) => this.leases.lease(client, leaseId), run: (client, runId) => this.leases.run(client, runId) }, // P5 O7 M5c
      dispatch: (...request) => {
        if (this.#services === null) return Promise.reject(new Error('the endpoint has not started'));
        return this.#services.dispatch(...request);
      },
      log: (line) => log(line),
      webauthn: {
        origin: () => this.#webOrigin(),
        counter: (credentialId) => this.#state?.webauthn[credentialId] ?? 0,
        setCounter: (credentialId, counter) => this.#state?.setWebAuthn({ ...this.#state.webauthn, [credentialId]: counter }),
      },
      stamp: () => this.#state?.ledger,
      setup,
      sminos: () => this.rl10.sminosCapabilities(), // P5 O8 M6b: the record acts, while sminos advertises `record`
      members: this.rl10.members, // P5 O8 M6b: the `record` rule's lane B placement
      offers: authorization.offers,
      gradeOf: authorization.gradeOf,
      registry: authorization.registry,
    });
    this.gate = new Gate({ authorize: (request, who, now) => this.authorizer.authorize(request, who, now), now: this.deps.now, log });
    // A channel's request names its asker (P5 O7 M2: the channel's `ClientRef`), which goes on as given.
    const dispatch: EndpointServices['dispatch'] = (...request) => {
      if (this.#services === null) return Promise.reject(new Error('the endpoint has not started'));
      return this.#services.dispatch(...request);
    };
    // P5 O8 M6b: where a lane B listing's record is, one way for `record.policy` and the record acts (desk 632 P2)
    const placeListingRecord = (appSessionId: string) => placeRecord(appSessionId, { dispatch, log, members: this.rl10.members });
    this.leases = new Leases({
      authorize: (request, who, now) => this.authorizer.authorize(request, who, now),
      dispatch,
      artifacts: this.artifactRanks,
      now: this.deps.now,
      log,
      recheckRetryMs: options.subscriptions?.recheckRetryMs,
    });
    this.assetHolds = new AssetHolds({
      authorize: (request, who, now) => this.authorizer.authorize(request, who, now),
      dispatch,
      artifacts: this.artifactRanks,
      now: this.deps.now,
      log,
      recheckRetryMs: options.subscriptions?.recheckRetryMs,
    });
    this.own = new EndpointActions({
      stateDir: () => {
        if (this.#services === null) throw new Error('the endpoint has not started');
        return this.#services.machine.stateDir;
      },
      grant: (value) => this.#grant(value),
      deliver: (states, transitions) => this.#deliver(states, transitions),
      openForward: async (who, port) => {
        // The act was decided before this ran: the sender's `shell` is decided again now, and the forward made in the same
        // step as that answer, so a grant ended meanwhile makes none (a later end removes it at its re-check).
        const made = await this.streams.decide('forward.open', who, { ...who, clientClass: 'native-mac' }, () => this.forwards.open(who, port));
        if (!made.ok) return { ok: false, error: { code: made.reason } };
        if (made.value === null) return { ok: false, error: { code: 'busy' } };
        return { ok: true, value: { forward: made.value.id, port } };
      },
      holdForward: (device, forward, channel) => void this.forwards.hold(device, forward, channel),
      // P5 O17 M9a: `machine.browserControl`'s epoch, read from `mawsd`'s route as the act runs (none before the start)
      browserInventory: (appSessionId) => this.#services?.browser.inventory(appSessionId as AppSessionId) ?? { epoch: '', state: 'unavailable' },
      now: this.deps.now,
      log: (line) => log(line),
    });
    // P5 O7 M5a2 fix wave 1: what artifact answers say of sessions, one projection for the calls, the acts and the queries.
    const sessionSafe = new SessionSafe({ ranks: (member) => this.authorizer.ranks(member, this.deps.now()) });
    this.sessionSafe = sessionSafe;
    this.actions = new Actions({
      sessionSafe,
      freshness: new Freshness(),
      own: this.own,
      rl10: this.rl10,
      dispatch,
      hold: (reason, standing?: boolean) => this.#services?.hold(reason, standing) ?? (() => {}),
      engineHostLedger: (closed) => (this.#engineHostLedger = closed),
      offers: authorization.offers,
      leases: this.leases, // P5 O7 M5c
      now: this.deps.now,
      log,
    });
    this.queries = new Queries({
      sessionSafe,
      authorize: (request, who, now) => this.authorizer.authorize(request, who, now),
      own: this.own,
      rl10: this.rl10,
      dispatch,
      engineHostLedger: (closed) => (this.#engineHostLedger = closed),
      // P5 O8 M6b: a record act's lane B session, as the members join holds it
      placeSminos: (session) => {
        const app = this.rl10.members.get(session)?.lane === 'B' ? this.rl10.members.appSessionId(session) : null;
        return app === null ? { lane: 'A', session } : { lane: 'B', session, appSessionId: app };
      },
      now: this.deps.now,
      log,
    });
    this.rl10.onResult((result) => this.actions.result(result));
    const seams = options.subscriptions ?? {};
    this.forwards = new Forwards({ log, resumeMs: seams.resumeMs });
    this.streams = new Streams({
      activity: () => this.#services?.activity?.(), // P5 Decision Log 273
      authorize: (request, who, now) => this.authorizer.authorize(request, who, now),
      dispatch,
      // P5 O7 M5b: an `http` read open's request, to the machine's artifact endpoint (read when asked: a suite may replace it).
      artifacts: {
        fetch: (request) => (this.#services === null ? Promise.reject(new Error('the endpoint has not started')) : this.#services.artifacts.fetch(request)),
      },
      // P5 O7 M5b: a `document` read open's channel, in the endpoint's range (read when asked, as above).
      documents: {
        open: (message) => this.#services?.documents.open(message) ?? false,
        close: (channel) => this.#services?.documents.close(channel),
        frame: (channel, bytes) => this.#services?.documents.frame(channel, bytes) ?? false,
      },
      // P5 O17 M9a: a `browser.screencast` read open's subscription, to `mawsd`'s feed seam (read when asked, as above).
      browser: {
        open: (input, sink) => (this.#services === null ? Promise.reject(new Error('the endpoint has not started')) : this.#services.browser.open(input, sink)),
      },
      own: this.own,
      forwards: this.forwards,
      now: this.deps.now,
      log,
      resumeMs: seams.resumeMs,
      recheckRetryMs: seams.recheckRetryMs,
      transmitDeadlineMs: seams.transmitDeadlineMs,
    });
    const recordSource = authorization.records ?? this.rl10.members;
    // P5 O7 M5a: before the subscriptions' re-check (registered below), so a feed re-checked on the change reads afresh.
    // P5 O7 M5b: then every read stream whose decision the change moved is authorized again.
    this.#unseam.push(
      recordSource.onChange((target) => {
        this.artifactRanks.dropSession(target);
        this.streams.accessMoved();
      }),
    );
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
    // P5 O8 M7b fix wave: the channel's cursors, under a key in the endpoint's own state (channel-cursors.ts).
    const channelCursors = new ChannelCursors(() => {
      if (this.#state === null) throw new Error('the endpoint has not started');
      return this.#state.subdirectory('channel');
    });
    this.planeFeeds = new PlaneFeeds({
      dispatch,
      bounds: this.checkoutBounds,
      ranks: (member) => this.authorizer.ranks(member, this.deps.now()),
      artifacts: this.artifactRanks,
      leases: this.leases,
      browser: () => this.#services?.browser ?? null, // P5 O17 M9a: a session's `browser.inventory` feed
      cursors: channelCursors, // P5 O8 M7b fix wave: its entries' cursors, history's too
      owners: () => this.#ownersRead(), // P5 O8 M6a: whose reading a `session.changed` carries as it is
      log,
      backlogBytes: seams.backlogBytes,
    });
    this.rl10.onSession((message) => this.planeA.message(message));
    this.rl10.onPending((project, raised) => this.planeA.pendingSet(project, raised));
    this.rl10.onLink((connected) => connected || this.planeA.linkLost());
    this.subscriptions = new Subscriptions({
      recheckRetryMs: seams.recheckRetryMs,
      transmitDeadlineMs: seams.transmitDeadlineMs,
      authorize: (request, who, now) => this.authorizer.authorize(request, who, now),
      planes: { A: this.planeA, B: this.planeB, feeds: this.planeFeeds },
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
      members: () => this.#heldSessions(),
      records: recordSource,
      machineOwners: () => this.#machineOwners(),
      recordFor: (report) => this.listings.recordFor(report),
      recordSays: (listingId) => this.rl10.members.recordSays(listingId), // U9: a lane B listing follows its record
      ranks: (member) => this.authorizer.ranks(member, this.deps.now()),
      sessionSafe,
      leases: this.leases, // P5 O7 M5c
      artifacts: this.artifactRanks,
      assetHolds: this.assetHolds, // P5 O7 M5c round 3
      offers: authorization.offers,
      now: this.deps.now, // P5 O7 M5c review 1: an acquisition's bound, on the gate's clock
      ...(options.acquireWithinMs === undefined ? {} : { acquireWithinMs: options.acquireWithinMs }),
      engineHostLists: (capability) => this.#services?.engineHostLists(capability) ?? false, // P5 O7 M8
      setup,
      cursors: channelCursors,
      readerMoved: (member, appSessionId) => this.planeFeeds.readerMoved(member, appSessionId), // P5 O8 M6a: their other devices
      sminos: () => this.rl10.sminosCapabilities(), // P5 O8 M6b: `record.policy`
      placeRecord: placeListingRecord, // the record acts' placement (desk 632 P2)
      grants: (member) => this.#grants({ member }), // P5 O8 M4b
      log,
    });
    this.gate.setExecutors({
      act: (channel, m, decision) => this.actions.execute(channel, m, decision),
      call: (channel, m, decision) => this.calls.execute(channel, m, decision),
      sub: (channel, m, decision) => this.subscriptions.start(channel, m, decision),
      subRefused: (channel, m, reason) => this.subscriptions.refused(channel, m, reason),
      actRefused: (channel, m, reason) => this.actions.refused(channel, m, reason), // P5 O7 M5c review 1
    });
    const { sub: gatedSub, ...gated } = this.gate.routes();
    this.channels.setRoutes({
      ...gated,
      act: (channel, m) => this.actions.receive(channel, m, gated.act),
      query: (channel, m) => this.queries.route(channel, m),
      sub: (channel, m) => this.subscriptions.receive(channel, m, gatedSub),
      credit: (channel, m) => this.subscriptions.credit(channel, m),
      unsub: (channel, m) => this.subscriptions.unsub(channel, m),
      stream: (channel, m) => this.streams.receive(channel, m),
      clientAnswer: (channel, m) => this.clientPorts.answer(channel, m), // P5 O7 M5c
    });
    // P5 O8 M6b: an act through the local door takes a channel's route once the door's own checks passed
    this.local = new LocalDoor({
      head: () => (this.#org?.ready ? this.#org.head().state : null),
      certificates: () => (this.#org?.ready ? this.#org.certificates() : NO_CERTIFICATES), // P5 O8 M4b: a grant's verification
      now: this.deps.now,
      act: (channel, m) => this.actions.receive(channel, m, gated.act),
      policy: (input) => this.#localPolicy(input, authorization.records ?? this.rl10.members, placeListingRecord),
      grants: async () => (await this.#grants('owners'))(), // P5 O8 M4b: as the machine's owners' member
      log,
    });
  }

  /** The machine's sessions as sminos reports them, each with the id it is listed under (null: not yet) and its target. */
  #heldSessions(): HeldSession[] {
    return this.rl10.members.sessions().flatMap((session) => {
      const member = this.rl10.members.get(session);
      if (member === null) return [];
      const listingId = this.rl10.members.listingId(session);
      const target: SessionTarget = member.lane === 'A' ? { lane: 'A', session } : { lane: 'B', session, appSessionId: listingId ?? '' };
      return [{ member, listingId, target }];
    });
  }

  /**
   * P5 O8 M6b: `record.policy` through the local door, as the machine's owners' member (P5 Decision Log 36's local
   * reader): the sessions any of the machine's owners owns (record-policy.ts). The desk track's review 632: the owners are
   * those of the head and certificates the answer goes under (P1: a head that moved while they were read is read again,
   * up to LOCAL_POLICY_READS times, then `unavailable`), each lane B listing is read on the record its acts change (P2,
   * `place`), and sminos is as it stands when the answer goes (P3).
   */
  async #localPolicy(input: unknown, records: RecordSource, place: (appSessionId: string) => Promise<RecordPlacement>): Promise<DoorCallAnswer> {
    const before = unsupported(this.rl10.sminosCapabilities());
    if (before !== null) return before;
    const named = typeof input === 'object' && input !== null && typeof (input as { session?: unknown }).session === 'string' ? (input as { session: string }).session : undefined;
    for (let reads = 0; reads < LOCAL_POLICY_READS; reads++) {
      const read = this.#ownersRead();
      const owners = await read.owners;
      const placed = await placeListings(this.#heldSessions(), place, named);
      if (!read.stands()) continue;
      // from here to the answer in one step: the head, the certificates and sminos as they are when it goes
      const now = unsupported(this.rl10.sminosCapabilities());
      if (now !== null) return now;
      const owned = (target: SessionTarget) => {
        const record = records.record(target);
        return owners.some((owner) => owns(record, owner, owners));
      };
      return { ok: true, output: { supported: true, policies: policies(this.#heldSessions(), placed, owned, named) } };
    }
    this.#services?.log(`endpoint: a local record.policy found the machine's owners moved under each of ${LOCAL_POLICY_READS} reads; answered unavailable`);
    return { ok: false, code: 'unavailable' };
  }

  async start(services: EndpointServices): Promise<void> {
    this.#services = services;
    const log = (line: string) => services.log(line);
    const state = EndpointState.open(services.machine.stateDir, { log, now: this.deps.now });
    const org = new EndpointOrg(state, { log, now: this.deps.now });
    org.onAdopted((change) => this.#adopted(change));
    org.onCertificates(() => {
      // P5 O7 M5b: a certificate set moves every decision taken under the one before (the machine's owners read through it),
      // so the streams are held and authorized again at once, as at a `caps` refresh, the artifact placements dropped first;
      // and every subscription and resumable cursor, as at a new head (the desk track's certificates parity).
      this.artifactRanks.clear();
      this.streams.recheck();
      this.subscriptions.recheck();
      void this.#judge();
      void this.rl10.adopted();
      this.registry.adopted();
    });
    this.#state = state;
    this.#org = org;
    // What notify told the hub before a restart, read before anything below feeds it.
    this.notifier.restore();
    // Lane B's live events and their availability (none at start; an app's attachment, or P5 O3-D's permanent link), for
    // the subscriptions; its events and each engine-host link, for notify's counts.
    this.#unseam.push(
      services.onEvent((owner, message) => {
        this.#artifactEvent(owner, message); // P5 O7 M5a: a relink, or a linked session's new placement, first
        this.planeB.event(owner, message);
        this.planeFeeds.event(owner, message);
        this.calls.event(owner, message); // P5 O7 M6: a record moved under an `each-session` call in flight
        // U9: a lane B session's listing follows its record (archived, its title)
        if (owner === 'machine' && message.name === 'session.changed') void this.rl10.members.recordChanged((message.payload as { record?: unknown } | null)?.record);
        this.sessionSafe?.event(owner, message); // P5 O7 M5a2: a record moved under an artifact answer being told
        this.laneB.event(owner, message);
        this.streams.event(owner, message);
      }),
      // P5 O7 M3: a pty's output, for the terminal streams reading it; P5 O7 M5b: a document channel's frames and its end,
      // for the document stream on it (the endpoint's range carries nothing else).
      services.onFrame((frame) => (frame.owner === 'pty-host' ? this.streams.frame(frame) : this.streams.documentFrame(frame.channel, frame.bytes))),
      services.documents.onClosed((channel, reason) => this.streams.documentClosed(channel, reason)),
      services.onAttachment((attached) => this.planeB.attachment(attached)),
      // the project registry: the index's declared rows moved (a row, a statement, the index loaded)
      this.#options.projectsSource?.onChange(() => this.registry.own.kick()) ?? (() => {}),
      services.onUpstream((link) => {
        if (!link.connected) return this.assetHolds.upstreamLost(); // P5 O7 M5c round 3: the host released its connection's holds

        this.laneB.restate();
        this.planeB.relinked(); // P5 O3-D D41: each streaming of the link, every subscription catches up from its cursor
      }),
    );
    if (state.refusing !== null) return;
    // A provisioning interrupted mid-set (O14 M1) is whole again before anything below reads the directory.
    await completeProvisioning(state, org, log, () => this.rl10.forgetRecords());
    this.own.open();
    if (state.machineKey !== null) {
      try {
        this.#key = await importSigningKey(state.machineKey.jwk);
      } catch (error) {
        log(`endpoint: refusing its state: the machine key in ${services.machine.stateDir} does not import: ${(error as Error).message}`); // no `import (` in a string: the bundle guard reads one as a dynamic import
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
    this.registry.statementsMoved();
    this.registry.adopted(); // the held records read from the file count once verified again (M9's review 1, F4)
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#retries.clear();
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    // No action more; those in flight record their results first (up to 2 s), then the subscriptions and channels close.
    await this.actions.stop();
    this.subscriptions.stop();
    this.streams.stop();
    this.forwards.stop();
    this.leases.stop(); // P5 O7 M5c
    this.assetHolds.stop(); // P5 O7 M5c round 3: every snapshot hold released on the engine host
    for (const off of this.#unseam.splice(0)) off();
    // Each channel's sealed `restart` goes out before the carriers end: the hub link and the listener close after.
    await this.channels.closeAll('restart');
    await this.#direct?.stop();
    this.links.listener = { bound: false };
    this.rl10.members.stop();
    await this.rl10.unserve();
    await this.hub.stop();
    this.registry.stop();
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

  /** The enrollment held (`machine.identity`'s project id, P5 O3-D D38); null while unenrolled, a pending provisioning included. */
  enrollment(): EnrollmentState | null {
    return this.#state?.enrolled ? current(this.#state) : null;
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
        this.registry.statementsMoved();
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
    this.registry.statementsMoved();
    return result;
  }

  /** Reads the hub's org state now (one at a time); a failure is logged and waits for the next. */
  syncNow(): Promise<unknown> {
    const parts = this.parts;
    if (parts === null || !parts.state.enrolled || this.#stopped) return Promise.resolve();
    if (this.#syncing !== null) return this.#syncing;
    const release = parts.services.hold('the hub sync'); // P5 Decision Log 273: work to the daemon, which collects over none
    this.#syncing = syncAndPromote(this.enrollContext()).finally(() => {
      release();
      this.#syncing = null;
      // Judged again after every read: a delegation that expired since the last change is noticed here.
      void this.#judge();
      this.#ensureLink();
    });
    return this.#syncing;
  }

  /** A read of the hub's org state that begins after this call (`#syncAfter`): `mawsd endpoint sync`'s (P5 O7 M10). */
  syncAfter(): Promise<unknown> {
    return this.#syncAfter();
  }

  /** P5 O8 M4b: `endpoint.grants` for `reader`, judged as its answer goes (grants.ts' `grantsAnswer`). */
  #grants(reader: GrantsReader): Promise<() => GrantsResult> {
    return grantsAnswer(() => this.#grantsRead(), () => this.#state?.ledger ?? null, reader, (line) => this.#services?.log(line));
  }

  /** The machine's owners under the head held now, with that head (null: none held). */
  #grantsRead(): GrantsRead {
    const org = this.#org;
    return { head: org?.ready ? org.head().state : null, ...this.#ownersRead() };
  }

  /** P5 O8 M6a: the machine's owners under the head held now, and whether that head and its certificates still stand. */
  #ownersRead(): OwnersRead {
    const org = this.#org;
    const head = org?.ready ? org.head() : null;
    const certificates = org?.ready ? org.certificates() : null;
    return { owners: this.#machineOwners(), stands: () => (org?.ready ? org.head() : null) === head && (org?.ready ? org.certificates() : null) === certificates && this.#org === org };
  }

  /** The machine's owners as member ids, as the head and certificates give them now; none before the endpoint starts. */
  #machineOwners(): Promise<string[]> {
    const org = this.#org;
    if (!org?.ready || this.#services === null) return Promise.resolve([]);
    return machineOwnerMembers(org.head().state, org.certificates(), this.#services.machine.ref, new Date(this.deps.now()));
  }

  /**
   * A read that begins after this call, for RL10's held events (`Rl10Context.behind`): one in flight may have begun
   * before the certificate they wait on was stored, so another follows it. Asks while it waits share that one.
   */
  #syncAfter(): Promise<unknown> {
    const syncing = this.#syncing;
    if (syncing === null) return this.syncNow();
    const read = () => this.syncNow();
    return syncing.then(read, read);
  }

  /**
   * A `state {version}` notice: read until the head reaches `version` (a read in flight may have begun before it). A head
   * still short of it after that, the read having failed or served less, is read again on the link's backoff
   * (`#retries`, key `sync`), toward the highest version announced, until the head reaches it or the link ends; the next
   * welcome reads anyway, and the periodic read stays the backstop. A revocation is a new version, so this is how one
   * reaches the endpoint when its first read fails. Notices are unsigned: one the hub can't serve costs a read per step
   * of the backoff while the link lasts, and holds nothing back.
   */
  async #syncTo(version: number): Promise<void> {
    this.#target = Math.max(this.#target, version);
    await this.syncNow();
    if (this.#short()) await this.syncNow();
    this.#chase();
  }

  /** Whether the head is short of the version a notice announced. */
  #short(): boolean {
    const org = this.#org;
    return this.#target > 0 && (org?.ready !== true || org.head().state.version < this.#target);
  }

  /**
   * The `sync` retry waiting while the head is short of the target and the endpoint runs enrolled; settled otherwise.
   * Whatever adoption reaches the target settles it (`#adopted`): an admin's delivery or a channel's catch-up as well.
   */
  #chase(): void {
    if (!this.#short() || this.#stopped || this.#state?.enrolled !== true) {
      this.#target = 0;
      this.#retries.settle('sync');
      return;
    }
    const again = () => this.#chase();
    this.#retries.retry('sync', () => (this.#short() ? void this.syncNow().then(again, again) : again()));
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
    else if (refusal.frame === 'projects') this.#retries.retry('projects', () => void this.registry.own.resend());
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
    return { ref: this.#services.machine.ref, key: this.#key, build: this.#options.build ?? 'unknown', capabilities: ENDPOINT_CAPABILITIES.filter((c) => !this.#withheld.has(c)) };
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

  /**
   * P5 O7 M5a: what the machine says that changes an artifact's placement: its relink (`artifacts.changed {linked}`), or
   * a session's record in the spine's index (its engine session, or its first one).
   */
  #artifactEvent(owner: string, message: { name: string; payload: unknown }): void {
    const payload = message.payload as { artifactId?: unknown; change?: unknown; record?: { appId?: unknown } } | null;
    // Every change but a write's (`updated`, which moves neither the artifact's existence nor its links: a write that
    // links its session says `linked` too) changes what `library.entry` answers: a relink, a delete, a create.
    if (owner === 'engine-host' && message.name === 'artifacts.changed' && payload?.change !== 'updated' && typeof payload?.artifactId === 'string') {
      this.artifactRanks.drop(payload.artifactId);
      this.streams.accessMoved(); // P5 O7 M5b: a read stream on it decided again, its placement read afresh
    }
    if (owner === 'machine' && message.name === 'session.changed' && typeof payload?.record?.appId === 'string') {
      this.artifactRanks.dropSession(payload.record.appId);
      this.streams.accessMoved();
    }
  }

  /** A new head is on disk: end what it took away. Channels, listings and RL10 (M3–M6) subscribe beside this. */
  #adopted(change: OrgChange): void {
    const parts = this.parts;
    if (parts === null) return;
    this.artifactRanks.clear(); // P5 O7 M5a: before anything re-checks under the new head
    // Removal closes at once, before anything else hears of the new head (M4): the machine's own standing first, then
    // each device's.
    if (!this.#plainlyStands(change.head)) {
      this.#judgments++;
      this.#stand(false);
    }
    this.channels.adopted(change.head.state);
    // A notice's read chased no further than this head (`#chase`).
    if (this.#target > 0 && !this.#short()) this.#chase();
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
    // The held projects records verified again under the new head, and the machine's own built again.
    this.registry.adopted();
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
    this.registry.statementsMoved();
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
