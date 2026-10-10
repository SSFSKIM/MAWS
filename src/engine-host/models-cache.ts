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
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod';
import { BUILTIN_MODELS, ModelCatalogueEntrySchema, type ModelCatalogue } from '@shared/sessions/models';

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
}

// The key a launch's catalogue lives under. 2.1.283 applies every settings source's `env` over its spawn environment
// in the order user < project < local < flag (SPEC 03 §12.1, full mode; MAWS launches trusted directories), so the
// model environment every launch shares is the spawn environment under the user settings, and a launch whose project,
// local or flag settings change it (the M6 home-directory case: `~` as the project under a scratch config home) keys
// its catalogue apart, by a digest of the model environment it runs with. Managed settings and `~/.claude.json`'s env
// apply to every launch alike and are not read; the local store canonicalised to a git root above `cwd` is not either.
export async function catalogueKey(engineVersion: string, gateway: 'gateway' | 'direct', sources: ModelEnvSources): Promise<string> {
  const route = modelsKey(engineVersion, gateway);
  const configDir = sources.env.CLAUDE_CONFIG_DIR || (sources.env.HOME ? join(sources.env.HOME, '.claude') : null);
  const project = sources.cwd === null ? null : join(sources.cwd, '.claude');
  const [user, projectEnv, localEnv] = await Promise.all([
    configDir === null ? {} : settingsEnv(join(configDir, 'settings.json')),
    project === null ? {} : settingsEnv(join(project, 'settings.json')),
    project === null ? {} : settingsEnv(join(project, 'settings.local.json')),
  ]);
  const shared = { ...modelEnvOf(sources.env), ...user };
  const launch = { ...shared, ...projectEnv, ...localEnv, ...modelEnvOf(sources.flagEnv) };
  const digest = (env: Record<string, string>) => JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
  if (digest(launch) === digest(shared)) return route;
  return `${route}/env-${createHash('sha256').update(digest(launch)).digest('hex').slice(0, 12)}`;
}

function modelEnvOf(env: unknown): Record<string, string> {
  if (typeof env !== 'object' || env === null || Array.isArray(env)) return {};
  const picked: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const name = key.toUpperCase();
    if (MODEL_ENV.test(name) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) picked[name] = String(value);
  }
  return picked;
}

// A settings file's model env; a missing, unreadable or malformed file sets none.
async function settingsEnv(file: string): Promise<Record<string, string>> {
  try {
    return modelEnvOf((JSON.parse(await readFile(file, 'utf8')) as { env?: unknown } | null)?.env);
  } catch {
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
