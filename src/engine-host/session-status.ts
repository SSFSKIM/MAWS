// What the frames and the handshake say about one process, for its EngineSessionStatus (C3 execution document,
// Interfaces "Process table and status"; split out of session.ts in M4): engine state and activity, the permission mode
// requested and effective with the pre-plan mode, the resolved model and engine version, the gateway verification and
// the per-turn local auto-mode lane, C11's fast mode and plugin fields, MCP servers, background tasks, held peer
// messages with their five-minute expiry, the memory sample, and C7's command catalogue. The session feeds it rows
// after they were journaled and normalised; it writes nothing and emits no events.
import { PERMISSION_MODES, type PermissionMode } from '@shared/graph/enums';
import type { EventId, TaskId } from '@shared/graph/ids';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { InitializeResponse } from '@shared/wire/control';

export const HELD_PEER_MESSAGE_TTL_MS = 5 * 60_000;

export interface Catalog { commands: unknown[]; agents: unknown[]; skills: unknown[]; terminalSlashCommands: unknown[]; revision: number }

type Frame = Record<string, unknown> & { type?: unknown; subtype?: unknown };
type Gateway = Omit<EngineSessionStatus['gateway'], 'mode'>;
export type TrackedStatus = Pick<
  EngineSessionStatus,
  'engineState' | 'activity' | 'permissionMode' | 'prePlanMode' | 'fastMode' | 'plugins' | 'pluginErrors' | 'pluginWarnings' | 'backgroundTasks' | 'mcpServers' | 'heldPeerMessages' | 'memory'
> & { gateway: Gateway; resolvedModel: string | null; engineVersion: string | null };

const FAST_MODE_STATES = ['off', 'cooldown', 'on'] as const;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => typeof x === 'object' && x !== null) as Record<string, unknown>[]) : []);

export function isPermissionMode(mode: string): mode is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(mode);
}

export class SessionStatusTracker {
  engineState: EngineSessionStatus['engineState'] = 'unknown';
  activity: EngineSessionStatus['activity'] = null;
  requestedMode: PermissionMode;
  effectiveMode: PermissionMode;
  prePlanMode: PermissionMode | null = null;
  resolvedModel: string | null = null;
  engineVersion: string | null = null;
  engineCwd: string | null = null; // system/init.cwd, the engine's canonical (realpath) working directory
  gateway: Gateway = { baseUrl: null, verified: 'pending', autoModeServer: 'unknown', localLane: null };
  fastMode: EngineSessionStatus['fastMode'] = { state: null, disabledReason: null };
  plugins: EngineSessionStatus['plugins'] = [];
  pluginErrors: EngineSessionStatus['pluginErrors'] = [];
  pluginWarnings: EngineSessionStatus['pluginWarnings'] = [];
  mcpServers: EngineSessionStatus['mcpServers'] = [];
  backgroundTasks: EngineSessionStatus['backgroundTasks'] = [];
  heldPeerMessages: EngineSessionStatus['heldPeerMessages'] = [];
  memory: EngineSessionStatus['memory'] = { rssKiB: null, treeRssKiB: null, sampledAt: null };
  peakTreeRssKiB: number | null = null;
  private catalogState: Catalog = { commands: [], agents: [], skills: [], terminalSlashCommands: [], revision: 0 };
  private modeKnown = false;
  private currentTurnEventId: EventId | null = null; // the last main-lane turn.started event id: status.turn.id while that turn is open

