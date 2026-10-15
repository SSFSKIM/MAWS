// One project: its log (DX2's sync with machines, DX3's resume for browsers) and its audit record, held by a Durable
// Object on SQLite. Browsers hold WebSockets accepted with the Hibernation API, each carrying its member and whether it
// follows the log in its attachment, so a woken object knows whose it is. Machines reach it through their `Machine`
// objects (`fromMachine`), and it reaches them back the same way, one ordered queue per machine. The session plane and
// the pending set are M3's.
import { DurableObject } from 'cloudflare:workers';
import { MEMBER_HEADER, ORG_HEADER, PROJECT_HEADER, type Env } from '../env';
import type { AuditEntry, ProjectDown } from '../protocol/browser';
import { isMemberId } from '../protocol/identity';
import { HUB_WRITER_PREFIX, hubWriter, isHubPosition, LEGACY_WRITER_PREFIX, withoutPosition, writerMachine, type LogEvent, type Vector } from '../protocol/log';
import type { DownFrame, Refusal, Rejection, UpFrame } from '../protocol/machine';
import { FRAME_LIMIT, PartAssembler, toWire, type Part } from '../protocol/parts';
import { eventShapeError, LogStore, sameEvent, type AuditRow, type Stored } from './log-store';

/** A `.smns` project id (a lowercase uuid). */
export const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type SocketAttachment = { member: string; visible: boolean; subs: string[]; /** resumed: receives the log live */ log: boolean };

/** Who sent a machine's frame: its org, the project it names, the machine, and the stream the POST belongs to. */
export type MachineContext = { org: string; project: string; machine: string; generation: number };

/** How many audit entries a browser that resumes is shown after `caught-up`. */
const AUDIT_REPLAY = 100;
const REJECTION_REASONS = new Set<string>(['bad-code', 'seen-nonce', 'bad-shape']);
const encoder = new TextEncoder();

