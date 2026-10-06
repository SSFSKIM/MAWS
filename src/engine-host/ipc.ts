// The engine host's X2 surface (C3 execution document, Interfaces "X2 — commands and events", M5): one handler per
// `session.*` and `engine.*` command the engine host owns, each in one of the three deadline shapes of "Deadlines and
// operations" (DEADLINE_SHAPES), so nothing the renderer awaits can outlive the bridge's 10 s router timeout:
// immediate (answered from host state or at a flushed write), bounded (control round trips under one 8 s budget; a
// ControlTimeout answers the typed `timeout` HostCommandError), and operations (a receipt now, `session.operation`
// later, through the OperationTable). Each live launch's events, statuses, queue and broker items leave through its
// SessionStream. A command naming an `appSessionId` with no session answers the typed `internal` error.
import type { AppSessionId, MessageUuid, RequestId } from '@shared/graph/ids';
import { AUTO_MODE_REFUSAL_CODES, type AutoModeRefusalCode } from '@shared/graph/enums';
import { assertSafeAppSessionId } from '@shared/engine/app-session-id';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import { canYield } from '@shared/engine/status'; // W7
import { SendContentSchema, type QueueState, type QueueEntry, type SessionStateStore } from '@shared/engine/session-state-store';
import type { RelayHealth } from '@shared/engine/relay-health';
import { HostCommandError, type HostEmit, type HostOn } from '@shared/host/runtime';
import { captureShellEnvironment, SHELL_CAPTURE_GRACE_MS, SHELL_CAPTURE_TIMEOUT_MS } from '@shared/host/shell-env';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import type { C3_ENGINE_COMMANDS } from '@shared/ipc/schema/engine';
import type { C3_SESSION_COMMANDS, E8_SESSION_COMMANDS, R2_SESSION_COMMANDS } from '@shared/ipc/schema/session';
import { SURFACE_CLIENT_ID } from '@shared/engine/surface'; // R2
import { createBinaryProbe, PROBE_BOUND_MS, type BinaryCheck } from './binary-info';
import { TESTED_ENGINE_VERSION } from './engine-compat'; // W13
import * as controls from './controls';
import { createLauncher } from './launcher';
import { LaunchSpecConflict, mergeFlagSettings, RELAY_URL, type LaunchPlan } from './launch';
// C11 start
import { setBinaryConfig } from './launch';
// C11 end
import { memoryAppend, MemoryAppendBudgetSpent } from './memory-append';
import { OperationTable } from './operations';
import { ProcessTable } from './process-table';
import { QueueEntryError } from './queue';
import { checkRelay as checkRelayHealth, RELAY_HEALTH_TIMEOUT_MS } from './relay-health';
import { rewind, rewindFiles } from './rewind';
import { ControlError, ControlTimeout, type ControlClient } from './rpc';
import type { EngineSession } from './session';
import { SessionStream } from './session-stream';
import { FileSessionStateStore } from './store/file-session-state-store';
import { queueTransaction } from './store/queue-transaction';
import { MAX_LINE_CHARS, spawnEngine, type EngineTransport } from './transport';
import { renderAnswerOf, rosterOf } from './surface-wire'; // R2
// C4 start
import type { SessionEvent } from '@shared/graph/events';
// C4 end
// E1 start
import type { commands as MawsCommands } from '@shared/ipc/schema/maws';
import { AskAnswerMismatch } from './tool-server/ask';
// E1 end
// C10 start
import type { ModelCatalogue } from '@shared/sessions/models';
import { catalogueKey, ModelsCache, modelsKey } from './models-cache';
// C10 end
// E8 start
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ReloadPluginsResponse } from '@shared/wire/control';
import { availableOf, installedOf, listing, marketplacesOf } from './plugins/cli-result';
import { PluginsRunner, SHUTDOWN_KILL_GRACE_MS, type Timers } from './plugins/runner';
import { READ_LINES } from '@shared/plugins/cli';
// E8 end

export type DeadlineShape = 'immediate' | 'bounded' | 'operation';
type C3Command = (typeof C3_SESSION_COMMANDS)[number] | (typeof C3_ENGINE_COMMANDS)[number];

// Interfaces "Deadlines and operations", command by command.
export const DEADLINE_SHAPES: Record<C3Command, DeadlineShape> = {
  'engine.binaryInfo': 'immediate', 'engine.relayHealth': 'immediate', 'engine.sessions': 'immediate', 'engine.shutdown': 'bounded',
  'session.launch': 'immediate', 'session.status': 'immediate', 'session.events': 'immediate', 'session.stop': 'bounded', 'session.pendingRequest': 'immediate', 'session.catalog': 'immediate',
  'session.send': 'immediate', 'session.steer': 'immediate', 'session.queue.list': 'immediate', 'session.queue.edit': 'immediate', 'session.queue.remove': 'immediate',
  'session.queue.promote': 'immediate', 'session.queue.hold': 'bounded' /* W1 */, 'session.queue.setPaused': 'immediate', 'session.interrupt': 'bounded', 'session.answer': 'immediate', 'session.bash': 'immediate',
  'session.memoryAppend': 'bounded', 'session.setPermissionMode': 'bounded', 'session.setModel': 'bounded', 'session.setEffort': 'bounded', 'session.setThinking': 'bounded',
  'session.applyFlagSettings': 'bounded', 'session.stopTask': 'bounded', 'session.rewind': 'bounded', 'session.rewindFiles': 'bounded', 'session.setCwd': 'bounded',
  'session.renameSession': 'bounded',
  'session.generateTitle': 'operation', 'session.reloadPlugins': 'operation', 'session.mcpReconnect': 'operation', 'session.mcpToggle': 'operation', 'session.sideQuestion': 'operation',
  'session.getUsage': 'bounded', 'session.getContextUsage': 'bounded', 'session.getSettings': 'bounded', 'session.listPermissionRules': 'bounded', 'session.getHooksListing': 'bounded',
  'session.getMemoryDialog': 'bounded', 'session.getSkillsDialog': 'bounded', 'session.getSandboxDialog': 'bounded', 'session.getWorkspaceDiff': 'bounded',
  'session.exportConversation': 'bounded', 'session.getStatus': 'bounded', 'session.mcpStatus': 'bounded', 'session.listModels': 'bounded', 'session.getSessionCost': 'bounded',
  'session.getBinaryVersion': 'bounded',
};

