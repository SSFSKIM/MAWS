import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EventName, EventPayload, PtyId } from '@shared/ipc/schema';
import { PROFILE_VARIABLE, writeScratchShellHome } from '../../test/support/shell-home';
import { terminalEnvironment } from './env';
import { HIGH_WATERMARK, LOW_WATERMARK } from './flow';
import { createPtyTable, RING_BYTES, type PtyTable } from './table';

// Real node-pty under Node (C9 Residue *Testing and harness*): the table's flow control, ring buffer, checkpoint,
// initial command and foreground detection against real shells and programs. The Electron-runtime proof is the smoke.
// Every test here waits on real processes and floods, which a saturated machine slows well past vitest's 5 s default
// (two full runs at a load average of 22 on 10 cores timed out here, C9 M3): each gets 20 s.
vi.setConfig({ testTimeout: 20_000 });
// Wait budgets. Every wait below times a real process (its start, its output, its exit, a flood's progress) and takes
// this default, just under the per-test limit, so the per-test limit is the one that fires on a saturated machine
// (a 10 s `exited` failed once at a load average of 130 to 158). The only shorter bound is the spec's pin that a flood
// is paused within one second of its first byte: that measures the host's own flow control, not a process.
const WAIT_MS = 18_000;
// Every shell here starts over a scratch home (test/support/shell-home.ts) with HOME moved there too: its startup files
// are that home's, and its history is written there, never to the owner's.
const SHELL_HOME = writeScratchShellHome(mkdtempSync(join(tmpdir(), 'maws-pty-home-')));
const BASE_ENV: NodeJS.ProcessEnv = { ...process.env, HOME: SHELL_HOME.dir, ...SHELL_HOME.env };
afterAll(() => rmSync(SHELL_HOME.dir, { recursive: true, force: true }));
const SESSION = 'app-session-1' as AppSessionId;
const decoder = new TextDecoder();
let labels = 0;
const spawnInput = (rest: { shell?: string; args?: string[]; command?: string; cwd?: string }) => ({
  appSessionId: SESSION,
  label: `terminal-${++labels}`,
  cwd: rest.cwd ?? '/tmp',
  cols: 80,
  rows: 24,
  ...rest,
});

interface Chunk {
  offset: number;
  data: Uint8Array;
}

function harness(environment: Record<string, string> = terminalEnvironment(BASE_ENV, { appVersion: '9.9.9' })) {
  const chunks = new Map<string, Chunk[]>();
  const exits = new Map<string, EventPayload<'pty.exit'>>();
  const ackers = new Set<string>();
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => {
    if (name === 'pty.data') {
      const { ptyId, offset, data } = payload as EventPayload<'pty.data'>;
      if (!chunks.has(ptyId)) chunks.set(ptyId, []);
      chunks.get(ptyId)!.push({ offset, data });
      // A renderer acknowledges after it has parsed, never inside the emit.
      if (ackers.has(ptyId)) setImmediate(() => table.ack({ ptyId, offset: offset + data.byteLength }));
    } else if (name === 'pty.exit') {
      const exit = payload as EventPayload<'pty.exit'>;
      exits.set(exit.ptyId, exit);
    }
  };
  const table: PtyTable = createPtyTable({ emit, environment: Promise.resolve(environment) });
  tables.push(table);
  const bytes = (ptyId: string): Uint8Array => {
    const list = chunks.get(ptyId) ?? [];
    const out = new Uint8Array(list.reduce((n, c) => n + c.data.byteLength, 0));
    let at = 0;
    for (const c of list) {
      out.set(c.data, at);
      at += c.data.byteLength;
    }
    return out;
  };
  const text = (ptyId: string) => decoder.decode(bytes(ptyId));
  const exited = (ptyId: string, timeout = WAIT_MS) =>
    vi.waitFor(
      () => {
        const exit = exits.get(ptyId);
        if (!exit) throw new Error(`${ptyId} has not exited`);
        return exit;
      },
      { timeout, interval: 20 },
    );
  const until = (check: () => boolean, timeout = WAIT_MS, what = 'the condition') =>
    vi.waitFor(
      () => {
        if (!check()) throw new Error(`${what} did not hold`);
      },
      { timeout, interval: 10 },
    );
  return { table, chunks, exits, ackers, bytes, text, exited, until };
}

