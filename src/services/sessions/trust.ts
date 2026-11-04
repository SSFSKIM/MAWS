// The trust reader (C10 execution document, Interfaces "Trust"): which global config file the engine reads, the trust
// key a directory's trust is recorded under, and whether the pinned engine running headless would find that key
// trusted. It mirrors the engine's `Xf()` exactly: `projects[<trustKey>].hasTrustDialogAccepted === true`, no ancestor
// walk and no second entry (an older engine's per-worktree record is ignored, as the engine ignores it; M1's
// `trust-exact-key` probe recorded that an accepted "/" does not satisfy the headless gate). Read on demand, never
// watched, never written: trust is recorded only by the engine on an attested launch.
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { SetupReadRefused } from '@shared/machine/git-reads';
import { normalizePath, type TrustState } from '@shared/sessions/trust';
import { NotARepositoryError, type GitRun } from '../git/runner';

export type TrustEntries = Record<string, { hasTrustDialogAccepted?: boolean }>;

const TORN_READ_RETRY_MS = 50;

function homeOf(env: NodeJS.ProcessEnv): string {
  return env.HOME || homedir();
}

// The engine's `Lo()` (SPEC §3 16.1): the legacy `<configHome>/.config.json` wins outright when it exists, where the
// config home is CLAUDE_CONFIG_DIR or `~/.claude`; otherwise `${CLAUDE_CONFIG_DIR || homedir}/.claude<suffix>.json`.
// The suffix is the OAuth environment's (`w3()`, cli.pretty.js 525522-525533): 2.1.283 compiles its environment
// switch to the constant "prod", so `-staging-oauth` and `-local-oauth` are unreachable and only
// CLAUDE_CODE_CUSTOM_OAUTH_URL selects one, `-custom-oauth`.
export function configFilePath(env: NodeJS.ProcessEnv, exists: (path: string) => boolean = existsSync): string {
  const home = homeOf(env);
  const legacy = legacyConfigPath(env);
  if (exists(legacy)) return legacy;
  const suffix = env.CLAUDE_CODE_CUSTOM_OAUTH_URL ? '-custom-oauth' : '';
  return join(env.CLAUDE_CONFIG_DIR || home, `.claude${suffix}.json`);
}

function legacyConfigPath(env: NodeJS.ProcessEnv): string {
  return join(env.CLAUDE_CONFIG_DIR || join(homeOf(env), '.claude'), '.config.json');
}

async function realOrSelf(path: string): Promise<{ path: string; exists: boolean }> {
  try {
    return { path: normalizePath(await realpath(path)), exists: true };
  } catch {
    return { path: normalizePath(path), exists: false };
  }
}

// The repository a directory is in, as `git rev-parse --show-toplevel --git-common-dir --git-dir` answers it: null
// when it is in none; throws where git fails otherwise (a bare repository has no toplevel).
export type RepoDirs = (directory: string) => Promise<{ toplevel: string; commonDir: string; gitDir: string } | null>;

