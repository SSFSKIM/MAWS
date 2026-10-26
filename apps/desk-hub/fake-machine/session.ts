// One session's depth as the fake machine serves it: DX4's producer rules over a replayed timeline. It keeps what the
// bridge's endpoint keeps (each message still streaming, per block, with its watermark; the subagent tree; the last
// usage) and what the daemon reads from disk (each transcript's rows so far), and serves subscriptions from them:
//
// - subscribe before snapshot: a subscription takes the bridge's state and joins the live stream in one step, then
//   reads its rows (a wait in which the replay may go on: `duringSnapshot`), sends the snapshot, and then what arrived
//   meanwhile, dropping rows the snapshot holds (by uuid) and chunks at or below their message's watermark;
// - a block leaves the snapshot state when its `block-row` is applied, and its whole message at its step's end (DX5's
//   child does the same), so an aborted block reaches no later subscriber;
// - `step-end` follows every `block-row` of its step, since the timeline keeps the bridge's order; a step still open
//   when its turn ends gets one then;
// - a main-scope subscription carries every agent's chunks, `block-row`s, and `step-end`s, the tree, and `usage`, and
//   its own transcript's rows; an agent-scope one carries that agent's alone;
// - as a DC8 producer (`producer: 'dc8'`), the tree is DX4's widened `subagents` body — each agent's status and what it
//   rests on, the loop's jobs, its MCP names (jobs.ts) — derived again whenever a row, the bridge's agent state, or the
//   session's presence changes, and sent whenever it changed (an agent-scope subscription carries that agent's own
//   loop's jobs and MCP names); an agent joins the tree at its spawn, a seed naming it, or its first row, whichever
//   comes first; and `output` is answered from the recording's `tasks/`;
// - a subscription outlives the replayed session: it stays open, idle, answering `rows` and `output` (DX4, "History and
//   ended sessions").
import { randomUUID } from 'node:crypto';
import { join, posix } from 'node:path';
import { isOutputTail, isTaskId } from '../src/protocol/browser';
import type { JsonObject } from '../src/protocol/json';
import { loadRoutes } from './routes';
// The MW1 live check's recording (dx4/README.md): imported, as the route table is, for the bundled command.
import mw1 from './dx4/mw1-reads.json' with { type: 'json' };
// And MW2's (dx4/README.md).
import mw2 from './dx4/mw2-ops.json' with { type: 'json' };
// And MW3's (dx4/README.md).
import mw3 from './dx4/mw3-scoped.json' with { type: 'json' };
// And MW4's (dx4/README.md).
import mw4 from './dx4/mw4-agents.json' with { type: 'json' };
// And MW5's (dx4/README.md).
import mw5 from './dx4/mw5-media.json' with { type: 'json' };
import type { Catalog, Capabilities, ConfigRead, MediaOpBody, ControlCapabilities, McpRead, PermissionUpdate, SettingsRead, UsageRead, Job, ReadAnswer, SessionBodies, SessionMessage, SessionPresence, StatusRead, Streaming, StreamingBlock, SubagentMeta, SubscriptionKind, Usage } from '../src/protocol/session';
import type { SuggestionScope } from '../src/protocol/rpc';
import { derive, fileFacts, LoopIndex, loopJobs, stopNote, type Body, type BridgeAgent, type Derivation } from './jobs';
import { answerOutput, type Locate } from './output';
import type { Recording, Row, Step } from './recording';

/**
 * Which daemon the fake machine stands for. `dc8` carries DX4's widened `subagents` body (status, evidence, the bridge's
 * spawn, the rows' outcome, file facts), `jobs` and `mcp`, and answers `output`; `dc3`, as DC3 built it, sends each
 * agent's id and meta alone and passes `output` by, as a daemon older than DC8 does. `m0` is a daemon and bridge at the
 * desk control surface's M0 (sminos `M0_SMINOS`), everything `dc8` does and more: each bridged session's presence
 * carries its `capabilities` (but a stale session's, whose mod loaded before the update), the machine presence its
 * `desk`, a `read status` is answered on the sub, and a `command` RPC runs (`commands.ts`); an older producer sends
 * neither field and passes `read` by. `m1` adds the pushed catalog; `mw1` (sminos `MW1_SMINOS`, the machine-side wave's
 * MW1) the reads of usage, config, settings and MCP, answered as the MW1 live check recorded them, and
 * `capabilities.controls`; `mw2` (sminos `MW2_SMINOS`) the side question (`btw`), answered as the MW2 live check
 * recorded it, and compact's `instructions`; `mw3` (sminos `MW3_SMINOS`) the scoped allows: a permission request
 * raised with the engine's suggestions, as the MW3 live check recorded them, and `decide`'s `scope` checked and applied
 * as the daemon does; `mw4` (sminos `MW4_SMINOS`) one subagent stopped or told (`stop-agent`, `tell`), checked against
 * the bridge's agent tree as the daemon checks it, the stop leaving the parent the note the MW4 live check recorded;
 * `mw5` (sminos `MW5_SMINOS`) image and PDF intake (`media`), answered `queued` and each attachment's states following as
 * `op`, as the MW5 live check recorded them.
 */
export type Producer = 'dc3' | 'dc8' | 'm0' | 'm1' | 'mw1' | 'mw2' | 'mw3' | 'mw4' | 'mw5';

const LEVEL: Record<Producer, number> = { dc3: 0, dc8: 1, m0: 2, m1: 3, mw1: 4, mw2: 5, mw3: 6, mw4: 7, mw5: 8 };

/** Whether `producer` does what `level` added. */
export const producerAtLeast = (producer: Producer, level: Producer): boolean => LEVEL[producer] >= LEVEL[level];

/** The sminos version of the desk control surface's M0 (one minor past 1.6.3, the spec's Plan of Work). */
export const M0_SMINOS = '1.7.0';
export const M1_SMINOS = '1.8.0';

