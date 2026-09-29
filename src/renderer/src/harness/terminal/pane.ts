// One probe pane (C9 M1, moved to the production transport in M2): a `TerminalRenderer` attached to its own pty
// through C9's binary `pty.*` stream, acknowledging what the renderer has parsed (`pty.ack`, coalesced) so the host's
// flow control paces a flood, and opening links through `pty.openLink`. It keeps the counters the spike's items read
// (bytes handed to the renderer and bytes it has parsed, `?2026h` occurrences, the Kitty and XTVERSION exchanges,
// cursor-position replies, the last link and the last input bytes) and runs the workloads that produce `Metrics`.
// Held outside React so the emulator survives the page's re-renders; the page mounts `renderer.element` and reads
// `debug` through the store. (M3's registry is the product's version of this wiring; the probe stays a harness.)
import type { AppSessionId } from '@shared/graph/ids';
import type { EventPayload, PtyId } from '@shared/ipc/schema';
import { SCRATCH_CWD, resolveProgram, WIDTH_FIXTURES, type Bins, type Phase, type ProgramWorkload } from '../../../../../spikes/terminal-probe/workloads.mjs';
import { ipc } from '../../ipc/client';
import { SCROLLBACK_LINES } from '../../terminal/constants';
import { createRenderer, type Acceleration, type RendererKind, type TerminalFont, type TerminalModes, type TerminalRenderer, type TerminalTheme } from '../../terminal/renderer';
import { armInputGuard } from './input-guard';
import {
  byteCountError,
  countLineEndings,
  FrameSampler,
  heapMB,
  observeLongTasks,
  summarizeFrames,
  summarizeSamples,
  type FrameSummary,
  type LongTaskSummary,
  type Metrics,
  type WidthResult,
} from './metrics';

export type PaneStatus = 'creating' | 'failed' | 'idle' | 'running' | 'exited';

export interface PaneDebug {
  kind: RendererKind;
  status: PaneStatus;
  error: string | null;
  acceleration: Acceleration | null;
  ptyId: string | null;
  pid: number | null;
  exit: { exitCode: number | null; signal: number | null } | null;
  cols: number;
  rows: number;
  bytes: number; // UTF-8 bytes handed to the renderer since spawn
  parsed: number; // bytes the renderer reported parsed
  lineFeeds: number;
  carriageReturns: number;
  syncFrames: number; // `CSI ? 2026 h` occurrences in the output
  kittyQueried: boolean; // the program sent `CSI ? u`
  kittyAnswered: boolean; // the terminal answered `CSI ? <flags> u`
  xtversionQueried: boolean; // `CSI > 0 q` (or `CSI > q`)
  xtversionAnswered: boolean; // a `DCS > | … ST` reply
  dsrReplies: string[]; // `row;col` from `CSI 6 n` answers
  lastInput: string; // the last onData payload, escaped
  rawTail: string; // the last 120 characters of output, escaped
  lastLink: string | null; // "url (meta|plain)"
  lastOpen: string | null; // "url → opened true|false", pty.openLink's answer
  acked: number; // the offset the last pty.ack named
  title: string | null;
  metrics: Metrics | null;
}

export interface ProbeSnapshot {
  cols: number;
  rows: number;
  cursorX: number;
  cursorY: number;
  baseY: number;
  lineCount: number;
  modes: TerminalModes;
  lines: string[];
}

const ESC = '\x1b';
const SYNC_ON = `${ESC}[?2026h`;
// The probe's pty spawns belong to a session of their own; each spawn has a fresh label (the host refuses a second
// live pty under the same session and label).
const PROBE_SESSION = 'probe' as AppSessionId;
let spawns = 0;
// Ack coalescing (Residue *PTY stream and flow control*): one ack per 32 KiB parsed, or 16 ms after the last parse.
const ACK_BYTES = 32 * 1024;
const ACK_DELAY_MS = 16;
// eslint-disable-next-line no-control-regex -- escaping control bytes is the point
const escape = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);

// A macrotask yield that does not clamp like setTimeout, for the latency poll.
const channel = new MessageChannel();
const yieldMacrotask = () =>
  new Promise<void>((resolve) => {
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });

