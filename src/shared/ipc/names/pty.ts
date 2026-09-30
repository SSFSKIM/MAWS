// X2 `pty.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/pty.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'pty.hostState', 'pty.ping', 'pty.spawn', 'pty.write', 'pty.resize', 'pty.kill', 'pty.ack', 'pty.checkpoint',
  'pty.attach', 'pty.list', 'pty.foreground', 'pty.openLink',
] as const;

export const events = [
  'pty.hostState', 'pty.data', 'pty.exit',
] as const;
