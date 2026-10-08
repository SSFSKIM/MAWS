// The tab's one `webContents.debugger` attachment (E4a execution document, Design §10; A-19, A-33; Decision Log 19),
// shared by every later piece that speaks CDP to a page: E4c's tool bridge, E4b's CHIPS import, E4d's crop, and MAWS's
// own focus emulation (visibility.ts). It is Playwright-agnostic and never speaks WebSocket; E4c's bridge sits on it.
//
// `send` is the only way a command reaches the page: the raw debugger is never handed out. That is what makes the input
// attribution sound (`findings-pass2.txt:143-170`): every `Input.*` command, the tools' and MAWS's own, enters the
// in-flight table before it is sent and leaves it on its reply or its error, so a `before-mouse-event` press is the
// agent's exactly when a `mousePressed` is in flight and not yet consumed by an earlier press (input.ts), and a command
// that errors releases its slot rather than absorbing the human's next press.
//
// The attachment is made once (`attach` is idempotent; protocol 1.3, then `Page.getFrameTree` once for the main frame's
// id, which Chromium keeps across cross-site swaps, `findings-pass2.txt:306-310`) and survives navigations. `send`
// attaches when nothing is attached yet, so whoever asks first attaches; a renderer crash detaches it (the store) and the
// next ask attaches again. Chromium's own detach (the webContents closing) is forwarded with its reason.
//
// Leases (the in-app browser spec of 2026-10-08, "Debugger leases"; P1 A-51): the attachment is counted, not owned. A
// lease attaches when nothing is attached and the attachment ends when the last lease is released, so no holder's
// release ends an attachment another holder still uses. cua's primitive server takes a lease per tab it drives; the
// older holders (E4c's Playwright driver, focus emulation) hold one implicit lease each through `attach(owner)` and
// `detach(owner)`. Leases count attachment, not authority: CDP state belongs to the one attachment, so whoever drives a
// tab is decided above this class (one automation owner per tab). `end` is the store's: the page is going (closed,
// suspended, crashed), so the attachment ends whatever is held and every lease with it, as Chromium's own detach does.
import type { WebContents } from 'electron';

const PROTOCOL_VERSION = '1.3';

// The two Input.dispatchMouseEvent types a mouse button's hooks are matched against.
export type InFlightKind = 'mousePressed' | 'mouseReleased';

interface InFlightCommand {
  id: number;
  type: string | null; // the command's `params.type`, when it has one
  sentAt: number;
  consumed: boolean; // an event of its type was attributed to it already
}

export type CommandParams = Record<string, unknown>;

// One phase of a command `send` made: before it goes out, and when its reply or error comes back (the probe bridge's
// `onCommand` shape). `sessionId` is '' for the page's own session.
export type CommandPhase =
  | { phase: 'send'; id: number; method: string; params: CommandParams | undefined; sessionId: string; at: number }
  | { phase: 'reply'; id: number; method: string; params: CommandParams | undefined; sessionId: string; at: number; ok: true; result: unknown }
  | { phase: 'reply'; id: number; method: string; params: CommandParams | undefined; sessionId: string; at: number; ok: false; error: unknown };

// An event's listener: its params, the session it came from ('' for the page's own), and its method (for '*').
export type DebuggerEventListener = (params: unknown, sessionId: string, method: string) => void;

type DebuggerHost = Pick<WebContents, 'debugger' | 'isDestroyed'>;

// One hold on the attachment; `live` turns false when it is released or the attachment ended under it.
export interface DebuggerLease {
  readonly live: boolean;
  release(): void;
}

// The holders of an implicit lease, each through `attach(owner)` / `detach(owner)`.
export type DebuggerOwner = 'shared' | 'driver' | 'focus';

export class TabDebugger {
  private connection: Promise<void> | null = null; // the attachment, made or being made
  private isAttached = false;
  private generation = 0; // bumped by every detach, so an attach the detach overtook does not complete
  private wired = false;
  private nextId = 1;
  private frameId: string | null = null;
  private readonly flying = new Map<number, InFlightCommand>();
  private readonly listeners = new Map<string, Set<DebuggerEventListener>>();
  private readonly observers = new Set<(phase: CommandPhase) => void>();
  private readonly detachListeners = new Set<(reason: string) => void>();
  private readonly holders = new Set<object>(); // every live lease, the owners' implicit ones included
  private readonly owners = new Map<DebuggerOwner, DebuggerLease>();

