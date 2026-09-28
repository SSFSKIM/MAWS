import { describe, expect, it, vi } from 'vitest';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { createPtys } from './ptys';

// Real node-pty under Node: proves the darwin-arm64 prebuild loads and its spawn-helper can spawn at all. The
// Electron-runtime proof is the dev run and the M5 smoke.
function recorder() {
  const events: { name: EventName; payload: unknown }[] = [];
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => void events.push({ name, payload });
  const exited = (ptyId: string) =>
    vi.waitFor(
      () => {
        const exit = events.find((e) => e.name === 'pty.exit' && (e.payload as { ptyId: string }).ptyId === ptyId);
        if (!exit) throw new Error('not yet');
        return exit.payload;
      },
      { timeout: 5_000, interval: 20 },
    );
  const output = (ptyId: string) =>
    events
      .filter((e) => e.name === 'pty.data' && (e.payload as { ptyId: string }).ptyId === ptyId)
      .map((e) => (e.payload as { data: string }).data)
      .join('');
  return { events, emit, exited, output };
}

describe('pty host over node-pty', () => {
  it("loads node-pty and runs /bin/sh -c 'printf ok' to a clean exit", async () => {
    const rec = recorder();
    const ptys = createPtys(rec.emit);
    const { ptyId, pid } = ptys.spawn({ shell: '/bin/sh', args: ['-c', 'printf ok'], cwd: '/', cols: 80, rows: 24 });
    expect(pid).toBeGreaterThan(0);
    await expect(rec.exited(ptyId)).resolves.toEqual({ ptyId, exitCode: 0, signal: null });
    expect(rec.output(ptyId)).toContain('ok');
  });

  it('writes keystrokes to an interactive shell and streams its output back', async () => {
    const rec = recorder();
    const ptys = createPtys(rec.emit);
    const { ptyId } = ptys.spawn({ shell: '/bin/sh', cwd: '/', cols: 80, rows: 24 });
    ptys.write({ ptyId, data: "printf 'MAWS_%s_OK\\n' PTY\r" });
    await vi.waitFor(() => expect(rec.output(ptyId)).toContain('MAWS_PTY_OK'), { timeout: 5_000, interval: 20 });
    ptys.resize({ ptyId, cols: 100, rows: 30 });
    ptys.kill({ ptyId });
    await expect(rec.exited(ptyId)).resolves.toMatchObject({ ptyId, exitCode: expect.any(Number) });
  });

  it('gives each pty its own id and forgets a pty once it has exited', async () => {
    const rec = recorder();
    const ptys = createPtys(rec.emit);
    const a = ptys.spawn({ shell: '/bin/sh', args: ['-c', 'exit 3'], cwd: '/', cols: 80, rows: 24 });
    const b = ptys.spawn({ shell: '/bin/sh', args: ['-c', 'exit 0'], cwd: '/', cols: 80, rows: 24 });
    expect(a.ptyId).not.toBe(b.ptyId);
    await expect(rec.exited(a.ptyId)).resolves.toEqual({ ptyId: a.ptyId, exitCode: 3, signal: null });
    await rec.exited(b.ptyId);
    expect(() => ptys.write({ ptyId: a.ptyId, data: 'x' })).toThrow('unknown pty');
  });

  it('fails with "unknown pty" for an id it never issued', () => {
    const ptys = createPtys(() => {});
    const ptyId = 'nope' as never;
    expect(() => ptys.write({ ptyId, data: 'x' })).toThrow('unknown pty');
    expect(() => ptys.resize({ ptyId, cols: 1, rows: 1 })).toThrow('unknown pty');
    expect(() => ptys.kill({ ptyId })).toThrow('unknown pty');
  });

  it('passes the caller’s environment over the host’s own', async () => {
    const rec = recorder();
    const ptys = createPtys(rec.emit);
    const { ptyId } = ptys.spawn({
      shell: '/bin/sh',
      args: ['-c', 'printf "%s|%s" "$MAWS_PTY_PROBE" "${HOME:+home}"'],
      cwd: '/',
      cols: 80,
      rows: 24,
      env: { MAWS_PTY_PROBE: 'set' },
    });
    await rec.exited(ptyId);
    expect(rec.output(ptyId)).toContain('set|home');
  });
});