// C10 start: C10's engine-host commands (C10 execution document, X2 additions); each handler names its deadline shape
type C10Command = 'engine.models' | 'session.forget';
// C10 end
// R2: the remote surface's commands, bounded except `session.ui.answer` (immediate)
type R2Command = (typeof R2_SESSION_COMMANDS)[number];
export const R2_DEADLINE_SHAPES: Record<R2Command, DeadlineShape> = {
  'session.ui.render': 'bounded', 'session.ui.press': 'bounded', 'session.ui.input': 'bounded', 'session.ui.select': 'bounded', 'session.ui.focus': 'bounded',
  'session.ui.scroll': 'bounded', 'session.ui.panes': 'bounded', 'session.ui.paneShow': 'bounded', 'session.ui.paneFocus': 'bounded', 'session.ui.close': 'bounded',
  'session.ui.promptEdit': 'bounded', 'session.ui.answer': 'immediate',
};

// E8: `session.reloadSkills`, an operation like its plugins sibling. The `plugins.*` and `marketplaces.*` reads are one
// CLI run each under the bridge's 10 s deadline (accepted, E8 M1); their mutations are operations of the plugin runner.
export const E8_DEADLINE_SHAPES: Record<(typeof E8_SESSION_COMMANDS)[number], DeadlineShape> = { 'session.reloadSkills': 'operation' };
// E1: the `maws` tool server's commands (P1 ledger §5), each immediate: answered from the host's table or at the
// answer's flushed write
type MawsCommand = keyof typeof MawsCommands;
export const MAWS_DEADLINE_SHAPES: Record<MawsCommand, DeadlineShape> = { 'maws.asks.list': 'immediate', 'maws.ask.answer': 'immediate', 'maws.pane.answer': 'immediate' };

// The longest wait before a live launch spawns: its three checks run in parallel, each under its own bound (W13: the
// binary probe's covers a PATH lookup that waits for the capture before `--version`).
export const PRE_SPAWN_BOUND_MS = Math.max(SHELL_CAPTURE_TIMEOUT_MS + SHELL_CAPTURE_GRACE_MS, PROBE_BOUND_MS, RELAY_HEALTH_TIMEOUT_MS);
const BOUNDED_BUDGET_S = 8;

export interface EngineIpcDeps {
  userData: string;
  replayEnabled: boolean; // MAWS_ENGINE_REPLAY === '1'
  cwd?: string; // resolves relative replay paths and the prelude; default process.cwd()
  store?: SessionStateStore; // default FileSessionStateStore(userData), the P0 store
  table?: ProcessTable;
  ringSize?: number;
  batchMs?: number;
  appVersion?: string;
  binaryProbe?: () => Promise<BinaryCheck>;
  checkRelay?: (force: boolean) => Promise<RelayHealth>;
  captureEnv?: () => Promise<Record<string, string>>;
  spawn?: (plan: LaunchPlan) => EngineTransport;
  log?: (message: string) => void;
  // C4 start: the history of an app session with no stream in this host, from its transcript on disk (C4's
  // FsService.eventsSnapshot, which starts following it); absent, such a session is unknown here as before.
  diskEvents?: (appSessionId: AppSessionId) => Promise<{ events: SessionEvent[]; complete: boolean }>;
  // C4 end
  // W7: whether a foreign process holds the app session's engine session now, or held it at or after `since` (C4's
  // registry); absent, never
  heldElsewhere?: (appSessionId: AppSessionId, since: string | null) => boolean;
  pluginsTimers?: Timers; // E8: the plugin runner's timers (its settle, its CLI ceiling); default the real ones
}

export interface EngineIpc {
  table: ProcessTable;
  plugins: PluginsRunner; // E8
}

const unknownSession = (id: string) => new HostCommandError({ code: 'internal', message: `unknown session ${id}` });

// A bounded handler: the host's own deadline reaches the renderer as `timeout`, never as the router's; so does a
// `#` append refused because its budget ran out before the write (M5 review).
export async function bounded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ControlTimeout) throw new HostCommandError({ code: 'timeout', message: `${error.subtype} unanswered after ${BOUNDED_BUDGET_S} s` });
    if (error instanceof MemoryAppendBudgetSpent) throw new HostCommandError({ code: 'timeout', message: error.message });
    throw error;
  }
}

const isRefusal = (code: string | null): code is AutoModeRefusalCode => code !== null && (AUTO_MODE_REFUSAL_CODES as readonly string[]).includes(code);

