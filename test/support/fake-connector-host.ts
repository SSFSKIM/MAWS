// The engine host as the connector service reaches it (P3-H H3b's scripted host, shared since P5 O4 M2 with the services
// front's per-client case, test/mawsd/connectors-clients.test.ts): the reads of what is there (the artifact, spaces,
// the live sessions), route E's operation commands (resolve, check, start, the id-only end, take, cancel) and the
// store's grants, every input and answer checked against the registry; its events dropped unless it streams.
import { expect } from 'vitest';
import type { CommandName, EventName, HostState } from '../../src/shared/ipc/schema';
import { validateCommandInput, validateCommandOutput } from '../../src/shared/ipc/validate';

export const CONNECTOR_ART = '11111111-1111-4111-8111-111111111111';
export const CONNECTOR_FP = 'f'.repeat(64);
const ART = CONNECTOR_ART;
const FP = CONNECTOR_FP;

export class FakeConnectorHost {
  readonly dispatched: { name: string; input: unknown }[] = [];
  readonly grants = new Map<string, 'read' | 'once'>(); // by tool key
  readonly outcomes = new Map<string, unknown>(); // by operation id, what take answers
  readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  readonly stateListeners = new Set<(state: HostState) => void>();
  readonly streamingListeners = new Set<() => void>();
  streams = true; // past the connection's ready line: its events reach main
  lostAnswers = new Set<string>(); // commands whose effect lands but whose answer never comes back
  readonly gates = new Map<string, Promise<void>>(); // commands answered only once the test opens their gate
  artifact: Record<string, unknown> = { id: ART, kind: 'html', title: 'Live', createdBy: { kind: 'session', appSessionId: 'app-own' }, projectId: 'proj', createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0 };
  live = [{ appSessionId: 'app-own', launchId: 'L1', cwd: '/repo', process: 'ready', lastUsedAt: '2026-10-16T10:00:00.000Z' }];
  readOnly = true;
  endAtStart = false; // the operation's end announced before start's answer
  result: unknown = { content: 'rows 107' };

  dispatch = async (owner: string, name: CommandName, input: unknown) => {
    expect(owner).toBe('engine-host');
    expect(validateCommandInput(name, input).ok, `${name} input`).toBe(true);
    this.dispatched.push({ name, input });
    const gate = this.gates.get(name);
    if (gate) await gate;
    const value = await this.answer(name, input as Record<string, unknown>);
    expect(validateCommandOutput(name, value).ok, `${name} output`).toBe(true);
    if (this.lostAnswers.has(name)) return { ok: false as const, error: { code: 'timeout' as const, message: `${name} unanswered` } };
    return { ok: true as const, value };
  };
  private async answer(name: string, input: Record<string, unknown>): Promise<unknown> {
    const key = (tool: unknown) => JSON.stringify([(tool as { server: string }).server, (tool as { tool: string }).tool]);
    switch (name) {
      case 'library.entry':
        return { artifact: this.artifact, links: [] };
      case 'spaces.list':
        return { spaces: [] };
      case 'engine.sessions':
        return this.live.map((session) => fullStatus(session));
      case 'connectors.resolve':
        return { ready: true, fingerprint: FP, readOnly: input.tool === 'rows' ? this.readOnly : false };
      case 'connectors.check': {
        const mode = this.grants.get(key(input.call));
        return mode ? { granted: true, mode } : { granted: false, refusal: 'notGranted' };
      }
      case 'connectors.start': {
        const operationId = input.operationId as string;
        this.outcomes.set(operationId, { ok: true, result: this.result });
        if (this.endAtStart) this.emit('connectors.operation', { operationId });
        return { operationId };
      }
      case 'connectors.take': {
        const outcome = this.outcomes.get(input.operationId as string) ?? null;
        this.outcomes.delete(input.operationId as string);
        return { outcome };
      }
      case 'connectors.cancel':
        return { cancelled: this.outcomes.delete(input.operationId as string) };
      case 'connectors.grants':
        return { grants: [...this.grants].map(([k, mode]) => ({ server: JSON.parse(k)[0], tool: JSON.parse(k)[1], fingerprint: FP, mode, grantedAt: 1 })) };
      case 'connectors.grant': {
        const grant = input.grant as { server: string; tool: string; fingerprint: string; mode: 'read' | 'once' };
        this.grants.set(key(grant), grant.mode);
        return { grant: { ...grant, grantedAt: 1 } };
      }
      case 'connectors.revoke':
        return { revoked: this.grants.delete(key(input)) };
      default:
        throw new Error(`unexpected ${name}`);
    }
  }
  onEvent = (name: EventName, listener: (payload: never) => void) => {
    const set = this.listeners.get(name) ?? new Set();
    set.add(listener as (payload: unknown) => void);
    this.listeners.set(name, set);
    return () => void set.delete(listener as (payload: unknown) => void);
  };
  onState = (_owner: string, listener: (state: HostState) => void) => {
    this.stateListeners.add(listener);
    return () => void this.stateListeners.delete(listener);
  };
  onStreaming = (_owner: string, listener: () => void) => {
    this.streamingListeners.add(listener);
    return () => void this.streamingListeners.delete(listener);
  };
  streaming = () => this.streams;
  // the host emits: dropped unless the connection streams (X13), as the runtime drops it
  emit(name: string, payload: unknown): void {
    if (!this.streams) return;
    for (const listener of this.listeners.get(name) ?? []) listener(payload);
  }
  startStreaming(): void {
    this.streams = true;
    for (const listener of this.streamingListeners) listener();
  }
  started(): string[] {
    return this.dispatched.filter((entry) => entry.name === 'connectors.start').map((entry) => (entry.input as { operationId: string }).operationId);
  }
  names(): string[] {
    return this.dispatched.map((entry) => entry.name);
  }
}

function fullStatus(session: { appSessionId: string; launchId: string; cwd: string; process: string; lastUsedAt: string }) {
  return {
    ...session, engineSessionId: null, pid: null, launchedAt: '', taskListId: null, pendingPlan: null, exit: null, engineState: 'idle', activity: null, turn: null,
    model: { requested: null, resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null }, prePlanMode: null,
    gateway: { mode: 'direct', baseUrl: null, verified: 'direct', autoModeServer: 'unknown', localLane: null }, subagentModel: null, modelOverrides: {}, engineVersion: null, fileCheckpointing: false, bin: '',
    fastMode: { state: null, disabledReason: null }, plugins: [], pluginErrors: [], pluginWarnings: [], pluginsObservedAt: null, backgroundTasks: [], grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0,
    queue: { length: 0, paused: false }, keepAlive: [], busy: false, memory: { rssKiB: null, treeRssKiB: null, sampledAt: null }, journalPath: '', hostHooks: [], lastEventSeq: 0, trust: { attested: false, recorded: null },
  };
}