const tables: PtyTable[] = [];
afterEach(() => {
  for (const table of tables.splice(0)) for (const info of table.list().ptys) if (info.alive) table.kill({ ptyId: info.ptyId, signal: 'SIGKILL' });
});

// The program's output as the renderer will decode it: the tty's `onlcr` turns each line feed into CR LF, and macOS's
// tty sometimes duplicates the CR when its output queue fills (M1 Surprises), so the comparison folds any run of CRs
// before a line feed.
const asOutput = (s: string) => s.replace(/\r+\n/g, '\n');

describe('pty host flow control pauses and resumes', () => {
  it('pauses a flood nobody acknowledges near the high watermark, and acks let it finish', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', 'yes | head -c 5000000'] }));
    // The second is the flood's, not the process start's (the iutf8 wrapper and a loaded machine delay the first byte).
    await h.until(() => (h.chunks.get(ptyId)?.length ?? 0) > 0, WAIT_MS, 'the flood started');
    await h.until(() => h.table.list().ptys.find((p) => p.ptyId === ptyId)?.paused === true, 1_000, 'paused within one second');
    await new Promise((r) => setTimeout(r, 300)); // nothing more arrives while paused
    const largest = Math.max(...h.chunks.get(ptyId)!.map((c) => c.data.byteLength));
    const { total } = h.table.inspect(ptyId).flow;
    expect(total).toBeGreaterThanOrEqual(HIGH_WATERMARK);
    expect(total).toBeLessThan(HIGH_WATERMARK + largest);
    expect(h.table.inspect(ptyId).flow.mode).toBe('paused');

    h.table.ack({ ptyId, offset: total });
    expect(h.table.inspect(ptyId).flow.mode).toBe('flowing');
    h.ackers.add(ptyId);
    await expect(h.exited(ptyId)).resolves.toMatchObject({ exitCode: 0 });
    expect(asOutput(h.text(ptyId))).toBe('y\n'.repeat(2_500_000));
  });

  it('stays paused on an ack that leaves more than the low watermark outstanding', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', 'yes | head -c 5000000'] }));
    await h.until(() => h.table.inspect(ptyId).flow.mode === 'paused', WAIT_MS, 'paused');
    const { total } = h.table.inspect(ptyId).flow;
    h.table.ack({ ptyId, offset: total - LOW_WATERMARK - 1 });
    expect(h.table.inspect(ptyId).flow).toMatchObject({ mode: 'paused', acked: total - LOW_WATERMARK - 1 });
    h.table.ack({ ptyId, offset: total - LOW_WATERMARK });
    expect(h.table.inspect(ptyId).flow.mode).toBe('flowing');
  });

  it('clamps an ack above the total and logs it instead of failing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const h = harness();
      const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', 'printf ok; sleep 5'] }));
      await h.until(() => h.text(ptyId).includes('ok'), WAIT_MS, 'output');
      h.table.ack({ ptyId, offset: 1_000_000 });
      expect(h.table.inspect(ptyId).flow.acked).toBe(h.table.inspect(ptyId).flow.total);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ack'));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('pty host ring buffer and attach offsets', () => {
  it('loses nothing of seq 1 200000 with a renderer-like acker, offsets contiguous', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', 'seq 1 200000'] }));
    h.ackers.add(ptyId);
    await h.exited(ptyId);
    const expected = Array.from({ length: 200_000 }, (_, i) => `${i + 1}\n`).join('');
    expect(expected.length).toBe(1_288_895);
    expect(asOutput(h.text(ptyId))).toBe(expected);
    let next = 0;
    for (const chunk of h.chunks.get(ptyId)!) {
      expect(chunk.offset).toBe(next);
      next += chunk.data.byteLength;
    }
    expect(h.table.inspect(ptyId).flow.total).toBe(next);
    expect(next).toBeGreaterThanOrEqual(1_488_895); // one CR per line feed, plus any the tty duplicated

    // The ring holds exactly the last 512 KiB; with no checkpoint the replay is the whole ring.
    expect(RING_BYTES).toBe(2 * HIGH_WATERMARK);
    const attach = h.table.attach({ ptyId });
    expect(attach.nextOffset).toBe(next);
    expect(attach.replayFrom).toBe(next - RING_BYTES);
    expect(attach.checkpoint).toBeNull();
    expect(attach.replay).toEqual(h.bytes(ptyId).subarray(next - RING_BYTES));
    expect(attach.info).toMatchObject({ ptyId, alive: false, offset: next, exit: { exitCode: 0, signal: null } });
  });

  it('continues after attach at nextOffset: every later event is at or above it, the first exactly at it', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: [] }));
    h.table.write({ ptyId, data: "printf 'MAWS_%s\\n' ONE\r" });
    await h.until(() => h.text(ptyId).includes('MAWS_ONE'), WAIT_MS, 'first output');
    await new Promise((r) => setTimeout(r, 200));
    const before = h.chunks.get(ptyId)!.length;
    const attach = h.table.attach({ ptyId });
    expect(attach.nextOffset).toBe(h.bytes(ptyId).byteLength);
    expect(attach.replay).toEqual(h.bytes(ptyId));
    h.table.write({ ptyId, data: "printf 'MAWS_%s\\n' TWO\r" });
    await h.until(() => h.text(ptyId).includes('MAWS_TWO'), WAIT_MS, 'second output');
    const after = h.chunks.get(ptyId)!.slice(before);
    expect(after[0]!.offset).toBe(attach.nextOffset);
    for (const chunk of after) expect(chunk.offset).toBeGreaterThanOrEqual(attach.nextOffset);
  });
});

