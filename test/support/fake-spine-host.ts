// A `SpineHosts` for the spine's root (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces
// §G): an engine host that is starting until `ready()`, then ready and streaming, as the supervisor tells main (its
// state, the resync the spine registered, then the streaming notice). Every command and event crosses the production
// registry's codec, as the supervisor's do. It answers what the spine sends at a connect with the smallest valid answer
// (an empty scan, no holders, no sessions, the configure pushes accepted, an empty library), plays
// `session.replay.launch` through the engine host's own replay side (`ReplayHost` with the engine's normalizer, the
// in-process pattern of src/services/index/replay.test.ts), and raises, for each permission the replay asks, the
// `session.brokerItems` frame the broker would publish for it. Anything else answers `host_unavailable`.
//
// `held()` counts the listeners and the resync the spine holds on it, so a test can see a root's stop release them all.
import { ReplayHost } from '../../src/engine-host/fs/replay/host';
import { engineNormalizer } from '../../src/engine-host/fs/replay/normalizer';
import type { SessionEvent } from '../../src/shared/graph/events';
import type { AppSessionId, RequestId, ToolUseId } from '../../src/shared/graph/ids';
import type { HostDispatch, HostResync } from '../../src/shared/host/host-supervisor';
import { ipcError } from '../../src/shared/ipc/errors';
import type { CommandInput, CommandName, CommandOutput, CommandResult, EventName, EventPayload, HostState } from '../../src/shared/ipc/schema';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '../../src/shared/ipc/validate';
import type { SpineHosts } from '../../src/services/spine-root';
import { item } from './builders';

type Listener = (payload: unknown) => void;
type Answer = (input: never) => unknown;

const NOW = '2026-10-28T00:00:00.000Z';

export class FakeSpineHost implements SpineHosts {
  readonly calls: { name: CommandName; input: unknown }[] = [];
  private readonly events = new Map<string, Set<Listener>>();
  private readonly stateListeners = new Set<(state: HostState) => void>();
  private readonly streamingListeners = new Set<() => void>();
  private resync: HostResync | null = null;
  private state: HostState = { state: 'starting', pid: null, restarts: 0, revision: 0 };
  private isStreaming = false;
  private readonly replays = new ReplayHost({
    emit: (name, payload) => this.emit(name, payload),
    bindings: { bind: async () => {}, unbind: async () => {} },
    normalizer: engineNormalizer,
  });
  // The smallest valid answer to each command the spine sends at a connect, and the replay side's two
  private readonly answers: Partial<Record<CommandName, Answer>> = {
    'fs.scan': () => ({ projects: 0, sessions: 0, changed: 0, durationMs: 0 }),
    'fs.state': () => ({ configHome: '/nonexistent/.claude', watching: true, projects: 0, sessions: 0, bound: 0, followed: [], holders: [], lastScanAt: null, lastScan: null }),
    'fs.bind': () => undefined,
    'fs.unbind': () => undefined,
    'fs.holders': () => ({ refreshedAt: NOW, holders: [] }),
    'engine.sessions': () => [],
    'engine.configure': () => undefined,
    'engine.policy.set': () => undefined,
    'host.configure': () => undefined,
    'artifacts.setDefaults': () => undefined,
    'library.snapshot': () => ({ artifacts: [], links: [], spaces: [] }),
    'session.replay.launch': (input) => this.replays.launch(input),
    'session.replay.control': (input) => this.replays.control(input),
  };

  // A test's own answer to a command beyond the connect's (P5 O4 M2: delivery's `artifacts.get`)
  answer<N extends CommandName>(name: N, answer: (input: CommandInput<N>) => CommandOutput<N>): void {
    this.answers[name] = answer as Answer;
  }

  readonly dispatch: HostDispatch = async (owner, command, input) => {
    const name = command as CommandName;
    this.calls.push({ name, input });
    const answer = this.answers[name];
    if (owner !== 'engine-host' || this.state.state !== 'ready' || answer === undefined) return { ok: false, error: ipcError('host_unavailable', `the fake engine host does not answer ${name}`) };
    const checked = validateCommandInput(name, input);
    if (!checked.ok) return checked;
    try {
      return validateCommandOutput(name, await answer(checked.value as never)) as CommandResult<CommandName>;
    } catch (error) {
      return { ok: false, error: ipcError('internal', error instanceof Error ? error.message : String(error)) };
    }
  };

  onEvent<N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void): () => void {
    let set = this.events.get(name);
    if (!set) this.events.set(name, (set = new Set()));
    const entry = listener as Listener;
    set.add(entry);
    return () => void set.delete(entry);
  }

  onState(_owner: string, listener: (state: HostState) => void): () => void {
    this.stateListeners.add(listener);
    return () => void this.stateListeners.delete(listener);
  }

  onStreaming(_owner: string, listener: () => void): () => void {
    this.streamingListeners.add(listener);
    return () => void this.streamingListeners.delete(listener);
  }

  streaming(): boolean {
    return this.isStreaming;
  }

  snapshot(): HostState {
    return this.state;
  }

  setResync(_owner: string, resync: HostResync | null): void {
    this.resync = resync;
  }

  // The host connects: `ready` (it answers from here), the resync the spine registered, then the streaming notice (the
  // supervisor's order)
  async ready(): Promise<void> {
    this.state = { state: 'ready', pid: 4242, restarts: 0, revision: this.state.revision + 1 };
    for (const listener of [...this.stateListeners]) listener(this.state);
    this.isStreaming = true;
    await this.resync?.(this.dispatch, new AbortController().signal);
    for (const listener of [...this.streamingListeners]) listener();
  }

  // An event as the supervisor relays one: validated, then to every listener
  emit<N extends EventName>(name: N, payload: EventPayload<N>): boolean {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
    for (const listener of [...(this.events.get(name) ?? [])]) listener(checked.value);
    if (name === 'session.eventBatch') this.brokered(payload as EventPayload<'session.eventBatch'>);
    return true;
  }

  // The listeners and the resync the spine holds on this host
  held(): number {
    let count = this.stateListeners.size + this.streamingListeners.size + (this.resync === null ? 0 : 1);
    for (const set of this.events.values()) count += set.size;
    return count;
  }

  // The broker's publication for a permission the replay asks: the asking session's pending item
  private brokered({ appSessionId, events }: { appSessionId: string; events: SessionEvent[] }): void {
    for (const event of events) {
      if (event.kind !== 'permission.requested') continue;
      const asked = event as Extract<SessionEvent, { kind: 'permission.requested' }>;
      const raised = item(appSessionId, 'permission', event.at, {
        sessionId: event.sessionId,
        request: { requestId: asked.requestId as RequestId, toolUseId: (asked.toolUseId ?? null) as ToolUseId | null, taskId: null, agentId: null },
        summary: `${asked.displayName ?? asked.toolName}`,
      });
      this.emit('session.brokerItems', { appSessionId: appSessionId as AppSessionId, items: [raised] });
    }
  }
}
