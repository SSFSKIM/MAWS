// The live bench's agent (test/support/remote-bench-agent.ts; P5 O7 M7) with fakes for the scratch daemon's machine.sock
// and the fake sminos's socket: prepare writes only under the scratch profile; serve starts the stub's session and lists
// it for the owners named; and its life is its transport's: stdin's end, or its parent's loss, stops the session,
// withdraws the listing, closes the fake sminos and ends the bench's stubs, once.
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agentPaths, BenchAgent, BENCH_PROJECT, bindLifetime, openSminos, parseAgentArgs, prepare, type AgentArgs, type MachineClient, type ServeDeps } from './remote-bench-agent';

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const ARGS: AgentArgs = { name: 'mini-bench', profile: '/p/mini-bench', bench: '/p/mini-bench/bench', head: '/p/mini-bench/head', engineVersion: '2.1.283' };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? [path, ...walk(path)] : [path];
  });
}

/** The scratch daemon as machine.sock answers it, the stub writing its first turn's 300 samples when the session starts. */
function fakeDeps(written: string[] = []) {
  const requests: { name: string; input: unknown }[] = [];
  const out: object[] = [];
  const sent: object[] = [];
  const ended: string[] = [];
  const events: string[] = [];
  let tailing = false;
  let ready = false;
  const machine: MachineClient = {
    async request<T>(name: string, input?: unknown) {
      requests.push({ name, input });
      const answers: Record<string, unknown> = {
        'machine.identity': { ref: 'ref-mini-bench' },
        'session.projects.add': { id: 'project-1' },
        'session.create': { appSessionId: 'app-1' },
        'session.start': { status: 'starting' },
        'session.status': { process: 'ready', turn: null, engineSessionId: ready ? 'engine-1' : null },
        'engine.sessions': [{ appSessionId: 'app-1', engineSessionId: 'engine-1' }],
      };
      if (name === 'session.start') {
        for (let k = 1; k <= 300; k += 1) written.push(JSON.stringify({ turn: 1, k, writtenAt: k, wallAt: k }));
        ready = true;
      }
      if (name === 'session.stop') events.push('session stopped');
      return answers[name] as T;
    },
    close: () => void events.push('machine.sock closed'),
  };
  const deps: ServeDeps = {
    machine: async () => machine,
    sminos: async (info) => {
      events.push(`sminos opened on ${info.socket}`);
      return { send: (frame) => void sent.push(frame), close: () => void events.push('sminos closed') };
    },
    readFile: (path) => {
      if (path === agentPaths(ARGS).samples) return written.join('\n');
      if (path === agentPaths(ARGS).rl10) return JSON.stringify({ socket: `${ARGS.profile}/mawsd/endpoint/rl10.sock`, token: 'rl10-token' });
      throw new Error(`the agent read ${path}`);
    },
    out: (message) => void out.push(message),
    endStubs: (samples) => void ended.push(samples),
    sleep: async () => undefined,
    tail: () => {
      tailing = true;
      return () => {
        tailing = false;
        events.push('tail stopped');
      };
    },
  };
  return { deps, requests, out, sent, ended, events, tailing: () => tailing };
}