/** An M0 bridge's capabilities (DX5 `GET /status`), as the plane forwards them in presence. */
export const M0_CAPABILITIES: Capabilities = {
  sminos: M0_SMINOS,
  protocol: 2,
  engine: '2.1.307',
  ops: ['ping', 'steer', 'interrupt', 'stop', 'model', 'compact', 'deliver', 'answer', 'read', 'command'],
  reads: ['status'],
  routes: { measured: '2.1.307' },
};

export const M1_CAPABILITIES: Capabilities = { ...M0_CAPABILITIES, sminos: M1_SMINOS, reads: ['status', 'catalog'] };

/** The sminos version of the machine-side wave's MW1 (the reads, and `capabilities.controls`). */
export const MW1_SMINOS = '1.11.0';

/** What an MW1 bridge answers its four new reads with, as the MW1 live check recorded them on 2.1.310 (`usage-full` is
 * the answer to `{breakdown: 'full'}`; `mcp` carries the plane's disabled server). */
export const MW1_READS = mw1.reads as unknown as { usage: UsageRead; 'usage-full': UsageRead; config: ConfigRead; settings: SettingsRead; mcp: McpRead };

/** An MW1 bridge's capabilities: M1's, its new reads, and every control's capability as the live check's bridge said
 * them (the engine stays the table's 2.1.307, as the fake's `read status` says). */
export const MW1_CAPABILITIES: Capabilities = {
  ...M1_CAPABILITIES,
  sminos: MW1_SMINOS,
  reads: [...M1_CAPABILITIES.reads, 'usage', 'config', 'settings', 'mcp'],
  controls: mw1.capabilities.controls as ControlCapabilities,
};

const MW1_KINDS = new Set(['usage', 'config', 'settings', 'mcp']);

/** The sminos version of the machine-side wave's MW2 (the side question, compact's instructions). */
export const MW2_SMINOS = '1.12.0';

/** What the MW2 live check recorded of a side question (dx4/README.md): the bridge's answers when it was refused
 * (before the session's first model request) and started, and the `btw` events of the started one, in order. */
export const MW2_BTW = mw2.btw as unknown as { refused: JsonObject; started: JsonObject; events: JsonObject[]; prompt: string };

/** An MW2 bridge's capabilities: MW1's, its `btw` op, and every control's capability as the MW2 live check's bridge
 * said them (`btw` available). The engine and the route table stay 2.1.307, as MW1's do: the fake routes a `command`
 * by the vendored 2.1.307 table. */
export const MW2_CAPABILITIES: Capabilities = {
  ...MW1_CAPABILITIES,
  sminos: MW2_SMINOS,
  ops: [...MW1_CAPABILITIES.ops, 'btw'],
  controls: mw2.capabilities.controls as ControlCapabilities,
};

/** The sminos version of the machine-side wave's MW3 (the scoped allows). */
export const MW3_SMINOS = '1.13.0';

/**
 * What the MW3 live check recorded (dx4/README.md): each permission request the bridge raised with the engine's
 * suggestions, the scope a desk would send for it and the rule the daemon resolved and handed the engine (`session`, the
 * suggestion's own `localSettings`, a directory), and the request a guard beneath had restored, raised without them.
 */
export type ScopedRecording = { raised: { request: string; tool: string; input: JsonObject; suggestions?: PermissionUpdate[] }; scope: SuggestionScope; updatedPermissions: PermissionUpdate[] };
export const MW3_SCOPED = mw3 as unknown as { scoped: ScopedRecording[]; withheld: { raised: { request: string; tool: string; input: JsonObject } } };

/** An MW3 bridge's capabilities: MW2's, and every control's capability as the MW3 live check's bridge said them
 * (`decide.scope` and `decide.addDirectory` available). The engine and the route table stay 2.1.307, as MW1's do. */
export const MW3_CAPABILITIES: Capabilities = {
  ...MW2_CAPABILITIES,
  sminos: MW3_SMINOS,
  controls: mw3.capabilities.controls as ControlCapabilities,
};

/** The sminos version of the machine-side wave's MW4 (one subagent stopped or told). */
export const MW4_SMINOS = '1.14.0';

/**
 * What the MW4 live check recorded (dx4/README.md): a background agent's spawn as the bridge's child keeps it in the
 * tree (named by its Agent call, `bg-sleeper`), the bridge's answers to a stop by that name, by an id and of a foreground
 * agent, to a message, and to an agent no tree holds, the text the agent read, and the note its parent read.
 */
export type AgentAnswer = { ok: boolean; result?: JsonObject; error?: string; code?: string };
export const MW4_AGENTS = mw4 as unknown as {
  spawn: { agentId: string; parentAgentId: string | null; subagentType: string; description: string; name: string; background: boolean; model: string; toolUseId: string };
  stop: { byName: { asked: string; answer: AgentAnswer }; byId: { asked: string; answer: AgentAnswer }; foreground: { asked: string; answer: AgentAnswer }; again: AgentAnswer };
  tell: { asked: string; answer: AgentAnswer; read: string };
  unknown: { stop: AgentAnswer; tell: AgentAnswer; spaced: AgentAnswer };
  note: string;
};

/** The note an MW4 bridge leaves a stopped agent's parent, naming the agent as the person did (§9, as recorded). */
export const agentStopNote = (asked: string): string => MW4_AGENTS.note.replace(MW4_AGENTS.stop.byName.asked, asked);

/** An MW4 bridge's capabilities: MW3's, its `stop-agent` and `tell` ops, and every control's capability as the MW4 live
 * check's bridge said them (`stop-agent` and `tell` available). The engine and the route table stay 2.1.307. */
export const MW4_CAPABILITIES: Capabilities = {
  ...MW3_CAPABILITIES,
  sminos: MW4_SMINOS,
  ops: [...MW3_CAPABILITIES.ops, 'stop-agent', 'tell'],
  controls: mw4.capabilities.controls as ControlCapabilities,
};

