// The PTY host's terminals (C9 Interfaces "PTY host internals"): one entry per pty, keyed by a random `PtyId`, with
// its info, its flow state (`flow.ts`), a ring buffer of its last 512 KiB of output (`ring.ts`) and the latest
// checkpoint the renderer sent. Every state change happens on the host's single thread in the order messages arrive,
// which is the linearization the transition table relies on: a chunk is appended to the ring and emitted with its
// offset before the next message is handled, so `pty.attach`'s `nextOffset` is exactly where live events continue.
//
// node-pty on macOS reads at most 1 KiB at a time, and under a flood the host's loop is fast enough to take ~10-byte
// reads one per turn (so batching per `setImmediate` coalesces nothing, measured). The host coalesces by time: a read
// after 5 ms of quiet is flushed on the next `setImmediate` (a keystroke's echo is not delayed), reads within 5 ms of
// the last flush wait for that window to close, and 64 KiB pending flushes at once. The flow reducer, the ring and
// checkpoints see only flushed chunks. A flush always precedes `pty.exit` and the computation of
// a `pty.attach` reply, so `nextOffset` covers every byte the host has read.
//
// Every pty starts through `/bin/sh -c 'stty iutf8; exec "$0" "$@"'`: node-pty sets IUTF8 only when it decodes to
// strings, and without it canonical-mode erase removes one byte of a multi-byte character (Terminal.app's ttys have
// it). The exec replaces the wrapper in place, so the pid is the program's and `$0` is the requested path.
//
// A pty that exits on its own stays as a dead entry for an hour, so a reloaded renderer can still show its last
// screen; one the renderer killed is removed when it exits. An id the table does not hold fails with `unknown pty`.
import { randomUUID } from 'node:crypto';
import * as nodePty from 'node-pty';
import type { AppSessionId } from '@shared/graph/ids';
import type { HostEmit } from '@shared/host/runtime';
import type { CommandInput, CommandOutput, PtyCheckpoint, PtyId, PtyInfo } from '@shared/ipc/schema';
import { HIGH_WATERMARK, INITIAL_FLOW, stepFlow, type Flow, type FlowInput } from './flow';
import { foregroundOf } from './foreground';
import { RingBuffer } from './ring';

// Twice the high watermark: while a pty is paused, `total − acked` is at most HIGH plus the chunks node-pty had
// already read, so the ring always reaches back to the acknowledged offset and a checkpoint (never below it) is
// always replayable. That is what makes a reattach after a renderer reload exact.
export const RING_BYTES = 512 * 1024;
if (RING_BYTES !== 2 * HIGH_WATERMARK) throw new Error('the ring buffer must hold twice the high watermark');

export const DEAD_ENTRY_TTL_MS = 60 * 60 * 1000;
const DEFAULT_SHELL = '/bin/zsh';
const LOGIN_ARGS = ['-l'];
const FLUSH_BYTES = 64 * 1024;
const FLUSH_INTERVAL_MS = 5;
const IUTF8_WRAPPER = ['/bin/sh', '-c', 'stty iutf8 2>/dev/null; exec "$0" "$@"'] as const;

interface PtyEntry {
  info: Omit<PtyInfo, 'paused' | 'offset'>;
  pty: nodePty.IPty;
  ring: RingBuffer;
  flow: Flow;
  checkpoint: PtyCheckpoint | null;
  killed: boolean; // the renderer asked for it to end: remove the entry on exit instead of keeping it dead
  expiry: ReturnType<typeof setTimeout> | null;
  pending: Buffer[]; // reads not yet flushed as an event
  pendingBytes: number;
  flushTimer: { cancel(): void } | null; // the queued flush, if any
  lastFlushAt: number; // performance.now() of the last flush
  reads: number; // node-pty reads since spawn
  read: number; // bytes node-pty delivered since spawn: `flow.total` plus what is pending
}

export interface PtyTableOptions {
  emit: HostEmit;
  // The terminal environment every pty starts with (`terminalEnvironment` over `baseEnvironment()`); a promise
  // because the login-shell capture runs once, asynchronously, at host start.
  environment: Promise<Record<string, string>>;
}

