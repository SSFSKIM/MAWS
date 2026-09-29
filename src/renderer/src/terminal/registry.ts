// The terminal registry (C9 Interfaces *Terminal registry and store*): one per page, the only subscriber of
// `pty.data`, and the owner of every terminal's renderer, container and pty identity. A terminal lives here, not in
// React, so switching tabs, closing the panel or switching sessions under a pinned tab never re-creates the emulator
// (Residue *Persistence*). It carries the renderer side of flow control (coalesced acks, the hidden throttle), the
// claim-before-request dispatch that makes reattaching gapless, boundary-safe checkpoints (Residue *Reattach
// checkpoint*), the key filter and the ⌘ rule for links, the WebGL budget, lifecycle (lost on a host crash, respawn,
// close) and theme pushes.
import type { AppSessionId } from '@shared/graph/ids';
import type { EventPayload, HostState, IpcError, MawsBridge, PtyExit, PtyId, PtyInfo } from '@shared/ipc/schema';
import type * as z from 'zod';
import { ipc } from '../ipc/client';
import { runAction } from '../keymap/actions-runtime';
import {
  ACK_COALESCE_BYTES,
  ACK_COALESCE_MS,
  CHECKPOINT_QUIESCENCE_MS,
  HIDDEN_ACK_BYTES_PER_TICK,
  HIDDEN_ACK_TICK_MS,
  PENDING_BYTES,
  RESIZE_DEBOUNCE_MS,
  SCROLLBACK_LINES,
  WEBGL_BUDGET,
} from './constants';
import { terminalKeyFilter } from './keys';
import { createRenderer, type Acceleration, type RendererOptions, type TerminalFont, type TerminalRenderer, type TerminalTheme } from './renderer';
import { alignReplay, atBoundary, checkpointState, INITIAL_STREAM, resizedStream, trackStream, type StreamState } from './replay';
import { readDocumentFont, readDocumentTheme } from './theme';

export type TerminalId = string & z.$brand<'TerminalId'>; // renderer-assigned; survives "New terminal" (a new pty under the same tab)
export type TerminalStatus = 'starting' | 'running' | 'exited' | 'lost';

export interface TerminalInfo {
  id: TerminalId;
  appSessionId: AppSessionId;
  label: string;
  cwd: string;
  ptyId: PtyId | null;
  pid: number | null;
  status: TerminalStatus;
  exit: PtyExit | null;
  title: string | null;
  acceleration: Acceleration;
  visible: boolean;
  reconnect: 'exact' | 'lossy' | null; // which reattach path ran after a reload; null for a terminal this page spawned
  error: string | null; // why the terminal could not start (spawn or renderer failure), for the tool's bar
}

export interface TerminalHandle {
  readonly info: TerminalInfo;
  readonly renderer: TerminalRenderer | null; // null until the renderer is created (creation is async)
  readonly container: HTMLElement;
}

export interface TerminalInit {
  appSessionId: AppSessionId;
  label: string;
  cwd: string;
  command?: string; // written to the shell after its first spawn (C10's attach path)
}

export interface RegistryDeps {
  ipc: MawsBridge;
  createRenderer(opts: RendererOptions): Promise<TerminalRenderer>;
  readTheme(): TerminalTheme;
  readFont(): TerminalFont;
  runAction(id: 'tab.next' | 'tab.previous'): void;
  webglBudget?: number;
}

type Held = { kind: 'data'; offset: number; data: Uint8Array } | { kind: 'exit'; exit: PtyExit };

// Events held for a pty nobody has bound yet, oldest data dropped past the host ring's size (the replay has it).
class HeldEvents {
  readonly items: Held[] = [];
  private bytes = 0;
  push(item: Held): void {
    this.items.push(item);
    if (item.kind !== 'data') return;
    this.bytes += item.data.byteLength;
    while (this.bytes > PENDING_BYTES) {
      const index = this.items.findIndex((held) => held.kind === 'data');
      const [dropped] = this.items.splice(index, 1) as [Extract<Held, { kind: 'data' }>];
      this.bytes -= dropped.data.byteLength;
    }
  }
}

