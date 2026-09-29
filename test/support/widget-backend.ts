// The fixture-backed widget backend (C11 execution document, M2 and M3 decisions): answers the X2 commands C11's
// widgets call from recorded engine answers, in any order and as often as asked, with no engine and no replay
// transport. A table names the fixture line for every control subtype; `answer` serves C3's X2 result shape from it,
// `script` lets a test override one command (a refusal, an IpcError), `scriptOutcome` one operation's completion, `calls`
// is the log assertions read, and the `emit*` functions move a session (a status patch, a new turn, an operation's
// completion). The controls move the status as C3's host does after the engine accepted them (`noteRequested`: the
// requested model, the effort, the permission mode with its refusal), and an operation answers its receipt and then
// completes on `session.operation`, at once or when a test settles the held ones. Every status it answers or emits is
// C3's landed shape, parsed with the shared `EngineSessionStatusSchema` first, so a missing field fails here rather
// than in a widget. The same module is the widget unit tests' bridge stub (`bridge()`) and, under
// MAWS_WIDGET_BACKEND=fixtures, main's interceptor over C5's scenario records (`src/main/index.ts`, C11 block).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OperationCommand, OperationEvent } from '../../src/shared/engine/operations';
import { EngineSessionStatusSchema, type EngineSessionStatus } from '../../src/shared/engine/status';
import type { QueuePauseReason } from '../../src/shared/engine/session-state-store';
import type { AutoModeRefusalCode, PermissionMode } from '../../src/shared/graph/enums';
import type { IpcError } from '../../src/shared/ipc/errors';
import { EventIdSchema, type AppSessionId, type EventId } from '../../src/shared/graph/ids';
import type { CommandName, CommandResult, EventName, EventPayload, MawsBridge } from '../../src/shared/ipc/schema';

// A fixture line: `<journal>#<seq>` names an `in` row of `spikes/protocol-probe/fixtures/<journal>.jsonl` (a control
// response's payload, or the frame itself for any other row); `widgets/<name>.json` a SPEC-derived synthetic answer
// under `test/fixtures/widgets/` (the controls no fixture recorded), whose `response` is the answer and `_from` its
// citation.
export type FixtureLine = string;

// What each control subtype answers with. The reads and the direct controls come from the probe's own answers.
export const RESPONSES: Record<string, FixtureLine> = {
  get_usage: 'reads#54',
  get_context_usage: 'reads#57',
  get_settings: 'pass2/dialogs#58',
  list_permission_rules: 'pass2/grant-askrule-start#65',
  get_hooks_listing: 'pass2/hooks#46',
  get_memory_dialog: 'reads#69',
  get_skills_dialog: 'reads#72',
  get_sandbox_dialog: 'reads#75',
  get_workspace_diff: 'reads#81',
  export_conversation: 'reads#84',
  get_status: 'pass2/auto-routed#145',
  mcp_status: 'pass2/real-settings#63',
  list_models: 'pass2/auto-routed#143',
  get_session_cost: 'widgets/get-session-cost.json',
  // M3: the controls (success envelopes with no payload, or the mode the engine settled on) and the operations
  set_model: 'pass2/auto-routed#154',
  set_permission_mode: 'pass2/auto-routed#165',
  apply_flag_settings: 'pass2/auto-routed#176',
  reload_plugins: 'widgets/reload-plugins.json',
  mcp_reconnect: 'widgets/mcp-reconnect.json',
  mcp_toggle: 'widgets/mcp-toggle.json',
  rename_session: 'reads#90', // success, no payload (the rename widget's C10 seam until C10's session.rename)
};

// `set_permission_mode { mode: 'auto' }` on a model the catalogue does not mark `supportsAutoMode`: the engine's refusal.
export const AUTO_MODE_MODEL_REFUSAL: FixtureLine = 'pass2/auto-routed#156';

