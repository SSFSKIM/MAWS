// P3-HD M1: the host-memory observation cache behind route D (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// "Source truth and lifetime"; P3 co-work Decision Log 98 (1)-(3) and (9)). Route E's mcp_status reads (./calls.ts) are
// observed here before their answers are discarded; nothing else populates it, nothing persists it, and main's going
// clears it (./register.ts). An engine's exit does not: the last observation is what lets a page refresh with no
// engine live, until main detaches.
//
// - An observation is one complete report of one launch (`ConnectorLaunchContext`: the launch's directory and the
//   environment MAWS attests it handed that engine: the launch plan's environment with the env of the flag settings
//   MAWS passed over it, as the engine applies settings env over its process environment; never a settings file;
//   and the local-scope key the host captured before the spawn, ./local-key.ts). A launch's newer report replaces its older one,
//   removals included; an answer to an older request, or from a launch its session has since replaced, never lands;
//   `clear` invalidates every observation begun before it. Session and launch bookkeeping is bounded: past it the cache
//   saturates (every answer unavailable, nothing more tracked) until main reattaches.
// - Reports are grouped by launch context (config file and cwd). For one server, every report of a context must agree:
//   one identity (scope, source label, visible configuration) and no report omitting or disabling it. A contradiction
//   is sticky until the attachment resets; there is no latest-launch precedence. A context whose newer report is
//   malformed or past a bound fails closed, and past the context bound the cache refuses rather than evicts.
// - Retained: identity digests (keyed per attachment, so a header value is never recoverable from one), tool names
//   with their readOnly annotation, observation times and the launch reference. Never a header, env, args or OAuth
//   field of a report or a file.
// - A server becomes a `VerifiedConnectorSource` at each use, never once: the scope must be user or local (local only
//   where every agreeing launch captured one and the same identified `projects` key), the launch must name one file,
//   the one literal entry the scope names there must reproduce the reported visible fields and give the whole entry one
//   meaning under every agreeing launch (./source-entry.ts).
//   A lookup that any mutation of the cache overtakes while it reads starts again from the cache as it is then (a
//   bounded number of times, then unavailable), so a suspended lookup never answers what a fresh one would not; a
//   clear makes it unavailable. `readEntry` returns the whole entry for MAWS's own instance, transiently; this module
//   keeps none of it.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { McpStatusResponse } from '@shared/wire/control';
import type { ConnectorLocalKey } from './local-key';
import { connectorFingerprint } from './status';
import {
  CONFIG_FILE_MAX_BYTES,
  canonicalJson,
  configFileOf,
  legacyConfigFileOf,
  locateEntry,
  materializeEntry,
  nodeSourceFiles,
  reportedVisible,
  SDK_ENVIRONMENT_KEYS,
  type ConnectorLaunchEntry,
  type ConnectorSourceRefusal,
  type ConnectorTransport,
  type SourceFiles,
  type VisibleConfig,
} from './source-entry';

export type { ConnectorLaunchEntry, ConnectorSourceRefusal } from './source-entry';

// The launch facts an engine was started with, captured from its launch plan (EngineSession.connectorLaunchContext).
// `environment` holds only the SDK-minimal keys MAWS's own instance is started with (./source-entry.ts), as the launch
// attests them: the plan's values with the string env of the flag settings MAWS passed over them, the engine applying
// settings env over its process environment. No other launch variable is retained (entries are literal-only, so none
// is expanded). The config file and the engine's legacy file are selected from the plan's environment at capture
// (settings never move the config home); `localKey` is what the host captured before the spawn. Host memory only:
// never serialized, journaled or sent over IPC.
export interface ConnectorLaunchContext {
  readonly appSessionId: string;
  readonly launchId: string;
  readonly cwd: string; // the attested spawn cwd
  readonly configFile: string | null; // the file user scope lives in, or null when the launch names none
  readonly legacyConfigFile: string | null; // the engine's legacy file, which would win over it when present
  readonly environment: Readonly<Record<string, string>>;
  readonly localKey: ConnectorLocalKey;
}