export interface PtyTable {
  spawn(input: CommandInput<'pty.spawn'>): Promise<CommandOutput<'pty.spawn'>>;
  write(input: CommandInput<'pty.write'>): void;
  resize(input: CommandInput<'pty.resize'>): void;
  kill(input: CommandInput<'pty.kill'>): void;
  ack(input: CommandInput<'pty.ack'>): void;
  checkpoint(input: CommandInput<'pty.checkpoint'>): void;
  attach(input: CommandInput<'pty.attach'>): CommandOutput<'pty.attach'>;
  list(): CommandOutput<'pty.list'>;
  foreground(input: CommandInput<'pty.foreground'>): Promise<CommandOutput<'pty.foreground'>>;
  // tests: the flow state, the ring's oldest offset, and node-pty's reads and bytes read (flushed or pending)
  inspect(ptyId: string): { flow: Flow; ringStart: number; reads: number; read: number };
}

export function createPtyTable({ emit, environment }: PtyTableOptions): PtyTable {
  const entries = new Map<string, PtyEntry>();

  const get = (ptyId: string): PtyEntry => {
    const entry = entries.get(ptyId);
    if (!entry) throw new Error('unknown pty');
    return entry;
  };
  const live = (ptyId: string): PtyEntry => {
    const entry = get(ptyId);
    if (!entry.info.alive) throw new Error('pty exited');
    return entry;
  };
  const infoOf = (entry: PtyEntry): PtyInfo => ({ ...entry.info, paused: entry.flow.mode === 'paused', offset: entry.flow.total });

  const remove = (ptyId: string) => {
    const entry = entries.get(ptyId);
    if (entry?.expiry) clearTimeout(entry.expiry);
    entries.delete(ptyId);
  };

  // Emits what is pending as one chunk: one exact-size copy (a pooled Buffer would otherwise travel whole through
  // structured clone), appended to the ring and stamped with its offset, then stepped through the flow reducer.
  const flush = (ptyId: string, entry: PtyEntry): void => {
    entry.flushTimer?.cancel();
    entry.flushTimer = null;
    if (entry.pendingBytes === 0) return;
    entry.lastFlushAt = performance.now();
    const data = new Uint8Array(entry.pendingBytes);
    let at = 0;
    for (const chunk of entry.pending) {
      data.set(chunk, at);
      at += chunk.byteLength;
    }
    entry.pending = [];
    entry.pendingBytes = 0;
    entry.ring.append(data);
    emit('pty.data', { ptyId: entry.info.ptyId, offset: entry.flow.total, data });
    step(ptyId, entry, { kind: 'data', bytes: data.byteLength });
  };

  const step = (ptyId: string, entry: PtyEntry, input: FlowInput): void => {
    const { flow, effect, clamped } = stepFlow(entry.flow, input);
    entry.flow = flow;
    if (clamped && input.kind === 'ack') console.warn(`[pty-host] clamped an ack at ${input.offset} for ${ptyId} to the ${flow.total} bytes emitted`);
    if (!entry.info.alive) return;
    if (effect === 'pause') entry.pty.pause();
    else if (effect === 'resume') entry.pty.resume();
  };

  return {
    async spawn({ appSessionId, label, cwd, cols, rows, shell, args, command }) {
      const env = await environment;
      for (const [id, entry] of entries) {
        if (entry.info.appSessionId !== appSessionId || entry.info.label !== label) continue;
        if (entry.info.alive) throw new Error(`session ${appSessionId} already has a live pty labelled ${label}`);
        remove(id); // a dead terminal under the same tab is superseded by its replacement
      }
      const program = shell ?? (env.SHELL || DEFAULT_SHELL);
      const ptyId = randomUUID() as PtyId;
      const [wrapper, ...wrapperArgs] = IUTF8_WRAPPER;
      const pty = nodePty.spawn(wrapper, [...wrapperArgs, program, ...(args ?? LOGIN_ARGS)], {
        name: 'xterm-256color',
        cwd,
        cols,
        rows,
        env,
        encoding: null, // raw Buffers: the renderer decodes exactly what the program wrote
        handleFlowControl: false, // the host pauses the pty itself; in-band XOFF/XON is for programs
      });
      const entry: PtyEntry = {
        info: { ptyId, appSessionId: appSessionId as AppSessionId, label, pid: pty.pid, cwd, shell: program, cols, rows, spawnedAt: new Date().toISOString(), alive: true, exit: null },
        pty,
        ring: new RingBuffer(RING_BYTES),
        flow: INITIAL_FLOW,
        checkpoint: null,
        killed: false,
        expiry: null,
        pending: [],
        pendingBytes: 0,
        flushTimer: null,
        lastFlushAt: -Infinity,
        reads: 0,
        read: 0,
      };
      entries.set(ptyId, entry);

      pty.onData((chunk: string | Buffer) => {
        const buffer = chunk as Buffer;
        entry.pending.push(buffer);
        entry.pendingBytes += buffer.byteLength;
        entry.reads++;
        entry.read += buffer.byteLength;
        if (entry.pendingBytes >= FLUSH_BYTES) flush(ptyId, entry);
        else if (!entry.flushTimer) {
          const wait = entry.lastFlushAt + FLUSH_INTERVAL_MS - performance.now();
          if (wait <= 0) {
            const immediate = setImmediate(() => flush(ptyId, entry));
            entry.flushTimer = { cancel: () => clearImmediate(immediate) };
          } else {
            const timer = setTimeout(() => flush(ptyId, entry), wait);
            entry.flushTimer = { cancel: () => clearTimeout(timer) };
          }
        }
      });
      pty.onExit(({ exitCode, signal }) => {
        flush(ptyId, entry); // the program's last bytes precede its exit
        const exit = { exitCode, signal: signal || null };
        entry.info = { ...entry.info, alive: false, exit };
        emit('pty.exit', { ptyId, ...exit });
        if (entry.killed) remove(ptyId);
        else if (entries.get(ptyId) === entry) {
          entry.expiry = setTimeout(() => remove(ptyId), DEAD_ENTRY_TTL_MS);
          entry.expiry.unref();
        }
      });
      // The tty buffers the command until the shell reads its input, whenever its startup files are done.
      if (command !== undefined) pty.write(`${command}\n`);
      return { ptyId, pid: pty.pid };
    },

    write({ ptyId, data }) {
      live(ptyId).pty.write(data);
    },

    resize({ ptyId, cols, rows }) {
      const entry = live(ptyId);
      entry.pty.resize(cols, rows);
      entry.info = { ...entry.info, cols, rows };
    },

    kill({ ptyId, signal }) {
      const entry = get(ptyId);
      if (!entry.info.alive) {
        remove(ptyId);
        return;
      }
      entry.killed = true;
      // A paused pty would never read to its end, and node-pty reports the exit only once the output is drained.
      step(ptyId, entry, { kind: 'attach' });
      entry.pty.kill(signal ?? 'SIGHUP');
    },

    ack({ ptyId, offset }) {
      const entry = get(ptyId);
      step(ptyId, entry, { kind: 'ack', offset });
    },

    checkpoint({ ptyId, offset, state }) {
      const entry = get(ptyId);
      if (offset > entry.flow.total) console.warn(`[pty-host] clamped a checkpoint at ${offset} for ${ptyId} to the ${entry.flow.total} bytes emitted`);
      entry.checkpoint = { offset: Math.min(offset, entry.flow.total), state };
    },

    attach({ ptyId }) {
      const entry = get(ptyId);
      flush(ptyId, entry); // nextOffset covers every byte read, and the renderer receives them as a live event
      step(ptyId, entry, { kind: 'attach' });
      const replayFrom = Math.max(entry.checkpoint?.offset ?? 0, entry.ring.start);
      return {
        info: infoOf(entry),
        checkpoint: entry.checkpoint,
        replay: entry.ring.since(replayFrom),
        replayFrom,
        nextOffset: entry.flow.total,
      };
    },

    list() {
      return { ptys: [...entries.values()].map(infoOf) };
    },

    async foreground({ ptyId }) {
      const entry = get(ptyId);
      if (!entry.info.alive) return { process: null, busy: false };
      return foregroundOf({ pid: entry.info.pid, shell: entry.info.shell, process: entry.pty.process });
    },

    inspect(ptyId) {
      const entry = get(ptyId);
      return { flow: entry.flow, ringStart: entry.ring.start, reads: entry.reads, read: entry.read };
    },
  };
}