// The X2 command behind each subtype the table answers (C3's mapping, src/engine-host/ipc.ts).
export const SUBTYPE_OF: Partial<Record<CommandName, string>> = {
  'session.getUsage': 'get_usage',
  'session.getContextUsage': 'get_context_usage',
  'session.getSettings': 'get_settings',
  'session.listPermissionRules': 'list_permission_rules',
  'session.getHooksListing': 'get_hooks_listing',
  'session.getMemoryDialog': 'get_memory_dialog',
  'session.getSkillsDialog': 'get_skills_dialog',
  'session.getSandboxDialog': 'get_sandbox_dialog',
  'session.getWorkspaceDiff': 'get_workspace_diff',
  'session.exportConversation': 'export_conversation',
  'session.getStatus': 'get_status',
  'session.mcpStatus': 'mcp_status',
  'session.listModels': 'list_models',
  'session.getSessionCost': 'get_session_cost',
  'session.setModel': 'set_model',
  'session.setPermissionMode': 'set_permission_mode',
  'session.setEffort': 'apply_flag_settings', // C3 writes effort as `apply_flag_settings { effortLevel }`
  'session.applyFlagSettings': 'apply_flag_settings',
  'session.reloadPlugins': 'reload_plugins',
  'session.mcpReconnect': 'mcp_reconnect',
  'session.mcpToggle': 'mcp_toggle',
  'session.renameSession': 'rename_session',
};

// The launch's init facts every answered status carries (C3 reads them from `system/init`): the owner's eleven plugins,
// three connected MCP servers and fast mode's opt-in state (`pass2/real-settings` seq 15). The command catalogue is the
// initialize response's commands and agents (`pass2/auto-routed` seq 4) with the first init frame's skills and
// terminal-only commands (seq 9), as C3's catalogue state assembles it.
export const INIT_FRAME: FixtureLine = 'pass2/real-settings#15';
export const CATALOG_LINES = { initialize: 'pass2/auto-routed#4', init: 'pass2/auto-routed#9' } as const;

// Host-local commands the backend answers besides the table: the status, the catalogue, a prompt (the compact widget's
// `/compact`, a user message and no control), the app queue, and (M4, the route switch) the interrupt, the queue's
// pause and the stop, each moving the status and the queue as C3's host does.
const LOCAL_COMMANDS = ['session.status', 'session.catalog', 'session.send', 'session.queue.list', 'session.queue.setPaused', 'session.interrupt', 'session.stop'] as const satisfies readonly CommandName[];

export const WIDGET_BACKEND_COMMANDS: readonly CommandName[] = [...LOCAL_COMMANDS, ...(Object.keys(SUBTYPE_OF) as CommandName[])];

const OPERATIONS: Partial<Record<CommandName, OperationCommand>> = {
  'session.reloadPlugins': 'session.reloadPlugins',
  'session.mcpReconnect': 'session.mcpReconnect',
  'session.mcpToggle': 'session.mcpToggle',
};

// A refusal the backend answers with: main's interceptor turns it into the X2 error envelope.
export class WidgetBackendError extends Error {
  constructor(readonly error: IpcError) {
    super(error.message);
    this.name = 'WidgetBackendError';
  }
}

type Row = { seq: number; direction: 'in' | 'out' | 'meta'; frame: Record<string, unknown> };

function journalRow(root: string, line: FixtureLine): Row {
  const [journal, seq] = line.split('#');
  const rows = readFileSync(join(root, 'spikes/protocol-probe/fixtures', `${journal}.jsonl`), 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Row);
  const row = rows.find((r) => r.seq === Number(seq));
  if (!row) throw new Error(`widget backend: ${line} is not a row of ${journal}.jsonl`);
  return row;
}

// A synthetic file under test/fixtures/widgets/, whole (its `_from` citation, its `response`, and whatever else a case
// needs beside it, e.g. `mcp-toggle-connect-failed.json`'s operation outcome and the mcp_status that follows).
export function syntheticFixture(root: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'test/fixtures/widgets', name), 'utf8')) as Record<string, unknown>;
}