export function connectorLaunchContext(facts: { appSessionId: string; launchId: string; cwd: string; environment: Readonly<Record<string, string>>; flagSettings?: Readonly<Record<string, unknown>>; localKey?: ConnectorLocalKey }): ConnectorLaunchContext {
  const flagEnv = typeof facts.flagSettings?.env === 'object' && facts.flagSettings.env !== null && !Array.isArray(facts.flagSettings.env) ? (facts.flagSettings.env as Record<string, unknown>) : {};
  const attested: Record<string, unknown> = { ...facts.environment, ...flagEnv };
  const environment = Object.freeze(Object.fromEntries(SDK_ENVIRONMENT_KEYS.flatMap((key) => (typeof attested[key] === 'string' ? [[key, attested[key]]] : []))));
  const localKey = facts.localKey ?? { kind: 'unidentified', why: 'notCaptured' };
  return Object.freeze({ appSessionId: facts.appSessionId, launchId: facts.launchId, cwd: facts.cwd, configFile: configFileOf(facts.environment), legacyConfigFile: legacyConfigFileOf(facts.environment), environment, localKey });
}

// A fingerprint-matched entry located in the one file the engine's reported scope and the launch context name. Host
// memory only; `sourceId` is opaque and authorizes nothing. `generation` changes whenever the server's observed
// meaning in its context changes; `entryDigest` whenever the whole entry (omitted fields included) does.
export interface VerifiedConnectorSource {
  readonly sourceId: string;
  readonly generation: number;
  readonly cwd: string;
  readonly server: string;
  readonly scope: 'user' | 'local' | 'app'; // app: host-attested owner delivery only (configured-delivery.ts)
  readonly transport: ConnectorTransport;
  readonly url?: string; // http: the resource URL, as the engine reports it
  readonly path: string; // the config file
  readonly entryPath: readonly string[]; // the JSON location in it
  readonly observedAt: string; // the latest agreeing report
  readonly entryDigest: string;
}

// The tool as H's grant identifies it; `readOnly` null when no agreeing report listed it (a needs-auth server's tools
// are learned by the owner's discovery, never assumed).
export interface ConnectorObservedTool {
  readonly fingerprint: string;
  readonly readOnly: boolean | null;
}

export type ConnectorSourceAnswer = { ok: true; source: VerifiedConnectorSource } | { ok: false; why: ConnectorSourceRefusal };
export type ConnectorToolAnswer = { ok: true; source: VerifiedConnectorSource; tool: ConnectorObservedTool } | { ok: false; why: ConnectorSourceRefusal };
// P3-HD M2: `readEntryForWrite`'s `stillValid`, synchronous, answers whether the cache still stands behind the entry exactly as this lookup
// verified it, so route D's last check at the actual transport write needs no await (the lookup's own fence ends when
// its promise settles). It holds across a newer report or another launch that only repeats the same facts (an engine
// appearing for the same source: the next call picks route E, this one is not cancelled); it fails for a clear, a
// contradiction, the server's changed meaning, a failed or refused context, saturation, another config home reporting
// the server there, or an agreeing launch with other launch facts, every one of which a fresh lookup would re-judge.
export type ConnectorEntryAnswer = { ok: true; source: VerifiedConnectorSource; entry: ConnectorLaunchEntry } | { ok: false; why: ConnectorSourceRefusal };
export type ConnectorWriteEntryAnswer = (Extract<ConnectorEntryAnswer, { ok: true }> & { stillValid: () => boolean }) | Extract<ConnectorEntryAnswer, { ok: false }>;

// `launches`: sessions and launches tracked for replacement (current plus replaced), across every context.
export const CONNECTOR_STATUS_BOUNDS = { contexts: 128, serversPerContext: 256, launchesPerContext: 64, toolsPerServer: 1024, launches: 1024 } as const;
// fresh attempts of one lookup the cache keeps changing under
const VERIFY_ATTEMPTS = 3;

