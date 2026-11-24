// How MAWS finds the `sminos` it appends with (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md S2,
// §E; X2). Two sources and no third: the executable named in MAWS_SMINOS_CLI (MAWS's own environment, then the login
// shell's), or the `bin/sminos` of an installation of the sminos plugin that is of user scope and enabled in the
// settings that apply without a project (the user's and the managed ones), read from the engine's registry
// `<config>/plugins/installed_plugins.json`. An installation of project or local scope, a disabled one, and a `sminos`
// that merely is on a PATH are never run: this is a machine-wide service with no project of its own, and it would be
// executing code some one project chose. Under a test runner only MAWS_SMINOS_CLI is read.
//
// A found command is proven by a probe, `sminos sheet show --session <a session with no sheet>`, whose exit 3 shows that
// the launcher runs, its Python is new enough and it knows the sheet's verbs. The proof is kept by path and modification
// time in the caller's `proofs` (a failed probe is not kept), which the caller empties when a spawn fails (a plugin update removes the old version's
// directory). The command runs with the login shell's environment, so `python3` resolves as in the person's terminal,
// with SMINOS_HOME set to the home the reader reads.
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { managedSettings, managedSettingsDir } from '../../engine-host/session-start-hooks';
import { runSminos, type SminosCli } from './door';
import { SHEET_TIMING } from './timing';

export type { SminosCli } from './door';

export type Located = { ok: true; cli: SminosCli } | { ok: false; reason: 'not-installed' | 'no-sheet-verbs' | 'not-runnable'; detail: string };

/** The commands proven, each by `<path>\0<modification time>`. */
export type ProofCache = Set<string>;

type Env = Record<string, string | undefined>;

export interface LocateDeps {
  env: Env; // MAWS's own environment
  shell: Record<string, string>; // the login shell's (captureShellEnvironment)
  configHome: string; // the engine's config home
  home: string; // the sminos home the reader reads
  underTest?: boolean; // only MAWS_SMINOS_CLI is read (default: under vitest or an e2e launch)
  systemRoot?: string; // the tests' seam: the root the managed settings directory is read beneath
  proofs?: ProofCache;
  probeMs?: number;
}

export const PROBE_SESSION = '00000000-0000-4000-8000-000000000000';
const PLUGIN = 'sminos';
const PYTHON_COMPLAINT = 'sminos needs Python';

const DETAIL = {
  notInstalled: 'No sminos is installed and enabled for this user, and MAWS_SMINOS_CLI names none.',
  notAbsolute: 'MAWS_SMINOS_CLI must name the sminos command by its full path.',
  notStarted: 'The sminos command could not be started.',
  python: 'The sminos command needs Python 3.10 or newer first on the login shell’s PATH.',
  timedOut: 'The sminos command did not answer.',
  noSheetVerbs: 'The installed sminos is older than the question sheet.',
} as const;

const underTestRunner = (): boolean => Boolean(process.env.VITEST) || process.env.MAWS_E2E === '1';
const set = (value: string | undefined): string | undefined => (value === undefined || value === '' ? undefined : value);

export async function locateSminos(deps: LocateDeps): Promise<Located> {
  const found = await find(deps);
  if ('reason' in found) return found;
  return prove({ path: found.path, env: { ...deps.shell, SMINOS_HOME: deps.home }, source: found.source }, deps);
}

async function find(deps: LocateDeps): Promise<{ path: string; source: SminosCli['source'] } | Extract<Located, { ok: false }>> {
  const named = set(deps.env.MAWS_SMINOS_CLI) ?? set(deps.shell.MAWS_SMINOS_CLI);
  if (named !== undefined) return isAbsolute(named) ? { path: named, source: 'named' } : { ok: false, reason: 'not-runnable', detail: DETAIL.notAbsolute };
  if (deps.underTest ?? underTestRunner()) return { ok: false, reason: 'not-installed', detail: DETAIL.notInstalled };
  for (const installPath of await userInstallations(deps)) {
    const path = join(installPath, 'bin', PLUGIN);
    if ((await stat(path).catch(() => null))?.isFile()) return { path, source: 'plugin' };
  }
  return { ok: false, reason: 'not-installed', detail: DETAIL.notInstalled };
}

type Settings = Record<string, unknown>;
const asObject = (value: unknown): Settings | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Settings) : null);
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown;

// The install paths of the plugin's user-scope installations enabled where no project applies, in the registry's
// order. Enablement merges the managed settings (each fragment over the one before it, the last first) over the user's,
// the higher precedence winning per plugin id, as src/services/owner/resolve-style.ts reads it.
async function userInstallations(deps: LocateDeps): Promise<string[]> {
  const registry = asObject(await readJson(join(deps.configHome, 'plugins', 'installed_plugins.json')).catch(() => null));
  const plugins = registry?.version === 2 ? asObject(registry.plugins) : null;
  if (plugins === null) return [];
  const directory = deps.systemRoot === undefined ? managedSettingsDir() : join(deps.systemRoot, managedSettingsDir());
  const managed = (await managedSettings(directory)).map(asObject).filter((s): s is Settings => s !== null).reverse();
  const user = asObject(await readJson(join(deps.configHome, 'settings.json')).catch(() => null));
  const enabled: Settings = {};
  for (const source of [...managed, ...(user === null ? [] : [user])].reverse()) Object.assign(enabled, asObject(source.enabledPlugins) ?? {});
  const paths: string[] = [];
  for (const [id, records] of Object.entries(plugins)) {
    if (id.split('@')[0] !== PLUGIN || enabled[id] !== true || !Array.isArray(records)) continue;
    for (const record of records.map(asObject)) if (record?.scope === 'user' && typeof record.installPath === 'string') paths.push(record.installPath);
  }
  return paths;
}

async function prove(cli: SminosCli, deps: LocateDeps): Promise<Located> {
  const st = await stat(cli.path, { bigint: true }).catch(() => null);
  const key = st === null ? null : `${cli.path}\0${st.mtimeNs}`;
  if (key !== null && deps.proofs?.has(key)) return { ok: true, cli };
  const located = await probe(cli, deps.probeMs ?? SHEET_TIMING.probeMs);
  if (key !== null && located.ok) deps.proofs?.add(key); // a failure is not kept: a newer Python on the PATH mends it
  return located;
}

async function probe(cli: SminosCli, timeoutMs: number): Promise<Located> {
  const run = await runSminos(cli, ['sheet', 'show', '--session', PROBE_SESSION], '', timeoutMs);
  if (!run.started) return { ok: false, reason: 'not-runnable', detail: DETAIL.notStarted };
  if (run.timedOut) return { ok: false, reason: 'not-runnable', detail: DETAIL.timedOut };
  if (run.code === 3) return { ok: true, cli };
  // The launcher's own `exec python3` failing (126, 127), and sminos's complaint about its Python, are a command that
  // cannot run here; any other exit is a sminos that runs and does not know the sheet's verbs.
  if (run.code === 126 || run.code === 127 || (run.code === 1 && run.stderr.includes(PYTHON_COMPLAINT))) return { ok: false, reason: 'not-runnable', detail: run.code === 1 ? DETAIL.python : DETAIL.notStarted };
  return { ok: false, reason: 'no-sheet-verbs', detail: DETAIL.noSheetVerbs };
}