type Timer = ReturnType<typeof setTimeout>;

class Entry implements TerminalHandle {
  info: TerminalInfo;
  renderer: TerminalRenderer | null = null;
  ready: Promise<TerminalRenderer | null> = Promise.resolve(null); // settles when the renderer exists (or failed)
  readonly container: HTMLDivElement;
  command: string | undefined;
  disposed = false;
  // The stream. `generation` changes on every reset, so parse callbacks of a previous stream are ignored.
  generation = 0;
  bound = false; // chunks for `info.ptyId` go to the renderer; until then they are held
  held = new HeldEvents();
  nextOffset = 0; // chunks below it are already on screen
  parsed = 0; // the stream offset the renderer has parsed up to
  acked = 0;
  ackTimer: Timer | null = null;
  hiddenTick: Timer | null = null;
  tracker: StreamState = INITIAL_STREAM;
  // Checkpoints: the offset and size of the last one sent, and a quiescence check that found the stream mid-sequence.
  checkpointOffset = -1;
  checkpointSize = '';
  checkpointDue = false;
  quietTimer: Timer | null = null;
  // Layout.
  parent: HTMLElement | null = null;
  observer: ResizeObserver | null = null;
  resizeTimer: Timer | null = null;
  size: { cols: number; rows: number } | null = null;
  spawning: Promise<void> | null = null; // the spawn in flight, which a respawn awaits
  focusPending = false;

  constructor(id: TerminalId, init: TerminalInit, status: TerminalStatus) {
    this.command = init.command;
    this.container = document.createElement('div');
    this.container.dataset.keySink = 'terminal'; // C5's dispatcher refuses pane-scoped keys inside (wave-2 ledger)
    this.container.dataset.terminalId = id;
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.info = {
      id,
      appSessionId: init.appSessionId,
      label: init.label,
      cwd: init.cwd,
      ptyId: null,
      pid: null,
      status,
      exit: null,
      title: null,
      acceleration: 'dom',
      visible: false,
      reconnect: null,
      error: null,
    };
  }

  resetStream(): void {
    this.generation++;
    this.bound = false;
    this.held = new HeldEvents();
    this.nextOffset = 0;
    this.parsed = 0;
    this.acked = 0;
    this.tracker = INITIAL_STREAM;
    this.checkpointOffset = -1;
    this.checkpointSize = '';
    this.checkpointDue = false;
    this.clearStreamTimers();
  }

  clearStreamTimers(): void {
    for (const timer of [this.ackTimer, this.hiddenTick, this.quietTimer]) if (timer) clearTimeout(timer);
    this.ackTimer = this.hiddenTick = this.quietTimer = null;
  }
}

const deadStatus = (exit: PtyExit | null): TerminalStatus => (exit && (exit.exitCode !== null || exit.signal !== null) ? 'exited' : 'lost');

// A failed `pty.kill` whose pty is gone anyway: the host no longer knows it, or the host itself is not running.
const ptyGone = (error: IpcError): boolean => error.code === 'host_unavailable' || /unknown pty/.test(error.message);

export class TerminalRegistry {
  private readonly entries = new Map<TerminalId, Entry>();
  private readonly byPty = new Map<string, Entry>(); // the dispatch map: a claimed pty's events go to its entry
  private readonly unclaimed = new Map<string, HeldEvents>(); // events for ptys whose spawn reply is still in flight
  private spawnsInFlight = 0;
  private readonly listeners = new Set<(infos: TerminalInfo[], host: HostState | null) => void>();
  private started = false;
  private checkpoints = true;
  private metaHeld = false; // a ⌘ keydown seen and not yet released (link activation events may not carry metaKey)
  private theme: TerminalTheme | null = null;
  private themeKey = '';
  private hostState: HostState | null = null;
  private readonly webglBudget: number;

  constructor(private readonly deps: RegistryDeps) {
    this.webglBudget = deps.webglBudget ?? WEBGL_BUDGET;
  }