export function registerEngineIpc(on: HostOn, emit: HostEmit, deps: EngineIpcDeps): EngineIpc {
  const log = deps.log ?? ((message: string) => console.warn(`[engine-host] ${message}`));
  const table = deps.table ?? new ProcessTable();
  const store = deps.store ?? new FileSessionStateStore(deps.userData);
  const streams = new Map<AppSessionId, SessionStream>();
  const specs = new Map<AppSessionId, LaunchSpec>();
  const operations = new OperationTable((event) => {
    // E8 (D-13): a successful reload_plugins answer is the session's plugins now, published before its completion
    if (event.command === 'session.reloadPlugins' && event.outcome.ok && event.outcome.value !== null) table.get(event.appSessionId)?.noteReload(event.outcome.value as ReloadPluginsResponse);
    emit('session.operation', event);
  });
  const relayCheck = deps.checkRelay ?? ((force: boolean) => checkRelayHealth(RELAY_URL, undefined, { force }));
  const captureEnv = deps.captureEnv ?? (() => captureShellEnvironment());
  const binaryProbe = deps.binaryProbe ?? createBinaryProbe({ captureEnv }); // W13: the installed binary, per call
  // E8 start: the engine's plugin CLI, run by the binary a launch would run under the captured environment; after a
  // successful mutation it reloads every ready session, applying each answer to that session's status (D-4, D-13)
  const plugins = new PluginsRunner({
    binary: binaryProbe,
    captureEnv,
    timers: deps.pluginsTimers,
    emit: (event) => emit('plugins.operation', event),
    changed: () => emit('plugins.changed', {}),
    reloadTargets: () =>
      [...specs].flatMap(([id, spec]) => {
        const session = table.get(id);
        const client = session?.control;
        if (!session || session.lifecycle !== 'ready' || !client) return [];
        const reload = async () => {
          const answer = await controls.reloadPlugins(client, {});
          session.noteReload(answer);
          return answer;
        };
        return [{ id, directory: spec.cwd, reload }];
      }),
  });
  // E8 end
  // C10 start: the model catalogue, updated from every initialize response and every list_models answer, each under
  // its launch's key (binary version and route: debt wave 3; and the model environment its settings set: debt wave 5)
  const models = new ModelsCache(deps.userData, { warn: log });
  const modelsLoaded = models.load();
  const modelKeys = new Map<AppSessionId, Promise<string>>();
  const updateModels = (id: AppSessionId, list: readonly unknown[]) => {
    const key = modelKeys.get(id);
    if (key !== undefined) void Promise.all([key, modelsLoaded]).then(([resolved]) => models.update(resolved, list));
  };
  // C10 end

  const launch = createLauncher({
    userData: deps.userData,
    replayEnabled: deps.replayEnabled,
    cwd: deps.cwd ?? process.cwd(),
    table,
    store,
    binaryProbe,
    checkRelay: relayCheck,
    captureEnv,
    spawn: deps.spawn ?? ((plan) => spawnEngine(plan, { maxLineChars: MAX_LINE_CHARS })),
    appVersion: deps.appVersion ?? 'unknown',
    log,
    wire: (session, plan, spec) => {
      specs.set(spec.appSessionId, spec);
      streams.get(spec.appSessionId)?.dispose(); // the previous launch's stream: its events are that launch's
      const stream = new SessionStream({
        appSessionId: spec.appSessionId, launchId: plan.launchId, sessionId: plan.sessionId, journalPath: session.status().journalPath,
        emit, ringSize: deps.ringSize, batchMs: deps.batchMs,
      });
      streams.set(spec.appSessionId, stream);
      session.on('events', (events) => stream.events(events));
      session.on('status', (status) => stream.status(status));
      session.on('queue', (queue) => stream.queue(queue));
      session.on('brokerItems', (items) => stream.brokerItems(items));
      session.on('catalog', (catalog) => stream.catalog(catalog)); // C7: session.catalogChanged
      modelKeys.set(spec.appSessionId, catalogueKey(plan.engineVersion, plan.gateway, { env: plan.env, cwd: plan.cwd, flagEnv: plan.flagSettings.env })); // C10; never rejects
      session.on('models', (list) => updateModels(spec.appSessionId, list)); // C10
      session.on('paneShow', (request) => emit('maws.pane.show', request)); // E1: relayed to every window
    },
  });

  // Registration with the input's appSessionId narrowed to the branded id the host's maps use.
  const handle = <N extends C3Command & CommandName>(name: N, handler: (input: CommandInput<N>) => Promise<CommandOutput<N>>) => on(name, handler);
  const sessionOf = (id: string): EngineSession => table.get(id as AppSessionId) ?? throwing(unknownSession(id));
  const streamOf = (id: string): SessionStream => streams.get(id as AppSessionId) ?? throwing(unknownSession(id));
  const ready = (id: string): { session: EngineSession; client: ControlClient } => {
    const session = sessionOf(id);
    if (session.lifecycle !== 'ready' || !session.control) throw new Error(`session ${id} is not ready (${session.lifecycle})`);
    return { session, client: session.control };
  };
  const read = <S extends controls.OutboundSubtype>(subtype: S) => (input: { appSessionId: string }) =>
    bounded(() => ready(input.appSessionId).client.request(subtype, {} as controls.OutboundRequest<S>));

  // -- engine.* ------------------------------------------------------------------------------------------------------
  handle('engine.binaryInfo', async () => binaryProbe()); // W13: resolved and probed per call, the version cached by file
  handle('engine.relayHealth', async ({ force }) => relayCheck(force));
  handle('engine.sessions', async () => table.list().map((session) => session.status()));
  handle('engine.shutdown', async ({ graceMs }) => {
    // E8: a plugin CLI outlives nothing it should not (X13): answered only once every CLI's process group is gone, its
    // SIGKILL sooner than a cancel's so the stop fits main's quit bound
    const [result] = await Promise.all([table.shutdown({ graceMs }), plugins.stop(SHUTDOWN_KILL_GRACE_MS)]);
    return result;
  });
  // C12 start: the memory budget (C12 execution document, Interfaces "X2 additions"). Both immediate: the policy is
  // evaluated at once against the previous sample (a release it makes is a stop the table starts, not awaited here),
  // and the state is the table's own; the event goes out whenever the state changes and at every release.
  on('engine.policy.set', async (policy) => table.configure(policy));
  on('engine.budget', async () => table.budgetState());
  table.onBudget((state) => emit('engine.budget', state));
  // An exited row dropped beyond the cap takes its stream and spec with it, as an archive's release does, but nothing
  // is forgotten: no session.forgotten, the state file and the journal stay, and session.events answers from disk.
  table.onDropped((id) => {
    streams.get(id)?.dispose();
    streams.delete(id);
    specs.delete(id);
    modelKeys.delete(id); // C10
  });
  // C12 end
  // C11 start: the binary configuration main sends from settings.engine (C11 execution document, M1). The next launch
  // and engine.binaryInfo read it; a process already spawned keeps the path its plan carries. C3's setter refuses a
  // relative path (the validator already has), which reaches the renderer as invalid_input. W13: the path only; null
  // is the installed Claude Code.
  on('engine.configure', async ({ binaryPath }) => {
    try {
      setBinaryConfig({ binaryPath });
    } catch (error) {
      throw new HostCommandError({ code: 'invalid_input', message: error instanceof Error ? error.message : String(error) });
    }
    return binaryProbe();
  });
  // C11 end

  // -- lifecycle and state -------------------------------------------------------------------------------------------
  handle('session.launch', async ({ spec }) => launch(spec as Parameters<typeof launch>[0]));
  handle('session.status', async ({ appSessionId }) => sessionOf(appSessionId).status());
  handle('session.events', async ({ appSessionId, afterSeq, limit }) => {
    // C4 start: no stream here (not launched in this run, or archived and released): the transcript's history, whose
    // events carry no seq, so `afterSeq` and `limit` select nothing and `lastSeq` is 0
    if (deps.diskEvents && !streams.has(appSessionId as AppSessionId)) return { ...(await deps.diskEvents(appSessionId as AppSessionId)), lastSeq: 0 };
    // C4 end
    // W7: a process that exited while a foreign one held the session, or before one took it (it yielded, or it stopped
    // beside a terminal that resumed the id), is not the session's history any more: the transcript is, as the other
    // process wrote it, also after that process exits. A new launch of the id makes its stream the history again.
    const exited = table.get(appSessionId as AppSessionId);
    if (deps.diskEvents && exited?.lifecycle === 'exited' && deps.heldElsewhere?.(appSessionId as AppSessionId, exited.status().exit?.at ?? null)) {
      return { ...(await deps.diskEvents(appSessionId as AppSessionId)), lastSeq: 0 };
    }
    return streamOf(appSessionId).snapshot(afterSeq, limit);
  });
  handle('session.stop', async ({ appSessionId, reason, ifIdle }) => {
    if (reason === 'archive') assertSafeAppSessionId(appSessionId); // archive deletes a directory named after it (M5 review)
    const session = sessionOf(appSessionId);
    // W7: the yield's stop, decided against the process as it is now, with no await between the check and the stop
    if (ifIdle === true && !canYield(session.status())) return { exited: false, code: null, signal: null, skipped: true as const };
    const result = await session.stop(reason);
    if (reason === 'archive') {
      const id = appSessionId as AppSessionId;
      // the journal directory only; the state file with the queue and the grant snapshot survives an archive so an
      // unarchived session resumes with them, charter §12 C10
      await store.forgetJournal(id);
      streams.get(id)?.flush(); // the session's last events first
      emit('session.forgotten', { appSessionId: id }); // main's attention service retires it (M5 review)
      // the host keeps nothing of an archived session (whole-branch review): its row, stream and spec go at its exit
      const release = () => {
        if (table.get(id) !== session || !table.release(id)) return; // relaunched meanwhile: the new launch owns them
        streams.get(id)?.dispose();
        streams.delete(id);
        specs.delete(id);
        modelKeys.delete(id); // C10
      };
      if (session.lifecycle === 'exited') release();
      else void session.exited.then(release);
    }
    return result;
  });
  handle('session.pendingRequest', async ({ appSessionId, requestId }) => ({ event: streamOf(appSessionId).pendingRequest(requestId as RequestId) }));
  handle('session.catalog', async ({ appSessionId }) => sessionOf(appSessionId).catalog());

  // -- the composer ----------------------------------------------------------------------------------------------------
  handle('session.send', async ({ appSessionId, content }) => {
    const { messageUuid, disposition, queueId } = await sessionOf(appSessionId).send(content);
    return { messageUuid, disposition, queueId };
  });
  handle('session.steer', async ({ appSessionId, content, priority }) => sessionOf(appSessionId).steer(content, { priority: priority ?? 'now' }));
  handle('session.queue.list', async ({ appSessionId }) => {
    assertSafeAppSessionId(appSessionId); // it may read a state file named after it
    const session = table.get(appSessionId as AppSessionId);
    if (session?.queue.recovered) return session.queue.state;
    // no queue loaded in this host (no reservation, or a launch that never became ready): the store's, verbatim, with
    // no recovery transition (C10's restart reconciliation)
    if (await store.exists(appSessionId as AppSessionId)) {
      const { entries, paused, pauseReason } = await store.loadQueue(appSessionId as AppSessionId); // C7: pauseReason
      return pauseReason === undefined ? { entries, paused } : { entries, paused, pauseReason }; // C7: absent in a state file older than the field
    }
    if (session) return session.queue.state;
    throw unknownSession(appSessionId);
  });
  // Retained prompts are editable before a new process exists. Serialize read/modify/save pairs per id so
  // concurrent edits/removals cannot restore one another's old snapshots; do not run recovery merely to edit.
  function editQueue<T>(appSessionId: string, live: (session: EngineSession) => Promise<T>, saved: (queue: QueueState) => T): Promise<T> {
    assertSafeAppSessionId(appSessionId);
    return queueTransaction(store, appSessionId as AppSessionId, async () => {
      const id = appSessionId as AppSessionId;
      const session = table.get(id);
      if (session?.queue.recovered) return live(session);
      if (!(await store.exists(id))) throw unknownSession(appSessionId);
      const { corrupt, ...queue } = await store.loadQueue(id);
      if (corrupt !== null) throw new QueueEntryError(`The saved queue could not be read; kept at ${corrupt}`);
      const result = saved(queue);
      await store.saveQueue(id, queue);
      emit('session.queue', { appSessionId: id, ...queue });
      return result;
    });
  }
  function savedEntry(queue: QueueState, queueId: string): QueueEntry {
    const entry = queue.entries.find((e) => e.queueId === queueId);
    if (!entry || entry.state !== 'queued') throw new QueueEntryError('This message is not queued');
    return entry;
  }
  handle('session.queue.edit', async ({ appSessionId, queueId, content }) => editQueue(appSessionId,
    (session) => session.queue.edit(queueId, content), (queue) => {
      const entry = savedEntry(queue, queueId);
      entry.content = SendContentSchema.parse(content);
      entry.uncertain = false;
      return entry;
    }));
  handle('session.queue.remove', async ({ appSessionId, queueId }) => editQueue(appSessionId,
    (session) => session.queue.remove(queueId), (queue) => {
      const entry = savedEntry(queue, queueId);
      queue.entries = queue.entries.filter((e) => e !== entry);
    }));
  handle('session.queue.promote', async ({ appSessionId, queueId, priority }) => sessionOf(appSessionId).queue.promote(queueId, { priority: priority ?? 'now' }));
  handle('session.queue.hold', async ({ appSessionId, messageUuid }) => bounded(() => sessionOf(appSessionId).queue.hold(messageUuid as MessageUuid))); // W1
  handle('session.queue.setPaused', async ({ appSessionId, paused }) => sessionOf(appSessionId).queue.setPaused(paused));
  handle('session.interrupt', async ({ appSessionId, cancelEngineQueued, holdEngineQueued }) => bounded(() => sessionOf(appSessionId).interrupt({ cancelEngineQueued, holdEngineQueued: holdEngineQueued ?? false })));
  handle('session.answer', async ({ appSessionId, requestId, answer }) => ({ outcome: await sessionOf(appSessionId).answer(requestId as RequestId, answer as Parameters<EngineSession['answer']>[1]) }));
  handle('session.bash', async ({ appSessionId, command }) => sessionOf(appSessionId).bash(command));
  handle('session.memoryAppend', async ({ appSessionId, text, target }) => {
    const session = sessionOf(appSessionId);
    session.markUsed(); // C12: a `#` note is use
    return bounded(() => memoryAppend(session, { text, target }, { budgetMs: BOUNDED_BUDGET_S * 1000 }));
  });

  // -- mutations -------------------------------------------------------------------------------------------------------
  handle('session.setPermissionMode', async ({ appSessionId, mode }) =>
    bounded(async () => {
      const { session, client } = ready(appSessionId);
      session.markUsed(); // C12: a mode change is use, whatever the engine answers
      try {
        const response = await controls.setPermissionMode(client, { mode });
        session.noteRequested({ permissionMode: { mode, refusal: null, effective: response.mode } });
        const effective = session.status().permissionMode.effective;
        return { effective, refusal: null, error: null };
      } catch (error) {
        if (!(error instanceof ControlError) || error instanceof ControlTimeout) throw error;
        const refusal = isRefusal(error.code) ? error.code : null;
        if (refusal) session.noteRequested({ permissionMode: { mode, refusal, effective: null } });
        return { effective: session.status().permissionMode.effective, refusal, error: error.message };
      }
    }),
  );
  handle('session.setModel', async ({ appSessionId, model }) =>
    bounded(async () => {
      const { session, client } = ready(appSessionId);
      session.markUsed(); // C12
      try {
        await controls.setModel(client, { model });
      } catch (error) {
        if (!(error instanceof ControlError) || error instanceof ControlTimeout) throw error;
        return { ok: false, error: error.message, code: error.code };
      }
      session.noteRequested({ model });
      return { ok: true, error: null, code: null };
    }),
  );
  handle('session.setEffort', async ({ appSessionId, effort }) =>
    bounded(async () => {
      const { session, client } = ready(appSessionId);
      session.markUsed(); // C12
      await controls.applyFlagSettings(client, { settings: { effortLevel: effort } }); // null clears (M6 observes the live answer)
      session.noteRequested({ effort });
    }),
  );
  handle('session.setThinking', async ({ appSessionId, maxThinkingTokens, display }) =>
    bounded(async () => {
      const { session, client } = ready(appSessionId);
      session.markUsed(); // C12
      await controls.setMaxThinkingTokens(client, { max_thinking_tokens: maxThinkingTokens, display });
    }),
  );
  handle('session.applyFlagSettings', async ({ appSessionId, settings }) =>
    bounded(async () => {
      const { session, client } = ready(appSessionId);
      try {
        // the X6 protected keys hold for the process's life, not only at launch
        mergeFlagSettings({ ...specs.get(appSessionId as AppSessionId)!, effort: session.status().effort, extraSettings: settings });
      } catch (error) {
        if (error instanceof LaunchSpecConflict) throw new Error(error.message, { cause: error });
        throw error;
      }
      await controls.applyFlagSettings(client, { settings });
    }),
  );
  handle('session.stopTask', async ({ appSessionId, taskId }) => bounded(async () => void (await controls.stopTask(ready(appSessionId).client, { task_id: taskId }))));
  handle('session.rewind', async ({ appSessionId, targetMessageUuid, lastSeenMessageUuid, files }) =>
    bounded(() => rewind(sessionOf(appSessionId), { targetMessageUuid: targetMessageUuid as never, lastSeenMessageUuid: lastSeenMessageUuid as never, files })),
  );
  handle('session.rewindFiles', async ({ appSessionId, userMessageUuid, dryRun }) => bounded(() => rewindFiles(sessionOf(appSessionId), { userMessageUuid: userMessageUuid as never, dryRun })));
  handle('session.setCwd', async ({ appSessionId, path, trust }) =>
    bounded(async () => {
      const { session, client } = ready(appSessionId);
      const response = await controls.setCwd(client, trust ? { path, trust_accepted: true, trusted_directory: trust.directory } : { path });
      if (response.status === 'ok') session.noteCwd(response.cwd);
      return response;
    }),
  );
  handle('session.renameSession', async ({ appSessionId, title }) => bounded(async () => void (await controls.renameSession(ready(appSessionId).client, { title, source: 'host' }))));

  // -- operations --------------------------------------------------------------------------------------------------------
  const operation = (id: string) => ({ id: id as AppSessionId, client: ready(id).client });
  handle('session.generateTitle', async ({ appSessionId, description, persist }) => {
    const { id, client } = operation(appSessionId);
    return operations.start(id, 'session.generateTitle', client, 'generate_session_title', { description, persist });
  });
  handle('session.reloadPlugins', async ({ appSessionId }) => {
    const { id, client } = operation(appSessionId);
    return operations.start(id, 'session.reloadPlugins', client, 'reload_plugins', {});
  });
  handle('session.mcpReconnect', async ({ appSessionId, serverName }) => {
    const { id, client } = operation(appSessionId);
    return operations.start(id, 'session.mcpReconnect', client, 'mcp_reconnect', { serverName });
  });
  handle('session.mcpToggle', async ({ appSessionId, serverName, enabled }) => {
    const { id, client } = operation(appSessionId);
    return operations.start(id, 'session.mcpToggle', client, 'mcp_toggle', { serverName, enabled });
  });
  handle('session.sideQuestion', async ({ appSessionId, question }) => {
    const { id, client } = operation(appSessionId);
    return operations.start(id, 'session.sideQuestion', client, 'side_question', { question });
  });

  // -- structured reads --------------------------------------------------------------------------------------------------
  handle('session.getUsage', read('get_usage'));
  handle('session.getContextUsage', async ({ appSessionId, detail }) => bounded(() => controls.getContextUsage(ready(appSessionId).client, { detail })));
  handle('session.getSettings', read('get_settings'));
  handle('session.listPermissionRules', read('list_permission_rules'));
  handle('session.getHooksListing', read('get_hooks_listing'));
  handle('session.getMemoryDialog', read('get_memory_dialog'));
  handle('session.getSkillsDialog', read('get_skills_dialog'));
  handle('session.getSandboxDialog', read('get_sandbox_dialog'));
  handle('session.getWorkspaceDiff', read('get_workspace_diff'));
  handle('session.exportConversation', read('export_conversation'));
  handle('session.getStatus', read('get_status'));
  handle('session.mcpStatus', read('mcp_status'));
  // C10 start: every list_models answer also refreshes the catalogue cache
  handle('session.listModels', async (input) => {
    const answer = await read('list_models')(input);
    updateModels(input.appSessionId as AppSessionId, answer.models);
    return answer;
  });
  // C10 end
  handle('session.getSessionCost', read('get_session_cost'));
  handle('session.getBinaryVersion', read('get_binary_version'));

  // C10 start -----------------------------------------------------------------------------------------------------------
  const handleC10 = <N extends C10Command>(name: N, handler: (input: CommandInput<N>) => Promise<CommandOutput<N>>) => on(name, handler);

  // The catalogue before any session exists, for the route the caller names (the launch's binary version and that
  // route key the cache; with no route, the most recent catalogue of any) and, when it names one, the directory it
  // would launch in (whose settings may key it apart, debt wave 5; before that key's first list, the route's): with
  // `refresh`, the most recently launched ready session's list_models among that key's (a failure falls back to what
  // is cached, logged); otherwise the cache, else the built-in list. Bounded: its one control round trip runs under
  // `bounded`.
  handleC10('engine.models', async ({ refresh, gateway, cwd }): Promise<ModelCatalogue> => {
    await modelsLoaded;
    // W13: the version the next launch would run, as the binary probe answers it (the tested one while none answers)
    const version = gateway === undefined ? TESTED_ENGINE_VERSION : ((await binaryProbe()).version ?? TESTED_ENGINE_VERSION);
    const route = gateway === undefined ? undefined : modelsKey(version, gateway);
    const key = gateway === undefined || cwd === undefined ? route : await catalogueKey(version, gateway, { env: await captureEnv(), cwd });
    const ready = await Promise.all(
      table
        .list()
        .filter((session) => refresh && session.lifecycle === 'ready' && session.control)
        .map(async (session) => ({ session, key: await modelKeys.get(session.status().appSessionId) })),
    );
    const asked = ready.filter((candidate) => candidate.key !== undefined && (key === undefined || candidate.key === key)).sort((a, b) => b.session.status().launchedAt.localeCompare(a.session.status().launchedAt))[0];
    if (asked?.session.control) {
      const askedKey = asked.key!;
      try {
        const answer = await bounded(() => controls.listModels(asked.session.control!, {}));
        await models.update(askedKey, answer.models);
        return { ...models.answer(askedKey), source: 'live' };
      } catch (error) {
        log(`engine.models: list_models failed (${error instanceof Error ? error.message : String(error)}); answering the cache`);
      }
    }
    return models.answer(key, route);
  });

  // The whole erase behind delete conversation: the state file and the journal directory, then `session.forgotten` so
  // main's attention service retires the id. Refused while a process is reserved; the host keeps nothing afterwards.
  // Immediate: no control round trip, answered once the erase is flushed.
  handleC10('session.forget', async ({ appSessionId }) => {
    assertSafeAppSessionId(appSessionId); // it deletes a file and a directory named after it
    const id = appSessionId as AppSessionId;
    const session = table.get(id);
    const state = session?.status().process;
    if (session && state !== 'exited') throw new HostCommandError({ code: 'internal', message: `already_live: process is ${state}` });
    // `exited` is set at the exit row, before the exit's queue and store saves land; `session.exited` settles after them
    // (session.ts handleExit), so waiting on it keeps a late save from recreating the state file erased below
    if (session) await session.exited;
    // a different row under the id is a relaunch; a row merely released meanwhile (a concurrent forget, the archive's
    // release) is not, and the erase below is idempotent
    const now = table.get(id);
    if (now && now !== session) throw new HostCommandError({ code: 'internal', message: `already_live: ${id} was relaunched` });
    table.release(id);
    streams.get(id)?.dispose();
    streams.delete(id);
    specs.delete(id);
    modelKeys.delete(id);
    await store.forget(id);
    emit('session.forgotten', { appSessionId: id });
  });
  // C10 end -------------------------------------------------------------------------------------------------------------

  // R2 start: the renderer's asks of the engine's remote surface (shared/ipc/schema/session.ts, the R2 block). Bounded:
  // one control round trip each on the session's attached client, the host adding the surface and the client id;
  // `session.ui.answer` is immediate (the answer's flushed write).
  const handleR2 = <N extends R2Command>(name: N, handler: (input: CommandInput<N>) => Promise<CommandOutput<N>>) => on(name, handler);
  const attached = (id: string): { session: EngineSession; client: ControlClient; address: { surface: 'desktop'; client_id: string } } => {
    const { session, client } = ready(id);
    if (!session.surface.attached) throw new HostCommandError({ code: 'internal', message: `session ${id} has no engine surface (the engine did not advertise ui_surface_v1)` });
    return { session, client, address: session.surface.address };
  };
  handleR2('session.ui.render', async ({ appSessionId, component, instanceId, props, viewport, contentRows, keyed }) =>
    bounded(async () => {
      const { client, address } = attached(appSessionId);
      const answer = await controls.uiRender(client, { ...address, component, instance_id: instanceId, props, ...(viewport && { viewport }), ...(contentRows !== undefined && { content_rows: contentRows }), ...(keyed && { keyed }) });
      return renderAnswerOf(answer, props);
    }),
  );
  handleR2('session.ui.press', async ({ appSessionId, plugin, handle, key, href }) =>
    bounded(async () => {
      const { session, client, address } = attached(appSessionId);
      session.markUsed(); // C12: a press is the human's use
      const answer = await controls.uiPress(client, { plugin, handle, ...(key !== undefined && { key }), ...(href !== undefined && { href }), ...address });
      return { handled: answer.handled, element: answer.element ?? null };
    }),
  );
  handleR2('session.ui.input', async ({ appSessionId, plugin, handle, kind, value, key, component, instanceId }) =>
    bounded(async () => {
      const { session, client, address } = attached(appSessionId);
      session.markUsed();
      const answer = await controls.uiInput(client, { plugin, handle, kind, value, ...(key !== undefined && { key }), ...(component !== undefined && { component }), ...(instanceId !== undefined && { instance_id: instanceId }), ...address });
      return { handled: answer.handled, element: answer.element ?? null, value: answer.value ?? null };
    }),
  );
  handleR2('session.ui.select', async ({ appSessionId, plugin, handle, value, key, component, instanceId }) =>
    bounded(async () => {
      const { session, client, address } = attached(appSessionId);
      session.markUsed();
      const answer = await controls.uiSelect(client, { plugin, handle, value, ...(key !== undefined && { key }), ...(component !== undefined && { component }), ...(instanceId !== undefined && { instance_id: instanceId }), ...address });
      return { handled: answer.handled, element: answer.element ?? null, value: answer.value ?? null };
    }),
  );
  handleR2('session.ui.focus', async ({ appSessionId, component, instanceId, isHeld, element, by }) =>
    bounded(async () => {
      const { client, address } = attached(appSessionId);
      const answer = await controls.uiFocus(client, { component, instance_id: instanceId, is_held: isHeld, element, by, ...address });
      return { moved: answer.moved, element: answer.element ? { plugin: answer.element.plugin, key: answer.element.key } : null, deny: answer.deny ?? null };
    }),
  );
  handleR2('session.ui.scroll', async ({ appSessionId, component, instanceId, offset, by, bodyRows, contentRows, keyed }) =>
    bounded(async () => {
      const { client, address } = attached(appSessionId);
      const answer = await controls.uiScroll(client, { component, instance_id: instanceId, offset, by, body_rows: bodyRows, content_rows: contentRows, ...(keyed && { keyed }), ...address });
      return { moved: answer.moved, offset: answer.offset ?? null, deny: answer.deny ?? null, followEnd: answer.follow_end === true };
    }),
  );
  handleR2('session.ui.panes', async ({ appSessionId }) => bounded(async () => rosterOf(await controls.uiPanes(attached(appSessionId).client, { client_id: SURFACE_CLIENT_ID }))));
  handleR2('session.ui.paneShow', async ({ appSessionId, id }) =>
    bounded(async () => {
      const { client, address } = attached(appSessionId);
      return { shownId: (await controls.uiPaneShow(client, { id, ...address })).shown_id ?? null };
    }),
  );
  handleR2('session.ui.paneFocus', async ({ appSessionId, id }) =>
    bounded(async () => {
      const { client, address } = attached(appSessionId);
      return { focusedId: (await controls.uiPaneFocus(client, { id, ...address })).focused_id ?? null };
    }),
  );
  handleR2('session.ui.close', async ({ appSessionId, id }) =>
    bounded(async () => {
      const { session, client, address } = attached(appSessionId);
      session.markUsed();
      return { closed: (await controls.uiClose(client, { id, ...address })).closed };
    }),
  );
  handleR2('session.ui.promptEdit', async ({ appSessionId, text, cursor, key, by }) =>
    bounded(async () => {
      const { client, address } = attached(appSessionId);
      await controls.uiPromptEdit(client, { text, cursor, ...(key && { key }), by, ...address });
    }),
  );
  handleR2('session.ui.answer', async ({ appSessionId, requestId, answer }) => {
    try {
      return { outcome: await sessionOf(appSessionId).answerSurface(requestId as RequestId, answer) };
    } catch (error) {
      throw new HostCommandError({ code: 'invalid_input', message: error instanceof Error ? error.message : String(error) });
    }
  });
  // R2 end

  // E8 start: plugin and marketplace management (E8 execution document, M1; Interfaces "X2: plugins.*, marketplaces.*,
  // session.reloadSkills"). A read is one CLI run (about a second; the bridge's 10 s deadline is accepted) reduced to the
  // fields the widget shows; every mutation is an operation completing on `plugins.operation`; `session.reloadSkills` is
  // an operation beside `session.reloadPlugins`.
  on('plugins.env', async () => {
    const [check, env] = await Promise.all([binaryProbe(), captureEnv()]);
    const home = env.HOME || homedir();
    // the engine's global config sits inside an override, else beside `~/.claude` (SPEC 03 §16.1; M2 review)
    const globalConfig = env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json');
    // a failed probe answers its refusal in its own words, so the sheet names why it cannot run (M2 review, round two)
    return { binary: check.ok ? check.path : null, binaryError: check.ok ? null : (check.error ?? null), configHome: env.CLAUDE_CONFIG_DIR || join(home, '.claude'), globalConfig };
  });
  on('plugins.list', async ({ cwd }) => ({ plugins: listing(await plugins.read(READ_LINES.installed, cwd), installedOf) }));
  on('plugins.available', async ({ cwd }) => ({ plugins: listing(await plugins.read(READ_LINES.available, cwd), availableOf) }));
  on('marketplaces.list', async ({ cwd }) => ({ marketplaces: listing(await plugins.read(READ_LINES.marketplaces, cwd), marketplacesOf) }));
  on('plugins.install', async ({ cwd, binary, plugin, scope, acceptCommand }) => plugins.start('install', { plugin, scope, acceptCommand }, cwd, binary));
  on('plugins.update', async ({ cwd, binary, plugin, scope, acceptCommand }) => plugins.start('update', { plugin, scope, acceptCommand }, cwd, binary));
  on('plugins.uninstall', async ({ cwd, binary, plugin, scope, keepData }) => plugins.start('uninstall', { plugin, scope, keepData }, cwd, binary));
  on('plugins.enable', async ({ cwd, binary, plugin, scope }) => plugins.start('enable', { plugin, scope }, cwd, binary));
  on('plugins.disable', async ({ cwd, binary, plugin, scope }) => plugins.start('disable', { plugin, scope }, cwd, binary));
  on('plugins.cancel', async ({ opId }) => ({ cancelled: plugins.cancel(opId) }));
  on('marketplaces.add', async ({ cwd, binary, source, scope }) => plugins.start('marketplace-add', { source, scope }, cwd, binary));
  on('marketplaces.update', async ({ cwd, binary, name }) => plugins.start('marketplace-update', { name }, cwd, binary));
  on('marketplaces.remove', async ({ cwd, binary, name, scope }) => plugins.start('marketplace-remove', { name, scope }, cwd, binary));
  on('session.reloadSkills', async ({ appSessionId }) => {
    const { id, client } = operation(appSessionId);
    return operations.start(id, 'session.reloadSkills', client, 'reload_skills', {});
  });
  // E8 end

  // E1 start: the `maws` tool server's commands. A session this host does not hold has no ask and nothing pending;
  // answers that do not fit the ask's questions are invalid input, never written.
  const handleMaws = <N extends MawsCommand>(name: N, handler: (input: CommandInput<N>) => Promise<CommandOutput<N>>) => on(name, handler);
  handleMaws('maws.asks.list', async ({ appSessionId }) => ({ asks: table.get(appSessionId as AppSessionId)?.asks() ?? [] }));
  handleMaws('maws.ask.answer', async ({ appSessionId, askId, answers }) => {
    const session = table.get(appSessionId as AppSessionId);
    if (!session) return { outcome: 'not_pending' };
    try {
      return { outcome: await session.answerAsk(askId, answers) };
    } catch (error) {
      if (error instanceof AskAnswerMismatch) throw new HostCommandError({ code: 'invalid_input', message: error.message });
      throw error;
    }
  });
  handleMaws('maws.pane.answer', async ({ appSessionId, requestId, result }) => ({ outcome: table.get(appSessionId as AppSessionId)?.answerPane(requestId as RequestId, result) ?? 'not_pending' }));
  // E1 end

  return { table, plugins };
}

function throwing(error: Error): never {
  throw error;
}
