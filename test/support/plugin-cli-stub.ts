// The plugin CLI stub's typed handle (E8 execution document, M3 and D-10): `writePluginCliStub` copies the stub
// (`plugin-cli-script.js`) into a launch's userData with its starting state and a shell wrapper that runs it under this
// Node, and answers the wrapper's path for MAWS_E2E_ENGINE_BIN, so the engine host's runner spawns it as the engine
// binary with no seam in product code. The e2e reads `calls.log` (every argv, one JSON array per line) to compare with
// the argument list the confirm sheet showed, edits the state to bump a version or fail on demand, and holds a mutation
// while it watches the row. `scratchMarketplace` writes a folder marketplace in G0's layout. P2-B (M2): the rows carry
// the times, `projectEnabled`, the entry's source and the install counts the engine's catalog has; the stub writes each
// installation's plugin tree and each cloned marketplace's catalogue where the engine keeps them (inside the launch's
// CLAUDE_CONFIG_DIR only); `ownerShapedState` is a registry shaped like the owner's (29 plugins, 130 installations).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FIXTURE_ENGINE_VERSION } from './engine-pin';

export interface StubPlugin {
  name: string;
  version: string | null;
  description: string | null;
  dependencies?: string[]; // plugins an install brings with it: a name in the same marketplace, or `name@marketplace`
  // P2-B start (2026-10-09)
  source?: string | Record<string, unknown>; // the marketplace entry's source; `./plugins/<name>` when absent
  installCount?: number; // listed only when the marketplace `countsInstalls`
  author?: string;
  manifest?: false; // no plugin.json: the entry is the manifest (`strict: false`), its tree a licence and a readme
  lspServers?: Record<string, Record<string, unknown>>;
  // P2-B end
}

export type StubMarketplace = { name: string; plugins: StubPlugin[]; countsInstalls?: boolean /* P2-B */ } & ({ source: 'directory'; path: string } | { source: 'github'; repo: string; ref?: string /* P2-B */ } | { source: 'git' | 'url'; url: string; ref?: string /* P2-B: git only */ });

export interface StubInstallation {
  id: string;
  version: string | null;
  scope: 'user' | 'project' | 'local';
  enabled: boolean;
  projectPath: string | null;
  installedAt?: string; // P2-B: ISO times, as the engine records them
  lastUpdated?: string;
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
  directory?: StubPlugin[]; // P2-B (M5): the engine's built-in directory, listed by `--available` only (each `source` an object)
  installed: StubInstallation[];
  fail: Partial<Record<string, StubFailure>>;
}

export interface StubRun {
  stdout: string;
  stderr: string;
  code: number;
  state: StubState;
}

interface StubCtx {
  cwd: string;
  configHome: string;
  now?: string; // P2-B: the time an install or update records; the clock's when absent
}

const stub = createRequire(__filename)('./plugin-cli-script.js') as {
  run(argv: string[], state: StubState, ctx: StubCtx): StubRun;
  pluginTree(plugin: StubPlugin, version: string | null): Record<string, string>; // P2-B
  writeTree(root: string, files: Record<string, string>): void; // P2-B
  materialise(state: StubState, ctx: StubCtx, env: Record<string, string | undefined>): void; // P2-B
};

// One CLI run over a state, without a process (the unit tests' entry).
export const runPluginCli = (argv: string[], state: StubState, ctx: StubCtx): StubRun => stub.run(argv, state, ctx);
// P2-B: what the process half writes after a run, for the unit tests (inside `env.CLAUDE_CONFIG_DIR` only)
export const materialisePluginCli = (state: StubState, ctx: StubCtx, env: Record<string, string | undefined>): void => stub.materialise(state, ctx, env);

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
// its own `plugin.json` and, P2-B, the components of the stub's plugin tree); answers the folder.
export function scratchMarketplace(path: string, manifest: { name: string; plugins: StubPlugin[] }): string {
  mkdirSync(join(path, '.claude-plugin'), { recursive: true });
  for (const plugin of manifest.plugins) {
    stub.writeTree(join(path, 'plugins', plugin.name), stub.pluginTree(plugin, plugin.version));
    writeFileSync(join(path, 'plugins', plugin.name, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: plugin.name, version: plugin.version, description: plugin.description }, null, 2));
  }
  const entries = manifest.plugins.map((p) => ({ name: p.name, source: `./plugins/${p.name}`, description: p.description }));
  writeFileSync(join(path, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: manifest.name, owner: { name: 'E8 stub' }, plugins: entries }, null, 2));
  return path;
}

