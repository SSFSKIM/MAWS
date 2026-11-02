// The live bench's agent (test/support/remote-bench-agent.ts; P5 O7 M7) with fakes for the scratch daemon's machine.sock
// and the fake sminos's socket: prepare writes only under the scratch profile; serve starts the stub's session and lists
// it for the owners named; and its life is its transport's: stdin's end, or its parent's loss, stops the session,
// withdraws the listing, closes the fake sminos and ends the bench's stubs, once.
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_CLEANUP_MS, agentPaths, askExit, BenchAgent, BENCH_PROJECT, bindLifetime, hostDeps, openSminos, parseAgentArgs, prepare, scratchHosts, stopHosts, type AgentArgs, type MachineClient, type ServeDeps } from './remote-bench-agent';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';

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

/**
 * The scratch daemon as machine.sock answers it, the stub writing its first turn's 300 samples when the session starts.
 * `hold`: a request whose answer waits for `release()`; `stubborn`: how many signals the stub outlives.
 */
function fakeDeps(written: string[] = [], options: { hold?: string; stubborn?: number } = {}) {
  const requests: { name: string; input: unknown }[] = [];
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let stubs = 0;
  let outlives = options.stubborn ?? 0;
  const signals: string[] = [];
  const out: object[] = [];
  const sent: object[] = [];
  const ended: string[] = [];
  const events: string[] = [];
  let tailing = false;
  let ready = false;
  const machine: MachineClient = {
    async request<T>(name: string, input?: unknown) {
      requests.push({ name, input });
      if (name === options.hold) await held;
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
        stubs = 1;
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
    endStubs: (samples, signal = 'SIGTERM') => {
      ended.push(samples);
      signals.push(signal);
      if (outlives > 0) outlives -= 1;
      else stubs = 0;
    },
    stubsLeft: () => stubs,
    sleep: async () => undefined,
    tail: () => {
      tailing = true;
      return () => {
        tailing = false;
        events.push('tail stopped');
      };
    },
  };
  return { deps, requests, out, sent, ended, events, signals, release, tailing: () => tailing };
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
    prepare(a, '/runtime/bin/node', false);
    const made = walk(root).map((path) => relative(root, path));
    expect(made.filter((path) => !path.startsWith('profile'))).toEqual([]);
    expect(made.sort()).toEqual(['profile', 'profile/bench', 'profile/bench/checkout', 'profile/bench/latency-engine', 'profile/claude-config', 'profile/claude-config/.claude.json', 'profile/claude-config/settings.json', 'profile/claude-usage', 'profile/home', 'profile/shell-home', 'profile/shell-home/.bash_profile', 'profile/shell-home/.zprofile', 'profile/sminos', 'profile/tmp'].sort());
    expect(readFileSync(`${profile}/bench/latency-engine`, 'utf8')).toBe(`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 MAWS_LATENCY_STUB_VERSION='2.1.283' exec '/runtime/bin/node' '${profile}/head/test/support/latency-engine-stub.mjs' '${profile}/bench/samples.jsonl' "$@"\n`);
    // on the mini's MAWS binary, run as production runs its mawsd
    prepare(a, '/Applications/MAWS.app/Contents/MacOS/MAWS', true);
    expect(readFileSync(`${profile}/bench/latency-engine`, 'utf8')).toContain(`exec '/Applications/MAWS.app/Contents/MacOS/MAWS' --disable-sigusr1 '${profile}/head/`);
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

  // a start cut short at each of its steps: the end waits for it, and stops the session once it was created
  for (const [stage, created] of [['session.list', false], ['machine.identity', false], ['session.projects.add', false], ['session.create', true], ['session.intent.patch', true], ['session.start', true], ['session.status', true]] as const) {
    it(`an EOF during its start at ${stage}: the start cancelled and waited for, then ${created ? 'the session it created stopped' : 'nothing to stop'}, the stubs ended`, async () => {
      const fake = fakeDeps([], { hold: stage });
      const agent = new BenchAgent(ARGS, fake.deps);
      const stdin = new EventEmitter();
      const exits: number[] = [];
      bindLifetime(agent, { stdin, parent: () => 4242, every: () => () => undefined, exit: (code) => void exits.push(code), error: () => undefined });
      const starting = agent.start();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fake.requests.at(-1)!.name).toBe(stage);
      stdin.emit('end');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(exits).toEqual([]); // the end waits for the start in hand
      expect(fake.events).toEqual([]);
      fake.release();
      await expect(starting).rejects.toThrow(/its start is cancelled/);
      await expect.poll(() => exits).toEqual([0]);
      expect(fake.requests.some((r) => r.name === 'session.stop')).toBe(created);
      if (created) expect(fake.requests.find((r) => r.name === 'session.stop')!.input).toEqual({ appSessionId: 'app-1', reason: 'stop' });
      expect(fake.requests.map((r) => r.name).indexOf(stage)).toBe(fake.requests.length - 1 - (created ? 1 : 0)); // nothing after the cancelled step but the stop
      expect(fake.ended).toEqual(['/p/mini-bench/bench/samples.jsonl']);
      expect(fake.out).toEqual([]);
    });
  }

  it('waits for a list in hand before it withdraws it, and refuses input once ending', async () => {
    const fake = fakeDeps([], { hold: 'engine.sessions' });
    const agent = new BenchAgent(ARGS, fake.deps);
    await agent.start();
    const listing = agent.input(JSON.stringify({ list: { owners: ['member-1'], title: 't' } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ending = agent.end();
    await expect(agent.input(JSON.stringify({ turn: { content: 'late' } }))).rejects.toThrow(/is ending/);
    fake.release();
    await listing;
    await ending;
    expect(fake.sent.map((f) => (f as { t: string; gone?: boolean }).gone === true ? 'gone' : (f as { t: string }).t)).toEqual(['session', 'hello', 'member', 'gone']);
  });

  it('sends a turn the bench names (the live resume’s, written while the app’s link is held down)', async () => {
    const fake = fakeDeps();
    const agent = new BenchAgent(ARGS, fake.deps);
    await expect(agent.input(JSON.stringify({ turn: { content: 'latency bench turn 5' } }))).rejects.toThrow(/not started/);
    await agent.start();
    await agent.input(JSON.stringify({ turn: { content: 'latency bench turn 5' } }));
    expect(fake.requests.at(-1)).toEqual({ name: 'session.send', input: { appSessionId: 'app-1', content: 'latency bench turn 5' } });
    expect(fake.out.at(-1)).toEqual({ sent: { app: 'app-1' } });
  });

  it('kills a stub that outlives its end, checks again, and fails the end when one still runs', async () => {
    const once = fakeDeps([], { stubborn: 1 });
    const agent = new BenchAgent(ARGS, once.deps);
    await agent.start();
    await agent.end();
    expect(once.signals).toEqual(['SIGTERM', 'SIGKILL']);
    const always = fakeDeps([], { stubborn: 2 });
    const stuck = new BenchAgent(ARGS, always.deps);
    await stuck.start();
    await expect(stuck.end()).rejects.toThrow(/1 stub of the bench still run after SIGKILL/);
  });

  it('takes the serve’s absolute deadline, and ends itself before it with its cleanup done, exit 0', async () => {
    expect(parseAgentArgs(JSON.stringify({ ...ARGS, deadline: 1_000_000 })).deadline).toBe(1_000_000);
    expect(() => parseAgentArgs(JSON.stringify({ ...ARGS, deadline: 'soon' }))).toThrow(/deadline/);
    const fake = fakeDeps();
    const agent = new BenchAgent(ARGS, fake.deps);
    const exits: number[] = [];
    const armed: { at: { ms: number; fire: () => void } | null } = { at: null };
    bindLifetime(agent, { stdin: new EventEmitter(), parent: () => 4242, every: () => () => undefined, exit: (code) => void exits.push(code), error: () => undefined, deadline: 100_000, now: () => 10_000, after: (ms, fire) => ((armed.at = { ms, fire }), () => undefined) });
    await agent.start();
    expect(armed.at!.ms).toBe(100_000 - 10_000 - AGENT_CLEANUP_MS);
    armed.at!.fire();
    await expect.poll(() => exits).toEqual([0]);
    expect(fake.events).toContain('session stopped');
    expect(fake.ended).toEqual(['/p/mini-bench/bench/samples.jsonl']);
  });

  it('prepare writes each file under a fresh name moved into place: a file that is a symlink is replaced, its target outside untouched', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bench-agent-')));
    scratch.push(root);
    const profile = join(root, 'profile');
    const a: AgentArgs = { ...ARGS, profile, bench: `${profile}/bench`, head: `${profile}/head` };
    prepare(a, '/runtime/bin/node', false);
    writeFileSync(join(root, 'outside'), 'the owner’s\n');
    rmSync(`${profile}/bench/latency-engine`);
    symlinkSync(join(root, 'outside'), `${profile}/bench/latency-engine`);
    prepare(a, '/runtime/bin/node', false);
    expect(readFileSync(join(root, 'outside'), 'utf8')).toBe('the owner’s\n');
    expect(readFileSync(`${profile}/bench/latency-engine`, 'utf8')).toContain('exec ');
    expect(readdirSync(`${profile}/bench`).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });

  // ---- the hosts' own stop (the milestone review's fix 4) -----------------------------------------------------------

  /** A host's socket as the engine host and pty host serve it: the hello read, `answer` written, the exit recorded. */
  async function fakeHostSocket(path: string, answer: object) {
    const heard: Record<string, unknown>[] = [];
    const server = createServer((socket) => {
      let buffer = '';
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
          const frame = JSON.parse(buffer.slice(0, at)) as Record<string, unknown>;
          buffer = buffer.slice(at + 1);
          heard.push(frame);
          if (frame.t === 'hello') socket.write(`${JSON.stringify(answer)}\n`);
          if (frame.t === 'exit') socket.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    return { heard, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }

  it('tells a host to exit through its own socket: the hello with its token, its answer waited for, then exit now; a refused token is no exit', async () => {
    const root = realpathSync(mkdtempSync('/tmp/bra-'));
    scratch.push(root);
    const welcome = await fakeHostSocket(`${root}/w.sock`, { t: 'welcome', protocol: SOCKET_PROTOCOL, minor: 0, build: 'b', capabilities: [], pid: 1, startedAt: '', liveSessions: 0, rows: 0 });
    const refusedWire = await fakeHostSocket(`${root}/r.sock`, { t: 'refuse', reason: 'wire', protocol: SOCKET_PROTOCOL, buildId: 'b', wire: 'w', liveSessions: 1 });
    const refusedToken = await fakeHostSocket(`${root}/t.sock`, { t: 'refuse', reason: 'token', protocol: SOCKET_PROTOCOL, buildId: 'b', wire: 'w', liveSessions: 0 });
    try {
      await askExit(`${root}/w.sock`, 'host-token'); // resolved once the exit is written: the host's exit is waited for by stopHosts
      await expect.poll(() => welcome.heard.length).toBe(2);
      expect(welcome.heard).toEqual([{ t: 'hello', protocol: SOCKET_PROTOCOL, token: 'host-token', minor: expect.any(Number), build: 'remote-bench-agent', capabilities: [], appPid: process.pid }, { t: 'exit', when: 'now' }]);
      // a refused connection's one exit is still honoured by the host (the wire's, not the token's)
      await askExit(`${root}/r.sock`, 'host-token');
      await expect.poll(() => refusedWire.heard.map((f) => f.t)).toEqual(['hello', 'exit']);
      await expect(askExit(`${root}/t.sock`, 'stale')).rejects.toThrow(/refused its token/);
      expect(refusedToken.heard.map((f) => f.t)).toEqual(['hello']);
      await expect(askExit(`${root}/none.sock`, 't')).rejects.toThrow(/ENOENT/);
    } finally {
      await Promise.all([welcome.close(), refusedWire.close(), refusedToken.close()]);
    }
  });

  /** A host process of the profile's: its lock and token written where the daemon's hosts keep them, its socket served. */
  async function startHost(dir: string, options: { obeys: boolean }, children: ChildProcess[]): Promise<ChildProcess> {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(`${dir}/host.token`, 'tok\n', { mode: 0o600 });
    const script = `const net = require('node:net'); const server = net.createServer((s) => { let b = ''; s.on('data', (c) => { b += c; if (b.includes('"hello"') && !s.welcomed) { s.welcomed = true; s.write(JSON.stringify({ t: 'welcome' }) + '\\n'); } if (b.includes('"exit"') && ${options.obeys}) process.exit(0); }); }); server.listen(process.argv[1], () => process.stdout.write('up\\n')); setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ['-e', script, `${dir}/host.sock`], { stdio: ['ignore', 'pipe', 'ignore'] });
    children.push(child);
    await new Promise((resolve) => child.stdout!.once('data', resolve));
    writeFileSync(`${dir}/host.lock`, JSON.stringify({ pid: child.pid, procStart: '', protocol: SOCKET_PROTOCOL, buildId: 'b', socketPath: `${dir}/host.sock`, startedAt: '' }));
    return child;
  }

  it('stop-hosts: the engine host and pty host its locks name told to exit through their sockets and waited for; one that stays is named', async () => {
    const root = realpathSync(mkdtempSync('/tmp/bra-'));
    scratch.push(root);
    const a: AgentArgs = { ...ARGS, profile: `${root}/p`, bench: `${root}/p/bench`, head: `${root}/p/head` };
    expect(scratchHosts(a)).toEqual([{ name: 'the engine host', dir: `${root}/p/supervisor` }, { name: 'the pty host', dir: `${root}/p/mawsd/pty-host` }]);
    const children: ChildProcess[] = [];
    const alive = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;
    try {
      // none running: nothing to do
      expect(await stopHosts(a, hostDeps(), 1_000)).toEqual([]);
      const engine = await startHost(`${root}/p/supervisor`, { obeys: true }, children);
      const pty = await startHost(`${root}/p/mawsd/pty-host`, { obeys: false }, children);
      expect(await stopHosts(a, hostDeps(), 1_000)).toEqual(['the pty host']);
      await expect.poll(() => alive(engine)).toBe(false);
      expect(alive(pty)).toBe(true); // left for the runner's reap, by its pid and start time
      // a lock naming a socket outside the profile is never connected to
      pty.kill('SIGKILL');
      const outside = await startHost(`${root}/elsewhere`, { obeys: true }, children);
      writeFileSync(`${root}/p/supervisor/host.lock`, JSON.stringify({ pid: outside.pid, procStart: '', protocol: SOCKET_PROTOCOL, buildId: 'b', socketPath: `${root}/elsewhere/host.sock`, startedAt: '' }));
      expect(await stopHosts(a, hostDeps(), 500)).toEqual(['the engine host']);
      expect(alive(outside)).toBe(true);
    } finally {
      for (const child of children) if (alive(child)) child.kill('SIGKILL');
    }
  }, 30_000);
});