/** The sminos version of the machine-side wave's MW5 (image and PDF intake). */
export const MW5_SMINOS = '1.15.0';

/**
 * What the MW5 live check recorded (dx4/README.md): an idle upload of a PNG and a PDF answered `queued` and every `op`
 * body it sent, in order (each attachment `read`, then `forwarded`, the last `phase: 'end'`); the ends of an upload whose
 * Read the desk denied (`failed`), of one whose first attachment Esc stopped mid-step (`aborted`, the second read in the
 * person's next turn), and of a claim a reload found without a result (`aborted`, `indeterminate after reload`); and the
 * bridge's wake and prelude.
 */
export const MW5_MEDIA = mw5 as unknown as {
  queued: { state: 'done'; result: { queued: true; upload: string; intake: 'native-read'; root: string; paths: string[] } };
  states: MediaOpBody[];
  failed: MediaOpBody;
  aborted: MediaOpBody;
  indeterminate: MediaOpBody;
  wake: string;
  prelude: string;
};

/** An MW5 bridge's capabilities: MW4's, its `media` op, and every control's capability as the MW5 live check's bridge
 * said them (`media` available). The engine and the route table stay 2.1.307. */
export const MW5_CAPABILITIES: Capabilities = {
  ...MW4_CAPABILITIES,
  sminos: MW5_SMINOS,
  ops: [...MW4_CAPABILITIES.ops, 'media'],
  controls: mw5.capabilities.controls as ControlCapabilities,
};

/** The sminos version, and the bridge's capabilities, that `producer` stands for. */
export const sminosOf = (producer: Producer): string =>
  producerAtLeast(producer, 'mw5') ? MW5_SMINOS : producerAtLeast(producer, 'mw4') ? MW4_SMINOS : producerAtLeast(producer, 'mw3') ? MW3_SMINOS : producerAtLeast(producer, 'mw2') ? MW2_SMINOS : producerAtLeast(producer, 'mw1') ? MW1_SMINOS : producerAtLeast(producer, 'm1') ? M1_SMINOS : M0_SMINOS;
const capabilitiesOf = (producer: Producer): Capabilities =>
  producerAtLeast(producer, 'mw5')
    ? MW5_CAPABILITIES
    : producerAtLeast(producer, 'mw4')
    ? MW4_CAPABILITIES
    : producerAtLeast(producer, 'mw3')
    ? MW3_CAPABILITIES
    : producerAtLeast(producer, 'mw2')
      ? MW2_CAPABILITIES
      : producerAtLeast(producer, 'mw1')
        ? MW1_CAPABILITIES
        : producerAtLeast(producer, 'm1')
          ? M1_CAPABILITIES
          : M0_CAPABILITIES;

/** The per-uid temporary root the recordings' engine wrote task outputs under (macOS, uid 501): `<resolved tmp>/claude-<uid>`. */
export const ENGINE_TMP = '/private/tmp/claude-501';

/** The engine's project slug of a path (SPEC §35.2.1): every character but a letter or a digit becomes `-`. */
const slugOf = (path: string) => path.replace(/[^A-Za-z0-9]/g, '-');

type Live = {
  turnId: string;
  agentId: string | null;
  step: number;
  model?: string;
  upTo: number;
  blocks: Map<number, StreamingBlock>;
  settled: Set<number>;
  /** The last chunk applied, kept to replay an overlap (`overlap`). */
  last: SessionBodies['chunk'] | null;
};

type Out = { [K in SubscriptionKind]: { kind: K; body: SessionBodies[K] } }[SubscriptionKind];

type Sub = {
  agentId: string | null;
  n: number;
  ready: boolean;
  queue: Out[];
  /** Rows the snapshot held, and each streaming message's watermark in it: what the live part drops. */
  held: Set<string>;
  marks: Map<string, number>;
};

/** The plugin a session's bridge and ask run in: doperpowers before the sminos plugin existed, sminos from its 1.0.0. */
export type BridgePlugin = 'doperpowers' | 'sminos';

export type SnapshotOptions = {
  /** Runs while the snapshot is being built, after the subscription joined the live stream and before its rows are
   * read: what happens here (the replay going on) reaches the subscriber after the snapshot, never inside it twice. */
  duringSnapshot?: () => Promise<void>;
  /** Also hands the live part what the snapshot already holds — its newest row, and each streaming message's last
   * chunk — as a transcript tail that started before the read would: the watermark and the row ids must drop them. */
  overlap?: boolean;
  /** About how many bytes of rows the snapshot carries (SNAPSHOT_ROW_BUDGET by default); older rows come as pages. */
  budget?: number;
};

const BLOCK_KINDS: Record<string, StreamingBlock['kind']> = { text: 'text', thinking: 'thinking', redacted_thinking: 'thinking', tool: 'tool', input: 'tool' };

const keyOf = (m: { turnId: string; agentId: string | null; step: number }) => `${m.turnId}\u0000${m.agentId ?? ''}\u0000${m.step}`;

/** About as much as one snapshot carries of rows, in bytes of JSON: older rows come as `rows` pages. */
export const SNAPSHOT_ROW_BUDGET = 256 * 1024;

export class SessionDepth {
  /** Rows on disk so far, per transcript (`main` and each agent), oldest first. */
  readonly rows = new Map<string, Row[]>();
  private readonly live = new Map<string, Live>();
  private readonly ended = new Set<string>();
  private readonly tree = new Map<string, JsonObject>();
  private readonly subs = new Map<string, Sub>();
  /** Each transcript's index (`main` and each agent), fed as its rows reach the disk, and its bytes so far. */
  private readonly indexes = new Map<string, { index: LoopIndex; bytes: number }>();
  /** The bridge's agent state: its snapshot's or a resync's `agents`, each `agent` spawn and stop applied. */
  private readonly bridgeAgents = new Map<string, BridgeAgent>();
  /** The widened body as last derived (a DC8 producer's), and its JSON, to send only what changed. */
  private body: Body | null = null;
  private bodyJson = '';
  /** Each subscribed agent's own jobs and MCP names as last sent, as JSON. */
  private readonly agentBodies = new Map<string, string>();
  private record: JsonObject | null = { status: 'idle', waitingFor: null, needs: null };
  usage: Usage | null = null;
  /** The main loop's turn running now, or null. */
  mainTurn: string | null = null;
  /** Stops run before a crash whose TaskStop rows the replay has not reached yet (`restoreStop`). */
  private readonly stopsToRestore = new Set<string>();
  /** Agent stops run before a crash, by id: the spelling asked, and whether the replay has written the note yet (`restoreAgentStop`). */
  private readonly restoredAgentStops = new Map<string, { asked: string; isNoted: boolean }>();

