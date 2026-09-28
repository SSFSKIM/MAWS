// The diagnostics strip's echo test: spawn `/bin/sh` in the PTY host, type one command, and wait for its output line
// to stream back as `pty.data`. The shell is left running on purpose: it belongs to the PTY host, not to the page,
// which is what a reload proves (acceptance item 3). The page forgets the result on reload; the shell does not.
// Since C9 the stream is binary (`pty.data` carries bytes and an offset) and a spawn names the session and tab it
// belongs to: the echo test's shells are the diagnostics strip's, each under a label of its own.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';

export const DIAGNOSTICS_SESSION = 'diagnostics' as AppSessionId;
let runs = 0;

export const ECHO_MARKER = 'MAWS_ECHO_OK';
// The shell assembles the marker from two pieces, so the terminal's echo of the typed line never contains it and only
// the command's own output can.
export const ECHO_COMMAND = "printf 'MAWS_ECHO_%s\\n' OK\r";
export const ECHO_TIMEOUT_MS = 5_000;

export type EchoState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; line: string; pid: number }
  | { status: 'failed'; error: string; pid?: number };

export interface EchoStore {
  echo: EchoState;
  run(): Promise<void>;
}

export function createEchoStore(client: MawsBridge) {
  return create<EchoStore>()((set) => ({
    echo: { status: 'idle' },
    async run() {
      set({ echo: { status: 'running' } });
      let ptyId: string | null = null;
      let pid: number | undefined;
      // Until the spawn answers, output of any pty may be ours; each pty's bytes go through a streaming decoder of its
      // own, so a character split across two chunks decodes whole.
      const output = new Map<string, { decoder: TextDecoder; text: string }>();
      let settle!: (result: EchoState) => void;
      const settled = new Promise<EchoState>((resolve) => (settle = resolve));

      const check = () => {
        if (ptyId === null || pid === undefined) return;
        const line = (output.get(ptyId)?.text ?? '').split(/\r?\n/).find((l) => l.includes(ECHO_MARKER));
        if (line !== undefined) settle({ status: 'ok', line: line.trim(), pid });
      };
      const offData = client.on('pty.data', (event) => {
        if (ptyId !== null && event.ptyId !== ptyId) return;
        let stream = output.get(event.ptyId);
        if (!stream) output.set(event.ptyId, (stream = { decoder: new TextDecoder(), text: '' }));
        stream.text += stream.decoder.decode(event.data, { stream: true });
        check();
      });
      const offExit = client.on('pty.exit', (event) => {
        if (event.ptyId === ptyId) settle({ status: 'failed', error: `the shell exited (code ${event.exitCode}) before answering`, pid });
      });
      let timer: ReturnType<typeof setTimeout> | undefined;

      const spawned = await client.invoke('pty.spawn', {
        appSessionId: DIAGNOSTICS_SESSION,
        label: `echo-${Date.now().toString(36)}-${++runs}`,
        shell: '/bin/sh',
        args: [], // a plain /bin/sh, as C1's smoke expects: not the login shell the host starts by default
        cwd: '/',
        cols: 80,
        rows: 24,
      });
      if (!spawned.ok) {
        settle({ status: 'failed', error: spawned.error.message });
      } else {
        ({ ptyId, pid } = spawned.value);
        check();
        const written = await client.invoke('pty.write', { ptyId: spawned.value.ptyId, data: ECHO_COMMAND });
        if (!written.ok) settle({ status: 'failed', error: written.error.message, pid });
        timer = setTimeout(
          () => settle({ status: 'failed', error: `the shell did not answer within ${ECHO_TIMEOUT_MS / 1000} s`, pid }),
          ECHO_TIMEOUT_MS,
        );
      }

      const result = await settled;
      clearTimeout(timer);
      offData();
      offExit();
      set({ echo: result });
    },
  }));
}

export const useEcho = createEchoStore(ipc);
