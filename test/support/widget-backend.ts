// The fixture-backed widget backend (C11 execution document, M2 decisions): answers the X2 commands C11's widgets call
// from recorded engine answers, in any order and as often as asked, with no engine and no replay transport. A table
// names the fixture line for every control subtype; `answer` serves C3's X2 result shape from it, `script` lets a test
// override one command (a refusal, an IpcError, a failed operation), `calls` is the log assertions read, and the
// `emit*` functions move a session (a status patch, a new turn, an operation's completion). Every status it answers or
// emits is C3's landed shape, parsed with the shared `EngineSessionStatusSchema` first, so a missing field fails here
// rather than in a widget. The same module is the widget unit tests' bridge stub (`bridge()`) and, under
// MAWS_WIDGET_BACKEND=fixtures, main's interceptor over C5's scenario records (`src/main/index.ts`, C11 block).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OperationEvent } from '../../src/shared/engine/operations';
import { EngineSessionStatusSchema, type EngineSessionStatus } from '../../src/shared/engine/status';
import type { IpcError } from '../../src/shared/ipc/errors';
import { EventIdSchema, type AppSessionId, type EventId } from '../../src/shared/graph/ids';
import type { CommandName, CommandResult, EventName, EventPayload, MawsBridge } from '../../src/shared/ipc/schema';

// A fixture line: `<journal>#<seq>` names an `in` row of `spikes/protocol-probe/fixtures/<journal>.jsonl` (a control
// response's payload, or the frame itself for any other row); `widgets/<name>.json` a SPEC-derived synthetic answer
// under `test/fixtures/widgets/` (the controls no fixture recorded).
export type FixtureLine = string;

// What each control subtype answers with. The reads come from the probe's own answers.
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
};

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
};

// The launch's init facts every answered status carries (C3 reads them from `system/init`): the owner's eleven plugins,
// three connected MCP servers and fast mode's opt-in state (`pass2/real-settings` seq 15). The command catalogue is the
// initialize response's commands and agents (`pass2/auto-routed` seq 4) with the first init frame's skills and
// terminal-only commands (seq 9), as C3's catalogue state assembles it.
export const INIT_FRAME: FixtureLine = 'pass2/real-settings#15';
export const CATALOG_LINES = { initialize: 'pass2/auto-routed#4', init: 'pass2/auto-routed#9' } as const;

// Host-local commands the backend answers besides the table: the status and the catalogue.
const LOCAL_COMMANDS = ['session.status', 'session.catalog'] as const satisfies readonly CommandName[];

export const WIDGET_BACKEND_COMMANDS: readonly CommandName[] = [...LOCAL_COMMANDS, ...(Object.keys(SUBTYPE_OF) as CommandName[])];

// A refusal the backend answers with: main's interceptor turns it into the X2 error envelope.
export class WidgetBackendError extends Error {
  constructor(readonly error: IpcError) {
    super(error.message);
    this.name = 'WidgetBackendError';
  }
}

type Row = { seq: number; direction: 'in' | 'out' | 'meta'; frame: Record<string, unknown> };

// The payload a fixture line names.
export function fixtureLine(root: string, line: FixtureLine): unknown {
  if (line.startsWith('widgets/')) return JSON.parse(readFileSync(join(root, 'test/fixtures', line), 'utf8')) as unknown;
  const [journal, seq] = line.split('#');
  const rows = readFileSync(join(root, 'spikes/protocol-probe/fixtures', `${journal}.jsonl`), 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Row);
  const row = rows.find((r) => r.seq === Number(seq));
  if (!row) throw new Error(`widget backend: ${line} is not a row of ${journal}.jsonl`);
  if (row.frame.type !== 'control_response') return row.frame;
  const response = row.frame.response as { subtype: string; response?: unknown; error?: string };
  if (response.subtype !== 'success') throw new Error(`widget backend: ${line} is an error response`);
  return response.response ?? {};
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

export function createWidgetBackend(options: WidgetBackendOptions): WidgetBackend {
  const now = options.now ?? (() => new Date().toISOString());
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => {
    options.emit?.(name, payload);
    listeners.get(name)?.forEach((listener) => listener(payload));
  };
  const facts = initFacts(options.root);
  const catalog = catalogOf(options.root);
  const statuses = new Map<AppSessionId, EngineSessionStatus>();
  // The status C3 would hold for the session. C10's `trust` field joins here at the C10 integration.
  const shaped = (status: EngineSessionStatus): EngineSessionStatus => EngineSessionStatusSchema.parse(status);
  for (const status of options.statuses) statuses.set(status.appSessionId, shaped(status.process === 'ready' ? { ...status, ...facts } : status));
  const scripts = new Map<CommandName, ScriptedAnswer>();
  const calls: WidgetCall[] = [];
  let turnSeq = 0;

  const statusOf = (appSessionId: AppSessionId | null): EngineSessionStatus => {
    const status = appSessionId === null ? undefined : statuses.get(appSessionId);
    if (!status) throw new WidgetBackendError({ code: 'internal', message: `unknown app session: ${appSessionId}` });
    return status;
  };

  function served(command: CommandName, input: unknown): unknown {
    const scripted = scripts.get(command);
    if (scripted) return scripted(input);
    if (command === 'session.status') return statusOf(appSessionIdOf(input));
    const status = statusOf(appSessionIdOf(input));
    if (command === 'session.catalog') return catalog;
    if (status.process !== 'ready') throw new WidgetBackendError({ code: 'internal', message: `${status.appSessionId} has no ready process` });
    const subtype = SUBTYPE_OF[command];
    if (!subtype) throw new WidgetBackendError({ code: 'internal', message: `the widget backend does not answer ${command}` });
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
    status: (appSessionId) => statusOf(appSessionId),
    emitStatus(appSessionId, patch) {
      const next = shaped({ ...statusOf(appSessionId), ...patch });
      statuses.set(appSessionId, next);
      emit('session.status', { appSessionId, status: next });
      return next;
    },
    emitTurnStarted(appSessionId) {
      const current = statusOf(appSessionId);
      const id = EventIdSchema.parse(`${appSessionId}:${current.launchId}:${++turnSeq}:0`);
      const at = now();
      // C3 clears the local-lane observation at every turn.started.
      backend.emitStatus(appSessionId, {
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