export class Project extends DurableObject<Env> {
  private readonly log: LogStore;
  /** One promise chain per machine, so every frame this object sends a machine arrives in the order it was queued. */
  private readonly queues = new Map<string, Promise<void>>();
  /** Part sets a socket is sending (lost with a hibernation, as the socket's half-sent frame would be). */
  private readonly parts = new Map<WebSocket, PartAssembler>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.log = new LogStore(ctx.storage);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS machines (name TEXT PRIMARY KEY, generation INTEGER NOT NULL)');
  }

  /** A browser's socket. The Worker sends one only for a project the registry holds. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/socket') return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
    const member = request.headers.get(MEMBER_HEADER) ?? '';
    this.remember(request.headers.get(ORG_HEADER) ?? '', request.headers.get(PROJECT_HEADER) ?? '');
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ member, visible: false, subs: [], log: false } satisfies SocketAttachment);
    this.toSocket(server, { t: 'welcome', project: this.projectId, member, head: this.log.head() });
    return new Response(null, { status: 101, webSocket: client });
  }

  /** A frame a machine posted, handed over by its `Machine` object; resolves once every reply is on its stream. */
  async fromMachine(ctx: MachineContext, frame: UpFrame): Promise<void> {
    this.remember(ctx.org, ctx.project);
    if (frame.t === 'hello') await this.hello(ctx, frame);
    else if (frame.t === 'events') await this.upload(ctx, frame.events);
    else if (frame.t === 'rejected') this.rejected(ctx, frame);
    // `rpc-result`, `session`, and `pending` are the session plane's (M3).
    await this.queues.get(ctx.machine);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let frame: { t?: unknown; [key: string]: unknown };
    try {
      frame = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return this.refuseBrowser(socket, { reason: 'bad-shape', message: 'a frame is JSON' });
    }
    if (frame?.t === 'part') {
      let assembler = this.parts.get(socket);
      if (!assembler) this.parts.set(socket, (assembler = new PartAssembler()));
      try {
        const whole = assembler.add(frame as unknown as Part);
        if (whole !== undefined) await this.webSocketMessage(socket, JSON.stringify(whole));
      } catch {
        this.refuseBrowser(socket, { reason: 'bad-shape', message: 'a malformed part' });
      }
      return;
    }
    if (frame?.t === 'resume') return this.resume(socket, frame.after);
    if (frame?.t === 'human') return this.human(socket, frame.event);
    // `rpc`, `subscribe`, `unsubscribe`, `rows`, and `visibility` are the session plane's (M3).
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    this.parts.delete(socket);
  }

  // The log handshake (DX2): the hub's vector and whether this machine writes the archive, then every writer's suffix
  // the machine lacks. The machine joins the fan-out in the same step the backlog is read, so an event stored after it
  // goes out live behind the backlog, and none falls between.
  private async hello(ctx: MachineContext, frame: Extract<UpFrame, { t: 'hello' }>): Promise<void> {
    const have = frame.have as unknown;
    const valid =
      typeof frame.name === 'string' &&
      frame.name !== '' &&
      frame.name.length <= 200 &&
      typeof have === 'object' &&
      have !== null &&
      !Array.isArray(have) &&
      Object.values(have).every((seq) => Number.isSafeInteger(seq) && (seq as number) >= 0);
    if (!valid) return this.refuseMachine(ctx, { reason: 'bad-shape', message: 'hello is {project, name, have: {writer: seq}}' });
    const record = await this.registry().registerProject(ctx.project, frame.name, ctx.machine);
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO machines (name, generation) VALUES (?, ?)', ctx.machine, ctx.generation);
    this.toMachine(ctx, { t: 'have', project: ctx.project, have: this.log.vector(), archive: record.archive_machine === ctx.machine });
    for (const events of this.log.beyond(have as Vector)) this.toMachine(ctx, { t: 'events', project: ctx.project, events });
  }

  // A machine's upload: each event stored once at the next seq of its writer, a copy of a stored one passed over, a
  // gap answered by `resend`, and a writer the machine may not write, or a different payload at a stored position,
  // refused, reported, and recorded. A writer stops at its first refusal or gap in a batch.
  private async upload(ctx: MachineContext, events: unknown): Promise<void> {
    if (!this.isOpen(ctx)) return this.refuseMachine(ctx, { reason: 'not-open', message: 'send hello for this project on this stream first' });
    if (!Array.isArray(events)) return this.refuseMachine(ctx, { reason: 'bad-shape', message: 'events is a list' });
    const archive = events.some((e) => typeof e?.writer === 'string' && e.writer.startsWith(LEGACY_WRITER_PREFIX))
      ? (await this.registry().project(ctx.project))?.archive_machine
      : undefined;
    const accepted: Stored[] = [];
    const stopped = new Set<string>();
    for (const event of events as LogEvent[]) {
      const problem = eventShapeError(event);
      const position = positionOf(event);
      if (problem) {
        this.refuseMachine(ctx, { reason: problem === 'an event is at most 1 MiB' ? 'too-large' : 'bad-shape', ...position, message: problem });
        continue;
      }
      const { writer, seq } = event;
      if (stopped.has(writer)) continue;
      const mine = writerMachine(writer) === ctx.machine || (writer.startsWith(LEGACY_WRITER_PREFIX) && archive === ctx.machine);
      if (!mine) {
        stopped.add(writer);
        this.refuseMachine(ctx, { reason: 'writer-not-yours', writer, seq, message: `${ctx.machine} writes only ${ctx.machine}/… (and legacy/… as the archive machine)` });
        continue;
      }
      const last = this.log.last(writer);
      if (seq <= last) {
        if (!sameEvent(this.log.at(writer, seq)!.event, event)) {
          stopped.add(writer);
          this.refuseMachine(ctx, { reason: 'conflict', writer, seq, message: 'a different payload is stored at this position' });
        }
      } else if (seq === last + 1) {
        accepted.push(this.log.append(event));
      } else {
        stopped.add(writer);
        this.toMachine(ctx, { t: 'resend', project: ctx.project, writer, from: last + 1 });
      }
    }
    this.fanOut(accepted, ctx.machine);
  }

  /** A daemon's report of an event it refused: recorded in the audit record and shown to every browser. */
  private rejected(ctx: MachineContext, frame: Extract<UpFrame, { t: 'rejected' }>): void {
    if (!this.isOpen(ctx)) return this.refuseMachine(ctx, { reason: 'not-open', message: 'send hello for this project on this stream first' });
    const event = frame.event as unknown;
    const valid =
      REJECTION_REASONS.has(frame.reason) &&
      (event === null || (typeof event === 'object' && typeof (event as { writer?: unknown }).writer === 'string' && typeof (event as { seq?: unknown }).seq === 'number')) &&
      (frame.nonce === undefined || typeof frame.nonce === 'string') &&
      (frame.message === undefined || (typeof frame.message === 'string' && frame.message.length <= 2000));
    if (!valid) return this.refuseMachine(ctx, { reason: 'bad-shape', message: 'rejected is {project, event: {writer, seq} | null, nonce?, reason, message?}' });
    const rejection: Rejection & { machine: string } = {
      machine: ctx.machine,
      event: event === null ? null : { writer: frame.event!.writer, seq: frame.event!.seq },
      ...(frame.nonce === undefined ? {} : { nonce: frame.nonce }),
      reason: frame.reason,
      ...(frame.message === undefined ? {} : { message: frame.message }),
    };
    this.broadcast(this.audited(this.log.record('rejected', rejection)));
  }

  /** A browser resumes after an offset: the backlog, `caught-up`, then the log live; and the audit record's latest. */
  private resume(socket: WebSocket, after: unknown): void {
    if (!Number.isSafeInteger(after) || (after as number) < 0) return this.refuseBrowser(socket, { reason: 'bad-shape', message: 'resume is {after: offset}' });
    const attachment = socket.deserializeAttachment() as SocketAttachment;
    socket.serializeAttachment({ ...attachment, log: true } satisfies SocketAttachment);
    for (const events of this.log.after(after as number)) this.toSocket(socket, { t: 'log', events });
    this.toSocket(socket, { t: 'caught-up', offset: this.log.head() });
    for (const row of this.log.audit(AUDIT_REPLAY)) this.toSocket(socket, this.audited(row));
  }

  // A web `human`: accepted only from its own member, sealed by the browser without a position, and given one by the
  // hub (writer `hub/<member>`, the next seq, the time) that DX1's check admits. A nonce the member's feed holds is
  // the same send again: answered from the stored event, never stored twice.
  private human(socket: WebSocket, event: unknown): void {
    const { member } = socket.deserializeAttachment() as SocketAttachment;
    const draft = event as Record<string, unknown> & { member?: unknown; mac?: { nonce?: unknown; value?: unknown } };
    const nonce = typeof draft?.mac?.nonce === 'string' ? draft.mac.nonce : undefined;
    const problem = humanShapeError(event);
    if (problem) return this.refuseBrowser(socket, { reason: problem === 'too-large' ? 'too-large' : 'bad-shape', message: problem, ...(nonce ? { nonce } : {}) });
    if (draft.member !== member) {
      return this.refuseBrowser(socket, { reason: 'writer-not-yours', nonce, message: 'a web human is written by the member signed in' });
    }
    const writer = hubWriter(member);
    const sent = this.log.byNonce(writer, nonce!);
    if (sent) {
      if (!sameEvent(withoutPosition(sent.event), draft)) return this.refuseBrowser(socket, { reason: 'conflict', writer, seq: sent.event.seq, nonce, message: 'this nonce was sent with another payload' });
      return this.toSocket(socket, { t: 'human-ack', nonce: nonce!, offset: sent.offset, writer, seq: sent.event.seq });
    }
    const stored = { ts: new Date().toISOString(), writer, seq: this.log.last(writer) + 1, ...draft } as LogEvent;
    if (!isHubPosition(stored)) throw new Error('the hub assigned a position DX1 refuses');
    const appended = this.log.append(stored);
    this.toSocket(socket, { t: 'human-ack', nonce: nonce!, offset: appended.offset, writer, seq: stored.seq });
    this.fanOut([appended]);
  }

  /** New events to every browser that follows the log and to every machine syncing the project, but the sender. */
  private fanOut(accepted: Stored[], except?: string): void {
    if (accepted.length === 0) return;
    for (const socket of this.ctx.getWebSockets()) {
      if ((socket.deserializeAttachment() as SocketAttachment | null)?.log) this.toSocket(socket, { t: 'log', events: accepted });
    }
    const events = accepted.map((s) => s.event);
    for (const { name, generation } of this.ctx.storage.sql.exec<{ name: string; generation: number }>('SELECT name, generation FROM machines')) {
      if (name !== except) this.toMachine({ org: this.orgId, project: this.projectId, machine: name, generation }, { t: 'events', project: this.projectId, events });
    }
  }

  private refuseMachine(ctx: MachineContext, refusal: Refusal): void {
    this.toMachine(ctx, { t: 'refused', project: ctx.project, refusal });
    this.broadcast(this.audited(this.log.record('refused', { ...refusal, machine: ctx.machine })));
  }

  private refuseBrowser(socket: WebSocket, refusal: Refusal & { nonce?: string }): void {
    const { member } = socket.deserializeAttachment() as SocketAttachment;
    const frame = this.audited(this.log.record('refused', { ...refusal, member }));
    this.broadcast(frame);
  }

  private audited(row: AuditRow): ProjectDown {
    const entry = { ...row.entry, id: row.id, at: row.at } as AuditEntry & Record<string, unknown>;
    return row.kind === 'rejected' ? ({ t: 'rejected', rejection: entry } as ProjectDown) : ({ t: 'refused', refusal: entry } as ProjectDown);
  }

  /** An audit entry to every browser of the project, following the log or not (each entry's `id` lets a browser that
   * sees it again in a replay keep one). */
  private broadcast(frame: ProjectDown, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) if (socket !== except) this.toSocket(socket, frame);
  }

  private toSocket(socket: WebSocket, frame: ProjectDown): void {
    try {
      for (const line of toWire(frame)) socket.send(line);
    } catch {
      // A socket closing as it is written to: its browser resumes after its last offset.
    }
  }

  /** Queues a frame for a machine behind everything queued for it before; a machine whose stream is gone (or newer than
   * the one it opened this project on) leaves the fan-out until its next `hello`. */
  private toMachine(ctx: MachineContext, frame: DownFrame): void {
    const machine = this.env.MACHINE.get(this.env.MACHINE.idFromName(`${ctx.org}:${ctx.machine}`));
    const previous = this.queues.get(ctx.machine) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        if ((await machine.send(frame, ctx.generation)) === 'offline') {
          this.ctx.storage.sql.exec('DELETE FROM machines WHERE name = ? AND generation = ?', ctx.machine, ctx.generation);
        }
      })
      .catch(() => {});
    this.queues.set(ctx.machine, next);
  }

  private isOpen(ctx: MachineContext): boolean {
    const row = this.ctx.storage.sql.exec<{ generation: number }>('SELECT generation FROM machines WHERE name = ?', ctx.machine).toArray()[0];
    return row?.generation === ctx.generation;
  }

  private registry() {
    return this.env.REGISTRY.get(this.env.REGISTRY.idFromName(this.orgId));
  }

  /** The org and project this object serves, which its name (`<org>:<project>`) holds but the object cannot read. */
  private remember(org: string, project: string): void {
    if (org && this.ctx.storage.kv.get('org') !== org) this.ctx.storage.kv.put('org', org);
    if (project && this.ctx.storage.kv.get('project') !== project) this.ctx.storage.kv.put('project', project);
  }

  private get orgId(): string {
    return this.ctx.storage.kv.get<string>('org') ?? '';
  }

  private get projectId(): string {
    return this.ctx.storage.kv.get<string>('project') ?? '';
  }
}