describe('the live bench’s agent (P5 O7 M7)', () => {
  it('takes its arguments as one JSON word, each path absolute and the bench directory the profile’s own', () => {
    expect(parseAgentArgs(JSON.stringify(ARGS))).toEqual(ARGS);
    expect(() => parseAgentArgs(JSON.stringify({ ...ARGS, bench: '/elsewhere/bench' }))).toThrow(/the profile’s own/);
    expect(() => parseAgentArgs(JSON.stringify({ ...ARGS, head: 'head' }))).toThrow(/not absolute/);
    expect(() => parseAgentArgs(JSON.stringify({ ...ARGS, engineVersion: '$(id)' }))).toThrow(/not an engine version/);
  });

  it('prepare writes the stub’s wrapper, the store’s trust and the daemon’s directories, all under the scratch profile', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bench-agent-')));
    scratch.push(root);
    const profile = join(root, 'profile');
    const a: AgentArgs = { ...ARGS, profile, bench: `${profile}/bench`, head: `${profile}/head` };
    prepare(a, '/runtime/bin/node');
    const made = walk(root).map((path) => relative(root, path));
    expect(made.filter((path) => !path.startsWith('profile'))).toEqual([]);
    expect(made.sort()).toEqual(['profile', 'profile/bench', 'profile/bench/checkout', 'profile/bench/latency-engine', 'profile/claude-config', 'profile/claude-config/.claude.json', 'profile/claude-config/settings.json', 'profile/claude-usage', 'profile/home', 'profile/shell-home', 'profile/shell-home/.bash_profile', 'profile/shell-home/.zprofile', 'profile/sminos', 'profile/tmp'].sort());
    expect(readFileSync(`${profile}/bench/latency-engine`, 'utf8')).toBe(`#!/bin/sh\nMAWS_LATENCY_STUB_VERSION='2.1.283' exec '/runtime/bin/node' '${profile}/head/test/support/latency-engine-stub.mjs' '${profile}/bench/samples.jsonl' "$@"\n`);
    expect(statSync(`${profile}/bench/latency-engine`).mode & 0o777).toBe(0o755);
    expect(JSON.parse(readFileSync(`${profile}/claude-config/.claude.json`, 'utf8'))).toEqual({ projects: { [`${profile}/bench/checkout`]: { hasTrustDialogAccepted: true } } });
    for (const path of Object.values(agentPaths(a))) expect(path.startsWith(`${profile}/`), path).toBe(true);
  });

  it('serve starts the stub’s session over machine.sock, says it ready once its first turn is over, then lists it through the fake sminos for the owners named', async () => {
    const fake = fakeDeps();
    const agent = new BenchAgent(ARGS, fake.deps);
    await agent.start();
    expect(fake.requests.map((r) => r.name)).toEqual(['session.list', 'machine.identity', 'machineSettings.set', 'session.projects.add', 'session.create', 'session.intent.patch', 'session.start', 'session.status']);
    expect(fake.requests.find((r) => r.name === 'session.projects.add')!.input).toEqual({ directory: '/p/mini-bench/bench/checkout' });
    expect(fake.out).toEqual([{ ready: { ref: 'ref-mini-bench', app: 'app-1', engine: 'engine-1', engineStartMs: expect.any(Number) } }]);
    expect(fake.tailing()).toBe(true);
    await agent.input(JSON.stringify({ list: { owners: ['member-1'], title: 'the bench session' } }));
    expect(fake.events).toEqual(['sminos opened on /p/mini-bench/mawsd/endpoint/rl10.sock']);
    expect(fake.sent).toEqual([
      expect.objectContaining({ t: 'session', message: expect.objectContaining({ project: BENCH_PROJECT, machine: 'mini-bench' }) }),
      { t: 'hello', project: BENCH_PROJECT, name: 'mini-bench', have: {} },
      expect.objectContaining({ t: 'member', session: 'engine-1', alias: 'app-1', owners: ['member-1'], title: 'the bench session', cwd: '/p/mini-bench/bench/checkout' }),
    ]);
    expect(fake.out.at(-1)).toEqual({ listed: { app: 'app-1' } });
  });

  it('refuses an RL10 socket outside the scratch profile', async () => {
    const fake = fakeDeps();
    const deps = { ...fake.deps, readFile: (path: string) => (path === agentPaths(ARGS).rl10 ? JSON.stringify({ socket: '/Users/kimmi/.local/share/maws/mawsd/endpoint/rl10.sock', token: 't' }) : fake.deps.readFile(path)) };
    const agent = new BenchAgent(ARGS, deps);
    await agent.start();
    await expect(agent.input(JSON.stringify({ list: { owners: ['m'], title: 't' } }))).rejects.toThrow(/not the scratch profile’s/);
    expect(fake.events).toEqual([]);
  });

  for (const [how, cut] of [
    ["stdin's end (the ssh closed)", (io: { stdin: EventEmitter; lose: () => void }) => io.stdin.emit('end')],
    ["its parent's loss (the ssh gone, the agent orphaned)", (io: { stdin: EventEmitter; lose: () => void }) => io.lose()],
  ] as const) {
    it(`ends with its transport, on ${how}: the tail stopped, the listing withdrawn, sminos closed, the session stopped, the bench’s stubs ended, once`, async () => {
      const fake = fakeDeps();
      const agent = new BenchAgent(ARGS, fake.deps);
      const stdin = new EventEmitter();
      let parent = 4242;
      let tick: (() => void) | null = null;
      const exits: number[] = [];
      bindLifetime(agent, { stdin, parent: () => parent, every: (_ms, run) => ((tick = run), () => void (tick = null)), exit: (code) => void exits.push(code), error: () => undefined });
      await agent.start();
      stdin.emit('data', `${JSON.stringify({ list: { owners: ['member-1'], title: 't' } })}\n`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      cut({ stdin, lose: () => ((parent = 1), tick?.()) });
      stdin.emit('close'); // and whatever follows asks again: still one end
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fake.events).toEqual(['sminos opened on /p/mini-bench/mawsd/endpoint/rl10.sock', 'tail stopped', 'sminos closed', 'session stopped', 'machine.sock closed']);
      expect(fake.sent.at(-1)).toEqual({ t: 'member', session: 'engine-1', gone: true });
      expect(fake.ended).toEqual(['/p/mini-bench/bench/samples.jsonl']);
      expect(exits).toEqual([0]);
      expect(tick).toBeNull(); // the parent's watch stops with it
    });
  }

  it('an agent whose start failed still ends the bench’s stubs on its way out', async () => {
    const fake = fakeDeps();
    const agent = new BenchAgent(ARGS, { ...fake.deps, machine: async () => ({ request: async () => Promise.reject(new Error('session.list: down')), close: () => void fake.events.push('machine.sock closed') }) });
    await expect(agent.start()).rejects.toThrow(/down/);
    await agent.end();
    expect(fake.ended).toEqual(['/p/mini-bench/bench/samples.jsonl']);
    expect(fake.events).toEqual(['machine.sock closed']);
  });

  it('speaks sminos’s side of the RL10 socket: the hello with its token, the welcome waited for, the restatement, then its frames', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rl10-'));
    scratch.push(root);
    const path = join(root, 'rl10.sock');
    const heard: { t: string; token?: string }[] = [];
    const server = createServer((socket) => {
      let buffer = '';
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
          const frame = JSON.parse(buffer.slice(0, at)) as { t: string; token?: string };
          buffer = buffer.slice(at + 1);
          heard.push(frame);
          if (frame.t === 'hello') socket.write(`${JSON.stringify({ t: 'note', text: 'before' })}\n${JSON.stringify({ t: 'welcome', protocol: { major: 1, minor: 0 } })}\n`);
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    try {
      const line = await openSminos({ socket: path, token: 'rl10-token' });
      line.send({ t: 'member', session: 'engine-1', gone: true });
      await expect.poll(() => heard.map((f) => f.t)).toEqual(['hello', 'restated', 'member']);
      expect(heard[0]!.token).toBe('rl10-token');
      line.close();
    } finally {
      server.close();
    }
    await expect(openSminos({ socket: join(root, 'none.sock'), token: 't' })).rejects.toThrow(/ENOENT/);
  });
});
