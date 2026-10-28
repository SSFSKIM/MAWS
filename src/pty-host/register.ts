// The pty host's handlers, over one pty table, for both modes (`index.ts` runs them as a utility process or in socket
// mode). The login-shell environment is captured once, at the register, without blocking the handshake; the first spawn
// waits for it.
//
// P5 O2 M4 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M8's login-shell capture): `pty.recaptureEnv` (main-only)
// starts a fresh capture, which the table uses for the spawns after it resolves; a spawn already waiting keeps the
// environment it awaited. A socket-mode pty host outlives every app, so `mawsd` sends it at each app welcome on
// `pty-host.sock`; a utility host is new at every launch and is never sent it.
import { hostPing, type HostRegister } from '@shared/host/runtime';
import { captureShellEnvironment, invalidateShellEnvironment } from '@shared/host/shell-env';
import { baseEnvironment, terminalEnvironment } from './env';
import { createPtyTable, type PtyTable } from './table';

export interface PtyHostRegisterOptions {
  hostVersion: string;
  capture?: () => Promise<Record<string, string>>; // the login-shell capture (shell-env.ts's, cached per process)
  launcher?: NodeJS.ProcessEnv; // the environment the host inherited
}

export interface PtyHostRegister {
  register: HostRegister;
  table(): PtyTable | null; // once the register has run
}

export function ptyHostRegister({ hostVersion, capture = captureShellEnvironment, launcher = process.env }: PtyHostRegisterOptions): PtyHostRegister {
  let table: PtyTable | null = null;
  const environment = () => baseEnvironment(capture).then((base) => terminalEnvironment(base, { appVersion: hostVersion, launcher }));
  const register: HostRegister = (on, emit) => {
    const ptys = createPtyTable({ emit, environment: environment() });
    table = ptys;
    on('pty.ping', async () => hostPing(hostVersion));
    on('pty.spawn', (input) => ptys.spawn(input));
    on('pty.write', async (input) => ptys.write(input));
    on('pty.resize', async (input) => ptys.resize(input));
    on('pty.kill', async (input) => ptys.kill(input));
    on('pty.ack', async (input) => ptys.ack(input));
    on('pty.checkpoint', async (input) => ptys.checkpoint(input));
    on('pty.attach', async (input) => ptys.attach(input));
    on('pty.list', async () => ptys.list());
    on('pty.foreground', (input) => ptys.foreground(input));
    // P5 O2 M4: answered at once; the capture runs (within its own bound) behind it
    on('pty.recaptureEnv', async () => {
      invalidateShellEnvironment(); // the cached capture is the start's; this one is fresh
      ptys.setEnvironment(environment());
    });
  };
  return { register, table: () => table };
}
