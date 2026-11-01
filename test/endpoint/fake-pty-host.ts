// The pty host as the endpoint's `dispatch('pty-host', …)`, `onFrame` and `onEvent` reach it in `mawsd` (P5 O7 M3), for
// the endpoint's stream suites: ptys with a byte ring and offsets as the real table keeps them (`pty.data` frames stamped
// with their offset, a ring of `ringBytes`, a local viewer's checkpoint that an attach's own replay would start at), and
// the pty host's real ledger (`ptyOps` over `pty-ops.jsonl` in the machine's state directory, M3a1's src/pty-host/ops.ts)
// running `pty.spawn`, `pty.attach`, `pty.kill` and `pty.listFor` on this table; `pty.replay` reads the ring from an
// offset, touching no checkpoint. Every input is held to the registry as the runtime holds it; writes and resizes are
// recorded.
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { CommandInput, CommandName } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import { openPtyOpsLedger, ptyOps, type PtyOpsTable } from '../../src/pty-host/ops';
import type { FakeServices } from './fake-services';

type Pty = { info: Record<string, unknown> & { ptyId: string; appSessionId: string; alive: boolean; offset: number }; ring: Uint8Array; ringStart: number; checkpoint: number | null };
type EventListener = Parameters<FakeServices['onEvent']>[0];
type FrameListener = Parameters<FakeServices['onFrame']>[0];

const ok = (value: unknown): HostResponse => ({ t: 'res', id: 'pty', ok: true, value }) as HostResponse;
const no = (code: string): HostResponse => ({ t: 'res', id: 'pty', ok: false, error: { code, message: code } }) as HostResponse;

export class FakePtyHost {
  readonly ptys = new Map<string, Pty>();
  /** Every `pty.write` and `pty.resize`, in order. */
  readonly writes: Array<{ ptyId: string; data: string }> = [];
  readonly resizes: Array<{ ptyId: string; cols: number; rows: number }> = [];
  /** Every command the endpoint sent the pty host, with its input. */
  readonly calls: Array<{ name: string; input: unknown }> = [];
  /** Each op the ledger ran, by name (a run-once proof). */
  readonly runs: string[] = [];
  /** Each pty whose metadata a remote attach read (no credit taken). */
  readonly attaches: string[] = [];
  #ops: ReturnType<typeof ptyOps> | null = null;
  #replayHeld: Promise<void> | null = null;
  /** The next this many `pty.write`s fail (`internal`), writing nothing. */
  failWrites = 0;
  /** The next this many `pty.write`s land and then their reply is lost: a throw, or this failed answer. */
  lostReplies: Array<'throw' | 'timeout' | 'host_unavailable'> = [];
  readonly #frames = new Set<FrameListener>();
  readonly #events = new Set<EventListener>();
  #next = 0;

  constructor(private readonly ringBytes = 512 * 1024) {}

  /** Wires the fake into `services` beside what serves the other owners (the engine host, the spine). */
  serve(services: FakeServices): void {
    this.#ops = ptyOps({ ledger: openPtyOpsLedger(services.machine.stateDir, () => {}), table: this.#table() });
    const others = services.dispatch;
    services.dispatch = (owner, name, input, client) => (owner === 'pty-host' ? this.dispatch(name, input) : others(owner, name, input, client));
    const otherEvents = services.onEvent;
    services.onEvent = (listener) => {
      const off = otherEvents(listener);
      this.#events.add(listener);
      return () => {
        off();
        this.#events.delete(listener);
      };
    };
    services.onFrame = (listener) => {
      this.#frames.add(listener);
      return () => void this.#frames.delete(listener);
    };
  }