// The payload a fixture line names.
export function fixtureLine(root: string, line: FixtureLine): unknown {
  if (line.startsWith('widgets/')) return syntheticFixture(root, line.slice('widgets/'.length)).response;
  const row = journalRow(root, line);
  if (row.frame.type !== 'control_response') return row.frame;
  const response = row.frame.response as { subtype: string; response?: unknown; error?: string };
  if (response.subtype !== 'success') throw new Error(`widget backend: ${line} is an error response`);
  return response.response ?? {};
}

// The engine's refusal a fixture line recorded: `{ error, error_code }` of an error control response.
export function fixtureRefusal(root: string, line: FixtureLine): { error: string; code: string | null } {
  const response = journalRow(root, line).frame.response as { subtype: string; error?: string; error_code?: string };
  if (response.subtype !== 'error') throw new Error(`widget backend: ${line} is not an error response`);
  return { error: response.error ?? '', code: response.error_code ?? null };
}

// The init facts of `INIT_FRAME` in C3's status fields.
function initFacts(root: string): Pick<EngineSessionStatus, 'plugins' | 'pluginErrors' | 'pluginWarnings' | 'fastMode' | 'mcpServers'> {
  const init = fixtureLine(root, INIT_FRAME) as {
    plugins?: { name: string; path: string; source?: string; version?: string }[];
    plugin_errors?: { plugin: string; type: string; message: string; path?: string }[];
    plugin_warnings?: { plugin: string; type: string; message: string }[];
    fast_mode_state?: 'off' | 'cooldown' | 'on';
    fast_mode_disabled_reason?: string;
    mcp_servers?: { name: string; status: string; source?: string }[];
  };
  return {
    plugins: (init.plugins ?? []).map((p) => ({ name: p.name, path: p.path, source: p.source ?? null, version: p.version ?? null })),
    pluginErrors: (init.plugin_errors ?? []).map((e) => ({ plugin: e.plugin, type: e.type, message: e.message, path: e.path ?? null })),
    pluginWarnings: (init.plugin_warnings ?? []).map((w) => ({ plugin: w.plugin, type: w.type, message: w.message })),
    fastMode: { state: init.fast_mode_state ?? null, disabledReason: init.fast_mode_disabled_reason ?? null },
    mcpServers: (init.mcp_servers ?? []).map((s) => ({ name: s.name, status: s.status, source: s.source ?? null })),
  };
}

function catalogOf(root: string) {
  const initialize = fixtureLine(root, CATALOG_LINES.initialize) as { commands: unknown[]; agents?: unknown[] };
  const init = fixtureLine(root, CATALOG_LINES.init) as { skills?: unknown[]; terminal_slash_commands?: unknown[] };
  return { commands: initialize.commands, agents: initialize.agents ?? [], skills: init.skills ?? [], terminalSlashCommands: init.terminal_slash_commands ?? [], revision: 2 };
}

export interface WidgetCall {
  command: CommandName;
  subtype: string | null; // the control subtype a host-owned read would have written; null for host-local commands
  input: unknown;
}

export type ScriptedAnswer = (input: unknown) => unknown;
export type OperationOutcome = OperationEvent['outcome'];

export interface WidgetBackendOptions {
  root: string; // the repository root the fixture lines are under
  statuses: readonly EngineSessionStatus[]; // the sessions it answers for; a ready one gains the init facts
  emit?: <N extends EventName>(name: N, payload: EventPayload<N>) => void;
  now?: () => string;
}

