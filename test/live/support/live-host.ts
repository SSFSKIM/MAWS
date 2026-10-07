// The engine host as the app runs it, minus Electron (C3 execution document, M6): C1's host runtime serving C3's
// registerEngineIpc on an in-memory port, so every live case goes through the X2 surface the renderer uses: inputs
// validated before a handler runs, outputs and events validated before they are posted, typed errors forwarded, and
// every process launched by the product's launcher, EngineSession, transport and journal. Main's router is the only
// hop missing (C1's, tested there); the attention service in main is absent too (its unit tests pin what it derives).
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { AttentionItem } from '@shared/graph/attention';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { QueueState } from '@shared/engine/session-state-store';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { OperationEvent } from '@shared/engine/operations';
import { createHostRuntime, type HostPort } from '@shared/host/runtime';
import type { IpcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandOutput, EventName } from '@shared/ipc/schema';
import { captureShellEnvironment } from '@shared/host/shell-env';
import { registerEngineIpc, type EngineIpc, type EngineIpcDeps } from '../../../src/engine-host/ipc';
import { assertConfigHomeSafe, ownerConfigHome, persistingControlOf, type PersistingControl } from './live';
import { HostHookRegistry } from '../../../src/engine-host/host-hooks';
import { JOURNAL_MAX_BYTES, JournalWriter } from '../../../src/engine-host/journal';
import { buildLaunch, RELAY_URL, setBinaryConfig } from '../../../src/engine-host/launch';
import { ENGINE_BIN, ENGINE_VERSION } from '../../support/engine-pin'; // W13
import { journalDir } from '../../../src/engine-host/launcher';
import { EngineSession } from '../../../src/engine-host/session';
import { FileSessionStateStore } from '../../../src/engine-host/store/file-session-state-store';
import { MAX_LINE_CHARS, spawnEngine } from '../../../src/engine-host/transport';
import { registerFs } from '../../../src/engine-host/fs/register';
import type { FsService } from '../../../src/engine-host/fs/service';

export interface Emitted {
  name: EventName;
  payload: unknown;
  at: number; // Date.now() when the host posted it
}

export class LiveCallError extends Error {
  constructor(readonly command: string, readonly ipcError: IpcError) {
    super(`${command} failed: ${ipcError.code}: ${ipcError.message}`);
  }
}

export type CallResult<N extends CommandName> = { ok: true; value: CommandOutput<N>; ms: number } | { ok: false; error: IpcError; ms: number };

const POLL_MS = 25;

export class LiveHost {
  readonly emitted: Emitted[] = [];
  readonly ipc: EngineIpc;
  readonly fs: FsService | null = null; // W7: C4's filesystem service over the same home, when the case asks for it
  private deliver!: (data: unknown) => void;
  private readonly pending = new Map<string, (message: { ok: boolean; value?: unknown; error?: IpcError }) => void>();
  private counter = 0;

  private readonly controls: ReadonlySet<PersistingControl>;
  private readonly configHome: string; // the home the guard checks `#` path targets against

