// A scripted stand-in for C3's engine host at the X2 seam, for the session service's tests (C10 execution document, M3
// pins: "a fake host answering C3's commands from scripts"). It keeps a process table, answers `session.launch` and
// then plays the statuses a launch reports (`initializing`, then `ready` with the pinned id and the trust answer, or an
// exit), and answers stop, send, the persisted queue, forget, rewind, rename, the relay and the registry. What survives
// an app restart (C3's store files and their queues, the registry) is kept apart, so a test can "restart" the app by
// taking `afterRestart()`, whose process table is empty. Never spawns anything.
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import type { AppSessionId, SessionId } from '../../src/shared/graph/ids';
import type { SessionEvent } from '../../src/shared/graph/events';
import type { Holder as SessionHolder } from '../../src/shared/wire/store';
import type { EngineSessionStatus } from '../../src/shared/engine/status';
import type { LaunchSpec } from '../../src/shared/engine/launch-spec';
import type { RelayHealth } from '../../src/shared/engine/relay-health';
import type { QueueEntry } from '../../src/shared/engine/session-state-store';
import type { CommandName, EventName, EventPayload, HostState } from '../../src/shared/ipc/schema';
import type { FsHoldersQuery } from '../../src/shared/ipc/schema/fs';
import type { LaunchResult } from '../../src/shared/ipc/schema/session';
import type { SetupIntent } from '../../src/shared/sessions/intent';
import type { HostDispatch } from '../../src/main/ipc/router';
import { status as statusOf, T0 } from './builders';

// How one launch goes. Defaults: `launching`, then `ready` with `trust.recorded` true when attested (null otherwise).
export interface LaunchScript {
  answer?: 'launching' | { relay: RelayHealth } | { refused: Extract<LaunchResult, { status: 'refused' }>['reason']; message: string };
  ready?: boolean; // false: the launch hangs in `initializing` (no ready, no exit)
  recorded?: boolean | null; // the initialize response's workspace_trust_recorded
  exit?: { error: string }; // the process exits before ready, having raised `error.raised { scope: 'process' }` with this text
  onReady?: (spec: LaunchSpec, engineSessionId: SessionId) => void | Promise<void>; // e.g. write the transcript a launch would
}

type RegistryRow = { sessionId: SessionId; holder: Exclude<SessionHolder, { kind: 'self' | 'none' }>; cwd: string | null; appSessionId: AppSessionId | null };

// What outlives the app: C3's state files (queue included), the registry.
export class HostDisk {
  readonly stores = new Set<string>();
  readonly queues = new Map<string, QueueEntry[]>();
  readonly registry: RegistryRow[] = [];
}

export const OK_RELAY: RelayHealth = { url: 'http://127.0.0.1:8641', ok: true, status: 200, latencyMs: 1, checkedAt: T0, error: null };
export const DOWN_RELAY: RelayHealth = { url: 'http://127.0.0.1:8641', ok: false, status: null, latencyMs: null, checkedAt: T0, error: 'ECONNREFUSED' };

export class FakeEngineHost {
  readonly launches: LaunchSpec[] = [];
  readonly calls: { name: string; input: unknown }[] = [];
  readonly table = new Map<string, EngineSessionStatus>();
  readonly events = new Map<string, SessionEvent[]>();
  readonly forgotten: string[] = [];
  relay: RelayHealth = OK_RELAY;
  script: (spec: LaunchSpec) => LaunchScript = () => ({});
  stopExits = true; // false: session.stop answers { exited: false } and the process lingers until exitNow()
  send: 'answer' | 'hang' | 'persist-then-hang' | 'refuse' = 'answer';
  queueListError: string | null = null;
  registryError: string | null = null;
  unfollowError: string | null = null;
  rewound = true;
  launchHangs: boolean | ((spec: LaunchSpec) => boolean) = false; // a crash point: `session.launch` never answers and nothing is reserved
  binaryPath = '/opt/engine/2.1.283';
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  private hostState: HostState = { state: 'starting', pid: null, restarts: 0, revision: 0 };

  constructor(readonly disk: HostDisk = new HostDisk()) {}

  // The app restarted: no process survives; the state files, queues and registry do.
  afterRestart(): FakeEngineHost {
    return new FakeEngineHost(this.disk);
  }

  calledWith(name: string): unknown[] {
    return this.calls.filter((c) => c.name === name).map((c) => c.input);
  }

  // A live registry holder (an interactive `claude` or a `--bg` job).
  hold(sessionId: string, holder: RegistryRow['holder'], cwd: string | null, appSessionId: string | null = null): void {
    this.disk.registry.push({ sessionId: sessionId as SessionId, holder, cwd, appSessionId: appSessionId as AppSessionId | null });
  }

  // A reservation made by some other path (a session MAWS runs now), in `cwd`.
  reserve(appSessionId: string, over: Partial<EngineSessionStatus> = {}): EngineSessionStatus {
    const s = { ...statusOf(appSessionId), ...over } as EngineSessionStatus;
    this.table.set(appSessionId, s);
    return s;
  }