/** The position an event names, when it names one, for a refusal to report. */
function positionOf(event: unknown): { writer?: string; seq?: number } {
  const e = (typeof event === 'object' && event !== null ? event : {}) as { writer?: unknown; seq?: unknown };
  return { ...(typeof e.writer === 'string' ? { writer: e.writer } : {}), ...(typeof e.seq === 'number' ? { seq: e.seq } : {}) };
}

/** Why a browser's `human` is not a sealed `HumanDraft`, or null. It must not name a position: the hub assigns it. */
function humanShapeError(event: unknown): string | null {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return 'event is a sealed HumanDraft';
  const e = event as Record<string, unknown>;
  if ('writer' in e || 'seq' in e || 'ts' in e) return 'the hub assigns writer, seq, and ts';
  if (e.kind !== 'human' || e.from !== 'human') return 'kind and from are "human"';
  if (typeof e.member !== 'string' || !isMemberId(e.member)) return 'member is a member id';
  if (typeof e.text !== 'string' || typeof e.created !== 'string') return 'text and created are strings';
  const to = e.to;
  const recipients = Array.isArray(to) && to.every((r) => typeof r?.session === 'string' && typeof r?.alias === 'string');
  if (to !== '*' && !recipients) return 'to is "*" or [{session, alias}]';
  const mac = e.mac as { nonce?: unknown; value?: unknown } | undefined;
  if (typeof mac !== 'object' || mac === null || typeof mac.nonce !== 'string' || mac.nonce === '' || typeof mac.value !== 'string') return 'mac is {nonce, value}';
  const shape = eventShapeError({ ...e, writer: `${HUB_WRITER_PREFIX}${e.member}`, seq: 1, ts: '' });
  if (shape === 'an event is at most 1 MiB') return 'too-large';
  if (shape) return shape;
  if (encoder.encode(JSON.stringify(e)).length > FRAME_LIMIT) return 'too-large';
  return null;
}