  // `configHome`: an explicit scratch CLAUDE_CONFIG_DIR (defaults to the environment; missing is refused);
  // `controls`: the persisting controls the case will issue, checked against the home before anything spawns;
  // `fs` (W7): also serve C4's `fs.*` over that scratch home, as the engine host does, `session.events` answering a
  // session with no stream from it. `binary` (W13): the binary path the host is configured with, as main's
  // `engine.configure` would send it: the fixtures' pin by default, null for the installed Claude Code.
  constructor(deps: Pick<EngineIpcDeps, 'userData'> & Partial<EngineIpcDeps> & { configHome?: string | null; controls?: PersistingControl[]; fs?: boolean; binary?: string | null }) {
    const { configHome = process.env.CLAUDE_CONFIG_DIR ?? null, controls = [], fs: withFs = false, binary = ENGINE_BIN, ...ipcDeps } = deps;
    setBinaryConfig({ binaryPath: binary });
    if (withFs && configHome === null) throw new Error('a live host serves fs.* only over a scratch config home');
    assertConfigHomeSafe({ configHome, controls });
    this.controls = new Set(controls);
    this.configHome = configHome ?? ownerConfigHome();
    const captureEnv = configHome === null ? ipcDeps.captureEnv : async () => ({ ...(await (ipcDeps.captureEnv ?? (() => captureShellEnvironment()))()), CLAUDE_CONFIG_DIR: configHome });
    let ipc!: EngineIpc;
    let fs: FsService | null = null;
    const runtime = createHostRuntime((on, emit) => {
      // as the engine host wires it (src/engine-host/index.ts): own pids from the table, disk reads after a yield
      const ownPids = () => new Set(ipc.table.list().flatMap((s) => (s.pid !== null && s.lifecycle !== 'exited' ? [s.pid] : [])));
      if (withFs) fs = registerFs(on, emit, { ...process.env, CLAUDE_CONFIG_DIR: configHome! }, { ownPids });
      const diskEvents = fs === null ? {} : { diskEvents: (id: AppSessionId) => fs!.eventsSnapshot(id, null), heldElsewhere: (id: AppSessionId, since: string | null) => fs!.heldElsewhere(id, since) };
      ipc = registerEngineIpc(on, emit, { replayEnabled: false, appVersion: '0.0.0-live', ...diskEvents, ...ipcDeps, ...(captureEnv ? { captureEnv } : {}) });
    });
    const port: HostPort = {
      postMessage: (message: unknown) => this.posted(message),
      start: () => {},
      on: (_event, listener) => void (this.deliver = (data) => listener({ data })),
    };
    runtime.serve(port);
    runtime.setReady(); // E10: main's ready line, sent once it pulled what it needs; events flow from here
    this.ipc = ipc;
    this.fs = fs;
  }

  private posted(message: unknown): void {
    const m = message as { t: string; id?: string; ok?: boolean; value?: unknown; error?: IpcError; name?: EventName; payload?: unknown };
    if (m.t === 'res' && m.id !== undefined) {
      this.pending.get(m.id)?.({ ok: m.ok === true, value: m.value, error: m.error });
      this.pending.delete(m.id);
    } else if (m.t === 'evt' && m.name) {
      this.emitted.push({ name: m.name, payload: m.payload, at: Date.now() });
    }
  }

  // A command through the runtime, as main would send it; the answer as the runtime posted it.
  async callRaw<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CallResult<N>> {
    const control = persistingControlOf(name, input, this.configHome);
    if (control !== null && !this.controls.has(control)) throw new Error(`live case issued ${control}, which it has not declared; declare it and run under a scratch config home`);
    const id = String(++this.counter);
    const started = Date.now();
    const answer = new Promise<{ ok: boolean; value?: unknown; error?: IpcError }>((resolve) => this.pending.set(id, resolve));
    this.deliver({ t: 'req', id, name, input });
    const res = await answer;
    const ms = Date.now() - started;
    return res.ok ? { ok: true, value: res.value as CommandOutput<N>, ms } : { ok: false, error: res.error!, ms };
  }

