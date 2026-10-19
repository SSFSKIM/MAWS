// How long a SessionStart hook may hold `initialize`'s answer (debt wave 5, widened in debt wave 6 and P3-F wave S, L35).
// The engine runs SessionStart hooks before it reads `initialize` and bounds each by 600 s unless the hook sets its own
// `timeout` (seconds; SPEC 27 §5.3), so while a hook it reported started has not reported back the host holds the
// deadline at the largest `timeout` any source the engine reads gives a SessionStart hook, never below 600 s. Hook
// arrays from every source run together (the engine's merge concatenates them), so the largest timeout over the
// sources is the bound. The sources, as the pinned engine resolves them for the plan's environment and working
// directory (read from the 2.1.302 bundle, unchanged since 2.1.283; MAWS launches with `--setting-sources
// user,project,local` and the `--settings` JSON):
// - user: `settings.json` under CLAUDE_CONFIG_DIR, else `~/.claude` (`cowork_settings.json` when
//   CLAUDE_CODE_USE_COWORK_PLUGINS is on, which also moves the plugins to `cowork_plugins`);
// - project: `<cwd>/.claude/settings.json` (the working directory's only: the engine reads no project file at a git root);
// - local: `<cwd>/.claude/settings.local.json`, and the one at the canonical git root above cwd (a linked worktree's
//   main checkout), where the engine keeps the local file when that root differs from cwd;
// - flag: the `--settings` JSON;
// - managed: the machine's `managed-settings.json`, then each `managed-settings.d/*.json` fragment (files or links, no
//   dotfiles) in name order, under `/Library/Application Support/ClaudeCode` (macOS), `/etc/claude-code` (Linux);
//   on macOS the MDM preferences, the user's `/Library/Managed Preferences/<user>/com.anthropic.claudecode.plist` then
//   the machine's `/Library/Managed Preferences/com.anthropic.claudecode.plist`, each converted as the engine converts
//   it (plutil to JSON); and the server-managed settings' copy the engine keeps at `<config>/remote-settings.json`, read
//   without its signature check: the host only waits longer on it;
// - plugins: each plugin the merged `enabledPlugins` turns on (true, or a list of version constraints), at every install
//   record `installed_plugins.json` holds for it: its `hooks/hooks.json` and the hooks its `.claude-plugin/plugin.json`
//   names (a file inside the plugin, or inline).
// A file the engine would refuse (its ownership and signature checks, a higher managed source winning, a plugin install
// it does not vouch for) only makes the hold longer. Not read: a plugin's hooks module (code, no declared timeout),
// plugins the engine finds outside `installed_plugins.json` (built-in, seed directories) or at a relative install
// path, and server-managed settings changed since the engine last cached them; a hook from those runs under 600 s.
import { execFile } from 'node:child_process';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { LaunchPlan } from './launch';

export const SESSION_START_HOOK_MS = 600_000;
// A timer longer than 2^31 - 1 ms fires at once in Node; a configured timeout is held no longer than this.
const MAX_HOLD_MS = 2_147_483_647 - 600_000;

// The engine's managed-settings directory for this platform.
export function managedSettingsDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode';
  return '/etc/claude-code';
}

// The managed-preferences directory the engine reads its MDM plists from: macOS only.
const MANAGED_PREFERENCES_DIR = process.platform === 'darwin' ? '/Library/Managed Preferences' : null;
const MDM_PLIST = 'com.anthropic.claudecode.plist';