describe('pty host checkpoint and replay window', () => {
  it('keeps the ring reaching back to the acknowledged offset while paused, so a checkpoint there is exact', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', 'yes | head -c 5000000'] }));
    await h.until(() => h.table.inspect(ptyId).flow.mode === 'paused', WAIT_MS, 'paused');
    const partial = 100 * 1024;
    h.table.ack({ ptyId, offset: partial }); // still paused: more than 64 KiB outstanding
    await new Promise((r) => setTimeout(r, 200));
    const { flow, ringStart } = h.table.inspect(ptyId);
    expect(flow).toMatchObject({ mode: 'paused', acked: partial });
    expect(ringStart).toBeLessThanOrEqual(flow.acked); // the 2 × HIGH invariant

    h.table.checkpoint({ ptyId, offset: partial, state: 'STATE-AT-100K' });
    const attach = h.table.attach({ ptyId });
    expect(attach.checkpoint).toEqual({ offset: partial, state: 'STATE-AT-100K' });
    expect(attach.replayFrom).toBe(partial); // exact
    expect(attach.nextOffset).toBe(flow.total);
    expect(attach.replay).toEqual(h.bytes(ptyId).subarray(partial));
    expect(h.table.inspect(ptyId).flow).toMatchObject({ mode: 'flowing', acked: flow.total }); // attach resumed it
  });

  it('answers lossy when the flood outran the checkpoint: replay from the ring start, the whole ring', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', 'sleep 0.3; yes | head -c 5000000'] }));
    h.table.checkpoint({ ptyId, offset: 0, state: 'STATE-AT-0' });
    h.ackers.add(ptyId);
    await h.exited(ptyId);
    const total = h.bytes(ptyId).byteLength;
    const attach = h.table.attach({ ptyId });
    expect(attach.checkpoint).toEqual({ offset: 0, state: 'STATE-AT-0' });
    expect(attach.replayFrom).toBe(total - RING_BYTES);
    expect(attach.replayFrom).toBeGreaterThan(0);
    expect(attach.replay).toEqual(h.bytes(ptyId).subarray(total - RING_BYTES));
  });

  it('replaces a checkpoint with the next, clamps one above the total, and still answers it for a dead pty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const h = harness();
      const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', "printf 'hello\\n'; sleep 0.5"] }));
      await h.until(() => h.text(ptyId).includes('hello'), WAIT_MS, 'output');
      const total = h.bytes(ptyId).byteLength;
      h.table.checkpoint({ ptyId, offset: 0, state: 'first' });
      h.table.checkpoint({ ptyId, offset: total, state: 'second' });
      expect(h.table.attach({ ptyId }).checkpoint).toEqual({ offset: total, state: 'second' });
      h.table.checkpoint({ ptyId, offset: total + 1000, state: 'third' });
      expect(h.table.attach({ ptyId }).checkpoint).toEqual({ offset: total, state: 'third' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('checkpoint'));

      await h.exited(ptyId);
      const dead = h.table.attach({ ptyId });
      expect(dead.info).toMatchObject({ alive: false, exit: { exitCode: 0, signal: null } });
      expect(dead.checkpoint).toEqual({ offset: total, state: 'third' });
      expect(dead.replayFrom).toBe(total);
      expect(dead.replay.byteLength).toBe(dead.nextOffset - total);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('pty host initial command runs under zsh and bash', () => {
  // The marker is assembled by the shell, so the tty's echo of the typed command never contains it: only running it can.
  // The login line also names the login profile the shell read and the history file it keeps.
  const cases = [
    { shell: '/bin/zsh', login: '[[ -o login ]]', profile: '.zprofile' },
    { shell: '/bin/bash', login: 'shopt -q login_shell', profile: '.bash_profile' },
  ];
  it.each(cases)('$shell starts as a login shell over the scratch home and runs the command it was spawned with', async ({ shell, login, profile }) => {
    const h = harness();
    const { ptyId } = await h.table.spawn(
      spawnInput({ shell, command: `printf 'MAWS_INIT_%s\\n' OK; ${login} && printf 'MAWS_LOGIN_%s|%s|%s\\n' YES "$${PROFILE_VARIABLE}" "$HISTFILE"` }),
    );
    const loginLine = () => /MAWS_INIT_OK\n[\s\S]*MAWS_LOGIN_YES\|([^|\n]*)\|([^\n]*)\n/.exec(asOutput(h.text(ptyId)));
    await h.until(() => loginLine() !== null, WAIT_MS, 'the initial command ran');
    expect(h.table.list().ptys.find((p) => p.ptyId === ptyId)).toMatchObject({ shell, alive: true });
    const [, read, history = ''] = loginLine()!;
    expect(read).toBe(profile);
    // Checked before the shell is let exit: one on the wrong home ends here, under afterEach's SIGKILL, which saves no
    // history. An exit saves it, and the command is in the scratch home's file.
    expect(history.startsWith(`${SHELL_HOME.dir}/`), history).toBe(true);
    h.table.write({ ptyId, data: 'exit\n' });
    await h.exited(ptyId);
    expect(readFileSync(history, 'utf8')).toContain('MAWS_INIT_');
  }, 20_000);
});

describe('pty host foreground detection', () => {
  it('reports busy false at a /bin/sh prompt and busy true with the program while sleep runs', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: [] }));
    h.table.write({ ptyId, data: "printf 'MAWS_%s\\n' READY\r" });
    await h.until(() => h.text(ptyId).includes('MAWS_READY'), WAIT_MS, 'the prompt');
    await expect(h.table.foreground({ ptyId })).resolves.toMatchObject({ busy: false });
    h.table.write({ ptyId, data: 'sleep 5\r' });
    await vi.waitFor(async () => expect(await h.table.foreground({ ptyId })).toEqual({ process: 'sleep', busy: true }), { timeout: WAIT_MS, interval: 50 });
  });

  it('reports nothing running for a dead pty', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', 'exit 0'] }));
    await h.exited(ptyId);
    await expect(h.table.foreground({ ptyId })).resolves.toEqual({ process: null, busy: false });
  });
});

