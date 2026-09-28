// The PTY host's terminals over node-pty (charter §12 C1 *node-pty native module*): each pty is keyed by a random
// `PtyId`, streams `pty.data` and ends with one `pty.exit`, after which its id is forgotten. An id this table does not
// hold fails with `unknown pty` (the runtime answers it as `internal`). C9 extends this into real terminals.
import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import type { HostEmit } from '@shared/host/runtime';
import type { CommandInput, CommandOutput, PtyId } from '@shared/ipc/schema';

export interface Ptys {
  spawn(input: CommandInput<'pty.spawn'>): CommandOutput<'pty.spawn'>;
  write(input: CommandInput<'pty.write'>): void;
  resize(input: CommandInput<'pty.resize'>): void;
  kill(input: CommandInput<'pty.kill'>): void;
}

export function createPtys(emit: HostEmit): Ptys {
  const live = new Map<string, pty.IPty>();

  const get = (ptyId: string) => {
    const term = live.get(ptyId);
    if (!term) throw new Error('unknown pty');
    return term;
  };

  return {
    spawn({ shell, args, cwd, cols, rows, env }) {
      const ptyId = randomUUID() as PtyId;
      // The host's own environment for now, the caller's entries over it. The allowlisted launch environment is X6
      // (C3's); C9 aligns terminals to it. Passing `process.env` itself lets node-pty drop the variables that
      // belong to the host's own terminal (TMUX, COLUMNS, …).
      const term = pty.spawn(shell ?? (process.env.SHELL || '/bin/zsh'), args ?? [], {
        name: 'xterm-256color',
        cwd,
        cols,
        rows,
        env: env ? { ...process.env, ...env } : process.env,
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