// One mcp_status request's place in its launch's order, taken before the request is written.
export interface ConnectorStatusTicket {
  readonly epoch: number;
  readonly seq: number;
  readonly context: ConnectorLaunchContext;
}

export interface ConnectorStatusCacheOptions {
  files?: SourceFiles;
  now?: () => Date;
}

// Statuses that attest the reported configuration (needs-auth included: the owner's first Connect starts from it), and
// those that attest nothing either way. Every other status, a future one included, counts against the server.
const POSITIVE = new Set(['connected', 'needs-auth']);
const NEUTRAL = new Set(['pending', 'cached', 'failed', 'needs-approval']);

type Observation =
  | { kind: 'positive'; identity: string; scope: string | null; source: string | null; transport: ConnectorTransport | null; argsReported: boolean; tools: ReadonlyMap<string, boolean> }
  | { kind: 'negative' | 'neutral' | 'conflicted' };
type Positive = Extract<Observation, { kind: 'positive' }>;
const NEGATIVE: Observation = { kind: 'negative' };

interface Snapshot {
  readonly seq: number;
  readonly observedAt: string;
  readonly context: ConnectorLaunchContext;
  readonly servers: ReadonlyMap<string, Observation>;
}

interface ContextState {
  readonly key: string;
  readonly cwd: string;
  readonly configFile: string | null;
  readonly snapshots: Map<string, Snapshot>; // by launch
  names: ReadonlySet<string>; // every server any of its reports named
  failed: boolean;
  readonly contested: Set<string>;
  readonly summaries: Map<string, string>;
  readonly revisions: Map<string, number>;
}

// `relevant` (P3-HD M2): what of a launch's facts the verified entry's materialization reads, for the write's proof
type Verified = { source: VerifiedConnectorSource; entry: ConnectorLaunchEntry; visible: VisibleConfig; observation: Positive; positives: Positive[]; relevant: (context: ConnectorLaunchContext) => string };
const OVERTAKEN = Symbol('overtaken'); // a lookup some change of the cache overtook: start again

const launchKeyOf = (context: ConnectorLaunchContext) => `${context.appSessionId}\0${context.launchId}`;
const contextKeyOf = (context: ConnectorLaunchContext) => `${context.configFile ?? ''}\0${context.cwd}`;
// P3-F L245: what a local-scope meaning takes from a captured key: the `projects` key string the engine reads, however it
// was found (a directory before `git init`, a repository after); an unidentified capture matches no key and is refused.
const keyMeaning = (localKey: ConnectorLocalKey): string | ConnectorLocalKey => (localKey.kind === 'unidentified' ? localKey : localKey.key);
const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

export class ConnectorStatusCache {
  private readonly files: SourceFiles;
  private readonly now: () => Date;
  private version = 0; // moves with every change a lookup's answer can depend on
  private key = randomBytes(32);
  private epoch = 0;
  private seq = 0;
  private generation = 0;
  private saturated = false; // past the bound of refused directories too: every answer unavailable until reset
  private readonly refused = new Set<string>(); // directories a context could not be admitted for
  private readonly contexts = new Map<string, ContextState>();
  private readonly current = new Map<string, string>(); // a session's latest launch
  private readonly retired = new Set<string>(); // launches their session replaced
  private readonly sources = new Map<string, { readonly meaning: string; readonly sourceId: string; readonly generation: number }>();

  constructor(options: ConnectorStatusCacheOptions = {}) {
    this.files = options.files ?? nodeSourceFiles;
    this.now = options.now ?? (() => new Date());
  }

  begin(context: ConnectorLaunchContext): ConnectorStatusTicket {
    const ticket = { epoch: this.epoch, seq: ++this.seq, context };
    this.track(context.appSessionId, context.launchId, true);
    return ticket;
  }

