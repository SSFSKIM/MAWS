// The fake bridge (P5 O9, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Interfaces §F): a stand-in for sminos's
// DX5 child (doperpowers `sminos/skills/sminos/scripts/sminos_bridge.py`) that speaks its HTTP over the Unix socket
// `<home>/bridge/<session>.sock`, for main's lane A driver's units and `e2e:lane-a`. It keeps what the child keeps for
// its routes: the pending requests and recent settlements, the turns, the streaming steps, the override and the catalog
// (a light fold of the events a test emits), `deliver`'s high-water mark per writer, and the launch fence. It runs no
// mod: a command is answered by its op's script (default ok), and the events a test emits stand for the mod's. The
// permission mode the session last reported (sminos 1.27.14) is set by the test, as the mod's hooks would observe it,
// and carried by `read status` and each heartbeat the test asks for, as the mod carries it.
import { chmodSync, mkdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';

export type FakeCapabilities = {
  sminos: string;
  protocol: number;
  engine: string;
  ops: string[];
  reads: string[];
  routes: { measured: string };
  controls?: Record<string, { available: boolean; reason?: string }>;
};

export type FakeReply = { status: number; body: unknown } | { drop: true };
// The mod's report of the main loop's permission mode (doperpowers `bridge.tsx` `observeMode`): the engine's word, when
// the mod read it (epoch ms) and the event it came in.
export type FakeMode = { mode: string; at: number; from: string };
export type FakeRaised = { request: string; tool: string; input: Record<string, unknown>; agentId?: string | null; deadline?: number; async?: true; toolUseId?: string; suggestions?: unknown[]; truncated?: true };

export interface FakeBridgeOptions {
  home: string;
  session: string;
  pid?: number;
  launch?: string | null;
  capabilities?: FakeCapabilities | null;
  ready?: boolean;
  lane?: 'match' | 'mismatch' | 'unresolved';
  readyWaitMs?: number; // how long GET /events waits for readiness before its 503 (the child's SMINOS_BRIDGE_READY_WAIT)
  sessionInfo?: Record<string, unknown>;
}

export interface FakeBridge {
  readonly socket: string;
  readonly commands: { op: string; body: Record<string, unknown> }[]; // every POST /command, in order
  readonly decisions: { request: string; body: Record<string, unknown> }[]; // every decision taken
  readonly requestReads: string[]; // every GET /requests/<id>
  answer(op: string, reply: (body: Record<string, unknown>) => FakeReply | Promise<FakeReply>): void;
  emit(event: Record<string, unknown>): void;
  raise(raised: FakeRaised): void;
  settle(request: string, winner: 'terminal' | 'web' | 'other', outcome?: string, by?: string): void;
  setReady(ready: boolean): void;
  setStatus(patch: Partial<Pick<FakeBridgeOptions, 'launch' | 'capabilities' | 'lane'>>): void;
  setMode(mode: FakeMode | null): void; // the mode the session last reported; null: none yet (a new process)
  heartbeat(): void; // one heartbeat as the mod posts it every 5 s: the main loop's turn, and the mode while one is reported
  subscribers(): number;
  reset(): void; // ends every stream (a module reload)
  close(): Promise<void>; // the socket goes; probes then fail
}

const OBSERVER_REASON = 'MAWS controls this session';
const CONTROL_OPS = new Set(['steer', 'interrupt', 'stop', 'model', 'compact', 'deliver', 'answer', 'command', 'btw', 'stop-agent', 'tell', 'media']);

export const FULL_CAPABILITIES: FakeCapabilities = {
  sminos: '1.25.0',
  protocol: 2,
  engine: '2.1.300',
  ops: ['ping', 'steer', 'interrupt', 'stop', 'model', 'compact', 'deliver', 'answer', 'read', 'command', 'btw', 'stop-agent', 'tell', 'media'],
  reads: ['status', 'catalog', 'usage', 'config', 'settings', 'mcp'],
  routes: { measured: '2.1.300' },
  controls: {
    'read.usage': { available: true }, 'read.config': { available: true }, 'read.settings': { available: true }, 'read.mcp': { available: true },
    btw: { available: true }, compact: { available: true }, model: { available: true },
    'mcp.enable': { available: true }, 'mcp.disable': { available: false, reason: 'the route table drops /mcp disable on this engine' }, 'mcp.reconnect': { available: true },
    decide: { available: true }, 'decide.scope': { available: true }, 'decide.interrupt': { available: false, reason: 'deny-and-interrupt is answered in the terminal' },
    'decide.addDirectory': { available: true }, 'stop-agent': { available: true }, tell: { available: true },
    media: { available: true }, forget: { available: false, reason: 'forget runs in the terminal' }, 'rewind-files': { available: false, reason: 'file rollback runs in the terminal' },
    'elicitation.answer': { available: false, reason: 'answer this form in the terminal' },
  },
};

const json = (res: ServerResponse, status: number, body?: unknown) => {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Connection: 'close' });
  res.end(data);
};

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text === '' ? null : (JSON.parse(text) as unknown));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    req.on('error', reject);
  });