  constructor(
    readonly id: string,
    private readonly recording: Recording | null,
    private readonly send: (message: SessionMessage) => void,
    private readonly where: { project: string; machine: string },
    readonly bridge = true,
    /** The branch its working-tree diff is taken against (DX4 `diff`'s `base`). */
    readonly diffBase = 'main',
    readonly producer: Producer = 'dc3',
    /** The plugin its bridge runs in, whose name its appended rows carry (`FakeMachineOptions.plugin`). */
    readonly plugin: BridgePlugin = 'doperpowers',
  ) {
    this.rows.set('main', []);
  }

  /** The session record's `status`, `waitingFor` and `needs`, or null once its process is gone: from then on its
   * agents and jobs without a terminal word are `exited`. */
  get presence(): JsonObject | null {
    return this.record;
  }

  set presence(record: JsonObject | null) {
    this.record = record;
    this.refresh();
  }

  get cwd(): string | null {
    return this.recording?.cwd ?? null;
  }

  get diffText(): string {
    return this.recording?.diff ?? '';
  }

  /** A DC8 producer's or later: the widened `subagents` body, `jobs`, `mcp`, `output`. */
  private get widens(): boolean {
    return producerAtLeast(this.producer, 'dc8');
  }

  /**
   * The bridge's capabilities as an M0 producer's plane forwards them: absent without a bridge, from an older producer,
   * and while the session is `stale` (its mod loaded before its machine's update, until a reload).
   */
  get capabilities(): Capabilities | null {
    return this.bridge && producerAtLeast(this.producer, 'm0') && !this.stale ? capabilitiesOf(this.producer) : null;
  }

  /** The session's DX4 presence body: its record, whether it is bridged, and its bridge's capabilities when held. */
  presenceBody(): SessionPresence {
    const capabilities = this.capabilities;
    return { record: this.record, bridge: this.bridge, ...(capabilities && { capabilities }) };
  }

  /** The session's `read status` answer (an M0 bridge's `$`); a suite may put another in its place. */
  status: StatusRead = {
    version: { version: '2.1.307', base: '2.1.307' },
    model: null,
    cwd: '',
    root: '',
    repo: { remote: 'https://github.com/SSFSKIM/MAWS.git', branch: 'main' },
    surfaces: ['cli'],
    override: null,
  };

  /**
   * Answers a browser's `read` on the subscription (an M0 producer; an older one passes it by): `status` from the bridge
   * on a main-scope subscription, `catalog` from an M1 one, `usage` (the full count when `args.breakdown` is `full`),
   * `config`, `settings` and `mcp` from an MW1 one, every other kind and scope an error, as the plane answers them.
   */
  read(sub: string, id: string, what: string, args?: JsonObject): void {
    const s = this.subs.get(sub);
    if (!s || !producerAtLeast(this.producer, 'm0')) return;
    const answer = (body: Omit<ReadAnswer, 'id' | 'what'>) => this.deliver(sub, s, { kind: 'read', body: { id, what, ...body } });
    if (!this.bridge || this.record === null) return answer({ error: { code: 'no-bridge', message: 'the session has no bridge, or has ended' } });
    if (what === 'catalog' && s.agentId === null && this.catalog) return answer({ result: this.catalog as unknown as JsonObject });
    if (MW1_KINDS.has(what) && this.capabilities?.reads.includes(what)) {
      if (s.agentId !== null) return answer({ error: { code: 'unsupported', message: "a read is the session's: ask it on the main loop's subscription" } });
      const breakdown = args?.breakdown ?? 'summary';
      if (what === 'usage' && breakdown !== 'summary' && breakdown !== 'full') return answer({ error: { code: 'failed', message: "usage's breakdown is summary or full" } });
      const result = what === 'usage' ? MW1_READS[breakdown === 'full' ? 'usage-full' : 'usage'] : MW1_READS[what as 'config' | 'settings' | 'mcp'];
      return answer({ result: result as unknown as JsonObject });
    }
    if (what !== 'status' || !this.capabilities) return answer({ error: { code: 'unsupported', message: `no read ${what}` } });
    if (s.agentId !== null) return answer({ error: { code: 'unsupported', message: "status is the main transcript's" } });
    const cwd = this.recording?.cwd ?? '';
    const model = (this.rows.get('main') ?? []).findLast((r) => r.type === 'assistant')?.message as { model?: string } | undefined;
    return answer({ result: { ...this.status, cwd: this.status.cwd || cwd, root: this.status.root || cwd, model: this.status.model ?? model?.model ?? null } as unknown as JsonObject });
  }