// P2-B start (2026-10-09): a registry shaped like the owner's (U3 Method 1: 29 plugin ids, 130 installation records, 71
// project, 46 local and 13 user, over 50 projects; 10 records reading "unknown"; doperpowers with 47 records and supabase
// with 46; four LSP plugins of claude-plugins-official with no plugin.json, whose `strict: false` entries carry their
// language servers). `project` is the session's directory: doperpowers is installed there and in 45 worktrees beneath it;
// supabase only in those worktrees and one other project, so from `project` it is installed for other projects only;
// `elsewhere` holds four more projects. Dates count back from `now`.
export function ownerShapedState(project: string, elsewhere: string, now: Date = new Date()): StubState {
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const worktrees = Array.from({ length: 45 }, (_, i) => join(project, '.claude', 'worktrees', `w${i + 1}`));
  const [e1, e2, e3, e4] = [1, 2, 3, 4].map((i) => join(elsewhere, `e${i}`));
  const lsp = (name: string, server: string, command: string, ext: string): StubPlugin => ({ name, version: '1.0.0', description: `${server} language server`, author: 'Anthropic', manifest: false, lspServers: { [server]: { command, extensionToLanguage: { [ext]: server } } } });
  const official: StubPlugin[] = [
    { name: 'agent-sdk-dev', version: null, description: 'Build agents with the Agent SDK', author: 'Anthropic', installCount: 50_210 },
    { name: 'chrome-devtools-mcp', version: '1.9.0', description: 'Drive Chrome DevTools from Claude', author: 'Google', installCount: 120_400 },
    { name: 'claude-code-setup', version: '1.0.0', description: 'Set up Claude Code in a repository', author: 'Anthropic', installCount: 88_000 },
    { name: 'claude-md-management', version: '1.0.0', description: 'Keep CLAUDE.md files in order', author: 'Anthropic', installCount: 64_500 },
    { name: 'cloud-sql-postgresql', version: '0.4.0', description: 'Cloud SQL for PostgreSQL', author: 'Google', installCount: 12_100 },
    { name: 'code-modernization', version: '1.0.0', description: 'Modernise legacy code', author: 'Anthropic', installCount: 9_870 },
    { name: 'code-review', version: null, description: 'Automated code review for pull requests', author: 'Anthropic', installCount: 492_072 },
    { name: 'code-simplifier', version: '1.0.0', description: 'Simplify code without changing behaviour', author: 'Anthropic', installCount: 301_000 },
    { name: 'commit-commands', version: null, description: 'Commit, push and open pull requests', author: 'Anthropic', installCount: 210_000 },
    { name: 'context7', version: null, description: 'Up-to-date library documentation', author: 'Upstash', installCount: 458_090 },
    { name: 'explanatory-output-style', version: '1.0.0', description: 'Explains its choices as it works', author: 'Anthropic', installCount: 77_000 },
    { name: 'feature-dev', version: null, description: 'A guided feature development workflow', author: 'Anthropic', installCount: 260_000 },
    { name: 'frontend-design', version: null, description: 'Distinctive, production-grade frontend interfaces', author: 'Anthropic', installCount: 1_290_640 },
    { name: 'linear', version: null, description: 'Linear issues from Claude', author: 'Linear', installCount: 45_000 },
    { name: 'playground', version: null, description: 'Interactive HTML playgrounds', author: 'Anthropic', installCount: 33_000 },
    { name: 'plugin-dev', version: '0120fb83da5d', description: 'Build Claude Code plugins', author: 'Anthropic', installCount: 98_000 },
    lsp('pyright-lsp', 'python', 'pyright-langserver', '.py'),
    lsp('rust-analyzer-lsp', 'rust', 'rust-analyzer', '.rs'),
    { name: 'security-guidance', version: '2.0.11', description: 'Security reminders while editing', author: 'Anthropic', installCount: 150_000 },
    { name: 'skill-creator', version: '0120fb83da5d', description: 'Create and improve skills', author: 'Anthropic', installCount: 440_508 },
    { name: 'supabase', version: '0.1.15', description: 'Supabase MCP integration', author: 'Supabase', installCount: 140_000 },
    lsp('swift-lsp', 'swift', 'sourcekit-lsp', '.swift'),
    { name: 'telegram', version: '0.0.7', description: 'Telegram as a channel', author: 'Anthropic', installCount: 21_000 },
    lsp('typescript-lsp', 'typescript', 'typescript-language-server', '.ts'),
  ];
  const marketplaces: StubMarketplace[] = [
    { name: 'claude-plugins-official', source: 'github', repo: 'anthropics/claude-plugins-official', countsInstalls: true, plugins: official },
    { name: 'claude-community', source: 'github', repo: 'anthropics/claude-plugins-community', plugins: [{ name: 'eli5', version: '1.0.0', description: 'Explain like I am five', author: 'Community' }] },
    { name: 'doperpowers', source: 'github', repo: 'owner/doperpowers', plugins: [{ name: 'doperpowers', version: '7.66.0', description: 'Specs, plans and review loops', author: 'Owner' }] },
    { name: 'ptc-tool', source: 'github', repo: 'owner/ptc-tool', plugins: [{ name: 'ptc', version: '0.5.3', description: 'A persistent IPython kernel', author: 'Owner' }] },
    { name: 'designer', source: 'github', repo: 'owner/designer', plugins: [{ name: 'designer', version: '2.6.0', description: 'Design work', author: 'Owner' }] },
    { name: 'cua', source: 'github', repo: 'owner/cua', plugins: [{ name: 'cua', version: '0.5.0', description: 'Computer use', author: 'Owner' }] },
  ];
  const at = (id: string, version: string | null, scope: StubInstallation['scope'], projectPath: string | null, days: number, enabled = true): StubInstallation => ({ id, version, scope, enabled, projectPath, installedAt: daysAgo(days + 30), lastUpdated: daysAgo(days) });
  const o = (name: string) => `${name}@claude-plugins-official`;
  const installed: StubInstallation[] = [
    at(o('agent-sdk-dev'), 'unknown', 'project', e1, 40),
    at(o('chrome-devtools-mcp'), '1.9.0', 'user', null, 2),
    at(o('claude-code-setup'), '1.0.0', 'project', project, 9),
    at(o('claude-md-management'), '1.0.0', 'project', project, 20),
    at(o('claude-md-management'), '1.0.0', 'project', e2, 21),
    at(o('cloud-sql-postgresql'), '0.4.0', 'project', e3, 60),
    at(o('code-modernization'), '1.0.0', 'user', null, 13),
    at(o('code-review'), 'unknown', 'project', project, 3),
    at(o('code-simplifier'), '1.0.0', 'project', e1, 15),
    at(o('code-simplifier'), '1.0.0', 'project', e4, 16),
    at(o('commit-commands'), 'unknown', 'project', e2, 50),
    at(o('context7'), 'unknown', 'project', project, 30, false),
    at(o('explanatory-output-style'), '1.0.0', 'project', e1, 70),
    at(o('explanatory-output-style'), '1.0.0', 'project', e2, 71),
    at(o('feature-dev'), 'unknown', 'project', project, 1),
    at(o('frontend-design'), 'unknown', 'project', project, 5),
    at(o('linear'), 'unknown', 'project', e4, 80),
    at(o('playground'), 'unknown', 'project', e3, 90),
    at(o('plugin-dev'), 'unknown', 'project', project, 100),
    at(o('plugin-dev'), '0120fb83da5d', 'project', e1, 10),
    at(o('pyright-lsp'), '1.0.0', 'user', null, 45),
    at(o('rust-analyzer-lsp'), '1.0.0', 'user', null, 46),
    at(o('rust-analyzer-lsp'), '1.0.0', 'project', e2, 47),
    at(o('security-guidance'), '2.0.11', 'user', null, 4),
    at(o('security-guidance'), '2.0.7', 'project', project, 25),
    at(o('security-guidance'), '2.0.6', 'project', e3, 26),
    at(o('skill-creator'), 'unknown', 'project', e1, 110),
    at(o('skill-creator'), '0120fb83da5d', 'project', e4, 11),
    at(o('swift-lsp'), '1.0.0', 'user', null, 48),
    at(o('telegram'), '0.0.7', 'user', null, 6),
    at(o('typescript-lsp'), '1.0.0', 'user', null, 49),
    at(o('typescript-lsp'), '1.0.0', 'project', project, 49),
    at(o('typescript-lsp'), '1.0.0', 'project', e2, 49),
    at('cua@cua', '0.5.0', 'user', null, 12),
    at('designer@designer', '2.6.0', 'user', null, 8),
    at('eli5@claude-community', '1.0.0', 'user', null, 200),
    at('ptc@ptc-tool', '0.5.3', 'user', null, 7),
    at('doperpowers@doperpowers', '7.66.0', 'user', null, 0),
    at('doperpowers@doperpowers', '7.66.0', 'project', project, 0),
    ...worktrees.map((path, i) => at('doperpowers@doperpowers', i % 2 === 0 ? '7.65.0' : '7.52.2', 'project', path, 3 + i)),
    ...[...worktrees, e1].map((path, i) => at(o('supabase'), i % 3 === 0 ? '0.1.14' : '0.1.15', 'local', path, 5 + i)),
  ];
  return { marketplaces, installed, fail: {} };
}
// P2-B end