  get turnEventId(): EventId | null {
    return this.currentTurnEventId;
  }
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly spec: LaunchSpec,
    private readonly onChange: () => void, // a held peer message expired
  ) {
    this.requestedMode = spec.permissionMode ?? 'default';
    this.effectiveMode = this.requestedMode;
  }

  snapshot(): TrackedStatus {
    return {
      engineState: this.engineState, activity: this.activity,
      permissionMode: { requested: this.requestedMode, effective: this.effectiveMode, refusal: null }, prePlanMode: this.prePlanMode,
      gateway: { ...this.gateway, localLane: this.gateway.localLane && { ...this.gateway.localLane } }, resolvedModel: this.resolvedModel, engineVersion: this.engineVersion,
      fastMode: { ...this.fastMode }, plugins: this.plugins.map((p) => ({ ...p })), pluginErrors: this.pluginErrors.map((e) => ({ ...e })), pluginWarnings: this.pluginWarnings.map((w) => ({ ...w })),
      backgroundTasks: this.backgroundTasks.map((t) => ({ ...t })), mcpServers: this.mcpServers.map((s) => ({ ...s })), heldPeerMessages: this.heldPeerMessages.map((m) => ({ ...m })), memory: { ...this.memory },
    };
  }

  catalog(): Catalog {
    return structuredClone(this.catalogState);
  }

  initialize(init: InitializeResponse): void {
    this.setMode(init.current_permission_mode);
    if (this.spec.permissionMode === null && isPermissionMode(init.current_permission_mode)) this.requestedMode = init.current_permission_mode;
    this.setFastMode(init as Record<string, unknown>);
    this.setCatalog({ commands: init.commands, agents: init.agents ?? [] });
  }

  // The pre-plan mode is captured whenever the effective mode moves into plan from a known other mode, from any source
  // (initialize response, system/init, system/status), so clear_and_implement knows what to restore.
  setMode(mode: string): void {
    if (!isPermissionMode(mode)) return;
    if (mode === 'plan' && this.modeKnown && this.effectiveMode !== 'plan') this.prePlanMode = this.effectiveMode;
    this.effectiveMode = mode;
    this.modeKnown = true;
  }

  // A main-lane turn.started: the local-lane observation belongs to the turn it was made in (C11's correction).
  turnStarted(eventId: EventId): void {
    this.currentTurnEventId = eventId;
    this.gateway.localLane = null;
  }

  recordMemory(sample: EngineSessionStatus['memory']): void {
    this.memory = { ...sample };
    if (sample.treeRssKiB !== null) this.peakTreeRssKiB = Math.max(this.peakTreeRssKiB ?? 0, sample.treeRssKiB);
  }

  dispose(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  // One inbound frame (already journaled and normalised); `at` is its time.
  observe(frame: Frame, at: string): void {
    if (frame.type === 'stream_event') {
      const delta = (frame.event as { delta?: { safeguard_results?: unknown } } | undefined)?.delta;
      if (list(delta?.safeguard_results).some((r) => (r.status as { type?: unknown } | undefined)?.type === 'unavailable')) this.observeLocalLane(at);
      return;
    }
    if (frame.type !== 'system') return;
    switch (frame.subtype) {
      case 'init':
        if (typeof frame.parent_tool_use_id === 'string' && frame.parent_tool_use_id.length > 0) return;
        this.systemInit(frame);
        return;
      case 'status':
        this.activity = frame.status === 'compacting' || frame.status === 'requesting' ? frame.status : null;
        if (typeof frame.permissionMode === 'string') this.setMode(frame.permissionMode);
        return;
      case 'session_state_changed':
        if (frame.state === 'idle' || frame.state === 'running' || frame.state === 'requires_action') this.engineState = frame.state;
        return;
      case 'commands_changed':
        if (Array.isArray(frame.commands)) this.setCatalog({ commands: frame.commands });
        return;
      case 'informational':
        if (typeof frame.content === 'string' && /classifier/i.test(frame.content)) this.observeLocalLane(at); // the engine's own classifier lane and its billing notice (§19)
        return;
      case 'background_tasks_changed':
        this.backgroundTasks = list(frame.tasks).map((t) => ({ taskId: String(t.task_id) as TaskId, taskType: String(t.task_type), description: String(t.description ?? ''), ambient: t.ambient === true }));
        return;
      case 'peer_message_hold':
        this.peerMessageHold(frame, at);
        return;
    }
  }

  private systemInit(frame: Frame): void {
    if (typeof frame.model === 'string') this.resolvedModel = frame.model;
    if (typeof frame.claude_code_version === 'string') this.engineVersion = frame.claude_code_version;
    if (typeof frame.cwd === 'string') this.engineCwd = frame.cwd;
    if (typeof frame.permissionMode === 'string') this.setMode(frame.permissionMode);
    if (Array.isArray(frame.mcp_servers)) this.mcpServers = list(frame.mcp_servers).map((s) => ({ name: String(s.name), status: String(s.status), source: str(s.source) }));
    this.setFastMode(frame);
    this.plugins = list(frame.plugins).map((p) => ({ name: String(p.name), path: str(p.path) ?? '', source: str(p.source), version: str(p.version) }));
    // omitted by the engine when empty (SPEC 45 §45.10.2)
    this.pluginErrors = list(frame.plugin_errors).map((e) => ({ plugin: String(e.plugin ?? ''), type: String(e.type ?? ''), message: String(e.message ?? ''), path: str(e.path) }));
    this.pluginWarnings = list(frame.plugin_warnings).map((w) => ({ plugin: String(w.plugin ?? ''), type: String(w.type ?? ''), message: String(w.message ?? '') }));
    this.setCatalog({ skills: Array.isArray(frame.skills) ? frame.skills : [], terminalSlashCommands: Array.isArray(frame.terminal_slash_commands) ? frame.terminal_slash_commands : [] });
  }

  private setFastMode(source: Record<string, unknown>): void {
    if (!('fast_mode_state' in source) && !('fast_mode_disabled_reason' in source)) return;
    const state = source.fast_mode_state;
    this.fastMode = { state: (FAST_MODE_STATES as readonly unknown[]).includes(state) ? (state as EngineSessionStatus['fastMode']['state']) : null, disabledReason: str(source.fast_mode_disabled_reason) };
  }

  private observeLocalLane(at: string): void {
    if (this.currentTurnEventId === null) return; // no turn has started in this process: nothing to attribute it to
    this.gateway.localLane = { observedInTurn: this.currentTurnEventId, at };
  }

  // system/peer_message_hold (SPEC 38 §38.22.6): `held` parks a message, `released` or `dropped` ends the hold; a hold
  // leaves the table five minutes after `heldAt` even without either (M4), which retires main's attention item.
  private peerMessageHold(frame: Frame, at: string): void {
    const messageUuid = str(frame.message_uuid);
    const from = str(frame.from) ?? '';
    const lane = str(frame.lane) ?? 'unknown';
    const same = (m: EngineSessionStatus['heldPeerMessages'][number]) => (messageUuid !== null ? m.messageUuid === messageUuid : m.messageUuid === null && m.from === from && m.lane === lane);
    this.heldPeerMessages = this.heldPeerMessages.filter((m) => !same(m));
    if (frame.state === 'held') {
      const heldAt = Number.isNaN(Date.parse(at)) ? new Date().toISOString() : at;
      this.heldPeerMessages.push({ messageUuid, from, fromName: str(frame.from_name), lane, heldAt, expiresAt: new Date(Date.parse(heldAt) + HELD_PEER_MESSAGE_TTL_MS).toISOString() });
    }
    this.scheduleExpiry();
  }

  private scheduleExpiry(): void {
    this.dispose();
    if (this.heldPeerMessages.length === 0) return;
    const next = Math.min(...this.heldPeerMessages.map((m) => Date.parse(m.expiresAt)));
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      const now = Date.now();
      const before = this.heldPeerMessages.length;
      this.heldPeerMessages = this.heldPeerMessages.filter((m) => Date.parse(m.expiresAt) > now);
      this.scheduleExpiry();
      if (this.heldPeerMessages.length !== before) this.onChange();
    }, Math.max(0, next - Date.now()));
    (this.expiryTimer as { unref?: () => void }).unref?.();
  }

  private setCatalog(patch: Partial<Omit<Catalog, 'revision'>>): void {
    const next = { ...this.catalogState, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.catalogState)) return;
    this.catalogState = { ...next, revision: this.catalogState.revision + 1 };
  }
}