  // Subscribes once, before the first `pty.spawn` or `pty.attach` leaves the page.
  private start(): void {
    if (this.started) return;
    this.started = true;
    const { ipc: bridge } = this.deps;
    bridge.on('pty.data', (event) => this.receive(event));
    bridge.on('pty.exit', (event) => this.receiveExit(event));
    bridge.on('pty.hostState', (state) => this.applyHost(state));
    bridge.on('settings.changed', () => this.refreshTheme());
    void bridge.invoke('pty.hostState', undefined).then((result) => {
      if (result.ok) this.applyHost(result.value);
    });
    window.addEventListener('pagehide', () => this.checkpointAll());
    window.addEventListener('keydown', (ev) => ev.key === 'Meta' && (this.metaHeld = true), true);
    window.addEventListener('keyup', (ev) => ev.key === 'Meta' && (this.metaHeld = false), true);
    window.addEventListener('blur', () => (this.metaHeld = false));
    // The page sets `data-theme` after `settings.changed` arrives (a React effect), and the tokens resolve from it.
    new MutationObserver(() => this.refreshTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  open(init: TerminalInit): TerminalId {
    this.start();
    return this.createEntry(init, 'starting').info.id;
  }

  // Re-adopts the host's ptys after a reload: for each one the page accepts, a handle that claims the pty before it
  // asks for the attach, then restores the screen exactly or lossily. Resolves with the adopted ids.
  async adopt(accept: (info: PtyInfo) => boolean = () => true): Promise<TerminalId[]> {
    this.start();
    const listed = await this.deps.ipc.invoke('pty.list', undefined);
    if (!listed.ok) {
      console.error('[terminal] pty.list failed', listed.error);
      return [];
    }
    const known = new Set([...this.entries.values()].map((entry) => entry.info.ptyId));
    const ids = await Promise.all(listed.value.ptys.filter((info) => !known.has(info.ptyId) && accept(info)).map((info) => this.adoptOne(info)));
    return ids.filter((id): id is TerminalId => id !== null);
  }

  get(id: TerminalId): TerminalHandle | undefined {
    return this.entries.get(id);
  }

  list(): TerminalInfo[] {
    return [...this.entries.values()].map((entry) => entry.info);
  }

  host(): HostState | null {
    return this.hostState;
  }

  subscribe(cb: (infos: TerminalInfo[], host: HostState | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // Shows the terminal in `parent`: its container is appended, acceleration acquired within the budget, the size
  // measured (a first mount spawns the pty at that size) and kept measured through a debounced ResizeObserver.
  mount(id: TerminalId, parent: HTMLElement, options: { focus?: boolean } = {}): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    parent.appendChild(entry.container);
    entry.parent = parent;
    if (options.focus) entry.focusPending = true;
    entry.observer?.disconnect();
    entry.observer = new ResizeObserver(() => this.scheduleFit(entry));
    entry.observer.observe(entry.container);
    this.update(entry, { visible: true });
    if (entry.renderer) this.shown(entry);
  }

  unmount(id: TerminalId): void {
    const entry = this.entries.get(id);
    if (!entry?.parent) return;
    entry.observer?.disconnect();
    entry.observer = null;
    if (entry.resizeTimer) clearTimeout(entry.resizeTimer);
    entry.resizeTimer = null;
    entry.container.remove();
    entry.parent = null;
    entry.renderer?.setVisible(false);
    if (entry.ackTimer) clearTimeout(entry.ackTimer);
    entry.ackTimer = null;
    this.update(entry, { visible: false, acceleration: entry.renderer?.acceleration ?? 'dom' });
    this.scheduleAck(entry); // what is parsed but unacknowledged now drains at the hidden rate
  }

  focus(id: TerminalId): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.renderer && entry.parent) entry.renderer.focus();
    else entry.focusPending = true;
  }

  // An exited or lost terminal gets a new pty with the same cwd and label, in the same handle (tab and title stay);
  // the old screen is cleared. A terminal whose renderer could not start tries to create it again first (a transient
  // failure recovers); if it fails again the terminal stays exited with the new reason, and the call rejects.
  async respawn(id: TerminalId): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || (entry.info.status !== 'exited' && entry.info.status !== 'lost')) return;
    if (entry.info.ptyId) this.byPty.delete(entry.info.ptyId);
    entry.resetStream();
    entry.renderer?.reset();
    this.update(entry, { status: 'starting', exit: null, ptyId: null, pid: null, reconnect: null, title: null, error: null });
    if (!entry.renderer && !(await this.startRenderer(entry))) throw new Error(entry.info.error ?? 'the terminal renderer could not start');
    await this.spawn(entry); // the spawn a mounted terminal's first fit already started, or a new one
  }

  // Kills the pty (SIGHUP), then disposes the handle. A kill that fails while the pty may still run keeps the handle,
  // its status and its screen, and rejects, so the tool can show the failure instead of orphaning a live shell.
  async close(id: TerminalId): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    const { ptyId, status } = entry.info;
    if (ptyId && status !== 'lost') {
      const result = await this.deps.ipc.invoke('pty.kill', { ptyId });
      if (!result.ok && !ptyGone(result.error)) throw new Error(`pty.kill failed: ${result.error.message}`);
    }
    this.dispose(entry);
  }

  // What runs in the foreground. Rejects when the host cannot answer: the tool then fails closed and asks before
  // closing, rather than reading a failure as "nothing is running".
  async foreground(id: TerminalId): Promise<{ process: string | null; busy: boolean }> {
    const entry = this.entries.get(id);
    const ptyId = entry?.info.ptyId;
    if (!ptyId || entry.info.status !== 'running') return { process: null, busy: false };
    const result = await this.deps.ipc.invoke('pty.foreground', { ptyId });
    if (!result.ok) throw new Error(`pty.foreground failed: ${result.error.message}`);
    return result.value;
  }

  // Test hook (harness `terminals.setCheckpoints`): off stops both the quiescence and the pagehide checkpoints.
  setCheckpoints(enabled: boolean): void {
    this.checkpoints = enabled;
    if (enabled) return;
    for (const entry of this.entries.values()) {
      if (entry.quietTimer) clearTimeout(entry.quietTimer);
      entry.quietTimer = null;
      entry.checkpointDue = false;
    }
  }

  // --- entries -------------------------------------------------------------------------------------------------

  private createEntry(init: TerminalInit, status: TerminalStatus): Entry {
    const entry = new Entry(crypto.randomUUID() as TerminalId, init, status);
    this.entries.set(entry.info.id, entry);
    void this.startRenderer(entry);
    this.publish();
    return entry;
  }

  private startRenderer(entry: Entry): Promise<TerminalRenderer | null> {
    const options: RendererOptions = { scrollback: SCROLLBACK_LINES, theme: this.currentTheme(), font: this.deps.readFont(), webgl: true };
    entry.ready = this.deps.createRenderer(options).then(
      (renderer) => {
        this.attachRenderer(entry, renderer);
        return entry.renderer;
      },
      (error: unknown) => {
        // A terminal that cannot draw: one that was to spawn shows as exited with the reason; an adopted one keeps its
        // pty's status (the pty runs on, and closing the tab kills it) and carries the reason too.
        const reason = error instanceof Error ? error.message : String(error);
        console.error('[terminal] renderer creation failed', error);
        this.update(entry, { error: `the terminal renderer could not start: ${reason}`, ...(entry.info.status === 'starting' ? { status: 'exited' as const } : {}) });
        return null;
      },
    );
    return entry.ready;
  }

  private attachRenderer(entry: Entry, renderer: TerminalRenderer): void {
    if (entry.disposed) return renderer.dispose();
    entry.renderer = renderer;
    entry.container.append(renderer.element);
    renderer.onData((data) => {
      const { ptyId, status } = entry.info;
      if (ptyId && status === 'running') void this.deps.ipc.invoke('pty.write', { ptyId, data });
    });
    renderer.onTitle((title) => this.update(entry, { title: title || null }));
    renderer.onAccelerationChange((acceleration) => this.update(entry, { acceleration }));
    renderer.setKeyFilter((ev) => {
      const verdict = terminalKeyFilter(ev);
      if (verdict === 'pty') return true;
      if (verdict !== 'app' && ev.type === 'keydown') this.deps.runAction(verdict);
      return false;
    });
    // ⌘-click opens (Residue *Copy, paste and links*). xterm activates links on any click, and under Playwright's
    // ⌘-click the activating `mouseup` arrived without `metaKey` (M1), so a ⌘ held since its keydown counts too.
    renderer.setLinkHandler((url, ev) => {
      if (ev.metaKey || this.metaHeld) void this.deps.ipc.invoke('pty.openLink', { url });
    });
    if (entry.size) renderer.resize(entry.size.cols, entry.size.rows);
    if (entry.parent) this.shown(entry);
  }

  private shown(entry: Entry): void {
    const renderer = entry.renderer!;
    const inUse = [...this.entries.values()].filter((other) => other !== entry && other.renderer?.acceleration === 'webgl').length;
    if (inUse < this.webglBudget) renderer.setVisible(true);
    this.update(entry, { acceleration: renderer.acceleration });
    this.fitNow(entry);
    if (entry.focusPending) {
      entry.focusPending = false;
      renderer.focus();
    }
    if (entry.hiddenTick) clearTimeout(entry.hiddenTick);
    entry.hiddenTick = null;
    if (entry.parsed > entry.acked) this.sendAck(entry, entry.parsed); // shown: acknowledge at once what is parsed
  }

  private scheduleFit(entry: Entry): void {
    if (entry.resizeTimer) clearTimeout(entry.resizeTimer);
    entry.resizeTimer = setTimeout(() => {
      entry.resizeTimer = null;
      this.fitNow(entry);
    }, RESIZE_DEBOUNCE_MS);
  }

  // Measures the container; a size change resizes the renderer and the pty, and the first size spawns the pty. No
  // size (hidden or detached) waits for the next observer callback rather than spawning at a default size.
  private fitNow(entry: Entry): void {
    const dims = entry.parent ? entry.renderer?.fit() : null;
    if (!dims) return;
    if (!entry.size || entry.size.cols !== dims.cols || entry.size.rows !== dims.rows) {
      entry.size = dims;
      entry.renderer!.resize(dims.cols, dims.rows);
      entry.tracker = resizedStream(entry.tracker); // the emulator's resize resets its scroll regions
      const { ptyId, status } = entry.info;
      if (ptyId && status === 'running') void this.deps.ipc.invoke('pty.resize', { ptyId, ...dims });
    }
    if (!entry.info.ptyId && entry.info.status === 'starting') void this.spawn(entry);
  }

  private spawn(entry: Entry): Promise<void> {
    if (entry.spawning) return entry.spawning;
    if (entry.info.ptyId || !entry.size || entry.disposed) return Promise.resolve();
    entry.spawning = this.spawnPty(entry, entry.size);
    return entry.spawning;
  }

  private async spawnPty(entry: Entry, measured: { cols: number; rows: number }): Promise<void> {
    this.spawnsInFlight++;
    const { appSessionId, label, cwd } = entry.info;
    const spawned = { ...measured };
    const command = entry.command;
    entry.command = undefined; // the attach command runs in the first shell only, not in a respawned one
    const result = await this.deps.ipc.invoke('pty.spawn', { appSessionId, label, cwd, ...spawned, ...(command ? { command } : {}) });
    this.spawnsInFlight--;
    entry.spawning = null;
    const held = result.ok ? this.unclaimed.get(result.value.ptyId) : undefined;
    if (result.ok) this.unclaimed.delete(result.value.ptyId);
    if (this.spawnsInFlight === 0) this.unclaimed.clear();
    if (!result.ok) {
      console.error(`[terminal] pty.spawn failed for ${label}`, result.error);
      if (entry.info.status === 'starting') this.update(entry, { status: 'exited', error: `the shell could not start: ${result.error.message}` });
      return;
    }
    const { ptyId, pid } = result.value;
    if (entry.disposed) {
      void this.deps.ipc.invoke('pty.kill', { ptyId });
      return;
    }
    entry.bound = true;
    entry.nextOffset = 0;
    this.byPty.set(ptyId, entry);
    this.update(entry, { ptyId, pid, status: 'running' });
    for (const item of held?.items ?? []) this.dispatch(entry, item);
    const size = entry.size;
    if (size && entry.info.status === 'running' && (size.cols !== spawned.cols || size.rows !== spawned.rows)) {
      void this.deps.ipc.invoke('pty.resize', { ptyId, ...size });
    }
  }

  private async adoptOne(info: PtyInfo): Promise<TerminalId | null> {
    const entry = this.createEntry({ appSessionId: info.appSessionId, label: info.label, cwd: info.cwd }, info.alive ? 'running' : deadStatus(info.exit));
    // The claim precedes the request: events the host emits after its snapshot wait in the entry's held list.
    this.byPty.set(info.ptyId, entry);
    this.update(entry, { ptyId: info.ptyId, pid: info.pid, exit: info.exit });
    const [attached, renderer] = await Promise.all([this.deps.ipc.invoke('pty.attach', { ptyId: info.ptyId }), entry.ready]);
    if (!attached.ok) {
      console.error(`[terminal] pty.attach failed for ${info.ptyId}`, attached.error);
      this.dispose(entry);
      return null;
    }
    if (entry.disposed) return null;
    const { checkpoint, replay, replayFrom, nextOffset, info: now } = attached.value;
    if (!renderer) {
      // Nothing can show this pty: release the claim and its held events, and report the handle with the reason.
      this.byPty.delete(info.ptyId);
      entry.held = new HeldEvents();
      this.update(entry, { status: now.alive ? 'running' : deadStatus(now.exit), exit: now.exit, pid: now.pid });
      return entry.info.id;
    }
    entry.size = { cols: now.cols, rows: now.rows };
    renderer.resize(now.cols, now.rows);
    entry.acked = nextOffset; // the attach acknowledged everything emitted
    entry.bound = true; // the restore below and the held events are written in one synchronous pass
    entry.nextOffset = nextOffset;
    const exact = checkpoint !== null && replayFrom === checkpoint.offset;
    if (exact) {
      this.writeTracked(entry, checkpoint.state);
      entry.parsed = entry.checkpointOffset = checkpoint.offset;
      entry.checkpointSize = `${now.cols}x${now.rows}`;
      this.writeStream(entry, replay, nextOffset);
    } else {
      renderer.reset();
      this.writeStream(entry, alignReplay(replay), nextOffset);
    }
    this.update(entry, { reconnect: exact ? 'exact' : 'lossy', status: now.alive ? 'running' : deadStatus(now.exit), exit: now.exit, pid: now.pid });
    const held = entry.held.items.splice(0);
    for (const item of held) this.dispatch(entry, item);
    if (!now.alive) this.byPty.delete(info.ptyId);
    if (!exact && now.alive && now.rows > 1) this.nudgeRepaint(entry, info.ptyId, now.cols, now.rows);
    return entry.info.id;
  }

  // A full-screen program repaints on SIGWINCH; the lossy path has no screen to show until it does.
  private nudgeRepaint(entry: Entry, ptyId: PtyId, cols: number, rows: number): void {
    void this.deps.ipc.invoke('pty.resize', { ptyId, cols, rows: rows - 1 });
    setTimeout(() => {
      if (entry.info.ptyId === ptyId && entry.info.status === 'running') void this.deps.ipc.invoke('pty.resize', { ptyId, cols, rows });
    }, RESIZE_DEBOUNCE_MS);
  }

  private dispose(entry: Entry): void {
    entry.disposed = true;
    this.unmount(entry.info.id);
    entry.clearStreamTimers();
    if (entry.info.ptyId && this.byPty.get(entry.info.ptyId) === entry) this.byPty.delete(entry.info.ptyId);
    entry.renderer?.dispose();
    this.entries.delete(entry.info.id);
    this.publish();
  }

  // --- the stream ----------------------------------------------------------------------------------------------

  private receive(event: EventPayload<'pty.data'>): void {
    this.route(event.ptyId, { kind: 'data', offset: event.offset, data: event.data });
  }

  private receiveExit(event: EventPayload<'pty.exit'>): void {
    this.route(event.ptyId, { kind: 'exit', exit: { exitCode: event.exitCode, signal: event.signal } });
  }

  // A claimed pty's event goes to its entry (held there until the entry is bound); an unclaimed one is held only
  // while a spawn is in flight, because only a spawn reply can still claim it. The unclaimed lists are dropped when
  // the last spawn reply arrives, which is also where an unclaimed pty's exit ends up discarding its list.
  private route(ptyId: string, item: Held): void {
    const entry = this.byPty.get(ptyId);
    if (entry) {
      if (entry.bound) this.dispatch(entry, item);
      else entry.held.push(item);
    } else if (this.spawnsInFlight > 0) {
      const held = this.unclaimed.get(ptyId) ?? new HeldEvents();
      held.push(item);
      this.unclaimed.set(ptyId, held);
    }
  }

  private dispatch(entry: Entry, item: Held): void {
    if (item.kind === 'exit') return this.exited(entry, item.exit);
    if (item.offset < entry.nextOffset) return; // the replay (or an earlier chunk) covered it
    const end = item.offset + item.data.byteLength;
    entry.nextOffset = end;
    this.writeStream(entry, item.data, end);
  }

  // Writes stream bytes; when the renderer has parsed them the tracker follows, and acks and checkpoints are due.
  private writeStream(entry: Entry, data: Uint8Array, end: number): void {
    const generation = entry.generation;
    if (data.byteLength === 0) {
      entry.parsed = Math.max(entry.parsed, end);
      return;
    }
    entry.renderer!.write(data, () => {
      if (entry.generation !== generation || entry.disposed) return;
      entry.tracker = trackStream(entry.tracker, data);
      entry.parsed = Math.max(entry.parsed, end);
      this.scheduleAck(entry);
      this.scheduleCheckpoint(entry);
    });
  }

  // Writes bytes that are not part of the stream (a checkpoint's state), keeping the tracker in step with the emulator.
  private writeTracked(entry: Entry, state: string): void {
    const generation = entry.generation;
    entry.renderer!.write(state, () => {
      if (entry.generation === generation) entry.tracker = trackStream(entry.tracker, state);
    });
  }

  private exited(entry: Entry, exit: PtyExit): void {
    if (entry.info.status === 'exited' || entry.info.status === 'lost') return;
    if (entry.info.ptyId) this.byPty.delete(entry.info.ptyId);
    const status = deadStatus(exit);
    if (status === 'lost') entry.clearStreamTimers();
    this.update(entry, { status, exit });
  }

  // Acks: visible terminals acknowledge at once past 32 KiB, else 16 ms after the last parse; hidden ones at most
  // 256 KiB per 250 ms tick.
  private scheduleAck(entry: Entry): void {
    if (entry.parsed <= entry.acked || entry.info.status !== 'running') return;
    if (entry.info.visible) {
      if (entry.parsed - entry.acked >= ACK_COALESCE_BYTES) this.sendAck(entry, entry.parsed);
      else entry.ackTimer ??= setTimeout(() => this.sendAck(entry, entry.parsed), ACK_COALESCE_MS);
      return;
    }
    entry.hiddenTick ??= setTimeout(() => {
      entry.hiddenTick = null;
      if (entry.info.visible) return;
      this.sendAck(entry, Math.min(entry.parsed, entry.acked + HIDDEN_ACK_BYTES_PER_TICK));
      this.scheduleAck(entry);
    }, HIDDEN_ACK_TICK_MS);
  }

  private sendAck(entry: Entry, offset: number): void {
    if (entry.ackTimer) clearTimeout(entry.ackTimer);
    entry.ackTimer = null;
    const { ptyId, status } = entry.info;
    if (!ptyId || status !== 'running' || offset <= entry.acked) return;
    entry.acked = offset;
    void this.deps.ipc.invoke('pty.ack', { ptyId, offset });
  }

  // --- checkpoints ---------------------------------------------------------------------------------------------

  private canCheckpoint(entry: Entry): boolean {
    const { ptyId, status } = entry.info;
    return this.checkpoints && entry.bound && !!ptyId && !!entry.renderer && (status === 'running' || status === 'exited');
  }

  // A point the serializer can restore exactly; the terminal's height lets a region spelled out as the full screen count.
  private atBoundary(entry: Entry): boolean {
    return atBoundary(entry.tracker, entry.size?.rows);
  }

  // Quiescence: 500 ms after the last parsed byte; if the stream is mid-sequence then, the first chunk after that
  // which ends on a boundary.
  private scheduleCheckpoint(entry: Entry): void {
    if (!this.canCheckpoint(entry)) return;
    if (entry.quietTimer) clearTimeout(entry.quietTimer);
    entry.quietTimer = setTimeout(() => {
      entry.quietTimer = null;
      if (entry.parsed <= entry.checkpointOffset) return;
      if (this.atBoundary(entry)) this.takeCheckpoint(entry);
      else entry.checkpointDue = true;
    }, CHECKPOINT_QUIESCENCE_MS);
    if (entry.checkpointDue && this.atBoundary(entry)) this.takeCheckpoint(entry);
  }

  // `pagehide` (a reload or a closing window) cannot wait: every live handle at a boundary is checkpointed now, the
  // rest keep the checkpoint the host already has. A handle whose last checkpoint is still current is skipped.
  private checkpointAll(): void {
    for (const entry of this.entries.values()) {
      if (!this.canCheckpoint(entry) || !this.atBoundary(entry)) continue;
      const size = entry.size ? `${entry.size.cols}x${entry.size.rows}` : '';
      if (entry.parsed === entry.checkpointOffset && size === entry.checkpointSize) continue;
      this.takeCheckpoint(entry);
    }
  }

  private takeCheckpoint(entry: Entry): void {
    const serialized = entry.renderer!.serialize();
    entry.checkpointDue = false;
    if (serialized === null) return;
    entry.checkpointOffset = entry.parsed;
    entry.checkpointSize = entry.size ? `${entry.size.cols}x${entry.size.rows}` : '';
    const state = checkpointState(serialized, entry.tracker);
    void this.deps.ipc.invoke('pty.checkpoint', { ptyId: entry.info.ptyId!, offset: entry.parsed, state });
  }

  // --- host, theme, publishing ---------------------------------------------------------------------------------

  // A crashed or restarting host has taken every pty with it: live handles are lost (the supervisor's `pty.exit`
  // events say the same and find them lost already).
  private applyHost(state: HostState): void {
    if (this.hostState && state.revision < this.hostState.revision) return;
    this.hostState = state;
    if (state.state === 'crashed' || state.state === 'restarting') {
      for (const entry of this.entries.values()) {
        if (entry.info.status === 'running' || entry.info.status === 'starting') this.exited(entry, { exitCode: null, signal: null });
      }
    }
    this.publish();
  }

  private currentTheme(): TerminalTheme {
    if (!this.theme) {
      this.theme = this.deps.readTheme();
      this.themeKey = JSON.stringify(this.theme);
    }
    return this.theme;
  }

  private refreshTheme(): void {
    let next: TerminalTheme;
    try {
      next = this.deps.readTheme();
    } catch (error) {
      console.error('[terminal] theme tokens unreadable', error);
      return;
    }
    const key = JSON.stringify(next);
    if (key === this.themeKey) return;
    this.theme = next;
    this.themeKey = key;
    for (const entry of this.entries.values()) entry.renderer?.setTheme(next);
  }

  private update(entry: Entry, patch: Partial<TerminalInfo>): void {
    entry.info = { ...entry.info, ...patch };
    this.publish();
  }

  private publish(): void {
    const infos = this.list();
    this.listeners.forEach((cb) => cb(infos, this.hostState));
  }
}

// The page's registry: xterm.js, the document's tokens, C5's action runtime.
export const terminals = new TerminalRegistry({
  ipc,
  createRenderer: (opts) => createRenderer('xterm', opts),
  readTheme: readDocumentTheme,
  readFont: readDocumentFont,
  runAction,
});
