import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node-pty';
import { expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { PtyInfo } from '@shared/ipc/schema/pty';
import { pauseTakeOver, until } from './pause-take-over';
import { readProcesses, type PaneProcess } from './pane-holder';

// Real job control and line editors, no owner profiles, config, history or engine. sleep is the CLI stand-in.
it.each(['/bin/bash', '/bin/zsh'].flatMap((shell) => ['start', 'middle', 'end'].map((cursor) => ({ shell, cursor }))))(
  'clears an unfinished line at $cursor in $shell emacs mode before returning the CLI to the foreground',
  async ({ shell, cursor }) => {
    const home = mkdtempSync(join(tmpdir(), 'maws-rollback-'));
    const marker = join(home, 'unintended');
    vi.stubEnv('LC_ALL', 'C');
    vi.stubEnv('TZ', 'UTC');
    const pty = spawn(shell, shell.endsWith('bash') ? ['--noprofile', '--norc', '-i'] : ['-f', '-i'], {
      name: 'xterm-256color', cols: 200, rows: 24, cwd: home,
      env: { HOME: home, ZDOTDIR: home, HISTFILE: '/dev/null', PATH: '/usr/bin:/bin', TERM: 'xterm-256color', LC_ALL: 'C', TZ: 'UTC', PS1: 'READY> ', PROMPT: 'READY> ' },
    });
    let output = '';
    pty.onData((data) => { output += data; });
    const exited = new Promise<void>((resolve) => pty.onExit(() => resolve()));
    let holder: PaneProcess | undefined;
    const wait = async (test: () => Promise<boolean>) => expect(await until(test, 3_000, 25), output).toBe(true);
    try {
      await wait(async () => output.includes('READY> '));
      pty.write(`${shell.endsWith('bash') ? 'set -o emacs' : 'bindkey -e'}; /bin/sleep 60\n`);
      await wait(async () => {
        const table = await readProcesses();
        holder = [...table.values()].find((p) => p.ppid === pty.pid && p.pgid === table.get(pty.pid)?.foreground);
        return holder !== undefined;
      });
      const target = { pane: { pid: pty.pid, ptyId: 'scratch', alive: true, label: 'Scratch' } as PtyInfo, holder: holder! };
      const result = await pauseTakeOver({
        processes: readProcesses,
        write: async (data) => { pty.write(data); },
        foreground: async () => ({ process: shell, busy: (await readProcesses()).get(pty.pid)?.foreground !== pty.pid }),
        authority: async (paused) => {
          expect(await paused.isPaused()).toBe(true);
          return { holder: { kind: 'none' }, live: 'none', source: 'none' };
        },
        signal: () => { throw new Error('must not end the CLI on failed resume'); },
        clear: async () => false,
        cancel: async () => true,
        resume: async () => {
          await wait(async () => output.split('READY> ').length >= 3);
          // A surviving suffix would either corrupt fg or run this harmless marker command.
          const line = `:; printf unintended > '${marker}'; :`;
          pty.write(line + (cursor === 'start' ? '\x01' : cursor === 'middle' ? '\x01\x06\x06' : ''));
          await wait(async () => output.includes('unintended'));
          throw new Error('simulated resume refusal');
        },
        waitMs: 3_000, pollMs: 25,
      }, { appSessionId: 'scratch' as AppSessionId, engineSessionId: 'scratch' as SessionId }, target);
      expect(result).toMatchObject({ status: 'refused', message: expect.stringContaining('back in the foreground') });
      const restored = (await readProcesses()).get(holder!.pid)!;
      expect(restored.state).not.toContain('T');
      expect(restored.foreground).toBe(holder!.pgid);
      expect(existsSync(marker)).toBe(false);
    } finally {
      // Kill only scratch children; the interactive parent reaps them before it exits, even on a failed assertion.
      for (const p of (await readProcesses()).values()) {
        if (p.ppid === pty.pid) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* already exited */ } }
      }
      pty.write('\x03\x15\x0bwait; exit\n');
      const timeout = setTimeout(() => pty.kill('SIGKILL'), 3_000);
      await exited;
      clearTimeout(timeout);
      if (holder) expect((await readProcesses()).has(holder.pid)).toBe(false);
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true });
    }
  }, 15_000,
);