// The engine's conversion of a managed preferences plist: plutil to JSON on stdout, no shell, bounded by the engine's
// own 5 s and 2 MiB. Asynchronous, so the host's loop never waits on it.
const run = promisify(execFile);
export async function plutilJson(file: string): Promise<string> {
  return (await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', file], { encoding: 'utf8', timeout: 5_000, maxBuffer: 2 * 1024 * 1024 })).stdout;
}

export interface HookSources {
  managedDir?: string; // the managed-settings directory (the platform's by default)
  managedPreferencesDir?: string | null; // the MDM plists' directory (macOS's by default, none elsewhere)
  convertPlist?: (file: string) => Promise<string>; // a plist as JSON text (plutil by default)
}

export async function sessionStartHookMs(plan: Pick<LaunchPlan, 'env' | 'cwd' | 'flagSettings'>, opts: HookSources = {}): Promise<number> {
  const configDir = plan.env.CLAUDE_CONFIG_DIR || (plan.env.HOME ? join(plan.env.HOME, '.claude') : null);
  const cowork = envOn(plan.env.CLAUDE_CODE_USE_COWORK_PLUGINS);
  const root = await canonicalGitRoot(plan.cwd);
  const localFiles = [...new Set([join(plan.cwd, '.claude', 'settings.local.json'), ...(root === null ? [] : [join(root, '.claude', 'settings.local.json')])])];
  const preferences = await managedPreferences(opts.managedPreferencesDir === undefined ? MANAGED_PREFERENCES_DIR : opts.managedPreferencesDir, opts.convertPlist ?? plutilJson);
  // in the engine's precedence, user < project < local < flag < managed, which decides `enabledPlugins` per plugin (the
  // managed sources last, the one the engine prefers last of all: server-managed, then the MDM plists, then the file)
  const settings = [
    ...(await Promise.all([...(configDir === null ? [] : [join(configDir, cowork ? 'cowork_settings.json' : 'settings.json')]), join(plan.cwd, '.claude', 'settings.json'), ...localFiles].map(readJson))),
    plan.flagSettings,
    ...(await managedSettings(opts.managedDir ?? managedSettingsDir())),
    ...preferences.reverse(),
    ...(configDir === null ? [] : [await readJson(join(configDir, 'remote-settings.json'))]),
  ];
  const plugins = configDir === null ? [] : await pluginHooks(plan.env.CLAUDE_CODE_PLUGIN_CACHE_DIR || join(configDir, cowork ? 'cowork_plugins' : 'plugins'), settings);
  let longest = SESSION_START_HOOK_MS;
  for (const seconds of [...settings, ...plugins].flatMap(sessionStartTimeouts)) longest = Math.max(longest, seconds * 1000);
  return Math.min(longest, MAX_HOLD_MS);
}

// `managed-settings.json`, then the `managed-settings.d` fragments in name order (the engine's walk).
async function managedSettings(dir: string): Promise<unknown[]> {
  const fragments = join(dir, 'managed-settings.d');
  const names = await readdir(fragments, { withFileTypes: true }).then(
    (entries) => entries.filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.json') && !e.name.startsWith('.')).map((e) => e.name).sort(),
    () => [],
  );
  return Promise.all([join(dir, 'managed-settings.json'), ...names.map((name) => join(fragments, name))].map(readJson));
}

// The user's MDM plist, then the machine's, in the engine's order; a plist that is not there costs one stat and no
// conversion, one that does not convert (malformed, a failure, the time bound) configures nothing.
async function managedPreferences(dir: string | null, convert: (file: string) => Promise<string>): Promise<unknown[]> {
  if (dir === null) return [];
  let user = '';
  try {
    user = userInfo().username;
  } catch {
    // no user name: the machine's plist alone, as the engine reads it then
  }
  const read: unknown[] = [];
  for (const file of [...(user ? [join(dir, user, MDM_PLIST)] : []), join(dir, MDM_PLIST)]) {
    if (!(await stat(file).catch(() => null))?.isFile()) continue;
    read.push(await convert(file).then((text) => JSON.parse(text) as unknown).catch(() => null));
  }
  return read;
}

// The settings shape (`{ hooks: { SessionStart } }`) of each enabled plugin's hooks, from every install record of it.
async function pluginHooks(pluginsDir: string, settings: unknown[]): Promise<unknown[]> {
  const enabled = Object.assign({}, ...settings.map((s) => (isRecord(s) && isRecord(s.enabledPlugins) ? s.enabledPlugins : {}))) as Record<string, unknown>;
  const installed = await readJson(join(pluginsDir, 'installed_plugins.json'));
  const records = isRecord(installed) && isRecord(installed.plugins) ? installed.plugins : {};
  const roots = Object.entries(enabled)
    .filter(([, on]) => on === true || Array.isArray(on))
    .flatMap(([id]) => [records[id]].flat())
    .flatMap((record) => (isRecord(record) && typeof record.installPath === 'string' && isAbsolute(record.installPath) ? [record.installPath] : []));
  return (await Promise.all([...new Set(roots)].map(hooksOfPlugin))).flat();
}

async function hooksOfPlugin(root: string): Promise<unknown[]> {
  const declared = (await readJson(join(root, '.claude-plugin', 'plugin.json')) as { hooks?: unknown } | null)?.hooks;
  const entries = declared === undefined ? [] : [declared].flat();
  const files = entries.flatMap((entry) => {
    if (typeof entry !== 'string') return [];
    const file = resolve(root, entry);
    const inside = relative(root, file);
    return inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside) ? [] : [file];
  });
  const inline = entries.filter(isRecord).map((hooks) => ({ hooks }));
  return [...(await Promise.all([...new Set([join(root, 'hooks', 'hooks.json'), ...files])].map(readJson))), ...inline];
}

// The canonical git root above `cwd` as the engine finds it: the nearest directory holding a `.git` entry, and for a
// linked worktree (a `.git` file naming `<common>/worktrees/<name>` that names it back) its main checkout. Null outside
// a repository.
async function canonicalGitRoot(cwd: string): Promise<string | null> {
  let dir = resolve(cwd);
  for (;;) {
    const entry = await stat(join(dir, '.git')).catch(() => null);
    if (entry?.isDirectory()) return dir;
    if (entry?.isFile()) return (await mainCheckout(dir)) ?? dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function mainCheckout(root: string): Promise<string | null> {
  const text = async (file: string) => (await readFile(file, 'utf8').catch(() => null))?.trim() ?? null;
  const pointer = await text(join(root, '.git'));
  if (pointer === null || !pointer.startsWith('gitdir:')) return null;
  const gitdir = resolve(root, pointer.slice('gitdir:'.length).trim());
  const commondir = await text(join(gitdir, 'commondir'));
  const back = await text(join(gitdir, 'gitdir'));
  if (commondir === null || back === null) return null;
  const common = resolve(gitdir, commondir);
  const real = (path: string) => realpath(path).catch(() => path);
  if (dirname(gitdir) !== join(common, 'worktrees') || (await real(resolve(gitdir, back))) !== join(await real(root), '.git')) return null;
  return basename(common) === '.git' ? dirname(common) : common;
}

// `hooks.SessionStart`: matchers, each with its `hooks` list; the positive `timeout`s among them, in seconds.
function sessionStartTimeouts(settings: unknown): number[] {
  const matchers = (settings as { hooks?: { SessionStart?: unknown } } | null)?.hooks?.SessionStart;
  if (!Array.isArray(matchers)) return [];
  return matchers.flatMap((matcher) => {
    const hooks = (matcher as { hooks?: unknown } | null)?.hooks;
    if (!Array.isArray(hooks)) return [];
    return hooks.flatMap((hook) => {
      const timeout = (hook as { timeout?: unknown } | null)?.timeout;
      return typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0 ? [timeout] : [];
    });
  });
}

// An environment switch the engine reads as on: 1, true, yes or on, in any case.
const envOn = (value: string | undefined): boolean => ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// A missing, unreadable or malformed file configures nothing.
async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}