export const revParsed =
  (git: GitRun): RepoDirs =>
  async (directory) => {
    let out: string;
    try {
      out = await git(directory, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir', '--git-dir']);
    } catch (error) {
      if (error instanceof NotARepositoryError) return null;
      throw error;
    }
    const [toplevel, commonDir, gitDir] = out.split('\n').map((line) => line.trim());
    if (!toplevel || !commonDir || !gitDir) throw new Error(`git rev-parse answered no toplevel, common dir and git dir for ${directory}`);
    return { toplevel, commonDir, gitDir };
  };

// The trust key (SPEC §3 15.1-15.4): the main worktree's root when the directory is inside a repository (linked
// worktrees share it), else the directory's own NFC realpath. A missing directory answers its own spelling, never
// throws; any other git failure does, because a wrong key would ask about, and attest, the wrong directory. `repoOf`
// is git's answer by default; a remote setup's trust read, before trust, reads git's files instead (P5 O7 M9 round 2,
// src/services/machine/setup.ts), the same key for the same folder.
export async function trustKeyOf(directory: string, git: GitRun, repoOf: RepoDirs = revParsed(git)): Promise<{ trustKey: string; keyKind: 'repo' | 'directory'; directory: string }> {
  const resolved = await realOrSelf(directory);
  if (!resolved.exists) return { trustKey: resolved.path, keyKind: 'directory', directory: resolved.path };
  const repo = await repoOf(resolved.path);
  if (repo === null) return { trustKey: resolved.path, keyKind: 'directory', directory: resolved.path };
  const { toplevel, commonDir, gitDir } = repo;
  let root: string;
  if (basename(commonDir) === '.git') root = dirname(commonDir);
  else {
    // A common dir of another name (a separate git dir, a submodule's `.git/modules/<name>`): the checkout that owns it
    // keys itself; a linked worktree of it keys the common dir, unless that holds a `.git` of its own (debt wave 6: the
    // engine's canonical root, 2.1.283 `Qt`, cli.pretty.js 23840-23884).
    const [common, own] = await Promise.all([realOrSelf(commonDir), realOrSelf(gitDir)]);
    root = common.path === own.path || existsSync(join(commonDir, '.git')) ? toplevel : commonDir;
  }
  return { trustKey: (await realOrSelf(root)).path, keyKind: 'repo', directory: resolved.path };
}

// The `projects` map of the global config; {} when the file is missing. The engine rewrites the file whole, so a read
// that does not parse is retried once after 50 ms before it answers {} with a warning (nothing trusted, the card asks).
export async function readTrustStore(
  path: string,
  opts: { read?: (path: string) => Promise<string>; delayMs?: number; warn?: (message: string) => void } = {},
): Promise<TrustEntries> {
  const read = opts.read ?? ((p: string) => readFile(p, 'utf8'));
  const warn = opts.warn ?? ((message: string) => console.warn(`[sessions trust] ${message}`));
  for (let attempt = 1; ; attempt += 1) {
    let text: string;
    try {
      text = await read(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const projects = (parsed as { projects?: unknown }).projects;
      return projects !== null && typeof projects === 'object' && !Array.isArray(projects) ? (projects as TrustEntries) : {};
    } catch (error) {
      if (attempt >= 2) {
        warn(`${path} did not parse twice (${error instanceof Error ? error.message : String(error)}); reading no trust`);
        return {};
      }
      await new Promise((resolve) => setTimeout(resolve, opts.delayMs ?? TORN_READ_RETRY_MS));
    }
  }
}

export interface TrustDeps {
  git: GitRun;
  env: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
  // P5 O7 M9: a remote setup's guarded read (src/services/machine/setup.ts): asked before each file of what trust would
  // load is read, its link followed only where it may be; a file it refuses fails the read rather than being skipped
  guard?: (path: string) => Promise<boolean>;
  // P5 O7 M9 round 2: the same run's repository, read from git's files rather than by git (`trustKeyOf`'s `repoOf`)
  repo?: RepoDirs;
}

// E11 (tracker row E6 "small per-call costs in scm.*"): the key and whether the store trusts it, reading nothing of what
// trust would load: what scm's gate and status need, on every command.
export type TrustedKey = Pick<TrustState, 'directory' | 'trustKey' | 'keyKind' | 'configPath' | 'trusted'>;

export async function trustedKeyOf(directory: string, deps: TrustDeps): Promise<TrustedKey> {
  const key = await trustKeyOf(directory, deps.git, deps.repo);
  // P5 O7 M9 round 3: under a remote setup's guard the store is a file of what is read too: the legacy file looked for,
  // then the store, each through the guard first
  if (deps.guard !== undefined) await guarded(legacyConfigPath(deps.env), deps.guard);
  const configPath = configFilePath(deps.env);
  if (deps.guard !== undefined) await guarded(configPath, deps.guard);
  const projects = await readTrustStore(configPath, { warn: deps.warn });
  return { ...key, configPath, trusted: projects[key.trustKey]?.hasTrustDialogAccepted === true };
}

export async function trustStateOf(directory: string, deps: TrustDeps): Promise<TrustState> {
  const key = await trustedKeyOf(directory, deps);
  const home = (await realOrSelf(homeOf(deps.env))).path;
  return {
    directory: key.directory,
    trustKey: key.trustKey,
    keyKind: key.keyKind,
    configPath: key.configPath,
    trusted: key.trusted,
    source: key.trusted ? 'trustKey' : null,
    isHome: key.directory === home,
    found: await gatedFiles(key.directory, deps.guard),
  };
}

// ---- what trust would load (SPEC §3 15.5), read from the directory itself --------------------------------------------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

async function readJsonAt(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null; // missing or unreadable: the engine loads nothing from it either
  }
}

function settingsSummary(settings: Record<string, unknown>): string {
  const parts: string[] = [];
  const permissions = isObject(settings.permissions) ? settings.permissions : {};
  const allow = Array.isArray(permissions.allow) ? permissions.allow.length : 0;
  const dirs = Array.isArray(permissions.additionalDirectories) ? permissions.additionalDirectories.length : 0;
  const hooks = isObject(settings.hooks)
    ? Object.values(settings.hooks).reduce<number>((n, matchers) => n + (Array.isArray(matchers) ? matchers.reduce<number>((m, entry) => m + (isObject(entry) && Array.isArray(entry.hooks) ? entry.hooks.length : 0), 0) : 0), 0)
    : 0;
  const env = isObject(settings.env) ? Object.keys(settings.env).length : 0;
  const marketplaces = isObject(settings.extraKnownMarketplaces) ? Object.keys(settings.extraKnownMarketplaces).length : 0;
  const plugins = isObject(settings.enabledPlugins) ? Object.values(settings.enabledPlugins).filter((enabled) => enabled === true).length : 0;
  if (allow > 0) parts.push(plural(allow, 'allow rule', 'allow rules'));
  if (dirs > 0) parts.push(plural(dirs, 'additional directory', 'additional directories'));
  if (hooks > 0) parts.push(plural(hooks, 'hook', 'hooks'));
  if (env > 0) parts.push(plural(env, 'env key', 'env keys'));
  if (marketplaces > 0) parts.push(plural(marketplaces, 'marketplace', 'marketplaces'));
  if (plugins > 0) parts.push(plural(plugins, 'plugin', 'plugins'));
  return parts.join(', ');
}

async function guarded(path: string, guard: NonNullable<TrustDeps['guard']>): Promise<void> {
  if (!(await guard(path))) throw new SetupReadRefused('protected', path); // the setup's handler answers it as its refusal
}

async function gatedFiles(directory: string, guard?: TrustDeps['guard']): Promise<TrustState['found']> {
  const readJson = async (path: string) => {
    if (guard !== undefined) await guarded(path, guard);
    return readJsonAt(path);
  };
  const found: TrustState['found'] = [];
  for (const file of ['.claude/settings.json', '.claude/settings.local.json']) {
    const settings = await readJson(join(directory, file));
    const summary = settings ? settingsSummary(settings) : '';
    if (summary) found.push({ file, summary });
  }
  const mcp = await readJson(join(directory, '.mcp.json'));
  const servers = mcp && isObject(mcp.mcpServers) ? Object.keys(mcp.mcpServers) : [];
  if (servers.length > 0) found.push({ file: '.mcp.json', summary: `${plural(servers.length, 'MCP server', 'MCP servers')}: ${servers.join(', ')}` });
  return found;
}