describe('pty host tty has iutf8', () => {
  it('starts every pty with IUTF8 set, as Terminal.app does', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', 'stty -a'] }));
    await h.exited(ptyId);
    expect(h.text(ptyId)).toMatch(/(^|\s)iutf8(\s|$)/);
    expect(h.text(ptyId)).not.toContain('-iutf8');
  });

  it('erases a whole multi-byte character in canonical mode', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', "stty -echo; printf 'MAWS_%s\\n' READY; head -n 1"] }));
    await h.until(() => h.text(ptyId).includes('MAWS_READY'), WAIT_MS, 'the reader');
    h.table.write({ ptyId, data: '한\x7fa\n' });
    await h.exited(ptyId);
    const after = h.text(ptyId).split('MAWS_READY')[1]!;
    expect(after.split(/\r?\n/).filter((line) => line.trim())).toEqual(['a']);
  });

  it('keeps the pid, and the program sees its own path as $0', async () => {
    const h = harness();
    const { ptyId, pid } = await h.table.spawn(spawnInput({ shell: '/bin/bash', args: ['-c', 'printf "MAWS_%s|%s\\n" "$$" "$0"'] }));
    await h.exited(ptyId);
    expect(h.text(ptyId)).toContain(`MAWS_${pid}|/bin/bash`);
    expect(h.table.list().ptys.find((p) => p.ptyId === ptyId)?.shell).toBe('/bin/bash');
  });
});