  /** The session's mod loaded before its machine's update: its presence carries no capabilities until a reload. */
  stale = false;
  private catalogValue: Catalog = loadRoutes().catalog!;
  get catalog(): Catalog | null { return this.capabilities?.reads.includes('catalog') ? this.catalogValue : null; }
  updateCatalog(catalog: Catalog): void {
    if (catalog.fingerprint === this.catalogValue.fingerprint) return;
    this.catalogValue = catalog;
    if (this.catalog) this.fanOut(null, { kind: 'catalog', body: catalog }, false);
  }
  /** A scripted reload discovers a changed catalog, as the bridge's next list does. */
  commandCatalog(name: string): void {
    if (!this.catalog || !['reload-skills', 'reload-plugins', 'mcp'].includes(name)) return;
    const number = this.catalog.commands.filter((c) => c.name.startsWith('reloaded-skill-')).length + 1;
    this.updateCatalog({ ...this.catalog, fingerprint: `${this.catalog.fingerprint}-${number}`,
      commands: [...this.catalog.commands, { name: `reloaded-skill-${number}`, description: 'A skill discovered after reload', source: 'skill', route: { class: 'run-prompt', enabled: true, measured: 'M' } }] });
  }

  /** The session's subagent tree: each started subagent's `meta.json`, with its status as a DC8 producer. */
  subagents(): SubagentMeta[] {
    if (this.widens) return this.current().subagents;
    return [...this.tree].map(([agentId, meta]) => ({ agentId, meta }));
  }

  /** DX4's widened body over what the session holds now. */
  private derived(): Body {
    const agents: Derivation['agents'] = {};
    for (const [key, { index, bytes }] of this.indexes) {
      const rows = this.rows.get(key) ?? [];
      if (key === 'main' || !rows.length) continue;
      // The fake keeps no files: the facts are its rows' bytes and its last row's time, the same on every run.
      agents[key] = { index, file: fileFacts(rows, bytes, Date.parse(String(rows.at(-1)!.timestamp)) || 0) };
    }
    return derive({
      session: { id: this.id, running: this.record !== null },
      main: this.indexes.get('main')?.index ?? new LoopIndex(),
      metas: [...this.tree].map(([agentId, meta]) => ({ agentId, meta })),
      agents,
      bridge: this.bridge ? { agents: [...this.bridgeAgents.values()] } : null,
    });
  }

  private current(): Body {
    if (!this.body) {
      this.body = this.derived();
      this.bodyJson = JSON.stringify(this.body);
    }
    return this.body;
  }

  /** What an agent-scope subscription carries of the body: no tree (as before DC8), that agent's own loop's jobs and
   * MCP names. */
  private agentBody(agentId: string): { subagents: SubagentMeta[] } & Pick<Body, 'jobs' | 'mcp'> {
    const loop = this.indexes.get(agentId)?.index ?? new LoopIndex();
    return { subagents: [], ...loopJobs(loop, this.record !== null, this.indexes.get('main')?.index) };
  }

  /**
   * A DC8 producer derives the body again, and sends `subagents` where it changed: the session's to the main-scope
   * subscriptions, each subscribed agent's own jobs and MCP names to that agent's.
   */
  private refresh(): void {
    if (!this.widens) return;
    const body = this.derived();
    const json = JSON.stringify(body);
    if (json !== this.bodyJson) {
      this.body = body;
      this.bodyJson = json;
      this.fanOut(null, { kind: 'subagents', body }, false);
    }
    for (const agentId of new Set([...this.subs.values()].map((s) => s.agentId))) {
      if (agentId === null) continue;
      const scoped = this.agentBody(agentId);
      const scopedJson = JSON.stringify(scoped);
      if (scopedJson === this.agentBodies.get(agentId)) continue;
      this.agentBodies.set(agentId, scopedJson);
      this.fanOut(agentId, { kind: 'subagents', body: scoped }, false);
    }
  }

  /** The agent's `meta.json` joins the session's tree: at its spawn, a seed naming it, or its first row on disk, whichever
   * the machine sees first (the plane reads the metas from disk, whatever the bridge saw). */
  private joinTree(agentId: string): void {
    if (!this.tree.has(agentId)) this.tree.set(agentId, this.recording?.meta[agentId] ?? { agentType: 'general-purpose' });
    if (!this.rows.has(agentId)) this.rows.set(agentId, []);
  }

  hasAgent(agentId: string): boolean {
    return this.tree.has(agentId) || this.rows.has(agentId);
  }

  /** Applies one step of the timeline: the bridge's state changes, and every subscriber it reaches hears of it. */
  apply(step: Step): void {
    switch (step.k) {
      case 'turn-start':
        if (step.agentId === null) this.mainTurn = step.turnId;
        return;
      case 'step-start': {
        const key = keyOf(step);
        this.ended.delete(key);
        this.live.set(key, { turnId: step.turnId, agentId: step.agentId, step: step.step, ...(step.model && { model: step.model }), upTo: -1, blocks: new Map(), settled: new Set(), last: null });
        return;
      }
      case 'chunk': {
        // Stamped as the machine's plane passes the bridge's stamp through: when it was taken, for the web's latency.
        const body: SessionBodies['chunk'] = { turnId: step.turnId, agentId: step.agentId, step: step.step, chunkIndex: step.chunkIndex, chunk: step.chunk, t: Date.now() };
        this.fold(body);
        this.fanOut(step.agentId, { kind: 'chunk', body }, true);
        return;
      }
      case 'block-row': {
        const m = this.live.get(keyOf(step.body));
        if (m) {
          m.blocks.delete(step.body.index);
          m.settled.add(step.body.index);
        }
        this.fanOut(step.body.agentId, { kind: 'block-row', body: step.body }, true);
        return;
      }
      case 'step-end':
        this.endStep(step.body.turnId, step.body.agentId, step.body.step);
        return;
      case 'turn-end':
        for (const m of [...this.live.values()]) if (m.turnId === step.turnId && m.agentId === step.agentId) this.endStep(m.turnId, m.agentId, m.step);
        if (step.agentId === null && this.mainTurn === step.turnId) this.mainTurn = null;
        return;
      case 'row':
        this.appendRow(step.agentId, step.row);
        return;
      case 'agent': {
        this.joinTree(step.agentId);
        if (step.spawn) this.bridgeAgents.set(step.agentId, { agentId: step.agentId, ...step.spawn, running: true });
        if (this.widens) this.refresh();
        else this.fanOut(null, { kind: 'subagents', body: { subagents: this.subagents() } }, false);
        this.reapplyAgentStops();
        return;
      }
      case 'agent-stop': {
        const held = this.bridgeAgents.get(step.agentId);
        if (held) this.bridgeAgents.set(step.agentId, { ...held, running: false });
        this.refresh();
        return;
      }
      case 'agents':
        this.bridgeAgents.clear();
        for (const a of step.agents) {
          this.bridgeAgents.set(a.agentId, a);
          if (this.widens) this.joinTree(a.agentId);
        }
        this.refresh();
        this.reapplyAgentStops();
        return;
      case 'usage':
        this.usage = step.body;
        this.fanOut(null, { kind: 'usage', body: step.body }, false);
        return;
      case 'presence':
        // The machine publishes it (DX4 `presence`, outside any subscription); here it ends or revives the process.
        this.presence = step.record;
        return;
      default:
        return;
    }
  }

