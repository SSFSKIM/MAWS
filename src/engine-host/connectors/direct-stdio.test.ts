// P3-HD M2: the owned stdio transport (./direct-stdio.ts) with modelled processes and groups (./direct-test-fakes.ts):
// what is spawned and how, and how its group is ended. The lifeline's own behaviour under a real killed host is the
// remote scene's (e2e/connectors-direct.spec.ts, transport).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectWire } from './direct-wire';
import { LIFELINE_SCRIPT, OwnedStdioTransport, STDIO_STOP, type StdioLaunch } from './direct-stdio';
import { FakeMcpServer, FakeProcesses } from './direct-test-fakes';

const entry: StdioLaunch = { transport: 'stdio', command: 'fixture', executable: '/scratch/bin/fixture', args: ['--serve', 'a b'], cwd: '/scratch/project', env: { PATH: '/scratch/bin', HOME: '/scratch/home', MAWS_CONFIGURED: 'configured-secret' } };

function transport(processes: FakeProcesses) {
  const wire = new DirectWire(() => true, () => {});
  return new OwnedStdioTransport(entry, wire, { maxMessageBytes: 4_096, spawn: processes.spawn, kill: processes.kill });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OwnedStdioTransport', () => {
  it('spawns the entry itself, exactly as materialized, leading its own group, with a lifeline on that group', async () => {
    const processes = new FakeProcesses(new FakeMcpServer());
    await transport(processes).start();
    const child = processes.children[0]!;
    // nothing inherited, no shell, args kept whole, stderr never read
    expect([child.command, child.args, child.options]).toEqual(['/scratch/bin/fixture', ['--serve', 'a b'], { cwd: '/scratch/project', env: { PATH: '/scratch/bin', HOME: '/scratch/home', MAWS_CONFIGURED: 'configured-secret' }, stdio: ['pipe', 'pipe', 'ignore'], detached: true, shell: false, windowsHide: true }]);
    const lifeline = processes.lifelines[0]!;
    expect([lifeline.command, lifeline.args, lifeline.options]).toEqual(['/bin/sh', ['-c', LIFELINE_SCRIPT, 'maws-lifeline', String(child.pid)], { cwd: '/', env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'ignore', 'ignore'], detached: true, shell: false, windowsHide: true }]);
    expect(JSON.stringify([lifeline.args, lifeline.options])).not.toContain('configured-secret');
    expect([lifeline.killed, lifeline.stdinDestroyed]).toEqual([null, false]); // held while the group is owned
  });

  it('ends stdin, then SIGTERM and SIGKILL to the group, until a grandchild ignoring both is gone', async () => {
    vi.useFakeTimers();
    const processes = new FakeProcesses(new FakeMcpServer());
    processes.behaviour = { exitOnStdinEnd: true, exitOn: ['SIGTERM', 'SIGKILL'], grandchild: { exitOn: ['SIGKILL'] } };
    const owned = transport(processes);
    await owned.start();
    const pid = processes.children[0]!.pid;
    let ended = false;
    void owned.close().then(() => (ended = true));
    await vi.advanceTimersByTimeAsync(STDIO_STOP.termAfterMs - 1);
    expect(processes.children[0]!.exited).toBe(true); // the server left at stdin's end
    expect(processes.alive(pid)).toEqual([pid + 1]); // its child did not
    expect(processes.signals.filter((entry) => entry.signal !== 0)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(processes.signals.filter((entry) => entry.signal !== 0)).toEqual([{ pid: -pid, signal: 'SIGTERM' }]);
    await vi.advanceTimersByTimeAsync(STDIO_STOP.killAfterMs - STDIO_STOP.termAfterMs);
    expect(processes.signals.filter((entry) => entry.signal !== 0)).toEqual([{ pid: -pid, signal: 'SIGTERM' }, { pid: -pid, signal: 'SIGKILL' }]);
    await vi.advanceTimersByTimeAsync(STDIO_STOP.pollMs);
    expect(ended).toBe(true);
    expect(processes.alive(pid)).toEqual([]);
    // the group gone, its lifeline goes without signalling anything
    expect([processes.lifelines[0]!.killed, processes.lifelines[0]!.stdinDestroyed]).toEqual(['SIGKILL', true]);
  });

  it('gives up inside the 5 s bound when the group never empties', async () => {
    vi.useFakeTimers();
    const processes = new FakeProcesses(new FakeMcpServer());
    processes.behaviour = { exitOnStdinEnd: false, exitOn: [] };
    const owned = transport(processes);
    await owned.start();
    let ended = false;
    void owned.close().then(() => (ended = true));
    await vi.advanceTimersByTimeAsync(STDIO_STOP.giveUpAfterMs - 1);
    expect(ended).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ended).toBe(true);
    expect(STDIO_STOP.giveUpAfterMs).toBeLessThan(5_000);
  });

  it('ends the whole group when the server exits by itself, and reports the close once', async () => {
    vi.useFakeTimers();
    const processes = new FakeProcesses(new FakeMcpServer());
    processes.behaviour = { exitOnStdinEnd: true, exitOn: ['SIGTERM'], grandchild: { exitOn: ['SIGTERM'] } };
    const owned = transport(processes);
    const onclose = vi.fn();
    owned.onclose = onclose;
    await owned.start();
    const pid = processes.children[0]!.pid;
    processes.children[0]!.exit(); // a crash, its grandchild left behind
    await vi.advanceTimersByTimeAsync(STDIO_STOP.termAfterMs + STDIO_STOP.pollMs);
    expect(processes.alive(pid)).toEqual([]);
    expect(onclose).toHaveBeenCalledTimes(1);
    await owned.close();
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('is not ready before its lifeline started', async () => {
    const processes = new FakeProcesses(new FakeMcpServer());
    processes.lifelineStart = 'held';
    let ready = false;
    void transport(processes).start().then(() => (ready = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(processes.children).toHaveLength(1);
    expect(ready).toBe(false);
    processes.lifelines[0]!.emit('spawn');
    await vi.waitFor(() => expect(ready).toBe(true));
  });

  it('fails its start and ends the group when the lifeline cannot be started', async () => {
    vi.useFakeTimers();
    const processes = new FakeProcesses(new FakeMcpServer());
    processes.lifelineStart = 'error';
    const owned = transport(processes);
    const onclose = vi.fn();
    owned.onclose = onclose;
    const started = owned.start().then(
      () => 'ready',
      () => 'failed',
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(await started).toBe('failed');
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(processes.children[0]!.stdinEnded).toBe(true);
    await vi.advanceTimersByTimeAsync(STDIO_STOP.giveUpAfterMs);
    expect(processes.alive(processes.children[0]!.pid)).toEqual([]);
  });

  it('closes, ending the group, when its lifeline exits while the group is owned', async () => {
    vi.useFakeTimers();
    const processes = new FakeProcesses(new FakeMcpServer());
    const owned = transport(processes);
    const onclose = vi.fn();
    owned.onclose = onclose;
    const started = owned.start();
    await vi.advanceTimersByTimeAsync(0);
    await started;
    processes.lifelines[0]!.exitEarly();
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(processes.children[0]!.stdinEnded).toBe(true);
    await vi.advanceTimersByTimeAsync(STDIO_STOP.giveUpAfterMs);
    expect(processes.alive(processes.children[0]!.pid)).toEqual([]);
  });

  it('delivers framed messages, skipping a broken line', async () => {
    const processes = new FakeProcesses(new FakeMcpServer());
    const owned = transport(processes);
    const received: unknown[] = [];
    const errors: string[] = [];
    owned.onmessage = (message) => received.push(message);
    owned.onerror = (error) => errors.push(error.message);
    await owned.start();
    processes.children[0]!.emitStdout('not json\n{"jsonrpc":"2.0","method":"notifications/x"}\n');
    await vi.waitFor(() => expect(received).toEqual([{ jsonrpc: '2.0', method: 'notifications/x' }]));
    expect(errors).toEqual(['the server wrote a line that is not a JSON-RPC message']);
  });
});
