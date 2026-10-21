// P3-HD M2: in-memory fakes for the direct transport's unit tests (./direct-client.test.ts, ./direct-stdio.test.ts): an
// MCP server that answers JSON-RPC, a fetch in front of it, and a spawn whose processes and process groups are modelled.
// No real process or socket.
import type { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import type { VerifiedConnectorSource } from './provenance';

type Message = Record<string, unknown>;
type FakeTool = { name: string; annotations?: Record<string, unknown>; execution?: Record<string, unknown>; outputSchema?: Record<string, unknown> };

export class FakeMcpServer {
  readonly received: Message[] = [];
  tools: FakeTool[] = [{ name: 'rows', annotations: { readOnlyHint: true } }, { name: 'write' }];
  toolPages: FakeTool[][] | null = null; // P3-F: tools/list answered page by page instead, the cursor a page's index
  holdCalls = false; // tools/call answers wait for `release`
  sessionId: string | undefined; // HTTP: the session initialize opens
  result: (params: Message) => unknown = (params) => ({ content: [{ type: 'text', text: `called ${String(params.name)}` }] });
  error: ((message: Message) => { code: number; message: string } | undefined) | undefined;
  private readonly held: Array<() => void> = [];

  methods(): string[] {
    return this.received.map((message) => String(message.method ?? 'response'));
  }

  calls(): Message[] {
    return this.received.filter((message) => message.method === 'tools/call');
  }

  release(): void {
    for (const resume of this.held.splice(0)) resume();
  }

  get waiting(): number {
    return this.held.length;
  }

  // The reply to one message, null for a notification. A held call rejects with the request's abort.
  async answer(message: Message, signal?: AbortSignal | null): Promise<Message | null> {
    this.received.push(message);
    if (message.id === undefined || typeof message.method !== 'string') return null;
    if (message.method === 'tools/call' && this.holdCalls) {
      await new Promise<void>((resolve, reject) => {
        this.held.push(resolve);
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    const failure = this.error?.(message);
    if (failure) return { jsonrpc: '2.0', id: message.id, error: failure };
    return { jsonrpc: '2.0', id: message.id, result: this.resultOf(message) };
  }

  private resultOf(message: Message): unknown {
    const params = (message.params ?? {}) as Message;
    switch (message.method) {
      case 'initialize':
        return { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } };
      case 'tools/list': {
        const listed = (tools: FakeTool[]) => tools.map((tool) => ({ inputSchema: { type: 'object' }, ...tool }));
        if (!this.toolPages) return { tools: listed(this.tools) };
        const page = Number(params.cursor ?? 0);
        return { tools: listed(this.toolPages[page]!), ...(page + 1 < this.toolPages.length && { nextCursor: String(page + 1) }) };
      }
      case 'tools/call':
        return this.result(params);
      default:
        return {};
    }
  }
}

export interface SeenFetch {
  url: string;
  method: string;
  headers: Headers;
  redirect: string | undefined;
  message: Message | null;
}

// A fetch answering from `server`; `respond` may answer a message itself (a redirect, a 401, an over-bound body).
export function fakeFetch(server: FakeMcpServer, respond?: (message: Message | null, init: RequestInit | undefined) => Response | Promise<Response | undefined> | undefined) {
  const seen: SeenFetch[] = [];
  const fetch: FetchLike = async (url, init) => {
    const message = typeof init?.body === 'string' ? (JSON.parse(init.body) as Message) : null;
    seen.push({ url: String(url), method: init?.method ?? 'GET', headers: new Headers(init?.headers), redirect: init?.redirect, message });
    const own = await respond?.(message, init);
    if (own) {
      if (message) server.received.push(message);
      return own;
    }
    if (message === null) return new Response(null, { status: init?.method === 'DELETE' ? 200 : 405 });
    const reply = await server.answer(message, init?.signal);
    if (reply === null) return new Response(null, { status: 202 });
    const session: Record<string, string> = message.method === 'initialize' && server.sessionId ? { 'mcp-session-id': server.sessionId } : {};
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json', ...session } });
  };
  return { fetch, seen, calls: () => seen.filter((entry) => entry.message?.method === 'tools/call') };
}

// ── processes ──

export interface FakeBehaviour {
  exitOnStdinEnd: boolean; // the server leaves when its stdin ends
  exitOn: Array<'SIGTERM' | 'SIGKILL'>; // the leader's signals that end it
  grandchild?: { exitOn: Array<'SIGTERM' | 'SIGKILL'> }; // a member the server started, ignoring stdin's end
}

export class FakeChild extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout = new PassThrough();
  readonly stdio: unknown[];
  readonly lines: string[] = [];
  exited = false;
  stdinEnded = false;
  inputClosed = false; // P3-F: the server closed its input yet lives on, so every write fails asynchronously (EPIPE)

  constructor(
    readonly pid: number,
    readonly command: string,
    readonly args: readonly string[],
    readonly options: Record<string, unknown>,
    private readonly processes: FakeProcesses,
    private readonly server: FakeMcpServer,
    readonly behaviour: FakeBehaviour,
  ) {
    super();
    let pending = '';
    this.stdin = new Writable({
      write: (chunk: Buffer, _encoding, done) => {
        if (this.inputClosed) {
          done(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
          return;
        }
        pending += chunk.toString('utf8');
        for (let newline = pending.indexOf('\n'); newline !== -1; newline = pending.indexOf('\n')) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          this.lines.push(line);
          void this.server.answer(JSON.parse(line) as Message).then((reply) => {
            if (reply && !this.exited) this.stdout.write(`${JSON.stringify(reply)}\n`);
          }, () => {});
        }
        done();
      },
      final: (done) => {
        this.stdinEnded = true;
        if (this.behaviour.exitOnStdinEnd) process.nextTick(() => this.exit());
        done();
      },
    });
    this.stdio = [this.stdin, this.stdout, null];
  }

  written(): Message[] {
    return this.lines.map((line) => JSON.parse(line) as Message);
  }

  // The server writes `text` on its stdout as it is (a frame past the bound, a broken line).
  emitStdout(text: string): void {
    this.stdout.write(text);
  }

  exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.processes.memberGone(this.pid, this.pid);
    this.emit('exit', 0, null);
  }

  kill(): boolean {
    return true;
  }
}

// A group's lifeline (`/bin/sh -c …`): it only waits on its stdin; `killed` and `stdinDestroyed` say how it ended.
export class FakeLifeline extends EventEmitter {
  readonly command = '/bin/sh';
  killed: NodeJS.Signals | null = null;
  stdinDestroyed = false;
  readonly stdin = new Writable({
    write: (_chunk, _encoding, done) => done(new Error('nothing is written to a lifeline')),
    destroy: (_error, done) => {
      this.stdinDestroyed = true;
      done(null);
    },
  });

  constructor(
    readonly pid: number,
    readonly args: readonly string[],
    readonly options: Record<string, unknown>,
  ) {
    super();
  }

  kill(signal: NodeJS.Signals): boolean {
    this.killed = signal;
    return true;
  }

  // It went by itself (a shell killed from outside, a resource failure after its start).
  exitEarly(): void {
    this.emit('exit', 1, null);
  }
}

export class FakeProcesses {
  readonly children: FakeChild[] = []; // servers
  readonly lifelines: FakeLifeline[] = [];
  readonly signals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
  readonly groups = new Map<number, Set<number>>(); // group id → live members
  behaviour: FakeBehaviour = { exitOnStdinEnd: true, exitOn: ['SIGTERM', 'SIGKILL'] };
  failSpawn = false;
  // 'spawn': it starts; 'error': its spawn fails (EAGAIN); 'held': it starts only at `lifelines[i].emit('spawn')`
  lifelineStart: 'spawn' | 'error' | 'held' = 'spawn';
  private nextPid = 4_000;

  constructor(private readonly server: FakeMcpServer) {}

  readonly spawn = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    if (command === '/bin/sh') {
      const lifeline = new FakeLifeline((this.nextPid += 10), args, options);
      this.lifelines.push(lifeline);
      if (this.lifelineStart === 'spawn') process.nextTick(() => lifeline.emit('spawn'));
      if (this.lifelineStart === 'error') process.nextTick(() => lifeline.emit('error', Object.assign(new Error('spawn EAGAIN'), { code: 'EAGAIN' })));
      return lifeline;
    }
    const pid = (this.nextPid += 10);
    const behaviour = structuredClone(this.behaviour);
    const child = new FakeChild(pid, command, args, options, this, this.server, behaviour);
    this.children.push(child);
    if (this.failSpawn) {
      Object.defineProperty(child, 'pid', { value: undefined });
      process.nextTick(() => child.emit('error', new Error('spawn ENOENT')));
      return child;
    }
    this.groups.set(pid, new Set(behaviour.grandchild ? [pid, pid + 1] : [pid]));
    process.nextTick(() => child.emit('spawn'));
    return child;
  }) as unknown as typeof nodeSpawn;

  readonly kill = (pid: number, signal: NodeJS.Signals | 0) => {
    this.signals.push({ pid, signal });
    const group = this.groups.get(-pid);
    if (pid >= 0 || !group || group.size === 0) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    if (signal === 0) return;
    const child = this.children.find((candidate) => candidate.pid === -pid)!;
    if (group.has(-pid) && child.behaviour.exitOn.includes(signal as 'SIGTERM')) process.nextTick(() => child.exit());
    if (group.has(-pid + 1) && child.behaviour.grandchild?.exitOn.includes(signal as 'SIGTERM')) group.delete(-pid + 1);
  };

  memberGone(group: number, pid: number): void {
    this.groups.get(group)?.delete(pid);
  }

  alive(group: number): number[] {
    return [...(this.groups.get(group) ?? [])];
  }
}

export function fakeSource(overrides: Partial<VerifiedConnectorSource> = {}): VerifiedConnectorSource {
  return { sourceId: 'source-1', generation: 1, cwd: '/scratch/project', server: 'fixture', scope: 'user', transport: 'stdio', path: '/scratch/home/.claude.json', entryPath: ['mcpServers', 'fixture'], observedAt: '2026-10-17T00:00:00.000Z', entryDigest: 'digest-1', ...overrides };
}