  /** A row reaches the disk: its transcript's subscribers receive it. */
  appendRow(agentId: string | null, row: Row): void {
    const key = agentId ?? 'main';
    if (agentId !== null && this.widens) this.joinTree(agentId);
    let list = this.rows.get(key);
    if (!list) this.rows.set(key, (list = []));
    if (list.some((r) => r.uuid === row.uuid)) return;
    list.push(row);
    let held = this.indexes.get(key);
    if (!held) this.indexes.set(key, (held = { index: new LoopIndex(), bytes: 0 }));
    held.index.feed(row);
    held.bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
    for (const [sub, s] of this.subs) if (s.agentId === agentId) this.deliver(sub, s, { kind: 'row', body: { row, agentId } });
    this.refresh();
    for (const taskId of this.stopsToRestore) {
      if (!this.runningJob(taskId)) continue;
      this.stopsToRestore.delete(taskId);
      this.stopJob(taskId);
    }
  }

  /**
   * A stop this machine ran before a crash (its trace): the replay starts again from the recording, so its TaskStop rows
   * are written again as soon as the job they stopped is running, as a transcript on disk would still hold them.
   */
  restoreStop(taskId: string): void {
    this.stopsToRestore.add(taskId);
  }

  /** Folds a chunk into its block, as DX5's child does: a chunk that does not follow its message's watermark (one was
   * lost) takes the message out, and a chunk of a settled block, or of an ended step, changes nothing. */
  private fold(body: SessionBodies['chunk']): void {
    const key = keyOf(body);
    if (this.ended.has(key)) return;
    let m = this.live.get(key);
    if (!m && body.chunkIndex === 0) {
      m = { turnId: body.turnId, agentId: body.agentId, step: body.step, upTo: -1, blocks: new Map(), settled: new Set(), last: null };
      this.live.set(key, m);
    }
    if (!m) return;
    if (body.chunkIndex !== m.upTo + 1) {
      this.live.delete(key);
      return;
    }
    m.upTo = body.chunkIndex;
    m.last = body;
    const chunk = body.chunk;
    const index = chunk.index;
    const kind = BLOCK_KINDS[String(chunk.kind)];
    if (typeof index !== 'number' || !kind || m.settled.has(index)) return;
    let block = m.blocks.get(index);
    if (!block) m.blocks.set(index, (block = { index, kind, text: '', upTo: -1 }));
    if (chunk.kind === 'tool') {
      if (typeof chunk.id === 'string') block.id = chunk.id;
      if (typeof chunk.name === 'string') block.name = chunk.name;
    } else if (chunk.kind === 'input') block.text += String(chunk.json ?? '');
    else block.text += String(chunk.text ?? '');
    block.upTo = body.chunkIndex;
  }

  private endStep(turnId: string, agentId: string | null, step: number): void {
    const key = keyOf({ turnId, agentId, step });
    this.live.delete(key);
    this.ended.add(key);
    this.fanOut(agentId, { kind: 'step-end', body: { turnId, agentId, step } }, true);
  }

  /** To the main-scope subscriptions (each agent's stream when `everyAgent`, else only the main loop's) and to the
   * subscription of the agent it belongs to. */
  private fanOut(agentId: string | null, out: Out, everyAgent: boolean): void {
    // Without the bridge a session's depth is its rows alone (§5): no stream, no usage.
    if (!this.bridge && out.kind !== 'subagents') return;
    for (const [sub, s] of this.subs) {
      if (s.agentId === null ? everyAgent || agentId === null : s.agentId === agentId) this.deliver(sub, s, out);
    }
  }

  private deliver(sub: string, s: Sub, out: Out): void {
    if (!s.ready) {
      s.queue.push(out);
      return;
    }
    if (out.kind === 'row' && s.held.has(out.body.row.uuid as string)) return;
    if (out.kind === 'chunk' && out.body.chunkIndex <= (s.marks.get(keyOf(out.body)) ?? -1)) return;
    this.emit(sub, s, out);
  }

  private emit(sub: string, s: Sub, out: Out): void {
    this.send({ project: this.where.project, machine: this.where.machine, session: this.id, kind: out.kind, sub, n: s.n++, body: out.body } as SessionMessage);
  }

  /** The bridge's snapshot entries for a scope: copies, blocks in index order. */
  private streaming(agentId: string | null): Streaming[] {
    return [...this.live.values()]
      .filter((m) => agentId === null || m.agentId === agentId)
      .map((m) => ({
        turnId: m.turnId,
        agentId: m.agentId,
        step: m.step,
        ...(m.model && { model: m.model }),
        upTo: m.upTo,
        blocks: [...m.blocks.values()].sort((a, b) => a.index - b.index).map((b) => ({ ...b })),
      }));
  }