  async call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
    const res = await this.callRaw(name, input);
    if (!res.ok) throw new LiveCallError(name, res.error);
    return res.value;
  }

  private payloads<T>(name: EventName, appSessionId: string): T[] {
    return this.emitted.filter((e) => e.name === name && (e.payload as { appSessionId?: string }).appSessionId === appSessionId).map((e) => e.payload as T);
  }

  // Every event the session's batches carried, across its launches (ids name the launch).
  events(appSessionId: string): SessionEvent[] {
    return this.payloads<{ events: SessionEvent[] }>('session.eventBatch', appSessionId).flatMap((p) => p.events);
  }

  statuses(appSessionId: string): EngineSessionStatus[] {
    return this.payloads<{ status: EngineSessionStatus }>('session.status', appSessionId).map((p) => p.status);
  }

  status(appSessionId: string): EngineSessionStatus | null {
    return this.statuses(appSessionId).at(-1) ?? null;
  }

  brokerItems(appSessionId: string): AttentionItem[][] {
    return this.payloads<{ items: AttentionItem[] }>('session.brokerItems', appSessionId).map((p) => p.items);
  }

  queues(appSessionId: string): QueueState[] {
    return this.payloads<QueueState & { appSessionId: string }>('session.queue', appSessionId).map(({ entries, paused }) => ({ entries, paused }));
  }

  operations(appSessionId: string): OperationEvent[] {
    return this.payloads<OperationEvent>('session.operation', appSessionId);
  }

  // Re-evaluates `probe` until it returns something other than undefined, null or false.
  async waitFor<T>(probe: () => T | undefined | null | false, what: string, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = probe();
      if (value !== undefined && value !== null && value !== false) return value;
      if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  // session.launch, then the status stream until `ready` (or the process gave up); `readyMs` is the wall time to ready.
  async launch(spec: LaunchSpec, timeoutMs = 15_000): Promise<{ status: EngineSessionStatus; readyMs: number }> {
    const started = Date.now();
    const result = await this.call('session.launch', { spec });
    if (result.status !== 'launching') throw new Error(`session.launch answered ${JSON.stringify(result)}`);
    const launchId = result.session.launchId;
    const status = await this.waitFor(
      () => this.statuses(spec.appSessionId).find((s) => s.launchId === launchId && (s.process === 'ready' || s.process === 'exited')),
      `${spec.appSessionId} ready`,
      timeoutMs,
    );
    if (status.process !== 'ready') throw new Error(`${spec.appSessionId} exited before ready: ${JSON.stringify(status.exit)}`);
    return { status, readyMs: Date.now() - started };
  }

  // Ends whatever is still live (the quit path); safe to call twice.
  async shutdown(): Promise<void> {
    if (this.ipc.table.list().some((s) => s.lifecycle !== 'exited')) await this.call('engine.shutdown', { graceMs: 3_000 });
    this.fs?.stop();
  }

  launchIdOf(appSessionId: AppSessionId | string): string | null {
    return this.status(appSessionId)?.launchId ?? null;
  }
}

// One EngineSession built exactly as the launcher builds a live one (captured shell env, buildLaunch, the file journal,
// spawnEngine, the file state store), for the one case the X2 surface cannot reach: host hooks, which no production
// launch registers in P0 (Interfaces, X6), so `session.launch` has no way to pass them. Everything below the launcher
// is the product's code.
export async function startDirectSession(userData: string, spec: LaunchSpec, hooks: HostHookRegistry): Promise<{ session: EngineSession; events: SessionEvent[] }> {
  const configHome = process.env.CLAUDE_CONFIG_DIR ?? null;
  assertConfigHomeSafe({ configHome, controls: [] });
  const captured = { ...(await captureShellEnvironment()), CLAUDE_CONFIG_DIR: configHome! };
  const plan = buildLaunch(spec, captured, { relayUrl: RELAY_URL, bin: ENGINE_BIN, engineVersion: ENGINE_VERSION }); // W13: the fixtures' engine
  const session = new EngineSession({
    spec, plan, hooks, appVersion: '0.0.0-live', store: new FileSessionStateStore(userData),
    spawn: (p) => spawnEngine(p, { maxLineChars: MAX_LINE_CHARS }),
    journal: new JournalWriter(journalDir(userData, spec.appSessionId), plan.launchId, { maxBytes: JOURNAL_MAX_BYTES }),
  });
  const events: SessionEvent[] = [];
  session.on('events', (batch) => void events.push(...batch));
  void session.start();
  const deadline = Date.now() + 15_000;
  while (session.lifecycle !== 'ready') {
    if (session.lifecycle === 'exited' || Date.now() > deadline) throw new Error(`direct session not ready: ${session.lifecycle}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return { session, events };
}
