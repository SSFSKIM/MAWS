// DX8's session plane faked in-process for the depth unit suites: every `subscribe` is held with its own `n`, so a suite
// plays each transcript's script to its own subscription (the main thread's and each subagent's are apart, as DX3
// scopes them), interrupts or ends one without touching another, and sees what each asked for. Beside it, what MAWS's view
// does with a controller's source: keeps it attached to the store under its key.
import type { JsonObject, JsonValue, SessionBodies, SubagentMeta } from 'desk-hub/protocol';
import type { createTranscriptStore } from '../../../../src/renderer/src/stores/transcript';
import type { DeskTranscript } from '../../src/depth/source/desk-transcript';
import type { SessionPlane, SessionTarget, Subscription, SubscriptionListener, SubscriptionMessage } from '../../src/shell/session-plane';
import { snapshotAt, type LiveItem } from './session-stream';

type Kind = SubscriptionMessage['kind'];
type Body<K extends Kind> = SessionBodies[K];

export class HeldSubscription {
  readonly asked: Array<{ before: string; limit: number }> = [];
  /** How many times the view asked for the diff. */
  diffs = 0;
  /** Each task output the view asked for, in order. */
  readonly outputs: Array<{ taskId: string; tail: number }> = [];
  /** Each read the view made, in order, held for the suite to answer or refuse. */
  readonly reads: Array<{ what: string; args?: JsonObject; resolve(answer: JsonValue): void; reject(error: Error): void }> = [];
  closed = false;
  n = 0;

  constructor(
    readonly project: string,
    readonly target: SessionTarget,
    readonly listener: SubscriptionListener,
    private readonly subagents: SubagentMeta[],
  ) {}

  send<K extends Kind>(kind: K, body: Body<K>): void {
    const n = kind === 'snapshot' ? 0 : ++this.n;
    const { machine, session } = this.target;
    this.listener.message({ project: this.project, machine, session, kind, sub: 'sub', n, body } as SubscriptionMessage);
  }

  snapshot(script: LiveItem[], cut: number, limit?: number): void {
    this.n = 0;
    this.send('snapshot', snapshotAt(script, cut, { subagents: this.subagents, limit }));
  }

  play(items: LiveItem[]): void {
    for (const item of items) this.send(item.kind, item.body as never);
  }
}

export class FakePlane implements SessionPlane {
  readonly subs: HeldSubscription[] = [];

  constructor(
    private readonly project: string,
    private readonly subagents: SubagentMeta[] = [],
  ) {}

  subscribe(target: SessionTarget, listener: SubscriptionListener): Subscription {
    const held = new HeldSubscription(this.project, target, listener, this.subagents);
    this.subs.push(held);
    return {
      rows: (before, limit) => void held.asked.push({ before, limit }),
      diff: () => void (held.diffs += 1),
      output: (taskId, tail) => void held.outputs.push({ taskId, tail }),
      read: (what, args) => new Promise<JsonValue>((resolve, reject) => void held.reads.push({ what, args, resolve, reject })),
      close: () => void (held.closed = true),
    };
  }

  /** The latest subscription. */
  get current(): HeldSubscription {
    return this.subs.at(-1)!;
  }

  /** The latest subscription of one transcript (`agentId` null: the main thread). */
  of(agentId: string | null): HeldSubscription {
    const held = this.subs.findLast((sub) => sub.target.agentId === agentId);
    if (!held) throw new Error(`no subscription for ${agentId ?? 'the main thread'}`);
    return held;
  }

  send<K extends Kind>(kind: K, body: Body<K>): void {
    this.current.send(kind, body);
  }

  snapshot(script: LiveItem[], cut: number, limit?: number): void {
    this.current.snapshot(script, cut, limit);
  }

  play(items: LiveItem[]): void {
    this.current.play(items);
  }
}

export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * What the view does: keeps the controller's current source attached to the store under its key. MAWS's `Transcript`
 * attaches a new source in an effect, after the render that read it, so a swap here waits a task too: messages that
 * arrive in between reach a controller whose new source is not attached yet.
 */
export function mount(controller: DeskTranscript, store: ReturnType<typeof createTranscriptStore>): () => void {
  const options = { agentId: controller.target.agentId as never };
  let source = controller.state.getState().source;
  void store.getState().attach(controller.key, source, options);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const off = controller.state.subscribe((s) => {
    if (s.source === source || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      const next = controller.state.getState().source;
      if (next === source) return;
      store.getState().detach(controller.key);
      source = next;
      void store.getState().attach(controller.key, source, options);
    }, 0);
  });
  return () => {
    off();
    if (timer !== null) clearTimeout(timer);
    store.getState().detach(controller.key);
  };
}
