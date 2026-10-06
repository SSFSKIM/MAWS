// The plugin CLI stub's typed handle (E8 execution document, M3 and D-10): `writePluginCliStub` copies the stub
// (`plugin-cli-script.js`) into a launch's userData with its starting state and a shell wrapper that runs it under this
// Node, and answers the wrapper's path for MAWS_E2E_ENGINE_BIN, so the engine host's runner spawns it as the engine
// binary with no seam in product code. The e2e reads `calls.log` (every argv, one JSON array per line) to compare with
// the argument list the confirm sheet showed, edits the state to bump a version or fail on demand, and holds a mutation
// while it watches the row. `scratchMarketplace` writes a folder marketplace in G0's layout.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FIXTURE_ENGINE_VERSION } from './engine-pin';

export interface StubPlugin {
  name: string;
  version: string | null;
  description: string | null;
}

export type StubMarketplace = { name: string; plugins: StubPlugin[] } & ({ source: 'directory'; path: string } | { source: 'github'; repo: string } | { source: 'git' | 'url'; url: string });

export interface StubInstallation {
  id: string;
  version: string | null;
  scope: 'user' | 'project' | 'local';
  enabled: boolean;
  projectPath: string | null;
}

// A failure on demand, by action (`install`, `marketplace-add`, …): the engine's result line with these words; one
// carrying `shownCommand` passes once the call names its sha256 through `--accept-command`.
export interface StubFailure {
  failureCode: string;
  message: string;
  shownCommand?: { sha256: string; command: string | string[] };
}

export interface StubState {
  version?: string;
  marketplaces: StubMarketplace[];
  installed: StubInstallation[];
  fail: Partial<Record<string, StubFailure>>;
}

export interface StubRun {
  stdout: string;
  stderr: string;
  code: number;
  state: StubState;
}

const stub = createRequire(__filename)('./plugin-cli-script.js') as { run(argv: string[], state: StubState, ctx: { cwd: string; configHome: string }): StubRun };

// One CLI run over a state, without a process (the unit tests' entry).
export const runPluginCli = (argv: string[], state: StubState, ctx: { cwd: string; configHome: string }): StubRun => stub.run(argv, state, ctx);

export interface PluginCliStub {
  bin: string; // the wrapper: MAWS_E2E_ENGINE_BIN
  dir: string;
  stateFile: string;
  callsLog: string;
  state(): StubState;
  setState(next: StubState): void;
  hold(on: boolean): void; // while held, a mutation prints one progress line and waits
}

export function writePluginCliStub(userData: string, state: StubState): PluginCliStub {
  const dir = join(userData, 'plugin-cli-stub');
  mkdirSync(dir, { recursive: true });
  const script = join(dir, 'plugin-cli-script.js');
  copyFileSync(join(__dirname, 'plugin-cli-script.js'), script);
  const stateFile = join(dir, 'state.json');
  const callsLog = join(dir, 'calls.log');
  const setState = (next: StubState) => writeFileSync(stateFile, `${JSON.stringify({ ...next, version: FIXTURE_ENGINE_VERSION }, null, 2)}\n`);
  setState(state);
  const bin = join(dir, 'claude');
  const quote = (path: string) => `'${path.replaceAll("'", `'\\''`)}'`;
  writeFileSync(bin, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`, { mode: 0o755 });
  const holdFile = join(dir, 'hold');
  return {
    bin,
    dir,
    stateFile,
    callsLog,
    state: () => JSON.parse(readFileSync(stateFile, 'utf8')) as StubState,
    setState,
    hold: (on) => (on ? writeFileSync(holdFile, '') : rmSync(holdFile, { force: true })),
  };
}

// Every argv the stub was run with, in order.
export const stubCalls = (s: Pick<PluginCliStub, 'callsLog'>): string[][] =>
  existsSync(s.callsLog)
    ? readFileSync(s.callsLog, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[])
    : [];

// A folder marketplace in the layout of G0's (`.claude-plugin/marketplace.json`, each plugin under `plugins/<name>` with
// its own `plugin.json`); answers the folder.
export function scratchMarketplace(path: string, manifest: { name: string; plugins: StubPlugin[] }): string {
  mkdirSync(join(path, '.claude-plugin'), { recursive: true });
  for (const plugin of manifest.plugins) {
    mkdirSync(join(path, 'plugins', plugin.name, '.claude-plugin'), { recursive: true });
    writeFileSync(join(path, 'plugins', plugin.name, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: plugin.name, version: plugin.version, description: plugin.description }, null, 2));
  }
  const entries = manifest.plugins.map((p) => ({ name: p.name, source: `./plugins/${p.name}`, description: p.description }));
  writeFileSync(join(path, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: manifest.name, owner: { name: 'E8 stub' }, plugins: entries }, null, 2));
  return path;
}
