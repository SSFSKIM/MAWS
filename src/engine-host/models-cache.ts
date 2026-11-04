// The model catalogue cache behind `engine.models` (C10 execution document, Interfaces "Catalogue cache"): an
// unstarted session's model chip runs before any session exists, and X6 only lets a live session answer `list_models`,
// so the engine host keeps the catalogues it saw (every `initialize` response's `models`, every `list_models` answer)
// at `<userData>/engine-host/models.json` (`{ entries: { [key]: { at, models } } }`, temp-then-rename), as the
// terminal's own `/model` shows after one launch. A catalogue is specific to the launch that answered it, so each is
// kept under the key of what varies between launches, the binary version and the route (`modelsKey`): a Direct launch
// and a relay launch no longer overwrite each other's lists (debt wave 3), and a launch whose settings set a model
// environment of its own keeps its list apart from its route's (`catalogueKey`, debt wave 5). Before any catalogue for a
// key it answers the built-in list.
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod';
import { BUILTIN_MODELS, ModelCatalogueEntrySchema, type ModelCatalogue } from '@shared/sessions/models';
import { GATEWAY_KEYS } from './launch'; // P5 O7 M9
import { localSettingsFiles } from './local-store'; // P2-F wave S (S-catalogue)
import { managedSettings, managedSettingsDir } from './session-start-hooks'; // P5 O7 M9: resolve-style.ts's managed path

// The built-in list is shared (the renderer shows it when the host cannot answer at all).
export { BUILTIN_MODELS };

const EntrySchema = z.strictObject({ at: z.string(), models: z.array(ModelCatalogueEntrySchema) });
// P2-F L117 (P2-0 G3's pattern): what `load` parses. A later build's key in the file or an entry is stripped rather than
// costing the cached catalogues; the file is left as it was, and the next update writes only this build's shape (`update`
// builds the file from `CacheFile`'s fields alone).
const StoredCacheFileSchema = z.object({ entries: z.record(z.string(), EntrySchema.strip()) });
type Entry = z.infer<typeof EntrySchema>;
type CacheFile = z.infer<typeof StoredCacheFileSchema>;

// What a launch's catalogue depends on that the launch plan carries: the binary and the route (the relay and a Direct
// launch resolve the aliases differently). A launch whose settings change its model environment keys apart
// (`catalogueKey`); every other launch of the route shares this key.
export function modelsKey(engineVersion: string, gateway: 'gateway' | 'direct'): string {
  return `${engineVersion}/${gateway}`;
}

// The variables that change the rows the engine lists (SPEC 06 §12.1's model-settings set, less the ones that pick a
// helper's model rather than a row: the subagent, utility, auto-mode and classifier models; plus the two that add or
// reshape rows: gateway model discovery and the 1M-context switch).
const MODEL_ENV = /^(ANTHROPIC_(MODEL|DEFAULT_MODEL|DEFAULT_[A-Z0-9]+_MODEL(_NAME|_DESCRIPTION|_SUPPORTED_CAPABILITIES)?|CUSTOM_MODEL_OPTION(_NAME|_DESCRIPTION|_SUPPORTED_CAPABILITIES)?)|CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY|CLAUDE_CODE_DISABLE_1M_CONTEXT)$/;

export interface ModelEnvSources {
  env: Record<string, string>; // the spawn environment (a launch plan's, or the captured shell's for a launch not yet made)
  cwd: string | null; // the project whose `.claude/settings.json` and `.claude/settings.local.json` the launch reads
  flagEnv?: unknown; // the `--settings` JSON's env
  // P5 O7 M9: the project's `.claude/settings.json` text in place of the cwd's file (null: there is none), for a launch
  // whose checkout does not exist yet (a new worktree, judged by what its branch tracks); the local store is the cwd's
  project?: { text: string | null };
}

// The key a launch's catalogue lives under. The engine applies the global config's `env` over its spawn environment,
// then every settings source's in the order user < project < local < flag < managed (SPEC 03 §12.1, full mode, which a
// print-mode launch always takes: 2.1.296 applies it after setup whatever the workspace's trust, P2-F S-catalogue), so
// the model environment every launch shares is the spawn environment under the global config and the user settings,
// and a launch whose project, local or flag settings change it (the M6 home-directory case: `~` as the project under a
// scratch config home) keys its catalogue apart, by a digest of the model environment it runs with. The local store is
// read where the engine reads it (`localSettingsFiles`: a worktree's or a subdirectory's at its repository's canonical
// root, over the cwd's own). Managed settings apply to every launch alike and are not read: a value they override only
// keys a launch apart whose list is its route's (P2-F S-catalogue's evidence). CLAUDE_CODE_RESTRICTED in the spawn
// environment empties the engine's setting sources (2.1.296 `vSr`: `--restricted`, which MAWS never passes, or the
// variable), leaving the global config and the flag settings; CLAUDE_CODE_SAFE_MODE disables customisations, not the
// settings env, and is not read (P2-F S-catalogue review).
export async function catalogueKey(engineVersion: string, gateway: 'gateway' | 'direct', sources: ModelEnvSources): Promise<string> {
  const route = modelsKey(engineVersion, gateway);
  const { shared, launch } = await layeredEnv(sources, (name) => MODEL_ENV.test(name), () => {});
  const digest = (env: Record<string, string>) => JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
  if (digest(launch) === digest(shared)) return route;
  return `${route}/env-${createHash('sha256').update(digest(launch)).digest('hex').slice(0, 12)}`;
}

