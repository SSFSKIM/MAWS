// How the local machine's ref reaches an app page synchronously (P5 O6 M2, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md,
// "The local ref reaches the page synchronously"): main passes it in every app window's `webPreferences.additionalArguments`,
// and the preload reads it from `process.argv` and exposes it as `window.maws.localMachine`. Zod-free: the sandboxed
// preload bundles this module.
import type { MachineRef } from './ref';

const SWITCH = '--maws-local-machine=';

export const localMachineArgument = (ref: MachineRef): string => `${SWITCH}${ref}`;

// The ref main passed, unchecked here (main's router validates every machine it is sent); throws when a window was opened
// without it, which is main's programming error.
export function localMachineFromArgv(argv: readonly string[]): MachineRef {
  const arg = argv.find((entry) => entry.startsWith(SWITCH));
  if (arg === undefined || arg.length === SWITCH.length) throw new Error(`the window was opened without ${SWITCH}<ref>`);
  return arg.slice(SWITCH.length) as MachineRef;
}