describe('pty host coalesces reads into fewer events', () => {
  // A producer faster than the host's event loop (a slow one, like `seq` to a tty, gets one read per turn and is
  // emitted at once: coalescing costs an interactive program no latency).
  it('emits fewer events than node-pty reads under a flood, every byte in order at monotone, contiguous offsets', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', 'yes | head -c 2000000'] }));
    h.ackers.add(ptyId);
    await h.exited(ptyId);
    const chunks = h.chunks.get(ptyId)!;
    const { reads } = h.table.inspect(ptyId);
    expect(chunks.length).toBeLessThan(reads / 2);
    let next = 0;
    for (const chunk of chunks) {
      expect(chunk.offset).toBe(next);
      expect(chunk.data.byteLength).toBeLessThanOrEqual(64 * 1024 + 1024); // flushed at 64 KiB, plus the read that crossed it
      next += chunk.data.byteLength;
    }
    expect(asOutput(h.text(ptyId))).toBe('y\n'.repeat(1_000_000));
    expect(next).toBe(h.table.inspect(ptyId).read);
  }, 20_000);

  it('flushes before the exit event, so a program’s last bytes precede its exit', async () => {
    const events: string[] = [];
    const table = createPtyTable({
      emit: (name, payload) => void events.push(name === 'pty.data' ? `data:${decoder.decode((payload as EventPayload<'pty.data'>).data)}` : name),
      environment: Promise.resolve(terminalEnvironment(BASE_ENV, { appVersion: '0' })),
    });
    tables.push(table);
    await table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', "printf 'MAWS_LAST'"] }));
    await vi.waitFor(() => expect(events.at(-1)).toBe('pty.exit'), { timeout: WAIT_MS, interval: 20 });
    expect(events.slice(0, -1).join('')).toContain('MAWS_LAST');
  });

  it('answers attach with every byte it has read: nextOffset covers what is still waiting to be flushed', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', 'yes | head -c 1000000'] }));
    h.ackers.add(ptyId);
    let attaches = 0;
    while (!h.exits.has(ptyId)) {
      const attach = h.table.attach({ ptyId });
      expect(attach.nextOffset).toBe(h.table.inspect(ptyId).read);
      expect(attach.nextOffset).toBe(h.bytes(ptyId).byteLength); // the flush was emitted before the reply
      attaches++;
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(attaches).toBeGreaterThan(1);
  }, 20_000);
});

describe('pty host environment', () => {
  it('starts a program with the terminal environment it was given, in the requested cwd', async () => {
    const h = harness(terminalEnvironment({ ...BASE_ENV, CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'parent' }, { appVersion: '9.9.9' }));
    const { ptyId } = await h.table.spawn(
      spawnInput({
        shell: '/bin/sh',
        args: ['-c', 'printf "%s|%s|%s|%s|%s|%s" "$TERM" "$TERM_PROGRAM" "$TERM_PROGRAM_VERSION" "$CLAUDE_CODE_FORCE_SYNC_OUTPUT" "${CLAUDECODE-unset}${CLAUDE_CODE_SESSION_ID-unset}" "$(pwd -P)"'],
        cwd: '/usr/bin',
      }),
    );
    await h.exited(ptyId);
    expect(h.text(ptyId)).toContain('xterm-256color|MAWS|9.9.9|1|unsetunset|/usr/bin');
  });

  it('defaults the shell to the environment’s SHELL, started with -l', async () => {
    const h = harness({ ...terminalEnvironment(BASE_ENV, { appVersion: '0' }), SHELL: '/bin/bash' });
    const { ptyId } = await h.table.spawn(spawnInput({ command: "shopt -q login_shell && printf 'MAWS_%s\\n' BASHLOGIN" }));
    await h.until(() => h.text(ptyId).includes('MAWS_BASHLOGIN'), WAIT_MS, 'a bash login shell');
    expect(h.table.list().ptys.find((p) => p.ptyId === ptyId)?.shell).toBe('/bin/bash');
  }, 20_000);
});