  // P3-HD panel correction: a session's launch is now `launchId` (the host's process table changed rows). A session
  // already tracked has its earlier launch retired at once, so that launch's pending answer never lands even before
  // the replacement requests anything; an untracked session is not tracked by this alone.
  launched(appSessionId: string, launchId: string): void {
    this.track(appSessionId, launchId, false);
  }

  private track(appSessionId: string, launchId: string, add: boolean): void {
    if (this.saturated) return; // refused at observe; nothing more is tracked
    const latest = this.current.get(appSessionId);
    if (latest === undefined && !add) return;
    const replacing = latest !== undefined && latest !== launchId;
    const added = (replacing ? 1 : 0) + (latest === undefined ? 1 : 0);
    if (this.current.size + this.retired.size + added > CONNECTOR_STATUS_BOUNDS.launches) {
      this.saturate();
      return;
    }
    if (replacing) this.retired.add(`${appSessionId}\0${latest}`);
    if (!this.retired.has(`${appSessionId}\0${launchId}`)) this.current.set(appSessionId, launchId);
  }

  // A complete successful report of the ticket's launch.
  observe(ticket: ConnectorStatusTicket, answer: McpStatusResponse): void {
    const state = this.admit(ticket);
    if (!state) return;
    const servers = this.parse(answer, ticket.context);
    const launch = launchKeyOf(ticket.context);
    if (servers === null || (!state.snapshots.has(launch) && state.snapshots.size >= CONNECTOR_STATUS_BOUNDS.launchesPerContext)) return this.fail(state);
    const names = new Set([...state.names, ...servers.keys()]);
    if (names.size > CONNECTOR_STATUS_BOUNDS.serversPerContext) return this.fail(state);
    state.snapshots.set(launch, { seq: ticket.seq, observedAt: this.now().toISOString(), context: ticket.context, servers });
    state.names = names;
    for (const name of names) this.settle(state, name);
    this.version += 1;
  }

  // A report of the ticket's launch that failed its schema: its context fails closed.
  reject(ticket: ConnectorStatusTicket): void {
    const state = this.admit(ticket);
    if (state) this.fail(state);
  }

  // The three lookups return `lookup`'s own promise (no further await or `then` of theirs), so the fence's last check is
  // synchronous with their completion.
  resolveSource(cwd: string, server: string): Promise<ConnectorSourceAnswer> {
    return this.lookup(cwd, server, (verified): ConnectorSourceAnswer => ({ ok: true, source: verified.source }));
  }

  resolve(cwd: string, server: string, tool: string): Promise<ConnectorToolAnswer> {
    return this.lookup(cwd, server, ({ source, visible, observation, positives }): ConnectorToolAnswer => {
      const config = visible.transport === 'stdio' ? { type: 'stdio', command: visible.command, ...(observation.argsReported && { args: visible.args }) } : { type: 'http', url: visible.url };
      const listed = positives.map((positive) => positive.tools.get(tool)).filter((readOnly): readOnly is boolean => readOnly !== undefined);
      return { ok: true, source, tool: { fingerprint: connectorFingerprint({ name: server, scope: observation.scope, config }, tool), readOnly: listed.length === 0 ? null : listed.every(Boolean) } };
    });
  }

  // The whole entry of a source resolved earlier, re-read and re-matched now; `changed` if its meaning moved since.
  readEntry(source: VerifiedConnectorSource): Promise<ConnectorEntryAnswer> {
    return this.lookup(source.cwd, source.server, (verified): ConnectorEntryAnswer =>
      verified.source.sourceId !== source.sourceId || verified.source.generation !== source.generation ? { ok: false, why: 'changed' } : { ok: true, source: verified.source, entry: verified.entry },
    );
  }

