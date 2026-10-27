// sminos's side of RL10 for the endpoint's suites (O10 M6): connections to the endpoint's socket that send what a test
// (or conversation.json's `up` lines) says and keep every line the endpoint writes, and the replay of conversation.json
// itself against the real server: each `up` line sent, each `down` line matched, each `scene` handed to the suite.
import { connect, type Socket } from 'node:net';
import { PartAssembler, type Part } from 'desk-hub/protocol';

export type Frame = { t: string } & Record<string, unknown>;

/** One connection, as sminos's uplink makes it (sminos_rl10.Connection). */
export class FakeSminos {
  readonly received: Frame[] = [];
  /** Indexes of `received` a `down` step matched. */
  readonly matched = new Set<number>();
  closed = false;
  readonly #socket: Socket;
  readonly #parts = new PartAssembler();
  #buffer = Buffer.alloc(0);

  private constructor(socket: Socket) {
    this.#socket = socket;
    socket.on('data', (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      for (let end = this.#buffer.indexOf(10); end >= 0; end = this.#buffer.indexOf(10)) {
        const line = this.#buffer.subarray(0, end).toString('utf8');
        this.#buffer = this.#buffer.subarray(end + 1);
        let frame = JSON.parse(line) as Frame;
        if (frame.t === 'part') {
          const whole = this.#parts.add(frame as unknown as Part);
          if (whole === undefined) continue;
          frame = whole as Frame;
        }
        this.received.push(frame);
      }
    });
    socket.on('close', () => (this.closed = true));
    socket.on('error', () => (this.closed = true));
  }

  static open(path: string): Promise<FakeSminos> {
    return new Promise((resolve, reject) => {
      const socket = connect(path);
      socket.once('connect', () => resolve(new FakeSminos(socket)));
      socket.once('error', reject);
    });
  }

  send(frame: object): void {
    this.#socket.write(`${JSON.stringify(frame)}\n`);
  }

  /** The first line received, not matched before, that `match` holds for; waits up to `ms`. */
  async next(match: (frame: Frame) => boolean, what: string, ms = 5000): Promise<Frame> {
    const deadline = Date.now() + ms;
    for (;;) {
      const at = this.received.findIndex((frame, i) => !this.matched.has(i) && match(frame));
      if (at >= 0) {
        this.matched.add(at);
        return this.received[at];
      }
      if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms; received: ${this.received.map((f, i) => `${i}${this.matched.has(i) ? '*' : ''}:${JSON.stringify(f).slice(0, 300)}`).join('\n')}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  close(): void {
    this.#socket.destroy();
  }
}

// ---- conversation.json ----------------------------------------------------------------------------------------------

/** One step: exactly one of `up`, `down`, `open`, `closed`, `quiet` or `scene` (a scene's other fields are its own). */
export type Step = {
  conn?: string;
  vary?: string[];
  note?: string;
  up?: Frame;
  down?: Frame;
  open?: string;
  closed?: string;
  quiet?: string[];
  ms?: number;
  scene?: string;
} & Record<string, unknown>;
export type Case = { name: string; steps: Step[] };
export type Conversation = { format: string[]; bindings: Record<string, unknown>; cases: Case[] };

/** `value` with every `{{name}}` in its strings replaced by the binding: a whole-string reference by the binding's own value. */
export function bind(value: unknown, bindings: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const whole = /^\{\{([^}]+)\}\}$/.exec(value);
    if (whole !== null) {
      if (!(whole[1] in bindings)) throw new Error(`no binding ${whole[1]}`);
      return structuredClone(bindings[whole[1]]);
    }
    return value.replace(/\{\{([^}]+)\}\}/g, (_, name: string) => {
      if (!(name in bindings)) throw new Error(`no binding ${name}`);
      return String(bindings[name]);
    });
  }
  if (Array.isArray(value)) return value.map((v) => bind(v, bindings));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[bind(k, bindings) as string] = bind(v, bindings);
    return out;
  }
  return value;
}

/** Whether `got` is `expected`, each `vary` path only present (of the same JSON type) in both. */
export function matches(expected: unknown, got: unknown, vary: readonly string[], path = ''): boolean {
  if (vary.includes(path)) return got !== undefined && typeof got === typeof expected && Array.isArray(got) === Array.isArray(expected);
  if (Array.isArray(expected)) return Array.isArray(got) && got.length === expected.length && expected.every((e, i) => matches(e, got[i], vary, join(path, String(i))));
  if (typeof expected === 'object' && expected !== null) {
    if (typeof got !== 'object' || got === null || Array.isArray(got)) return false;
    const keys = new Set([...Object.keys(expected), ...Object.keys(got)]);
    return [...keys].every((k) => matches((expected as Record<string, unknown>)[k], (got as Record<string, unknown>)[k], vary, join(path, k)));
  }
  return expected === got;
}

const join = (path: string, key: string) => (path === '' ? key : `${path}.${key}`);

export type Scenes = (step: { scene: string } & Record<string, unknown>, bindings: Record<string, unknown>) => Promise<void>;

/**
 * Plays one case against the endpoint: `socket()` is where the socket is now (it moves at a restart), `scenes` does what
 * the endpoint's side does, and `connections` carries the open connections from case to case.
 */
export async function replayCase(c: Case, options: { socket(): string; scenes: Scenes; bindings: Record<string, unknown>; connections: Map<string, FakeSminos> }): Promise<void> {
  const { connections, bindings } = options;
  const conn = (step: Step) => {
    const name = step.conn ?? 'main';
    const found = connections.get(name);
    if (found === undefined) throw new Error(`${c.name}: no connection ${name}`);
    return found;
  };
  for (const [i, step] of c.steps.entries()) {
    const where = `${c.name}, step ${i}`;
    if (step.open !== undefined) {
      connections.get(step.open)?.close();
      connections.set(step.open, await FakeSminos.open(options.socket()));
    } else if (step.up !== undefined) {
      conn(step).send(bind(step.up, bindings) as object);
    } else if (step.down !== undefined) {
      const expected = bind(step.down, bindings) as Frame;
      await conn(step)
        .next((frame) => frame.t === expected.t && matches(expected, frame, step.vary ?? []), `${where}: ${JSON.stringify(expected).slice(0, 400)}`)
        .catch((error: unknown) => {
          throw new Error(`${where}: ${(error as Error).message}`);
        });
    } else if (step.closed !== undefined) {
      const c2 = connections.get(step.closed);
      const deadline = Date.now() + 5000;
      while (c2 !== undefined && !c2.closed && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      if (c2 === undefined || !c2.closed) throw new Error(`${where}: ${step.closed} was not closed`);
      if (step.closed !== 'main' && c2.received.length > 0) throw new Error(`${where}: ${step.closed} was written to before its close`);
      connections.delete(step.closed);
    } else if (step.quiet !== undefined) {
      const quiet = step.quiet;
      const sminos = conn(step);
      const before = sminos.received.length;
      await new Promise((resolve) => setTimeout(resolve, step.ms ?? 300));
      const loud = sminos.received.slice(before).filter((f) => quiet.includes(f.t));
      if (loud.length > 0) throw new Error(`${where}: expected no ${quiet.join(', ')}, got ${JSON.stringify(loud).slice(0, 400)}`);
    } else if (step.scene !== undefined) {
      await options.scenes(bind(step, bindings) as { scene: string } & Record<string, unknown>, bindings).catch((error: unknown) => {
        throw new Error(`${where} (${String(step.scene)}): ${(error as Error).message}`);
      });
    } else {
      throw new Error(`${where}: not a step`);
    }
  }
}