  /** Serves a subscription: the snapshot (n 0), then the live part, under DX4's rules. */
  async subscribe(sub: string, agentId: string | null, options: SnapshotOptions = {}): Promise<void> {
    if (this.subs.has(sub)) return;
    if (agentId !== null && !this.hasAgent(agentId)) {
      this.send({ project: this.where.project, machine: this.where.machine, session: this.id, kind: 'end', sub, n: 0, body: { reason: 'error', message: `no subagent ${agentId} in this session` } });
      return;
    }
    // One step: the bridge's state (its streaming messages and each loop's cut) and the subscriber joining the stream.
    const streaming = this.bridge ? this.streaming(agentId) : [];
    const scope = this.rows.get(agentId ?? 'main') ?? [];
    const cut = scope.length;
    const s: Sub = { agentId, n: 1, ready: false, queue: [], held: new Set(), marks: new Map() };
    this.subs.set(sub, s);
    if (options.overlap) {
      const newest = scope[cut - 1];
      if (newest) s.queue.push({ kind: 'row', body: { row: newest, agentId } });
      for (const m of this.live.values()) if ((agentId === null || m.agentId === agentId) && m.last) s.queue.push({ kind: 'chunk', body: m.last });
    }
    await options.duringSnapshot?.();
    await Promise.resolve();
    if (this.subs.get(sub) !== s) return;
    // The rows, read up to the cut taken with the state: newest first, as many as the budget holds.
    const rows: Row[] = [];
    let bytes = 0;
    for (let i = cut - 1; i >= 0; i--) {
      bytes += JSON.stringify(scope[i]).length;
      if (rows.length && bytes > (options.budget ?? SNAPSHOT_ROW_BUDGET)) break;
      rows.push(scope[i]);
    }
    for (const r of scope.slice(0, cut)) s.held.add(r.uuid);
    for (const m of streaming) s.marks.set(keyOf(m), m.upTo);
    // A DC8 producer's snapshot carries the subscribed loop's jobs and MCP names: the session's, or the agent's own.
    let widened: Pick<Body, 'jobs' | 'mcp'> | null = null;
    if (this.widens && agentId === null) widened = this.current();
    else if (this.widens && agentId !== null) {
      widened = this.agentBody(agentId);
      this.agentBodies.set(agentId, JSON.stringify(widened));
    }
    const body: SessionBodies['snapshot'] = {
      rows,
      more: rows.length < cut,
      subagents: agentId === null ? this.subagents() : [],
      presence: this.presenceBody(),
      streaming,
      ...(agentId === null && { usage: this.bridge ? this.usage : null }),
      ...(agentId === null && this.catalog && { catalog: this.catalog }),
      ...(widened && { jobs: widened.jobs, mcp: widened.mcp }),
    };
    this.send({ project: this.where.project, machine: this.where.machine, session: this.id, kind: 'snapshot', sub, n: 0, body });
    s.ready = true;
    for (const out of s.queue.splice(0)) this.deliver(sub, s, out);
  }

  /** Ends a subscription with `reason`, at the next `n` (0 before its snapshot). */
  end(sub: string, reason: SessionBodies['end']['reason'], message?: string): void {
    const s = this.subs.get(sub);
    if (!s) return;
    this.subs.delete(sub);
    const n = s.ready ? s.n : 0;
    this.send({ project: this.where.project, machine: this.where.machine, session: this.id, kind: 'end', sub, n, body: { reason, ...(message && { message }) } });
  }

  /** Forgets every subscription without a word: the connection they ran on is gone. */
  forgetAll(): void {
    this.subs.clear();
  }

  holds(sub: string): boolean {
    return this.subs.has(sub);
  }

  openSubs(): string[] {
    return [...this.subs.keys()];
  }

  /** Older rows of the subscription's transcript, before row `before`, newest first. */
  page(sub: string, before: string, limit: number): void {
    const s = this.subs.get(sub);
    if (!s) return;
    const scope = this.rows.get(s.agentId ?? 'main') ?? [];
    const at = scope.findIndex((r) => r.uuid === before);
    const older = at < 0 ? [] : scope.slice(0, at);
    const rows = older.slice(-limit).reverse();
    this.deliver(sub, s, { kind: 'rows', body: { rows, before, more: older.length > rows.length } });
  }

  /**
   * A background task's output tail, answering `output` on the subscription from its own loop's index (a DC8 producer;
   * an older one passes it by). The session's canonical tasks roots — `<ENGINE_TMP>/<slug>/<session>/tasks/` for the
   * slug of each working directory the recording knows (DX4's set: the recorded cwd, the rows' cwd, the cwd it joined
   * the log with) — are this machine's view of the recording's `tasks/` directory: a path the rows named under one of
   * them is read there, and any other path lies outside every root.
   */
  output(sub: string, taskId: string, tail: number): void {
    const s = this.subs.get(sub);
    if (!s || !this.widens || !isTaskId(taskId) || !isOutputTail(tail)) return;
    const index = this.indexes.get(s.agentId ?? 'main')?.index ?? new LoopIndex();
    const { roots, locate } = this.tasks();
    this.deliver(sub, s, { kind: 'output', body: answerOutput({ taskId, tail }, index, this.id, roots, locate) });
  }

  private tasks(): { roots: string[]; locate: Locate } {
    if (!this.recording?.dir) return { roots: [], locate: () => null };
    const dir = join(this.recording.dir, 'tasks');
    const cwds = new Set<string>([this.recording.cwd]);
    const rowCwd = this.recording.rows.main.find((r) => typeof r.cwd === 'string')?.cwd;
    if (typeof rowCwd === 'string') cwds.add(rowCwd);
    for (const step of this.recording.steps) {
      if (step.k === 'log' && step.event.kind === 'joined' && step.event.session === this.id && typeof step.event.cwd === 'string') cwds.add(step.event.cwd);
    }
    const canonical = [...cwds].map((cwd) => `${ENGINE_TMP}/${slugOf(cwd)}/${this.id}/tasks/`);
    const locate: Locate = (named) => {
      const path = posix.normalize(named);
      const root = canonical.find((r) => path.startsWith(r));
      return root === undefined ? null : join(dir, path.slice(root.length));
    };
    return { roots: [dir], locate };
  }