export interface WidgetBackend {
  readonly commands: readonly CommandName[];
  readonly calls: WidgetCall[];
  answer(command: CommandName, input: unknown): Promise<unknown>; // the X2 value, or a rejection with WidgetBackendError
  script(command: CommandName, fn: ScriptedAnswer): () => void; // the latest script for a command wins until removed
  scriptOutcome(command: OperationCommand, fn: (input: unknown) => OperationOutcome): () => void; // how an operation completes
  holdOperations(held: boolean): void; // held: operations answer their receipt and complete only on settleOperations()
  settleOperations(): number; // completes every held operation; how many
  status(appSessionId: AppSessionId): EngineSessionStatus;
  emitStatus(appSessionId: AppSessionId, patch: Partial<EngineSessionStatus>): EngineSessionStatus;
  emitTurnStarted(appSessionId: AppSessionId): EventId; // opens a turn with a fresh id in C3's EventId form
  emitOperation(event: OperationEvent): void;
  bridge(): MawsBridge; // an X2 bridge over `answer` and the emitted events, for unit tests
}

const appSessionIdOf = (input: unknown): AppSessionId | null => {
  const id = (input as { appSessionId?: unknown } | undefined)?.appSessionId;
  return typeof id === 'string' ? (id as AppSessionId) : null;
};

type ModelRow = { value: string; resolvedModel?: string; supportsAutoMode?: boolean };

