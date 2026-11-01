// What the two unit managers share (P5 O2 M6; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M6 "The units" and
// Interfaces "The LaunchAgent", "The systemd user unit"): the unit's spec, the command runner every `launchctl`,
// `systemctl` and `loginctl` call goes through (injected, so a test drives fakes and never the machine's own), and the
// operations install.ts and the command line ask of either manager.
import * as fs from 'node:fs';

export const DEFAULT_LABEL = 'dev.maws.mawsd'; // the default profile's; every other profile, and every test, passes its own

// The program a unit runs: a Node runtime (on a Mac the app binary, run as Node) and `mawsd.js`.
export interface UnitProgram {
  runtime: string;
  entry: string;
}

export interface UnitSpec {
  label: string; // the launchd label; systemd's unit name derives from it (systemd.ts)
  profileDir: string; // MAWS_USER_DATA; the daemon's directory is <profile>/mawsd
  program: UnitProgram;
}

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
export type CommandRunner = (command: string, args: readonly string[], options?: { timeoutMs?: number }) => CommandResult; // P5 O5 M6: a longer timeout for render install's unzip

export interface UnitDeps {
  run: CommandRunner;
  home: string;
  env: NodeJS.ProcessEnv;
  uid: number;
  user: string;
  sleep(ms: number): Promise<void>;
}

export interface UnitState {
  installed: boolean; // the unit file exists
  loaded: boolean; // launchd: the job is in the user's domain; systemd: the unit is enabled
}

// What `apply` did: nothing, a first load, or a rewrite of a changed file (the daemon restarted on it).
export type UnitChange = 'unchanged' | 'loaded' | 'updated';

export interface Unit {
  readonly label: string;
  readonly name: string; // what the manager calls it: the label (launchd), `<unit>.service` (systemd)
  readonly file: string;
  render(spec: UnitSpec): string;
  state(): UnitState;
  // Writes the file when its content changed, loads the unit when it is not loaded, and restarts the daemon when a
  // loaded unit's content changed. Idempotent: a second call with the same text changes nothing.
  apply(text: string): Promise<UnitChange>;
  // Unloads the unit (which ends `mawsd`, whose hosts keep running) and removes its file; false when nothing was there.
  remove(): Promise<boolean>;
  restart(): void;
  start(): void; // P5 O2 M7: starts a loaded unit that is not running (the app's unit start strategy); kills nothing
}

// A unit operation that failed: `code` 2 when the manager is not available here, else 1.
export class UnitError extends Error {
  constructor(
    message: string,
    readonly code: 1 | 2 = 1,
  ) {
    super(message);
    this.name = 'UnitError';
  }
}

// Runs a command that must succeed, or throws naming it and what it said.
export function must(run: CommandRunner, command: string, args: readonly string[]): CommandResult {
  const result = run(command, args);
  if (result.status !== 0) throw new UnitError(`${[command, ...args].join(' ')} failed (${result.status ?? 'signal'}): ${(result.stderr || result.stdout).trim()}`);
  return result;
}

// The file's content, or null when it does not exist.
export function readIfPresent(path: string): string | null {
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : null;
}

// Written whole beside itself, then renamed into place, so the manager never reads half a file.
export function writeWhole(path: string, text: string, mode = 0o644): void {
  const temporary = `${path}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode });
  fs.renameSync(temporary, path);
}

// A file put back as it was before a transition that failed (`before` null: it was not there), so the next apply sees
// the change again and completes it, instead of reading matching text as nothing to do.
export function restoreFile(path: string, before: string | null): void {
  if (before === null) fs.rmSync(path, { force: true });
  else writeWhole(path, before);
}

// A bounded wait for `done`, polled every `everyMs`; false when the budget ran out.
export async function within(budgetMs: number, everyMs: number, sleep: UnitDeps['sleep'], done: () => boolean): Promise<boolean> {
  for (let waited = 0; ; waited += everyMs) {
    if (done()) return true;
    if (waited >= budgetMs) return false;
    await sleep(everyMs);
  }
}