  /** The job `taskId` names and the loop whose rows started it, while the session's jobs index holds it as running. */
  runningJob(taskId: string): { loop: string; job: Job } | null {
    for (const [loop, { index }] of this.indexes) {
      const job = loopJobs(index, this.record !== null, loop === 'main' ? undefined : this.indexes.get('main')?.index).jobs.find((j) => j.taskId === taskId);
      if (job) return job.status === 'running' ? { loop, job } : null;
    }
    return null;
  }

  /**
   * What the bridge's `stop` (DC10) leaves in the session. Its `TaskStop` through `$.tool.call` writes no row, so the
   * bridge appends its note to the main transcript (`$.session.append`: a meta user row with the plugin's origin), whose
   * whole text DX4 reads as the task `stopped` (`stopNote`, the vectors' case 16): a subagent's job too, since an
   * agent's jobs read the main loop's words on its tasks after its own (`loopJobs`'s `also`), as the plane does; the
   * live check saw the engine's own notice never reach a parked subagent. False, and nothing written, when the job is
   * not running.
   */
  stopJob(taskId: string): boolean {
    const held = this.runningJob(taskId);
    if (!held) return false;
    const timestamp = new Date().toISOString();
    this.appendRow(null, {
      type: 'user',
      uuid: randomUUID(),
      parentUuid: this.rows.get('main')?.at(-1)?.uuid ?? null,
      sessionId: this.id,
      isSidechain: false,
      timestamp,
      isMeta: true,
      origin: { kind: 'plugin', name: this.plugin },
      message: { role: 'user', content: [{ type: 'text', text: stopNote(taskId) }] },
    });
    return true;
  }

  /**
   * The agent the bridge's tree names by `ref`, as the daemon resolves a `stop-agent` or a `tell` before the claim
   * (MW4): an id the tree holds first, running or not, then the Agent call's name of exactly one running agent; else
   * `unknown-agent` (none running by it, a description among them) or `ambiguous-agent` (a name two running agents hold).
   */
  resolveAgent(ref: string): { agent: BridgeAgent } | { code: 'unknown-agent' | 'ambiguous-agent'; message: string } {
    const byId = this.bridgeAgents.get(ref);
    if (byId) return byId.running ? { agent: byId } : { code: 'unknown-agent', message: `agent ${ref} is not running` };
    const named = [...this.bridgeAgents.values()].filter((a) => a.running && a.name === ref);
    if (named.length === 1) return { agent: named[0] };
    if (named.length > 1) return { code: 'ambiguous-agent', message: `${named.length} running agents are named ${ref} (${named.map((a) => a.agentId).join(', ')}): name one by its id` };
    return { code: 'unknown-agent', message: `the session's subagent tree holds no running agent by the id or name ${ref}` };
  }

  /** Whether the agent of this id (no name) is running. */
  isAgentRunning(agentId: string): boolean {
    return this.bridgeAgents.get(agentId)?.running === true;
  }

  /** The running agent `ref` resolves to (`resolveAgent`), or null. */
  runningAgent(ref: string): BridgeAgent | null {
    const found = this.resolveAgent(ref);
    return 'agent' in found ? found.agent : null;
  }

  /**
   * What the bridge's `stop-agent` leaves in the session: the agent `agentId` (the one the daemon resolved, never another
   * by its name) stopped in the tree (its spawn kept, `running` false, as the bridge's next read of the engine's list says
   * it), and the note naming it as `asked` in its parent's loop (main for an agent main spawned), a meta user row with
   * the plugin's origin. False, and nothing written, when that agent is not running.
   */
  stopAgent(agentId: string, asked: string): boolean {
    const agent = this.bridgeAgents.get(agentId);
    if (!agent?.running) return false;
    this.bridgeAgents.set(agentId, { ...agent, running: false });
    this.writeAgentStopNote(agent, asked);
    return true;
  }

  /** A stop's note naming the agent as `asked`, in its parent's loop (main for an agent main spawned). */
  private writeAgentStopNote(agent: BridgeAgent, asked: string): void {
    const loop = agent.parentAgentId ?? null;
    this.appendRow(loop, {
      type: 'user',
      uuid: randomUUID(),
      parentUuid: this.rows.get(loop ?? 'main')?.at(-1)?.uuid ?? null,
      sessionId: this.id,
      isSidechain: loop !== null,
      timestamp: new Date().toISOString(),
      isMeta: true,
      origin: { kind: 'plugin', name: this.plugin },
      message: { role: 'user', content: [{ type: 'text', text: agentStopNote(asked) }] },
    });
    this.refresh();
  }

  /**
   * An agent stop this machine ran before a crash (its trace): the replay starts again from the recording, which knows
   * nothing of it, so the stop stays over every later update of the replay (a spawn, a resync of the tree), as the
   * engine would still hold the agent ended, and its note is written once, when the agent first appears, as a
   * transcript on disk would still hold it.
   */
  restoreAgentStop(agentId: string, asked: string): void {
    this.restoredAgentStops.set(agentId, { asked, isNoted: false });
  }

  /** Holds each restored stop over the replay: its agent not running, its note written once. */
  private reapplyAgentStops(): void {
    for (const [agentId, stop] of this.restoredAgentStops) {
      const agent = this.bridgeAgents.get(agentId);
      if (!agent) continue;
      const wasRunning = agent.running;
      if (wasRunning) this.bridgeAgents.set(agentId, { ...agent, running: false });
      if (!stop.isNoted) {
        stop.isNoted = true;
        this.writeAgentStopNote(agent, stop.asked); // refreshes
      } else if (wasRunning) this.refresh();
    }
  }

  /** The working tree's diff, on a main-scope subscription. */
  diff(sub: string): void {
    const s = this.subs.get(sub);
    if (!s || s.agentId !== null) return;
    this.deliver(sub, s, { kind: 'diff', body: { base: this.diffBase, text: this.diffText } });
  }
}