  constructor(
    private readonly webContents: DebuggerHost,
    private readonly now: () => number = Date.now,
  ) {}

  get attached(): boolean {
    return this.isAttached;
  }

  // An attach is under way (not yet `attached`): a command sent now goes out, in order, once it settles.
  get attaching(): boolean {
    return this.connection !== null && !this.isAttached;
  }

  // The page's main frame id (the page target's id in CDP), read once per attachment; null while detached.
  get mainFrameId(): string | null {
    return this.frameId;
  }

  // How many leases are held (the owners' implicit ones included).
  get leases(): number {
    return this.holders.size;
  }

  // Whether this owner holds its implicit lease.
  heldBy(owner: DebuggerOwner): boolean {
    return this.owners.has(owner);
  }

  // A lease on the attachment: attaches when nothing is attached (every caller in the meantime shares the one
  // attachment); rejects, holding nothing, when the attach fails.
  async lease(): Promise<DebuggerLease> {
    const token = {};
    const holders = this.holders;
    holders.add(token);
    const lease: DebuggerLease = {
      get live() {
        return holders.has(token);
      },
      release: () => {
        if (holders.delete(token) && holders.size === 0) this.endAttachment();
      },
    };
    try {
      await this.ensureAttached();
    } catch (error) {
      this.holders.delete(token);
      throw error;
    }
    if (!this.holders.has(token)) throw new Error('the debugger was detached while attaching');
    return lease;
  }

  // The owner's implicit lease (idempotent per owner), attaching if nothing is attached.
  async attach(owner: DebuggerOwner = 'shared'): Promise<void> {
    if (this.owners.has(owner)) return this.ensureAttached();
    const lease = await this.lease();
    if (this.owners.has(owner)) lease.release(); // two attaches of one owner raced: one lease is kept
    else this.owners.set(owner, lease);
  }

  // Releases the owner's implicit lease; when no lease remains, the attachment ends (a no-op while detached).
  detach(owner: DebuggerOwner = 'shared'): void {
    const lease = this.owners.get(owner);
    this.owners.delete(owner);
    lease?.release();
    if (this.holders.size === 0) this.endAttachment();
  }

  // The page is going (the store: closed, suspended, crashed): the attachment ends whatever is held, every lease with it.
  end(): void {
    this.endAttachment();
  }

  // Attaches if nothing is attached; every caller in the meantime shares the one attachment.
  private ensureAttached(): Promise<void> {
    if (!this.connection) {
      const generation = this.generation;
      this.connection = this.connect(generation).catch((error: unknown) => {
        if (this.generation === generation) {
          this.detachDebugger(); // half attached (attached, but the frame tree never came): undone
          this.release(null);
        }
        throw error;
      });
    }
    return this.connection;
  }

  // Detaches (a no-op while detached); the detach listeners hear it once, as they hear Chromium's.
  private endAttachment(): void {
    if (this.connection === null) {
      this.dropLeases();
      return;
    }
    this.detachDebugger();
    this.release('detached');
  }

  // Sends one command to the page (or to a child session) and answers its result; attaches first when needed. While
  // attached, an Input command is in the table by the time this returns.
  send<T = unknown>(method: string, params?: CommandParams, sessionId?: string): Promise<T> {
    const sent = this.isAttached ? this.command(method, params, sessionId) : this.ensureAttached().then(() => this.command(method, params, sessionId));
    return sent as Promise<T>;
  }

  // Whether an Input command of this type is in flight that no event has been attributed to yet.
  inFlight(kind: InFlightKind): boolean {
    for (const command of this.flying.values()) if (command.type === kind && !command.consumed) return true;
    return false;
  }