  // P3-HD M2: `readEntry` for route D's write, with its synchronous `stillValid` (above).
  readEntryForWrite(source: VerifiedConnectorSource): Promise<ConnectorWriteEntryAnswer> {
    return this.lookup(source.cwd, source.server, (verified): ConnectorWriteEntryAnswer => {
      if (verified.source.sourceId !== source.sourceId || verified.source.generation !== source.generation) return { ok: false, why: 'changed' };
      // taken in the same synchronous step as the lookup's completion fence, so nothing lands between them (a clear
      // forgets the minted source id, and a later lookup mints another)
      const standing = this.standing(source.cwd, source.server, verified.relevant);
      const stillValid = () => standing !== null && this.standing(source.cwd, source.server, verified.relevant) === standing;
      return { ok: true, source: verified.source, entry: verified.entry, stillValid };
    });
  }

  // P4-B5: the servers an owner's delivery may look up for `tool`, from memory alone and verified by nothing: per
  // directory, every server some positive report of a context names (a failed context, a refused directory and a
  // contested server excluded), whether an agreeing report lists `tool`, and whether one reported it over HTTP. Each is
  // still resolved (`resolveSource`) before it is offered; a directory two config homes report stays the lookup's to refuse.
  candidates(tool: string): { cwd: string; server: string; listed: boolean; http: boolean }[] {
    if (this.saturated) return [];
    const found = new Map<string, { cwd: string; server: string; listed: boolean; http: boolean }>();
    for (const state of this.contexts.values()) {
      if (state.failed || this.refused.has(state.cwd)) continue;
      for (const server of state.names) {
        if (state.contested.has(server)) continue;
        for (const snapshot of state.snapshots.values()) {
          const observation = snapshot.servers.get(server);
          if (observation?.kind !== 'positive') continue;
          const key = `${state.cwd}\0${server}`;
          const entry = found.get(key) ?? { cwd: state.cwd, server, listed: false, http: false };
          entry.listed ||= observation.tools.has(tool);
          entry.http ||= observation.transport === 'http';
          found.set(key, entry);
        }
      }
    }
    return [...found.values()];
  }

  // Main detached, or the host shuts down: every observation goes, and nothing begun before lands.
  clear(): void {
    this.epoch += 1;
    this.version += 1;
    this.key = randomBytes(32);
    this.saturated = false;
    this.refused.clear();
    this.contexts.clear();
    this.current.clear();
    this.retired.clear();
    this.sources.clear();
  }

  private admit(ticket: ConnectorStatusTicket): ContextState | null {
    const launch = launchKeyOf(ticket.context);
    if (ticket.epoch !== this.epoch || this.saturated || this.retired.has(launch)) return null;
    const key = contextKeyOf(ticket.context);
    let state = this.contexts.get(key);
    if (!state) {
      if (this.contexts.size >= CONNECTOR_STATUS_BOUNDS.contexts) {
        // refused, never evicted; its directory's answers are unavailable (the refused report could have contradicted
        // another config home's there) until main reattaches
        if (this.refused.size >= CONNECTOR_STATUS_BOUNDS.contexts) this.saturate();
        else if (!this.refused.has(ticket.context.cwd)) {
          this.refused.add(ticket.context.cwd);
          this.version += 1;
        }
        return null;
      }
      state = { key, cwd: ticket.context.cwd, configFile: ticket.context.configFile, snapshots: new Map(), names: new Set(), failed: false, contested: new Set(), summaries: new Map(), revisions: new Map() };
      this.contexts.set(key, state);
    }
    const previous = state.snapshots.get(launch);
    return previous && previous.seq > ticket.seq ? null : state; // a newer request of this launch already answered
  }

  private fail(state: ContextState): void {
    state.failed = true;
    this.version += 1;
  }

  // Every answer unavailable and nothing more tracked (`begin` stops at the flag), until `clear`; stale tickets stay
  // refused (by the saturation, then by the epoch).
  private saturate(): void {
    this.saturated = true;
    this.version += 1;
  }