describe('pty host lifecycle', () => {
  it('lists a live pty with its session, label, size and offset', async () => {
    const h = harness();
    const input = spawnInput({ shell: '/bin/sh', args: [] });
    const { ptyId, pid } = await h.table.spawn(input);
    h.table.resize({ ptyId, cols: 100, rows: 30 });
    expect(h.table.list().ptys).toEqual([
      expect.objectContaining({ ptyId, pid, appSessionId: SESSION, label: input.label, cwd: '/tmp', shell: '/bin/sh', cols: 100, rows: 30, alive: true, paused: false, exit: null, offset: expect.any(Number) }),
    ]);
    expect(Number.isNaN(Date.parse(h.table.list().ptys[0]!.spawnedAt))).toBe(false);
  });

  it('keeps a pty that exited on its own as a dead entry: writes fail with "pty exited", kill removes it', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', 'exit 3'] }));
    await expect(h.exited(ptyId)).resolves.toEqual({ ptyId, exitCode: 3, signal: null });
    expect(h.table.list().ptys).toEqual([expect.objectContaining({ ptyId, alive: false, exit: { exitCode: 3, signal: null } })]);
    expect(() => h.table.write({ ptyId, data: 'x' })).toThrow('pty exited');
    expect(() => h.table.resize({ ptyId, cols: 10, rows: 10 })).toThrow('pty exited');
    h.table.kill({ ptyId });
    expect(h.table.list().ptys).toEqual([]);
  });

  it('removes a killed pty once it has exited, with SIGHUP by default', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: ['-c', 'sleep 30'] }));
    h.table.kill({ ptyId });
    await expect(h.exited(ptyId)).resolves.toEqual({ ptyId, exitCode: 0, signal: 1 });
    expect(h.table.list().ptys).toEqual([]);
  });

  it('refuses a second live pty under the same session and label, and replaces a dead one', async () => {
    const h = harness();
    const input = spawnInput({ shell: '/bin/sh', args: ['-c', 'exit 0'] });
    const first = await h.table.spawn(input);
    await h.exited(first.ptyId);
    const second = await h.table.spawn({ ...input, args: ['-c', 'sleep 30'] });
    expect(h.table.list().ptys.map((p) => p.ptyId)).toEqual([second.ptyId]);
    await expect(h.table.spawn(input)).rejects.toThrow('already has a live pty');
  });

  it('fails with "unknown pty" for an id it never issued', async () => {
    const h = harness();
    const ptyId = 'nope' as PtyId;
    expect(() => h.table.write({ ptyId, data: 'x' })).toThrow('unknown pty');
    expect(() => h.table.resize({ ptyId, cols: 1, rows: 1 })).toThrow('unknown pty');
    expect(() => h.table.kill({ ptyId })).toThrow('unknown pty');
    expect(() => h.table.ack({ ptyId, offset: 0 })).toThrow('unknown pty');
    expect(() => h.table.attach({ ptyId })).toThrow('unknown pty');
    await expect(h.table.foreground({ ptyId })).rejects.toThrow('unknown pty');
  });

  it('writes keystrokes to an interactive shell and streams its output back as bytes', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnInput({ shell: '/bin/sh', args: [] }));
    h.table.write({ ptyId, data: "printf 'MAWS_%s_OK 한글\\n' PTY\r" });
    await h.until(() => h.text(ptyId).includes('MAWS_PTY_OK 한글'), WAIT_MS, 'output');
    for (const chunk of h.chunks.get(ptyId)!) expect(Object.getPrototypeOf(chunk.data)).toBe(Uint8Array.prototype); // exact-size copies, not pooled Buffers
  });
});