  // Attributes one event to the oldest such command; false when there was none.
  consume(kind: InFlightKind): boolean {
    let oldest: InFlightCommand | undefined;
    for (const command of this.flying.values()) {
      if (command.type === kind && !command.consumed && (!oldest || command.sentAt < oldest.sentAt)) oldest = command;
    }
    if (!oldest) return false;
    oldest.consumed = true;
    return true;
  }

  // Observes every command's send and reply (E4c's logging and rows); an observer enters nothing in the table.
  onCommand(observer: (phase: CommandPhase) => void): () => void {
    this.observers.add(observer);
    return () => void this.observers.delete(observer);
  }

  // Listens to one CDP event method, or to every event with '*'.
  on(method: string, listener: DebuggerEventListener): () => void {
    let set = this.listeners.get(method);
    if (!set) this.listeners.set(method, (set = new Set()));
    set.add(listener);
    return () => void set.delete(listener);
  }

  onDetach(listener: (reason: string) => void): () => void {
    this.detachListeners.add(listener);
    return () => void this.detachListeners.delete(listener);
  }

  // ---- internals ------------------------------------------------------------------------------------------------------

  private async connect(generation: number): Promise<void> {
    const dbg = this.webContents.debugger;
    this.wire(dbg);
    if (!dbg.isAttached()) dbg.attach(PROTOCOL_VERSION);
    const { frameTree } = (await this.command('Page.getFrameTree')) as { frameTree: { frame: { id: string } } };
    if (this.generation !== generation) throw new Error('the debugger was detached while attaching');
    this.frameId = frameTree.frame.id;
    this.isAttached = true;
  }

  private async command(method: string, params?: CommandParams, sessionId = ''): Promise<unknown> {
    const id = this.nextId++;
    const sentAt = this.now();
    if (method.startsWith('Input.')) this.flying.set(id, { id, type: typeof params?.type === 'string' ? params.type : null, sentAt, consumed: false });
    this.observe({ phase: 'send', id, method, params, sessionId, at: sentAt });
    try {
      const dbg = this.webContents.debugger;
      const result: unknown = await (sessionId ? dbg.sendCommand(method, params, sessionId) : dbg.sendCommand(method, params));
      this.flying.delete(id);
      this.observe({ phase: 'reply', id, method, params, sessionId, at: this.now(), ok: true, result });
      return result;
    } catch (error) {
      this.flying.delete(id);
      this.observe({ phase: 'reply', id, method, params, sessionId, at: this.now(), ok: false, error });
      throw error;
    }
  }

  // The debugger's events, subscribed once for the life of the webContents (an attachment ends; the debugger does not).
  private wire(dbg: WebContents['debugger']): void {
    if (this.wired) return;
    this.wired = true;
    dbg.on('message', (_event, method, params, sessionId) => {
      for (const key of [method, '*']) {
        for (const listener of [...(this.listeners.get(key) ?? [])]) this.safely(() => listener(params, sessionId || '', method));
      }
    });
    dbg.on('detach', (_event, reason) => {
      if (this.connection !== null) this.release(reason);
    });
  }

  private detachDebugger(): void {
    if (this.webContents.isDestroyed()) return;
    const dbg = this.webContents.debugger;
    if (dbg.isAttached()) dbg.detach();
  }

  // The attachment is gone: nothing is in flight any more (each pending reply rejects), and the listeners are told.
  private release(reason: string | null): void {
    this.dropLeases();
    this.generation++;
    this.connection = null;
    this.isAttached = false;
    this.frameId = null;
    this.flying.clear();
    if (reason !== null) for (const listener of [...this.detachListeners]) this.safely(() => listener(reason));
  }

  // Every lease ends with the attachment (or with an attach that failed).
  private dropLeases(): void {
    this.holders.clear();
    this.owners.clear();
  }

  private observe(phase: CommandPhase): void {
    for (const observer of [...this.observers]) this.safely(() => observer(phase));
  }

  // A listener's bug stays its own: Electron would otherwise surface it as an uncaught exception in main.
  private safely(call: () => void): void {
    try {
      call();
    } catch (error) {
      console.error('[browser] a debugger listener failed:', error);
    }
  }
}