  // null: past a bound
  private parse(answer: McpStatusResponse, context: ConnectorLaunchContext): Map<string, Observation> | null {
    if (answer.mcpServers.length > CONNECTOR_STATUS_BOUNDS.serversPerContext) return null;
    const servers = new Map<string, Observation>();
    for (const entry of answer.mcpServers as Record<string, unknown>[]) {
      const name = entry.name as string;
      if (servers.has(name)) {
        servers.set(name, { kind: 'conflicted' });
        continue;
      }
      const observation = this.observation(entry, context);
      if (observation === null) return null;
      servers.set(name, observation);
    }
    return servers;
  }

  private observation(entry: Record<string, unknown>, context: ConnectorLaunchContext): Observation | null {
    const status = entry.status as string;
    if (NEUTRAL.has(status)) return { kind: 'neutral' };
    if (!POSITIVE.has(status)) return NEGATIVE; // disabled, blocked, excluded, or a status this build does not know
    const tools = new Map<string, boolean>();
    if (Array.isArray(entry.tools)) {
      if (entry.tools.length > CONNECTOR_STATUS_BOUNDS.toolsPerServer) return null;
      for (const tool of entry.tools) {
        const fields = record(tool);
        if (typeof fields?.name !== 'string') continue;
        tools.set(fields.name, (tools.get(fields.name) ?? true) && record(fields.annotations)?.readOnly === true);
      }
    }
    const config = record(entry.config);
    const scope = typeof entry.scope === 'string' ? entry.scope : null;
    const source = typeof entry.source === 'string' ? entry.source : null;
    const visible = reportedVisible(entry.config);
    const shape = visible ?? ['unsupported', typeof config?.type === 'string' ? config.type : null];
    return { kind: 'positive', identity: this.identity(scope, source, shape, context.localKey), scope, source, transport: visible?.transport ?? null, argsReported: Array.isArray(config?.args), tools };
  }

  // One server across a context's reports: contested (sticky) on any disagreement; its revision moves with its meaning.
  private settle(state: ContextState, name: string): void {
    const identities = new Set<string>();
    let negative = false;
    for (const snapshot of state.snapshots.values()) {
      const observation = snapshot.servers.get(name) ?? NEGATIVE; // every report is complete: absent counts against
      if (observation.kind === 'positive') identities.add(observation.identity);
      else if (observation.kind === 'negative') negative = true;
      else if (observation.kind === 'conflicted') state.contested.add(name);
    }
    if (identities.size > 1 || (identities.size > 0 && negative)) state.contested.add(name);
    const summary = `${[...identities].sort().join(',')}|${negative}|${state.contested.has(name)}`;
    if (state.summaries.get(name) === summary) return;
    state.summaries.set(name, summary);
    state.revisions.set(name, (state.revisions.get(name) ?? 0) + 1);
  }