// The picked variables a launch runs with, by the engine's precedence (catalogueKey's comment): `shared`, what every
// launch of this environment and config home has (the spawn environment, the global config's env, the user settings);
// `launch`, this launch's (then the project, local and flag settings). A file that is missing sets nothing; one that is
// there and cannot be read as settings sets nothing too, and is told to `unreadable`.
async function layeredEnv(sources: ModelEnvSources, pick: (name: string) => boolean, unreadable: (file: string) => void): Promise<{ shared: Record<string, string>; launch: Record<string, string> }> {
  const read = (file: string) => settingsEnv(file, pick, unreadable);
  const given = sources.project;
  const home = sources.env.HOME || null;
  const configDir = sources.env.CLAUDE_CONFIG_DIR || (home ? join(home, '.claude') : null);
  const restricted = envFlag(sources.env.CLAUDE_CODE_RESTRICTED); // no setting source is read but the flag's
  const cwd = restricted ? null : sources.cwd;
  const project = cwd === null ? null : join(cwd, '.claude');
  const [globalEnv, user, projectEnv, localEnv] = await Promise.all([
    globalConfigEnv(configDir, sources.env.CLAUDE_CONFIG_DIR || home, read),
    configDir === null || restricted ? {} : read(join(configDir, 'settings.json')),
    project === null ? {} : given === undefined ? read(join(project, 'settings.json')) : given.text === null ? {} : settingsTextEnv(given.text, join(project, 'settings.json'), pick, unreadable),
    cwd === null ? {} : localSettingsFiles(cwd, home).then(async (files) => Object.assign({}, ...(await Promise.all(files.map(read)))) as Record<string, string>),
  ]);
  const shared = { ...envOf(sources.env, pick), ...globalEnv, ...user };
  return { shared, launch: { ...shared, ...projectEnv, ...localEnv, ...envOf(sources.flagEnv, pick) } };
}

// P5 O7 M9 start (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M9 "The relay check and the features"): the
// base URL a launch on the machine route reaches, before it is made: `ANTHROPIC_BASE_URL` by catalogueKey's precedence
// above (the spawn environment, the global config's env, the user, project, local and flag settings, the restricted
// variable emptying the setting sources), then the managed settings over all of them, read where resolve-style.ts reads
// them (the platform's directory, `managed-settings.json` then each `managed-settings.d/*.json` in name order, a later
// file winning); an empty value is none, as the direct route's blanking reads. `uncertain` when a settings file the
// launch reads is there and cannot be read as settings: what the engine makes of it is not known here, and a caller
// defers to the engine (get_status stays authoritative after the launch). The managed preferences plists are not read
// (resolve-style.ts reads none either). `platform` and `systemRoot` are the tests' seams, as resolve-style.ts's.
// `gatewayKeys`: which of the keys the legacy routes set or delete (launch.ts GATEWAY_KEYS, the base URL among them)
// resolve non-empty by the same precedence, in that order: the legacy direct route deletes them all, so it reaches what
// the machine route reaches only where the machine sets none (fix round, item 5).
export type BaseUrlResolution = { kind: 'resolved'; baseUrl: string | null; gatewayKeys: string[] } | { kind: 'uncertain'; why: string };

export async function effectiveBaseUrl(sources: ModelEnvSources & { platform?: NodeJS.Platform; systemRoot?: string }): Promise<BaseUrlResolution> {
  const unreadable: string[] = [];
  const pick = (name: string) => (GATEWAY_KEYS as readonly string[]).includes(name);
  const directory = sources.systemRoot === undefined ? managedSettingsDir(sources.platform) : join(sources.systemRoot, managedSettingsDir(sources.platform));
  const [{ launch }, managed] = await Promise.all([layeredEnv(sources, pick, (file) => unreadable.push(file)), managedSettings(directory)]);
  if (unreadable.length > 0) return { kind: 'uncertain', why: `not read as settings: ${unreadable.join(', ')}` };
  const merged: Record<string, string | undefined> = Object.assign({}, launch, ...managed.map((file) => envOf(isRecord(file) ? file.env : undefined, pick)));
  const value = (key: string) => merged[key] || null; // an empty value is none
  return { kind: 'resolved', baseUrl: value(BASE_URL), gatewayKeys: GATEWAY_KEYS.filter((key) => value(key) !== null) };
}