export function createWidgetBackend(options: WidgetBackendOptions): WidgetBackend {
  const now = options.now ?? (() => new Date().toISOString());
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => {
    options.emit?.(name, payload);
    listeners.get(name)?.forEach((listener) => listener(payload));
  };
  const facts = initFacts(options.root);
  const catalog = catalogOf(options.root);
  const models = (fixtureLine(options.root, RESPONSES.list_models) as { models: ModelRow[] }).models;
  const statuses = new Map<AppSessionId, EngineSessionStatus>();
  // The status C3 would hold for the session. C10's `trust` field joins here at the C10 integration.
  const shaped = (status: EngineSessionStatus): EngineSessionStatus => EngineSessionStatusSchema.parse(status);
  for (const status of options.statuses) statuses.set(status.appSessionId, shaped(status.process === 'ready' ? { ...status, ...facts } : status));
  const scripts = new Map<CommandName, ScriptedAnswer>();
  const outcomes = new Map<OperationCommand, (input: unknown) => OperationOutcome>();
  const toggled = new Map<string, boolean>(); // `${appSessionId}\n${serverName}` → enabled, after an accepted toggle
  const calls: WidgetCall[] = [];
  const held: (() => void)[] = [];
  let holding = false;
  let turnSeq = 0;
  let opSeq = 0;
  let queueSeq = 0;
  // The app queue's pause per session (C3's `QueueState` without entries): paused by the human, or by an interrupt.
  const queues = new Map<AppSessionId, { paused: boolean; pauseReason: QueuePauseReason | null }>();
  const queueOf = (status: EngineSessionStatus) => queues.get(status.appSessionId) ?? { paused: status.queue.paused, pauseReason: status.queue.paused ? ('user' as const) : null };
  const setQueue = (status: EngineSessionStatus, paused: boolean, pauseReason: QueuePauseReason | null) => {
    queues.set(status.appSessionId, { paused, pauseReason });
    emitStatus(status.appSessionId, { queue: { ...statusOf(status.appSessionId).queue, paused } });
  };

  const statusOf = (appSessionId: AppSessionId | null): EngineSessionStatus => {
    const status = appSessionId === null ? undefined : statuses.get(appSessionId);
    if (!status) throw new WidgetBackendError({ code: 'internal', message: `unknown app session: ${appSessionId}` });
    return status;
  };
  const emitStatus = (appSessionId: AppSessionId, patch: Partial<EngineSessionStatus>): EngineSessionStatus => {
    const next = shaped({ ...statusOf(appSessionId), ...patch });
    statuses.set(appSessionId, next);
    emit('session.status', { appSessionId, status: next });
    return next;
  };
  // The catalogue row of the session's model: the requested alias, else the resolved id (an alias's or its own).
  const modelRowOf = (status: EngineSessionStatus): ModelRow | undefined => {
    const named = status.model.requested ?? status.model.resolved;
    return models.find((m) => m.value === named) ?? models.find((m) => m.resolvedModel === named);
  };

  // What an accepted control does to C3's status (the host's `noteRequested`), and its X2 answer.
  function control(command: CommandName, input: Record<string, unknown>, status: EngineSessionStatus): unknown {
    const id = status.appSessionId;
    switch (command) {
      case 'session.setModel':
        fixtureLine(options.root, RESPONSES.set_model);
        emitStatus(id, { model: { ...status.model, requested: input.model as string | null } });
        return { ok: true, error: null, code: null };
      case 'session.setPermissionMode': {
        const mode = input.mode as PermissionMode;
        if (mode === 'auto' && modelRowOf(status)?.supportsAutoMode !== true) {
          const refused = fixtureRefusal(options.root, AUTO_MODE_MODEL_REFUSAL);
          const refusal = refused.code as AutoModeRefusalCode;
          emitStatus(id, { permissionMode: { requested: mode, effective: status.permissionMode.effective, refusal } });
          return { effective: status.permissionMode.effective, refusal, error: refused.error };
        }
        fixtureLine(options.root, RESPONSES.set_permission_mode);
        emitStatus(id, { permissionMode: { requested: mode, effective: mode, refusal: null } });
        return { effective: mode, refusal: null, error: null };
      }
      case 'session.setEffort':
        fixtureLine(options.root, RESPONSES.apply_flag_settings);
        emitStatus(id, { effort: input.effort as EngineSessionStatus['effort'] });
        return undefined;
      case 'session.applyFlagSettings':
        fixtureLine(options.root, RESPONSES.apply_flag_settings);
        return undefined; // fast mode's state arrives with the next init frame (a test emits it)
      default:
        return undefined;
    }
  }

  // An operation: the receipt now, the completion on `session.operation` at once or when settled.
  function operation(command: OperationCommand, input: Record<string, unknown>, status: EngineSessionStatus): { opId: string } {
    const opId = `op-${++opSeq}`;
    const complete = () => {
      const scripted = outcomes.get(command);
      const outcome: OperationOutcome = scripted ? scripted(input) : { ok: true, value: (fixtureLine(options.root, RESPONSES[SUBTYPE_OF[command]!]) ?? null) as never };
      if (command === 'session.mcpToggle' && outcome.ok) toggled.set(`${status.appSessionId}\n${input.serverName as string}`, input.enabled as boolean);
      emit('session.operation', { appSessionId: status.appSessionId, opId, command, late: false, outcome });
    };
    if (holding) held.push(complete);
    else setTimeout(complete, 0);
    return { opId };
  }

  // C3's interrupt: the app queue pauses first (`interrupt`), the engine is asked, and the turn ends after the answer.
  function interrupt(status: EngineSessionStatus): { stillQueued: string[]; cancelled: string[] } {
    setQueue(status, true, 'interrupt');
    if (status.turn !== null) setTimeout(() => emitStatus(status.appSessionId, { turn: null, engineState: 'idle', activity: null }), 0);
    return { stillQueued: [], cancelled: [] };
  }

  // C3's stop ladder, answered as a clean exit; the queue and its pause stay in the state file (a `stop` keeps it).
  function stop(status: EngineSessionStatus, reason: 'stop' | 'archive'): { exited: boolean; code: number | null; signal: string | null } {
    emitStatus(status.appSessionId, { process: 'exited', exit: { code: 0, signal: null, reason, at: now() }, turn: null, engineState: 'idle', activity: null, pid: null });
    return { exited: true, code: 0, signal: null };
  }

  // `mcp_status` as the engine would answer after the toggles it accepted.
  function mcpStatus(status: EngineSessionStatus): unknown {
    const answer = fixtureLine(options.root, RESPONSES.mcp_status) as { mcpServers: Record<string, unknown>[] };
    return {
      ...answer,
      mcpServers: answer.mcpServers.map((server) => {
        const enabled = toggled.get(`${status.appSessionId}\n${server.name as string}`);
        if (enabled === undefined) return server;
        const rest: Record<string, unknown> = { ...server, status: enabled ? 'connected' : 'disabled' };
        delete rest.error; // a toggled server reports no error until the engine says otherwise
        return rest;
      }),
    };
  }

  function served(command: CommandName, input: unknown): unknown {
    const scripted = scripts.get(command);
    if (scripted) return scripted(input);
    if (command === 'session.status') return statusOf(appSessionIdOf(input));
    const status = statusOf(appSessionIdOf(input));
    if (command === 'session.catalog') return catalog;
    if (command === 'session.queue.list') return { entries: [], ...queueOf(status) };
    if (command === 'session.queue.setPaused') {
      const paused = (input as { paused: boolean }).paused;
      return void setQueue(status, paused, paused ? 'user' : null);
    }
    if (command === 'session.stop') return stop(status, (input as { reason: 'stop' | 'archive' }).reason);
    if (status.process !== 'ready') throw new WidgetBackendError({ code: 'internal', message: `${status.appSessionId} has no ready process` });
    if (command === 'session.send') return { messageUuid: null, disposition: 'sent', queueId: `queue-${++queueSeq}` };
    if (command === 'session.interrupt') return interrupt(status);
    const subtype = SUBTYPE_OF[command];
    if (!subtype) throw new WidgetBackendError({ code: 'internal', message: `the widget backend does not answer ${command}` });
    const op = OPERATIONS[command];
    if (op) return operation(op, input as Record<string, unknown>, status);
    if (command === 'session.mcpStatus') return mcpStatus(status);
    if (subtype === 'set_model' || subtype === 'set_permission_mode' || subtype === 'apply_flag_settings') return control(command, input as Record<string, unknown>, status);
    if (subtype === 'rename_session') return void fixtureLine(options.root, RESPONSES.rename_session); // no payload
    return fixtureLine(options.root, RESPONSES[subtype]);
  }

  const backend: WidgetBackend = {
    commands: WIDGET_BACKEND_COMMANDS,
    calls,
    async answer(command, input) {
      calls.push({ command, subtype: SUBTYPE_OF[command] ?? null, input });
      return served(command, input);
    },
    script(command, fn) {
      scripts.set(command, fn);
      return () => {
        if (scripts.get(command) === fn) scripts.delete(command);
      };
    },
    scriptOutcome(command, fn) {
      outcomes.set(command, fn);
      return () => {
        if (outcomes.get(command) === fn) outcomes.delete(command);
      };
    },
    holdOperations(on) {
      holding = on;
    },
    settleOperations() {
      const settled = held.splice(0);
      settled.forEach((complete) => complete());
      return settled.length;
    },
    status: (appSessionId) => statusOf(appSessionId),
    emitStatus,
    emitTurnStarted(appSessionId) {
      const current = statusOf(appSessionId);
      const id = EventIdSchema.parse(`${appSessionId}:${current.launchId}:${++turnSeq}:0`);
      const at = now();
      // C3 clears the local-lane observation at every turn.started.
      emitStatus(appSessionId, {
        turn: { id, origin: 'human', startedAt: at, acceptedAt: at, userMessageUuids: [] },
        engineState: 'running',
        gateway: { ...current.gateway, localLane: null },
      });
      return id;
    },
    emitOperation(event) {
      emit('session.operation', event);
    },
    bridge() {
      return {
        async invoke(name, input) {
          if (!WIDGET_BACKEND_COMMANDS.includes(name) && !scripts.has(name)) return { ok: false, error: { code: 'host_unavailable', message: `the widget backend does not answer ${name}` } };
          try {
            return { ok: true, value: await backend.answer(name, input) } as CommandResult<typeof name>;
          } catch (error) {
            if (error instanceof WidgetBackendError) return { ok: false, error: error.error };
            throw error;
          }
        },
        on(name, listener) {
          const set = listeners.get(name) ?? new Set();
          listeners.set(name, set);
          const entry = listener as (payload: unknown) => void;
          set.add(entry);
          return () => void set.delete(entry);
        },
        pathForFile: () => '',
      } as MawsBridge;
    },
  };
  return backend;
}