const omit = (e: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k)));
const markOf = (key: Record<string, unknown>) => (typeof key.project === 'string' ? `${key.project}/${String(key.writer)}` : String(key.writer));
const stepKey = (e: Record<string, unknown>) => `${String(e.turnId)}|${String(e.agentId ?? null)}|${String(e.step)}`;

export async function startFakeBridge(options: FakeBridgeOptions): Promise<FakeBridge> {
  const { home, session } = options;
  const dir = join(home, 'bridge');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const socket = join(dir, `${session}.sock`);
  const temporary = join(dir, `.${session.slice(0, 8)}.${process.pid}.sock`);
  rmSync(temporary, { force: true });

  let launch = options.launch === undefined ? 'launch-1' : options.launch;
  let capabilities = options.capabilities === undefined ? FULL_CAPABILITIES : options.capabilities;
  let lane = options.lane;
  let ready = options.ready ?? true;
  const readyWaitMs = options.readyWaitMs ?? 5000;
  const readyWaiters = new Set<() => void>();

  const pending = new Map<string, Record<string, unknown>>();
  const settled = new Map<string, Record<string, unknown>>();
  const turns = new Map<string, Record<string, unknown>>();
  const streaming = new Map<string, Record<string, unknown>>();
  const marks = new Map<string, number>();
  let override: Record<string, unknown> | null = null;
  let catalog: Record<string, unknown> | null = null;
  let usage: Record<string, unknown> | null = null;
  let mode: FakeMode | null = null;
  const sessionInfo = options.sessionInfo ?? { session, cwd: home, model: 'claude-opus-4-5', version: '2.1.300' };
  const scripts = new Map<string, (body: Record<string, unknown>) => FakeReply | Promise<FakeReply>>();
  const commands: FakeBridge['commands'] = [];
  const decisions: FakeBridge['decisions'] = [];
  const requestReads: string[] = [];
  type Subscriber = { write(line: string): void; end(): void };
  const subscribers = new Set<Subscriber>();
  let commandIds = 0;

  const observing = () => lane !== undefined && lane !== 'mismatch';
  // the mode's three fields, as the heartbeat's `state` and `read status`'s result carry them: absent until a report
  const modeFields = () => (mode === null ? {} : { permissionMode: mode.mode, permissionModeAt: mode.at, permissionModeFrom: mode.from });

  const fold = (e: Record<string, unknown>) => {
    const { type, phase } = e;
    if (type === 'raised' && typeof e.request === 'string') {
      pending.set(e.request, omit(e, 'type'));
    } else if (type === 'settled' && typeof e.request === 'string') {
      pending.delete(e.request);
      settled.set(e.request, omit(e, 'type'));
    } else if (type === 'turn' && phase === 'start') turns.set(String(e.turnId), { turnId: e.turnId, agentId: e.agentId ?? null, t: e.t });
    else if (type === 'turn' && phase === 'complete') {
      turns.delete(String(e.turnId));
      for (const [k, m] of streaming) if (m.turnId === e.turnId) streaming.delete(k);
    } else if (type === 'step' && phase === 'start') streaming.set(stepKey(e), { turnId: e.turnId, agentId: e.agentId ?? null, step: e.step, upTo: -1, blocks: [] });
    else if (type === 'step' && phase === 'end') streaming.delete(stepKey(e));
    else if (type === 'chunk') {
      const m = streaming.get(stepKey(e));
      if (m) {
        m.upTo = e.chunkIndex;
        // DX5's chunk: `{kind: 'text' | 'thinking', index, text}` (the bridge's own; `lane-a/stream/dx4-stream.json`)
        const chunk = (e.chunk ?? {}) as { index?: number; kind?: string; text?: string; delta?: { text?: string } };
        const blocks = m.blocks as { index: number; kind: string; text: string; upTo: number }[];
        let block = blocks.find((b) => b.index === chunk.index);
        if (!block) blocks.push((block = { index: chunk.index ?? 0, kind: chunk.kind === 'thinking' ? 'thinking' : 'text', text: '', upTo: -1 }));
        block.text += chunk.text ?? chunk.delta?.text ?? '';
        block.upTo = Number(e.chunkIndex);
      }
    } else if (type === 'model') override = e.model === null && e.effort === null ? null : { model: e.model ?? null, effort: e.effort ?? null };
    else if (type === 'catalog') {
      catalog = omit(e, 'type', 'n');
    } else if (type === 'usage') usage = { ...e };
  };

  const snapshot = () => ({
    type: 'snapshot', session, protocol: 1, pid: options.pid ?? 4242, sessionInfo,
    turns: [...turns.values()], streaming: [...streaming.values()], agents: [], usage, override, capabilities,
    ...(catalog !== null && { catalog }), cut: { main: null }, namedBlocks: true,
    pending: [...pending.values()], settled: [...settled.values()],
  });

  const fanOut = (e: Record<string, unknown>) => {
    for (const sub of subscribers) sub.write(JSON.stringify(e));
  };

  const emit = (event: Record<string, unknown>) => {
    const e = { t: Date.now(), ...event };
    fold(e);
    fanOut(e);
  };

  // `media` as the mod takes it (doperpowers `bridge-media.tsx` `acceptMedia`): its upload id and absolute root, 1 to 4
  // files each a file inside the root by its own real path; an upload already held answers `duplicate`.
  const uploads = new Set<string>();
  const acceptMedia = (body: Record<string, unknown>): FakeReply => {
    const { upload, root, files } = body;
    const refuse = (error: string): FakeReply => ({ status: 200, body: { ok: false, error } });
    if (typeof upload !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(upload) || typeof root !== 'string' || !root.startsWith('/')) return refuse('media needs its upload id and the absolute directory it was saved in');
    if (!Array.isArray(files) || files.length === 0 || files.length > 4) return refuse('media holds 1 to 4 files');
    if (uploads.has(upload)) return { status: 200, body: { ok: true, result: { duplicate: true, upload } } };
    for (const f of files as Record<string, unknown>[]) {
      const path = typeof f.path === 'string' ? f.path : '';
      let real: string | null;
      try {
        real = statSync(path).isFile() ? realpathSync(path) : null;
      } catch {
        return refuse(`${String(f.name)} is missing: nothing is at ${path}`);
      }
      if (real !== path || !path.startsWith(`${root}/`)) return refuse(`${String(f.name)} is not a file inside its upload directory ${root}`);
    }
    uploads.add(upload);
    return { status: 200, body: { ok: true, result: { queued: true, upload } } };
  };

  const defaultReply = (body: Record<string, unknown>): FakeReply => {
    if (body.op === 'deliver') {
      emit({ type: 'delivered', key: body.key, outcome: 'entered', uuid: `row-${String((body.key as { seq?: unknown }).seq)}` });
      return { status: 200, body: { ok: true, result: { submitted: true } } };
    }
    if (body.op === 'model') {
      const next = { model: (body.model as string | null | undefined) ?? null, effort: (body.effort as string | null | undefined) ?? null };
      emit({ type: 'model', ...next });
      return { status: 200, body: { ok: true, result: next } };
    }
    if (body.op === 'read' && body.what === 'status') {
      const cwd = typeof sessionInfo.cwd === 'string' ? sessionInfo.cwd : home;
      return { status: 200, body: { ok: true, result: { version: { version: '2.1.300' }, model: sessionInfo.model ?? null, cwd, root: cwd, repo: null, surfaces: [], override, ...modeFields() } } };
    }
    if (body.op === 'media') return acceptMedia(body);
    return { status: 200, body: { ok: true, result: {} } };
  };

  const handleCommand = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const body = (await readBody(req)) as Record<string, unknown> | null;
    if (body === null || typeof body !== 'object' || typeof body.op !== 'string' || body.op === '') return json(res, 400, { error: 'a command is an object with an op' });
    if ('launch' in body && body.launch !== launch) {
      return json(res, 409, { ok: false, code: 'launch', error: `sealed for launch ${String(body.launch)} of the session; it runs as launch ${launch ?? 'unnamed'} now` });
    }
    const id = `cmd-${++commandIds}`;
    const relayed = omit(body, 'launch');
    commands.push({ op: body.op, body: relayed });
    if (observing() && CONTROL_OPS.has(body.op)) return json(res, 200, { id, ok: false, error: OBSERVER_REASON, code: 'lane-b' });
    // deliver's high-water mark per writer: a key at or below it is a repeat (the mod's rule, set before it answers)
    if (body.op === 'deliver') {
      const key = (body.key ?? {}) as Record<string, unknown>;
      const mark = markOf(key);
      const seq = Number(key.seq);
      if (seq <= (marks.get(mark) ?? 0)) {
        emit({ type: 'delivered', key, outcome: 'duplicate' });
        return json(res, 200, { id, ok: true, result: { duplicate: true } });
      }
      marks.set(mark, seq);
      if (!scripts.has('deliver')) emit({ type: 'delivered', key, outcome: 'submitted' });
    }
    const script = scripts.get(body.op);
    const reply = script ? await script(relayed) : defaultReply(relayed);
    if ('drop' in reply) {
      req.socket.destroy();
      return;
    }
    const wait = Number(url.searchParams.get('wait') ?? '0');
    if (reply.status === 200 && wait <= 0) return json(res, 202, { id, status: 'sent' });
    const out = reply.body as Record<string, unknown> | null;
    // the child names its command id in an answer and in a 504 (`{id, error}`): the op may still run, and its outcome names it
    return json(res, reply.status, (reply.status === 200 || reply.status === 504) && out !== null && typeof out === 'object' ? { id, ...out } : out);
  };

  const handleDecision = async (req: IncomingMessage, res: ServerResponse, request: string) => {
    const body = (await readBody(req)) as Record<string, unknown> | null;
    if (body !== null && typeof body === 'object' && 'launch' in body && body.launch !== launch) {
      return json(res, 409, { ok: false, code: 'launch', error: `sealed for launch ${String(body.launch)}` });
    }
    if (observing()) return json(res, 409, { error: OBSERVER_REASON, code: 'lane-b' });
    const raised = pending.get(request);
    if (!raised) {
      const s = settled.get(request);
      if (s) return json(res, 409, { error: 'already settled', settled: s });
      return json(res, 404, { error: `no request ${request} is pending in this session` });
    }
    if (body === null || typeof body !== 'object' || (body.behavior !== 'allow' && body.behavior !== 'deny')) return json(res, 400, { error: 'behavior is allow or deny' });
    if (typeof body.by !== 'string' || body.by === 'terminal' || body.by === 'bridge') return json(res, 400, { error: 'by names who decided' });
    const script = scripts.get(`decision:${request}`) ?? scripts.get('decision');
    if (script) {
      const reply = await script(body);
      if ('drop' in reply) {
        req.socket.destroy();
        return;
      }
      if (reply.status === 200) decisions.push({ request, body });
      return json(res, reply.status, reply.body);
    }
    decisions.push({ request, body });
    return json(res, 200, { accepted: true, request });
  };

  const handleEvents = (req: IncomingMessage, res: ServerResponse) => {
    const start = () => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', Connection: 'close' });
      let n = 0;
      const sub: Subscriber = {
        write(line) {
          if (res.writableEnded) return;
          n += 1;
          res.write(`${JSON.stringify({ n, ...(JSON.parse(line) as object) })}\n`);
        },
        end() {
          subscribers.delete(sub);
          if (!res.writableEnded) res.end();
        },
      };
      res.write(`${JSON.stringify(snapshot())}\n`);
      subscribers.add(sub);
      req.on('close', () => subscribers.delete(sub));
    };
    if (ready) return start();
    const timer = setTimeout(() => {
      readyWaiters.delete(go);
      json(res, 503, { error: "the session's state has not reached its bridge yet" });
    }, readyWaitMs);
    const go = () => {
      clearTimeout(timer);
      start();
    };
    readyWaiters.add(go);
    req.on('close', () => {
      clearTimeout(timer);
      readyWaiters.delete(go);
    });
  };

  const status = () => ({
    session, pid: options.pid ?? 4242, protocol: 1, socket, started: 1, ready, subscribers: subscribers.size, mod: { events: 0, last: null },
    ...(lane !== undefined && { lane }), ...(launch !== null && { launch }), ...(capabilities !== null && { capabilities }),
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://bridge');
    const parts = url.pathname.split('/');
    void (async () => {
      if (req.method === 'GET' && url.pathname === '/status') return json(res, 200, status());
      if (req.method === 'GET' && url.pathname === '/events') return handleEvents(req, res);
      if (req.method === 'GET' && url.pathname === '/requests') return json(res, 200, { pending: [...pending.values()], settled: [...settled.values()] });
      if (req.method === 'GET' && parts.length === 3 && parts[1] === 'requests') {
        const id = decodeURIComponent(parts[2]!);
        requestReads.push(id);
        const p = pending.get(id);
        if (p) return json(res, 200, { ...p, session });
        const s = settled.get(id);
        if (s) return json(res, 410, { error: 'settled', settled: s });
        return json(res, 404, { error: `no request ${id} is pending in this session` });
      }
      if (req.method === 'POST' && url.pathname === '/command') return handleCommand(req, res, url);
      if (req.method === 'POST' && parts.length === 4 && parts[1] === 'requests' && parts[3] === 'decision') return handleDecision(req, res, decodeURIComponent(parts[2]!));
      return json(res, 404, { error: `no route ${url.pathname}` });
    })().catch((error: unknown) => json(res, 500, { error: String(error) }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(temporary, () => resolve());
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, socket);

  return {
    socket,
    commands,
    decisions,
    requestReads,
    answer(op, reply) {
      scripts.set(op, reply);
    },
    emit,
    raise(raised) {
      emit({ type: 'raised', agentId: null, ...raised });
    },
    settle(request, winner, outcome = 'allow', by = winner === 'terminal' ? 'terminal' : winner === 'web' ? 'maws' : 'cli') {
      emit({ type: 'settled', request, winner, outcome, by });
    },
    setReady(next) {
      ready = next;
      if (ready) for (const go of [...readyWaiters]) go();
      readyWaiters.clear();
    },
    setStatus(patch) {
      if (patch.launch !== undefined) launch = patch.launch;
      if (patch.capabilities !== undefined) capabilities = patch.capabilities;
      if ('lane' in patch) lane = patch.lane;
    },
    setMode(next) {
      mode = next;
    },
    heartbeat() {
      const mainTurn = [...turns.values()].find((t) => (t.agentId ?? null) === null)?.turnId ?? null;
      emit({ type: 'heartbeat', state: { mainTurn, isStreaming: streaming.size > 0, tools: [], ...modeFields() } });
    },
    subscribers: () => subscribers.size,
    reset() {
      for (const sub of [...subscribers]) sub.end();
    },
    async close() {
      for (const sub of [...subscribers]) sub.end();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(socket, { force: true });
    },
  };
}
