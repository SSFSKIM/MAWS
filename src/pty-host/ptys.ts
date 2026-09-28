// The PTY host's terminals over node-pty (charter §12 C1 *node-pty native module*): each pty is keyed by a random
// `PtyId`, streams `pty.data` and ends with one `pty.exit`, after which its id is forgotten. An id this table does not
// hold fails with `unknown pty` (the runtime answers it as `internal`). C9 extends this into real terminals.
import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import type { HostEmit } from '@shared/host/runtime';
import type { CommandInput, CommandOutput, PtyId } from '@shared/ipc/schema';
import { terminalEnvironment } from './env';

export interface Ptys {
  spawn(input: CommandInput<'pty.spawn'>): CommandOutput<'pty.spawn'>;
  write(input: CommandInput<'pty.write'>): void;
  resize(input: CommandInput<'pty.resize'>): void;
  kill(input: CommandInput<'pty.kill'>): void;
}

export function createPtys(emit: HostEmit, appVersion: string): Ptys {
  const live = new Map<string, pty.IPty>();
  // The terminal environment (Residue *Terminal environment*): the host's own environment minus the parent-session
  // variables, plus the terminal's identity. M2 seeds it from X6's captured login-shell environment instead.
  const base = terminalEnvironment(process.env, { appVersion });

  const get = (ptyId: string) => {
    const term = live.get(ptyId);
    if (!term) throw new Error('unknown pty');
    return term;
  };

  return {
    spawn({ shell, args, cwd, cols, rows, env }) {
      const ptyId = randomUUID() as PtyId;
      const term = pty.spawn(shell ?? (process.env.SHELL || '/bin/zsh'), args ?? [], {
        name: 'xterm-256color',
        cwd,
        cols,
        rows,
        env: env ? { ...base, ...env } : base,
      });
      live.set(ptyId, term);
      term.onData((data) => emit('pty.data', { ptyId, data }));
      term.onExit(({ exitCode, signal }) => {
        live.delete(ptyId);
        emit('pty.exit', { ptyId, exitCode, signal: signal || null });
      });
      return { ptyId, pid: term.pid };
    },
    write({ ptyId, data }) {
      get(ptyId).write(data);
    },
    resize({ ptyId, cols, rows }) {
      get(ptyId).resize(cols, rows);
    },
    kill({ ptyId, signal }) {
      get(ptyId).kill(signal);
    },
  };
}
