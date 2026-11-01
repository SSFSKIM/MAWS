// X2 `pty.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/pty.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'pty.hostState', 'pty.ping', 'pty.spawn', 'pty.write', 'pty.resize', 'pty.kill', 'pty.ack', 'pty.checkpoint',
  'pty.attach', 'pty.list', 'pty.foreground', 'pty.openLink',
  'pty.listFor', // P5 O7 M3: a remote session's terminals (main's adapter makes it an act)
] as const;

export const events = [
  'pty.hostState', 'pty.data', 'pty.exit',
] as const;

// P5 O2 M4: only main (and `mawsd`, M5) asks the pty host to capture the login shell again; the renderer never does.
// P5 O7 M3: the pty host's ledger and the ring's read, the endpoint's in `mawsd`, never a window's.
export const mainOnlyCommands = ['pty.recaptureEnv', 'pty.op', 'pty.opQuery', 'pty.replay'] as const;