  /** A live pty of `appSessionId`, as a spawn makes one. */
  spawn(appSessionId: string, label = 't1'): string {
    const ptyId = `pty-${++this.#next}`;
    this.ptys.set(ptyId, {
      info: { ptyId, appSessionId, label, pid: 1000 + this.#next, cwd: '/work', shell: '/bin/zsh', cols: 80, rows: 24, spawnedAt: new Date().toISOString(), alive: true, paused: false, exit: null, offset: 0 },
      ring: new Uint8Array(0),
      ringStart: 0,
      checkpoint: null,
    });
    return ptyId;
  }

  /** Output of the pty: into its ring (its head dropped past `ringBytes`), and a `pty.data` frame at its offset. */
  emit(ptyId: string, output: string | Uint8Array): void {
    const pty = this.ptys.get(ptyId)!;
    const data = typeof output === 'string' ? new TextEncoder().encode(output) : output;
    const offset = pty.info.offset;
    const ring = new Uint8Array(pty.ring.byteLength + data.byteLength);
    ring.set(pty.ring);
    ring.set(data, pty.ring.byteLength);
    const cut = Math.max(0, ring.byteLength - this.ringBytes);
    pty.ring = ring.subarray(cut);
    pty.ringStart += cut;
    pty.info.offset = offset + data.byteLength;
    for (const listener of this.#frames) listener({ owner: 'pty-host', ptyId, offset, data });
  }

  /** Holds every `pty.replay` until the returned release; frames emitted meanwhile go out before the answer. */
  holdReplay(): () => void {
    let release!: () => void;
    this.#replayHeld = new Promise((resolve) => (release = resolve));
    return () => {
      this.#replayHeld = null;
      release();
    };
  }

  /** Whether a `pty.replay` has arrived (one held waits for its release). */
  replayAsked(): boolean {
    return this.calls.some((c) => c.name === 'pty.replay');
  }

  /** A local viewer's checkpoint (the app on the machine), which an attach's own replay starts at. */
  checkpoint(ptyId: string, offset: number): void {
    this.ptys.get(ptyId)!.checkpoint = offset;
  }

  /** The pty exits: `pty.exit` on the pty host's events. */
  exit(ptyId: string): void {
    const pty = this.ptys.get(ptyId)!;
    pty.info.alive = false;
    pty.info.exit = { exitCode: 0, signal: null };
    for (const listener of this.#events) listener('pty-host', { name: 'pty.exit', payload: { ptyId, exitCode: 0, signal: null } });
  }

  async dispatch(name: string, input: unknown): Promise<HostResponse> {
    this.calls.push({ name, input });
    const checked = validateCommandInput(name as CommandName, input);
    if (!checked.ok) return no('invalid_input');
    const i = (checked.value ?? {}) as Record<string, unknown>;
    switch (name) {
      case 'pty.op':
        return ok(await this.#ops!.op(checked.value as CommandInput<'pty.op'>));
      case 'pty.opQuery':
        return ok(this.#ops!.opQuery(checked.value as CommandInput<'pty.opQuery'>));
      case 'pty.list':
        return ok({ ptys: [...this.ptys.values()].map((p) => ({ ...p.info })) });
      case 'pty.replay': {
        // A held replay answers at its release, from the ring as it stands then: frames emitted meanwhile reach the
        // endpoint first, as the real host flushes its output before it replies.
        if (this.#replayHeld !== null) await this.#replayHeld;
        const pty = this.ptys.get(i.ptyId as string);
        if (pty === undefined) return no('invalid_input');
        const from = Math.max(i.from as number, pty.ringStart);
        return ok({ replay: pty.ring.slice(Math.min(from - pty.ringStart, pty.ring.byteLength)), replayFrom: from, nextOffset: pty.info.offset });
      }
      // A live pty's only (table.ts's `live`: an unknown or exited pty throws, which the host answers `internal`).
      case 'pty.write': {
        const pty = this.ptys.get(i.ptyId as string);
        if (pty === undefined || !pty.info.alive) return no('internal');
        if (this.failWrites > 0) {
          this.failWrites--;
          return no('internal');
        }
        this.writes.push({ ptyId: i.ptyId as string, data: i.data as string });
        const lost = this.lostReplies.shift();
        if (lost === 'throw') throw new Error('the reply was lost');
        if (lost !== undefined) return no(lost);
        return ok(undefined);
      }
      case 'pty.resize': {
        const pty = this.ptys.get(i.ptyId as string);
        if (pty === undefined || !pty.info.alive) return no('internal');
        pty.info = { ...pty.info, cols: i.cols as number, rows: i.rows as number };
        this.resizes.push({ ptyId: i.ptyId as string, cols: i.cols as number, rows: i.rows as number });
        return ok(undefined);
      }
      default:
        return no('unknown_command');
    }
  }

  /** The table `ptyOps` runs the acts on. */
  #table(): PtyOpsTable {
    const info = (ptyId: string) => {
      const pty = this.ptys.get(ptyId);
      if (pty === undefined) throw new Error(`no pty ${ptyId}`);
      return pty;
    };
    return {
      spawn: async (args) => {
        this.runs.push('pty.spawn');
        const ptyId = this.spawn(args.appSessionId, args.label);
        return { ptyId: ptyId as never, pid: info(ptyId).info.pid as number };
      },
      kill: async ({ ptyId }) => {
        this.runs.push('pty.kill');
        this.exit(info(ptyId).info.ptyId);
      },
      attachMetadata: (ptyId) => {
        this.runs.push('pty.attach');
        const pty = info(ptyId);
        this.attaches.push(ptyId);
        return { info: { ...pty.info } as never, ringStart: pty.ringStart, nextOffset: pty.info.offset };
      },
      listFor: ({ appSessionId }) => {
        this.runs.push('pty.listFor');
        return { ptys: [...this.ptys.values()].filter((p) => p.info.appSessionId === appSessionId).map((p) => ({ ...p.info })) as never };
      },
    };
  }
}