const BASE_URL = 'ANTHROPIC_BASE_URL';
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
// P5 O7 M9 end

function envOf(env: unknown, pick: (name: string) => boolean): Record<string, string> {
  if (!isRecord(env)) return {};
  const picked: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const name = key.toUpperCase();
    if (pick(name) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) picked[name] = String(value);
  }
  return picked;
}

// An environment flag as the engine reads one (2.1.296 `Ne`): 1, true, yes or on, in any case, around blanks.
function envFlag(value: string | undefined): boolean {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase().trim());
}

// The global config's env: `<config dir>/.config.json` while that legacy file exists, else `.claude.json` in the
// config directory when CLAUDE_CONFIG_DIR names one, else in the home directory (SPEC 03 §2, the global config).
async function globalConfigEnv(configDir: string | null, configHome: string | null, read: (file: string) => Promise<Record<string, string>>): Promise<Record<string, string>> {
  const legacy = configDir === null ? null : join(configDir, '.config.json');
  if (legacy !== null && (await access(legacy).then(() => true, () => false))) return read(legacy);
  return configHome === null ? {} : read(join(configHome, '.claude.json'));
}

// A settings file's picked env; a missing file sets none, and so does one that is unreadable or malformed (told).
async function settingsEnv(file: string, pick: (name: string) => boolean, unreadable: (file: string) => void): Promise<Record<string, string>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') unreadable(file);
    return {};
  }
  return settingsTextEnv(text, file, pick, unreadable);
}

function settingsTextEnv(text: string, file: string, pick: (name: string) => boolean, unreadable: (file: string) => void): Record<string, string> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed !== null && !isRecord(parsed)) throw new Error('not an object');
    return envOf(isRecord(parsed) ? parsed.env : undefined, pick);
  } catch {
    unreadable(file);
    return {};
  }
}

export class ModelsCache {
  private readonly file: string;
  private readonly now: () => string;
  private readonly warn: (message: string) => void;
  private cached: CacheFile = { entries: {} };
  private writing: Promise<void> = Promise.resolve();

  constructor(userData: string, opts: { now?: () => string; warn?: (message: string) => void } = {}) {
    this.file = join(userData, 'engine-host', 'models.json');
    this.now = opts.now ?? (() => new Date().toISOString());
    this.warn = opts.warn ?? ((message) => console.warn(`[engine-host models] ${message}`));
  }

  // The file from the last run; a missing file is the cold profile, an unreadable one is logged and ignored.
  async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warn(`${this.file} not read: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    try {
      const loaded = StoredCacheFileSchema.parse(JSON.parse(text));
      if (Object.keys(this.cached.entries).length === 0) this.cached = loaded; // an update that landed first wins
    } catch (error) {
      this.warn(`${this.file} is not a catalogue (${error instanceof Error ? error.message.split('\n')[0] : String(error)}); answering the built-in list`);
    }
  }

  // A catalogue the engine answered for a launch under `key`: the entries that are catalogue entries, kept under that
  // key and written; an empty list changes nothing.
  async update(key: string, models: readonly unknown[]): Promise<void> {
    const entries = models.flatMap((raw) => {
      const parsed = ModelCatalogueEntrySchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    });
    if (entries.length === 0) return;
    const others = Object.fromEntries(Object.entries(this.cached.entries).filter(([k]) => k !== key));
    const next: CacheFile = { entries: { ...others, [key]: { at: this.now(), models: entries } } }; // the newest last
    this.cached = next;
    this.writing = this.writing.then(() => this.write(next)).catch((error: unknown) => this.warn(`${this.file} not written: ${error instanceof Error ? error.message : String(error)}`));
    await this.writing;
  }

  // The catalogue kept under `key`, else under `fallback` (a launch keyed by its model environment before its first
  // list: its route's); with no key (a caller that does not name its route), the most recently updated.
  answer(key?: string, fallback?: string): ModelCatalogue {
    const entry: Entry | undefined = key !== undefined ? (this.cached.entries[key] ?? (fallback !== undefined ? this.cached.entries[fallback] : undefined)) : Object.values(this.cached.entries).at(-1);
    return entry ? { models: entry.models, source: 'cached', at: entry.at } : { models: [...BUILTIN_MODELS], source: 'builtin', at: null };
  }

  private async write(file: CacheFile): Promise<void> {
    await mkdir(join(this.file, '..'), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(file)}\n`);
    await rename(temp, this.file);
  }
}