  // One logical lookup: the attachment it began in is the only one it answers for (a clear at any point is
  // unavailable, a retry never adopts the new epoch), and an answer stands only if nothing changed between the attempt's
  // start and this method's completion, `answer` running synchronously before it returns.
  private async lookup<T>(cwd: string, server: string, answer: (verified: Verified) => T): Promise<T | { ok: false; why: ConnectorSourceRefusal }> {
    const epoch = this.epoch;
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
      const version = this.version;
      const verified = await this.verifyOnce(cwd, server, epoch);
      if (this.epoch !== epoch) return { ok: false, why: 'unavailable' };
      if (verified === OVERTAKEN || this.version !== version) continue;
      return typeof verified === 'string' ? { ok: false, why: verified } : answer(verified);
    }
    return { ok: false, why: 'unavailable' };
  }

  private async verifyOnce(cwd: string, server: string, epoch: number): Promise<Verified | ConnectorSourceRefusal | typeof OVERTAKEN> {
    if (this.epoch !== epoch) return 'unavailable';
    if (this.saturated || this.refused.has(cwd)) return 'unavailable';
    const states = [...this.contexts.values()].filter((state) => state.cwd === cwd);
    if (states.length === 0) return 'unobserved';
    if (states.some((state) => state.failed)) return 'unavailable';
    if (states.some((state) => state.contested.has(server))) return 'ambiguous';
    const holding = states
      .map((state) => ({ state, positives: [...state.snapshots.values()].flatMap((snapshot) => { const observation = snapshot.servers.get(server); return observation?.kind === 'positive' ? [{ snapshot, observation }] : []; }) }))
      .filter((held) => held.positives.length > 0);
    if (holding.length === 0) return 'unobserved';
    if (holding.length > 1) return 'ambiguous'; // two config homes report it at this directory: two files, no precedence
    const { state, positives } = holding[0]!;
    const observation = positives[0]!.observation; // every positive of an uncontested server has this identity
    if (observation.transport === null || (observation.scope !== 'user' && observation.scope !== 'local')) return 'engineOnly';
    const scope = observation.scope;
    // Local scope: the `projects` key every agreeing launch captured before its spawn; an unidentified one, or two
    // launches that captured different keys (a repository made or removed between them), are never resolved further.
    let key = cwd;
    if (scope === 'local') {
      const keys = positives.map(({ snapshot }) => snapshot.context.localKey);
      if (keys.some((captured) => captured.kind === 'unidentified')) return 'unidentified';
      const named = new Set(keys.map((captured) => (captured as { key: string }).key));
      if (named.size > 1) return 'ambiguous';
      key = [...named][0]!;
    }
    // every agreeing launch's legacy file (one config file can be named by CLAUDE_CONFIG_DIR in one launch, HOME in another)
    const legacies = [...new Set(positives.map(({ snapshot }) => snapshot.context.legacyConfigFile))];
    if (state.configFile === null || legacies.includes(null)) return 'unidentified';

    const version = this.version;
    const revision = state.revisions.get(server);
    // after every await: a clear is unavailable; any other change of the cache starts the lookup again
    const moved = (): ConnectorSourceRefusal | typeof OVERTAKEN | null => (this.epoch !== epoch ? 'unavailable' : this.version !== version ? OVERTAKEN : null);
    let text: string | null;
    let legacyPresent: boolean;
    try {
      legacyPresent = (await Promise.all(legacies.map((legacy) => this.files.exists(legacy!)))).includes(true);
      text = legacyPresent ? null : await this.files.read(state.configFile, CONFIG_FILE_MAX_BYTES);
    } catch {
      return moved() ?? 'unavailable';
    }
    const stale = moved();
    if (stale) return stale;
    if (legacyPresent) return 'unidentified'; // the engine may have read its legacy file instead
    if (text === null) return 'changed';
    let file: unknown;
    try {
      file = JSON.parse(text);
    } catch {
      return 'unavailable';
    }
    const located = locateEntry(file, scope, key, server);
    if (located === 'changed') return 'changed';

    let made: { visible: VisibleConfig; launch: ConnectorLaunchEntry } | undefined;
    let entryDigest: string | undefined;
    for (const { snapshot } of positives) {
      const environment = snapshot.context.environment;
      const result = await materializeEntry(located.entry, environment, cwd, this.files);
      const after = moved();
      if (after) return after;
      if (typeof result === 'string') return result;
      if (this.identity(observation.scope, observation.source, result.visible, snapshot.context.localKey) !== observation.identity) return 'changed';
      const digest = this.mac(canonicalJson(result.launch));
      // The agreeing launches would run it differently (another PATH or SDK-minimal key the configured env does not
      // override): an established contradiction, sticky like a reported one until the attachment resets.
      if (entryDigest !== undefined && digest !== entryDigest) return this.contest(state, server);
      entryDigest = digest;
      made ??= result;
    }
    const { visible, launch } = made!;
    const meaning = `${observation.identity}\0${revision}\0${scope === 'local' ? key : ''}`;
    const sourceKey = `${state.key}\0${server}`;
    let known = this.sources.get(sourceKey);
    if (known?.meaning !== meaning) {
      known = { meaning, sourceId: randomUUID(), generation: ++this.generation };
      this.sources.set(sourceKey, known);
    }
    const observedAt = positives.map(({ snapshot }) => snapshot.observedAt).sort().at(-1)!;
    const source: VerifiedConnectorSource = {
      sourceId: known.sourceId, generation: known.generation, cwd, server, scope, transport: visible.transport, ...(visible.transport === 'http' && { url: visible.url }),
      path: state.configFile, entryPath: located.entryPath, observedAt, entryDigest: entryDigest!,
    };
    return { source, entry: launch, visible, observation, positives: positives.map((positive) => positive.observation), relevant: this.relevance(scope, visible.transport, located.entry) };
  }

  // P3-HD M2 start: what a verified answer for `server` at `cwd` rests on in the cache's memory, without the file: null
  // when a fresh lookup would refuse it from memory alone. Every fact verifyOnce reads before its file read is here
  // (saturation, a refused directory, a failed context, a contest, which context holds it positively, that context's
  // revision of the server, the source id it minted) with the launch facts the entry's materialization reads (each
  // agreeing launch's `relevant` projection), as a set: a launch that differs only in facts the entry never reads adds
  // none, so it neither invalidates a call nor is let through where a fresh lookup would give the entry two meanings.
  private standing(cwd: string, server: string, relevant: (context: ConnectorLaunchContext) => string): string | null {
    if (this.saturated || this.refused.has(cwd)) return null;
    const states = [...this.contexts.values()].filter((state) => state.cwd === cwd);
    if (states.some((state) => state.failed || state.contested.has(server))) return null;
    const holding = states.filter((state) => [...state.snapshots.values()].some((snapshot) => snapshot.servers.get(server)?.kind === 'positive'));
    if (holding.length !== 1) return null;
    const state = holding[0]!;
    const known = this.sources.get(`${state.key}\0${server}`);
    if (!known) return null;
    const facts = new Set<string>();
    for (const snapshot of state.snapshots.values()) {
      if (snapshot.servers.get(server)?.kind !== 'positive') continue;
      facts.add(this.mac(relevant(snapshot.context)));
    }
    return canonicalJson([state.key, state.revisions.get(server) ?? 0, known.sourceId, known.generation, [...facts].sort()]);
  }

  // The launch facts a verified entry's meaning depends on (./source-entry.ts materializeEntry and the lookup above):
  // the legacy file every launch is checked for; for local scope the captured key; for stdio the SDK-minimal keys its
  // configured env does not set, as materialization reads them. An HTTP entry reads no launch variable.
  private relevance(scope: 'user' | 'local', transport: ConnectorTransport, entry: Record<string, unknown>): (context: ConnectorLaunchContext) => string {
    const stdio = transport === 'stdio';
    const configured = new Set(stdio && record(entry.env) ? Object.keys(entry.env as Record<string, unknown>) : []);
    const read = stdio ? SDK_ENVIRONMENT_KEYS.filter((key) => !configured.has(key)) : [];
    return (context) => {
      const environment = Object.fromEntries(read.flatMap((key) => { const value = context.environment[key]; return typeof value === 'string' && !value.startsWith('()') ? [[key, value]] : []; }));
      return canonicalJson([context.legacyConfigFile, scope === 'local' ? keyMeaning(context.localKey) : null, environment]);
    };
  }
  // P3-HD M2 end

  // A local-scope identity includes the `projects` key its launch captured, so two launches that captured different keys
  // contradict each other at observation, stickily; a user-scope identity never carries one.
  private identity(scope: string | null, source: string | null, shape: unknown, localKey: ConnectorLocalKey): string {
    return this.mac(canonicalJson(['maws.connector-source/1', scope, source, shape, scope === 'local' ? keyMeaning(localKey) : null]));
  }

  private contest(state: ContextState, name: string): 'ambiguous' {
    state.contested.add(name);
    this.settle(state, name);
    this.version += 1;
    return 'ambiguous';
  }

  private mac(text: string): string {
    return createHmac('sha256', this.key).update(text).digest('hex');
  }
}