  // The lingering process of a stop answered `{ exited: false }` finally exits.
  exitNow(appSessionId: string): void {
    const s = this.table.get(appSessionId);
    if (!s) return;
    this.setStatus({ ...s, process: 'exited', exit: { code: null, signal: 'SIGKILL', reason: 'stop', at: T0 } });
    this.batch(appSessionId, [{ kind: 'process.exited', code: null, signal: 'SIGKILL', reason: 'stop', lostAttentionCount: 0 }]);
  }

  readonly dispatch: HostDispatch = async (owner, name, input) => {
    if (owner !== 'engine-host') throw new Error(`unexpected owner ${owner}`);
    this.calls.push({ name, input });
    try {
      return { ok: true, value: (await this.answer(name, input as Record<string, unknown>)) as never };
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } };
    }
  };

  onEvent = <N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void): (() => void) => {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    const entry = listener as (payload: unknown) => void;
    set.add(entry);
    return () => set.delete(entry);
  };

  // IndexSessionSource's view of the host: never ready, so it does not sync; it still folds statuses.
  onState = (): (() => void) => () => {};
  snapshot = (): HostState => this.hostState;

  emitEvent<N extends EventName>(name: N, payload: EventPayload<N>): void {
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener(payload);
  }

  private setStatus(s: EngineSessionStatus): void {
    this.table.set(s.appSessionId, s);
    this.emitEvent('session.status', { appSessionId: s.appSessionId, status: s });
  }

  private batch(appSessionId: string, payloads: Record<string, unknown>[]): void {
    const list = this.events.get(appSessionId) ?? [];
    const events = payloads.map(
      (p, i) =>
        ({ id: `${appSessionId}:fake:${list.length + i}:0`, sessionId: this.table.get(appSessionId)?.engineSessionId ?? 'unknown', at: T0, seq: list.length + i + 1, agentId: null, parentToolUseId: null, ...p }) as SessionEvent,
    );
    list.push(...events);
    this.events.set(appSessionId, list);
    this.emitEvent('session.eventBatch', { appSessionId: appSessionId as AppSessionId, events });
  }

  private async answer(name: CommandName, input: Record<string, unknown>): Promise<unknown> {
    const id = (input ?? {}).appSessionId as string;
    switch (name) {
      case 'engine.sessions':
        return [...this.table.values()];
      case 'engine.binaryInfo':
        return { path: this.binaryPath, expectedVersion: '2.1.283', version: '2.1.283', ok: true, error: null };
      case 'engine.relayHealth':
        return this.relay;
      case 'fs.holders': {
        if (this.registryError !== null) throw new Error(this.registryError);
        const q = input as unknown as FsHoldersQuery;
        const ids = q.sessionIds === null ? null : new Set<string>(q.sessionIds);
        const dirs = q.directories === null ? null : new Set(await Promise.all(q.directories.map(canonical)));
        const holders = [];
        for (const row of this.disk.registry) {
          const cwd = row.cwd === null ? null : await canonical(row.cwd);
          if ((ids === null && dirs === null) || ids?.has(row.sessionId) || (cwd !== null && dirs?.has(cwd))) holders.push({ ...row, cwd });
        }
        return { refreshedAt: T0, holders };
      }
      case 'fs.unfollow':
        if (this.unfollowError !== null) throw new Error(this.unfollowError);
        return undefined;
      case 'fs.bind':
      case 'fs.unbind':
        return undefined;
      case 'session.launch':
        return this.launch((input as { spec: LaunchSpec }).spec);
      case 'session.status': {
        const s = this.table.get(id);
        if (!s) throw new Error(`unknown session ${id}`);
        return s;
      }
      case 'session.events':
        return { events: this.events.get(id) ?? [], lastSeq: (this.events.get(id) ?? []).length, complete: true };
      case 'session.stop': {
        const s = this.table.get(id);
        if (!s) throw new Error(`unknown session ${id}`);
        const reason = input.reason as 'stop' | 'archive';
        if (!this.stopExits) {
          this.setStatus({ ...s, process: 'exiting' });
          return { exited: false, code: null, signal: null };
        }
        this.setStatus({ ...s, process: 'exited', exit: { code: 0, signal: null, reason, at: T0 } });
        this.batch(id, [{ kind: 'process.exited', code: 0, signal: null, reason, lostAttentionCount: 0 }]);
        if (reason === 'archive') this.table.delete(id); // C3 releases an archived session's row at its exit
        return { exited: true, code: 0, signal: null };
      }
      case 'session.send': {
        const entry: QueueEntry = {
          queueId: randomUUID(), appSessionId: id as AppSessionId, content: input.content as QueueEntry['content'], createdAt: T0, state: 'submitting',
          messageUuid: randomUUID() as QueueEntry['messageUuid'], submittedAt: T0, uncertain: false, steer: false,
        };
        if (this.send === 'hang') return new Promise(() => {});
        if (this.send === 'refuse') throw new Error('send refused');
        this.disk.stores.add(id);
        this.disk.queues.set(id, [...(this.disk.queues.get(id) ?? []), entry]);
        if (this.send === 'persist-then-hang') return new Promise(() => {});
        return { messageUuid: entry.messageUuid, disposition: 'sent', queueId: entry.queueId };
      }
      case 'session.queue.list': {
        if (this.queueListError !== null) throw new Error(this.queueListError);
        if (this.disk.stores.has(id)) return { entries: this.disk.queues.get(id) ?? [], paused: false };
        if (this.table.has(id)) return { entries: [], paused: false };
        throw new Error(`unknown session ${id}`);
      }
      case 'session.forget': {
        const s = this.table.get(id);
        if (s && s.process !== 'exited') throw new Error(`already_live: process is ${s.process}`);
        this.table.delete(id);
        this.disk.stores.delete(id);
        this.disk.queues.delete(id);
        this.forgotten.push(id);
        return undefined;
      }
      case 'session.rewind':
        return { rewound: this.rewound, reason: this.rewound ? null : 'not found', error: null, prefillText: null, precedingAssistantUuid: null, files: null };
      case 'session.renameSession':
        return undefined;
      default:
        throw new Error(`the fake host does not answer ${name}`);
    }
  }

  private async launch(spec: LaunchSpec): Promise<LaunchResult> {
    if (this.launchHangs === true || (typeof this.launchHangs === 'function' && this.launchHangs(spec))) return new Promise(() => {});
    this.launches.push(spec);
    const script = this.script(spec);
    const answer = script.answer ?? 'launching';
    if (answer !== 'launching') {
      if ('relay' in answer) return { status: 'relay_unreachable', health: answer.relay };
      return { status: 'refused', reason: answer.refused, message: answer.message };
    }
    const existing = this.table.get(spec.appSessionId);
    if (existing && existing.process !== 'exited') return { status: 'refused', reason: 'already_live', message: `process is ${existing.process}` };
    const engineSessionId = (spec.sessionId ?? (spec.resume && !spec.resume.fork ? spec.resume.sessionId : randomUUID())) as SessionId;
    const launchId = randomUUID();
    const base: EngineSessionStatus = {
      ...statusOf(spec.appSessionId),
      engineSessionId,
      launchId,
      cwd: spec.cwd,
      process: 'starting',
      exit: null,
      turn: null,
      model: { requested: spec.model, resolved: spec.model === null ? 'claude-default' : `claude-${spec.model}` },
      effort: spec.effort,
      permissionMode: { requested: spec.permissionMode ?? 'default', effective: spec.permissionMode ?? 'default', refusal: null },
      gateway: { mode: spec.gateway, baseUrl: null, verified: 'pending', autoModeServer: 'unknown', localLane: null },
      trust: { attested: spec.trust !== null, recorded: null },
    };
    this.table.set(spec.appSessionId, base);
    this.disk.stores.add(spec.appSessionId);
    setTimeout(() => void this.play(spec, base, script), 0);
    return { status: 'launching', session: base };
  }

  private async play(spec: LaunchSpec, base: EngineSessionStatus, script: LaunchScript): Promise<void> {
    if (this.table.get(spec.appSessionId) !== base) return;
    this.setStatus({ ...base, process: 'initializing' });
    if (script.exit) {
      this.batch(spec.appSessionId, [{ kind: 'error.raised', scope: 'process', message: script.exit.error, code: 'exited', toolUseId: null, taskId: null, requestId: null }]);
      this.setStatus({ ...base, process: 'exited', exit: { code: 1, signal: null, reason: 'crash', at: T0 } });
      this.batch(spec.appSessionId, [{ kind: 'process.exited', code: 1, signal: null, reason: 'crash', lostAttentionCount: 0 }]);
      return;
    }
    if (script.ready === false) return;
    await script.onReady?.(spec, base.engineSessionId!);
    const recorded = script.recorded !== undefined ? script.recorded : spec.trust !== null ? true : null;
    this.setStatus({ ...base, process: 'ready', engineState: 'idle', trust: { attested: spec.trust !== null, recorded } });
  }
}

async function canonical(path: string): Promise<string> {
  try {
    return (await realpath(path)).normalize('NFC');
  } catch {
    return path.normalize('NFC');
  }
}

// A setup intent with every field at its `session.create` value, for tests.
export function intentFor(appSessionId: string, over: Partial<SetupIntent> = {}): SetupIntent {
  return {
    appSessionId: appSessionId as AppSessionId,
    projectId: null,
    createdAt: T0,
    updatedAt: T0,
    kind: 'create',
    source: null,
    location: { kind: 'directory', path: '/work' },
    additionalDirectories: [],
    model: null,
    effort: null,
    permissionMode: null,
    gateway: 'gateway',
    trust: 'unanswered',
    trustKey: null,
    message: null,
    draft: null,
    progress: { engineSessionId: null, worktree: null, trustRecorded: false, bootstrap: null, launch: null, send: null, lastFailure: null },
    ...over,
  };
}