export class Pane {
  renderer: TerminalRenderer | null = null;
  debug: PaneDebug;
  private listeners = new Set<() => void>();
  private tail = ''; // the last bytes of the previous chunk, for the `?2026h` scan across chunks
  private exitListeners = new Set<() => void>();
  private parsedListeners = new Set<() => void>();
  private lastByteAt = 0;
  private host: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private captured: string[] | null = null; // the whole output stream while capturing (a debugging aid)
  private decoder = new TextDecoder(); // streaming: the scans and debugging aids read text, the renderer gets bytes
  private parsedOffset = 0; // the stream offset up to which the renderer has parsed
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private acks = 0;
  private flow = { chunks: 0, maxUnparsed: 0, maxUnacked: 0 }; // the stream seen from the page during a run

  constructor(
    readonly kind: RendererKind,
    private readonly bins: Bins,
  ) {
    this.debug = {
      kind,
      status: 'creating',
      error: null,
      acceleration: null,
      ptyId: null,
      pid: null,
      exit: null,
      cols: 0,
      rows: 0,
      bytes: 0,
      parsed: 0,
      lineFeeds: 0,
      carriageReturns: 0,
      syncFrames: 0,
      kittyQueried: false,
      kittyAnswered: false,
      xtversionQueried: false,
      xtversionAnswered: false,
      dsrReplies: [],
      lastInput: '',
      rawTail: '',
      lastLink: null,
      lastOpen: null,
      acked: 0,
      title: null,
      metrics: null,
    };
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // Counter updates are coalesced (a flood delivers hundreds of chunks a second); state changes publish at once.
  private publish(immediate = false) {
    this.debug = { ...this.debug };
    if (immediate) {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.listeners.forEach((cb) => cb());
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.listeners.forEach((cb) => cb());
      }, 100);
    }
  }

  async create(theme: TerminalTheme, font: TerminalFont): Promise<void> {
    try {
      const renderer = await createRenderer(this.kind, { scrollback: SCROLLBACK_LINES, theme, font, webgl: true });
      this.renderer = renderer;
      renderer.onData((input) => this.onInput(input));
      renderer.onTitle((title) => {
        this.debug.title = title;
        this.publish();
      });
      renderer.onAccelerationChange((a) => {
        this.debug.acceleration = a;
        this.publish(true);
      });
      renderer.setLinkHandler((url, ev) => {
        this.debug.lastLink = `${url} (${ev.type}; meta ${ev.metaKey}, ctrl ${ev.ctrlKey}, alt ${ev.altKey})`;
        this.publish(true);
        // M2: the browser half of item 6 goes through main's scheme-checked opener. (Whether a plain click opens is
        // the registry's ⌘ policy, M3; the probe opens on every activation.)
        void ipc.invoke('pty.openLink', { url }).then((result) => {
          this.debug.lastOpen = `${url} → ${result.ok ? `opened ${result.value.opened}` : `failed: ${result.error.message}`}`;
          this.publish(true);
        });
      });
      renderer.setKeyFilter(() => true);
      this.debug.acceleration = renderer.acceleration;
      this.debug.status = 'idle';
      if (this.host) this.mount(this.host);
    } catch (error) {
      this.debug.status = 'failed';
      this.debug.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(`[probe] ${this.kind} failed to initialise`, error);
    }
    this.publish(true);
  }

  mount(host: HTMLElement): void {
    this.host = host;
    if (!this.renderer) return;
    host.replaceChildren(this.renderer.element);
    this.renderer.setVisible(true);
    this.debug.acceleration = this.renderer.acceleration;
    this.observer?.disconnect();
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(host);
    this.fit();
    this.publish(true);
  }

  unmount(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.renderer?.setVisible(false);
    this.host = null;
  }

  fit(): void {
    const dims = this.renderer?.fit();
    if (!dims || (dims.cols === this.debug.cols && dims.rows === this.debug.rows)) return;
    this.renderer!.resize(dims.cols, dims.rows);
    this.debug.cols = dims.cols;
    this.debug.rows = dims.rows;
    if (this.debug.ptyId && this.debug.status === 'running') {
      void ipc.invoke('pty.resize', { ptyId: this.debug.ptyId as PtyId, cols: dims.cols, rows: dims.rows });
    }
    this.publish();
  }

  setTheme(theme: TerminalTheme): void {
    this.renderer?.setTheme(theme);
  }

  focus(): void {
    this.renderer?.focus();
  }

  private onInput(input: string) {
    this.debug.lastInput = escape(input);
    // eslint-disable-next-line no-control-regex -- terminal replies are escape sequences
    if (/\x1b\[\?\d+u/.test(input)) this.debug.kittyAnswered = true;
    if (input.includes(`${ESC}P>|`)) this.debug.xtversionAnswered = true;
    // eslint-disable-next-line no-control-regex -- terminal replies are escape sequences
    for (const m of input.matchAll(/\x1b\[(\d+);(\d+)R/g)) this.debug.dsrReplies.push(`${m[1]};${m[2]}`);
    if (this.debug.ptyId && this.debug.status === 'running') {
      void ipc.invoke('pty.write', { ptyId: this.debug.ptyId as PtyId, data: input });
    }
    this.publish();
  }

  // Called by the page's single `pty.data` subscription for this pane's pty: bytes stamped with the stream offset of
  // their first byte. The renderer takes the bytes; the scans below read a streaming decode of them.
  onChunk(data: Uint8Array, offset: number): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const length = data.byteLength;
    this.debug.bytes += length;
    this.flow.chunks++;
    this.flow.maxUnparsed = Math.max(this.flow.maxUnparsed, this.debug.bytes - this.debug.parsed);
    this.flow.maxUnacked = Math.max(this.flow.maxUnacked, offset + length - this.debug.acked);
    const endings = countLineEndings(data);
    this.debug.lineFeeds += endings.lineFeeds;
    this.debug.carriageReturns += endings.carriageReturns;
    this.lastByteAt = performance.now();
    const text = this.decoder.decode(data, { stream: true });
    const combined = this.tail + text;
    let at = combined.indexOf(SYNC_ON);
    while (at !== -1) {
      this.debug.syncFrames++;
      at = combined.indexOf(SYNC_ON, at + 1);
    }
    this.tail = combined.slice(-(SYNC_ON.length - 1));
    this.debug.rawTail = escape((this.debug.rawTail + text).slice(-120));
    this.captured?.push(text);
    if (combined.includes(`${ESC}[?u`)) this.debug.kittyQueried = true;
    if (combined.includes(`${ESC}[>0q`) || combined.includes(`${ESC}[>q`)) this.debug.xtversionQueried = true;
    const ptyId = this.debug.ptyId;
    renderer.write(data, () => {
      this.debug.parsed += length;
      if (ptyId === this.debug.ptyId) this.parsedUpTo(offset + length);
      this.parsedListeners.forEach((cb) => cb());
      this.publish();
    });
    this.publish();
  }

  // Acknowledges parsed bytes to the host: at once past 32 KiB since the last ack, else 16 ms after the last parse.
  private parsedUpTo(offset: number): void {
    this.parsedOffset = Math.max(this.parsedOffset, offset);
    if (this.parsedOffset - this.debug.acked >= ACK_BYTES) this.sendAck();
    else if (!this.ackTimer) this.ackTimer = setTimeout(() => this.sendAck(), ACK_DELAY_MS);
  }

  private sendAck(): void {
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
    const ptyId = this.debug.ptyId;
    if (!ptyId || this.parsedOffset <= this.debug.acked) return;
    this.debug.acked = this.parsedOffset;
    this.acks++;
    void ipc.invoke('pty.ack', { ptyId: ptyId as PtyId, offset: this.parsedOffset });
  }

  onExit(exit: EventPayload<'pty.exit'>): void {
    this.debug.status = 'exited';
    this.debug.exit = { exitCode: exit.exitCode, signal: exit.signal };
    this.exitListeners.forEach((cb) => cb());
    this.publish(true);
  }

  private resetCounters() {
    Object.assign(this.debug, {
      bytes: 0,
      parsed: 0,
      lineFeeds: 0,
      carriageReturns: 0,
      syncFrames: 0,
      kittyQueried: false,
      kittyAnswered: false,
      xtversionQueried: false,
      xtversionAnswered: false,
      dsrReplies: [],
      lastInput: '',
      rawTail: '',
      lastLink: null,
      lastOpen: null,
      acked: 0,
      exit: null,
      metrics: null,
    });
    this.tail = '';
    this.decoder = new TextDecoder();
    this.parsedOffset = 0;
    this.acks = 0;
    this.flow = { chunks: 0, maxUnparsed: 0, maxUnacked: 0 };
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
  }

  // Spawns a program (or, for `shell: null`, the host's default: the login shell, `$SHELL -l`) as this pane's pty;
  // the previous pty, if any, is killed first.
  async spawn(spec: { shell: string | null; args: string[] | null }, claim: (ptyId: string) => void): Promise<{ ptyId: string; pid: number }> {
    if (!this.renderer) throw new Error(`${this.kind} has no renderer`);
    await this.kill();
    this.resetCounters();
    // ghostty-web's reset() leaves the old screen in place (observed in M1), so the screen is cleared explicitly too.
    this.renderer.reset();
    this.renderer.clear();
    const cols = this.debug.cols || 80;
    const rows = this.debug.rows || 24;
    const input = {
      appSessionId: PROBE_SESSION,
      label: `probe-${this.kind}-${++spawns}`,
      cwd: SCRATCH_CWD,
      cols,
      rows,
      ...(spec.shell ? { shell: spec.shell } : {}),
      ...(spec.args ? { args: spec.args } : {}),
    };
    const result = await ipc.invoke('pty.spawn', input);
    if (!result.ok) throw new Error(`pty.spawn failed: ${result.error.message}`);
    this.debug.ptyId = result.value.ptyId;
    this.debug.pid = result.value.pid;
    this.debug.status = 'running';
    claim(result.value.ptyId); // after the state is set: events held for this pty are delivered now
    this.publish(true);
    return result.value;
  }

  async write(data: string): Promise<void> {
    if (!this.debug.ptyId || this.debug.status !== 'running') throw new Error(`${this.kind} has no running pty`);
    const result = await ipc.invoke('pty.write', { ptyId: this.debug.ptyId as PtyId, data });
    if (!result.ok) throw new Error(`pty.write failed: ${result.error.message}`);
  }

  async kill(): Promise<void> {
    if (this.debug.ptyId && this.debug.status === 'running') {
      const ptyId = this.debug.ptyId as PtyId;
      const exited = this.waitForExit();
      await ipc.invoke('pty.kill', { ptyId, signal: 'SIGKILL' });
      await Promise.race([exited, new Promise((r) => setTimeout(r, 2_000))]);
    }
    this.debug.status = this.renderer ? 'idle' : this.debug.status;
    this.publish(true);
  }

  private waitForExit(): Promise<void> {
    if (this.debug.status !== 'running') return Promise.resolve();
    return new Promise((resolve) => {
      const cb = () => {
        this.exitListeners.delete(cb);
        resolve();
      };
      this.exitListeners.add(cb);
    });
  }

  private waitForParsed(): Promise<void> {
    if (this.debug.parsed >= this.debug.bytes) return Promise.resolve();
    return new Promise((resolve) => {
      const cb = () => {
        if (this.debug.parsed >= this.debug.bytes) {
          this.parsedListeners.delete(cb);
          resolve();
        }
      };
      this.parsedListeners.add(cb);
    });
  }

  // Resolves once no byte has arrived for `quietMs` and everything received is parsed, or after `maxMs` for a
  // program that never goes quiet (codex repaints its status line continuously). Returns whether it went quiet.
  async idle(quietMs = 500, maxMs = 15_000): Promise<boolean> {
    const started = performance.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, quietMs));
      if (performance.now() - this.lastByteAt >= quietMs && this.debug.parsed >= this.debug.bytes) return true;
      if (performance.now() - started >= maxMs) return false;
    }
  }

  // Debugging aid: capture the stream from the next spawn on, then report every character outside `allowed`.
  capture(enabled: boolean): void {
    this.captured = enabled ? [] : null;
  }

  foreignCharacters(allowed: RegExp): { position: number; text: string; context: string }[] {
    const all = (this.captured ?? []).join('');
    const found: { position: number; text: string; context: string }[] = [];
    for (let i = 0; i < all.length && found.length < 20; i++) {
      if (!allowed.test(all[i]!)) found.push({ position: i, text: escape(all[i]!), context: escape(all.slice(Math.max(0, i - 30), i + 30)) });
    }
    return found;
  }

  // Debugging aid: how often the captured stream carried the sequences that clear the screen or scrollback or
  // switch screens (a program that erases the scrollback itself, `CSI 3 J`, explains a "lost" history).
  sequenceCounts(): Record<string, number> {
    const all = (this.captured ?? []).join('');
    const count = (needle: string) => all.split(needle).length - 1;
    const matches = (pattern: RegExp) => (all.match(pattern) ?? []).length;
    return {
      'CSI 2 J (erase display)': count(`${ESC}[2J`),
      'CSI 3 J (erase scrollback)': count(`${ESC}[3J`),
      'CSI J / CSI 0 J (erase below)': matches(/\x1b\[0?J/g), // eslint-disable-line no-control-regex -- escape sequences
      'CSI 1 J (erase above)': count(`${ESC}[1J`),
      'CSI K (erase line)': matches(/\x1b\[[012]?K/g), // eslint-disable-line no-control-regex -- escape sequences
      'CSI n A (cursor up)': matches(/\x1b\[\d*A/g), // eslint-disable-line no-control-regex -- escape sequences
      'CSI H (cursor home or position)': matches(/\x1b\[(\d+;\d+)?H/g), // eslint-disable-line no-control-regex -- escape sequences
      'CSI n S (scroll up)': matches(/\x1b\[\d*S/g), // eslint-disable-line no-control-regex -- escape sequences
      'CSI n T (scroll down)': matches(/\x1b\[\d*T/g), // eslint-disable-line no-control-regex -- escape sequences
      'CSI ? 1049 h (alternate screen on)': count(`${ESC}[?1049h`),
      'CSI ? 1049 l (alternate screen off)': count(`${ESC}[?1049l`),
      'ESC c (full reset)': count(`${ESC}c`),
    };
  }

  snapshot(from?: number, to?: number): ProbeSnapshot {
    const probe = this.renderer!.probe();
    const lineCount = probe.lineCount();
    const baseY = Math.max(0, lineCount - probe.rows);
    const start = Math.max(0, from ?? baseY);
    const end = Math.min(lineCount, to ?? lineCount);
    const lines: string[] = [];
    for (let row = start; row < end; row++) lines.push(probe.line(row));
    return { cols: probe.cols, rows: probe.rows, cursorX: probe.cursorX, cursorY: probe.cursorY, baseY, lineCount, modes: probe.modes(), lines };
  }

  private lastLine(): string {
    const probe = this.renderer!.probe();
    for (let row = probe.lineCount() - 1; row >= 0; row--) {
      const text = probe.line(row);
      if (text.trim()) return text;
    }
    return '';
  }

  // The automated measurements of the item table: flood (item 9), width (item 3), latency (item 16), screen (item 13).
  async run(workload: ProgramWorkload, phase: Phase, claim: (ptyId: string) => void): Promise<Metrics> {
    const spec = resolveProgram(workload, phase, this.bins);
    const expectedBytes = workload.expectedBytes?.[phase] ?? null;
    const frames = new FrameSampler();
    const longTasks = observeLongTasks();
    const guard = armInputGuard(window);
    const t0 = performance.now();
    let latency: Metrics['latency'];
    let widths: WidthResult[] | undefined;
    let error: string | undefined;
    // The guard, the sampler and the observer are released whatever happens in the measured window: a failed run
    // must not leave the page deaf to input or sampling frames forever.
    let measured: { seconds: number; blockedInputEvents: number; frames: FrameSummary; longTasks: LongTaskSummary };
    // Whether the host's flow control engaged: `pty.list` sampled every 20 ms, latching a paused report.
    let pausedSeen = false;
    const sampler = setInterval(() => {
      void ipc.invoke('pty.list', undefined).then((result) => {
        if (result.ok && result.value.ptys.some((p) => p.ptyId === this.debug.ptyId && p.paused)) pausedSeen = true;
      });
    }, 20);
    try {
      frames.start();
      await this.spawn(spec, claim);
      if (workload.measure === 'latency') {
        latency = summarizeSamples(await this.sampleLatency(100));
        await this.kill();
      } else {
        await this.waitForExit();
        await this.waitForParsed();
      }
    } finally {
      clearInterval(sampler);
      measured = { seconds: (performance.now() - t0) / 1000, blockedInputEvents: guard.disarm(), frames: summarizeFrames(frames.stop()), longTasks: longTasks.stop() };
    }
    const { seconds, blockedInputEvents, frames: frameSummary, longTasks: longTaskSummary } = measured;
    if (workload.measure === 'width') widths = this.widthResults();
    if (workload.measure === 'screen') {
      const screen = this.snapshot().lines.slice(0, workload.expectedScreen!.length);
      const mismatch = workload.expectedScreen!.findIndex((line, i) => line !== screen[i]);
      if (mismatch !== -1) error = `screen mismatch at row ${mismatch}: expected ${JSON.stringify(workload.expectedScreen![mismatch])}, got ${JSON.stringify(screen[mismatch])}`;
    }
    const received = { bytes: this.debug.bytes, outputBytes: this.debug.bytes - this.debug.carriageReturns, lineFeeds: this.debug.lineFeeds };
    const metrics: Metrics = {
      renderer: this.kind,
      workload: workload.title,
      phase,
      expectedBytes,
      bytes: this.debug.bytes,
      outputBytes: received.outputBytes,
      lineFeeds: received.lineFeeds,
      extraCarriageReturns: this.debug.carriageReturns - this.debug.lineFeeds,
      seconds: Math.round(seconds * 1000) / 1000,
      lastLine: this.lastLine(),
      lineCount: this.renderer!.probe().lineCount(),
      heapMB: heapMB(),
      blockedInputEvents,
      pausedSeen,
      acks: this.acks,
      ...this.flow,
      ...(latency ? { latency } : {}),
      ...(widths ? { widths } : {}),
    };
    const expectedOutput = workload.expectedOutputBytes?.[phase];
    const bytesError =
      expectedBytes === null || expectedOutput === undefined
        ? null
        : byteCountError({ bytes: expectedBytes, outputBytes: expectedOutput, lineFeeds: expectedBytes - expectedOutput }, received);
    if (bytesError) error = bytesError;
    if (error) metrics.error = error;
    else {
      metrics.frames = frameSummary;
      metrics.longTasks = longTaskSummary;
      if (workload.measure === 'flood') metrics.mbps = Math.round((this.debug.bytes / seconds / 1e6) * 100) / 100;
    }
    this.debug.metrics = metrics;
    this.publish(true);
    return metrics;
  }

  private widthResults(): WidthResult[] {
    return WIDTH_FIXTURES.map((fixture, i) => {
      const reply = this.debug.dsrReplies[i];
      const col = reply ? Number(reply.split(';')[1]) : NaN;
      return { text: fixture.text, expected: fixture.width, reported: Number.isFinite(col) ? col - 1 : null };
    });
  }

  // Item 16: one character at a time into `cat`, polling the cursor line until the tty's echo has been parsed.
  private async sampleLatency(count: number): Promise<number[]> {
    const probe = this.renderer!.probe();
    const samples: number[] = [];
    let typed = '';
    for (let i = 0; i < count; i++) {
      if (typed.length >= 40) {
        await this.write('\r');
        await this.idle(150);
        typed = '';
      }
      const ch = String.fromCharCode(97 + (i % 26));
      typed += ch;
      const started = performance.now();
      const deadline = started + 5_000;
      void this.write(ch);
      for (;;) {
        await yieldMacrotask();
        const row = Math.max(0, probe.lineCount() - probe.rows) + probe.cursorY;
        if (probe.line(row).endsWith(typed)) break;
        if (performance.now() > deadline) throw new Error(`echo of ${JSON.stringify(typed)} never appeared`);
      }
      samples.push(Math.round((performance.now() - started) * 100) / 100);
    }
    return samples;
  }

  dispose(): void {
    this.unmount();
    this.renderer?.dispose();
    this.renderer = null;
  }
}
