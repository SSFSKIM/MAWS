// The model catalogue cache behind `engine.models` (C10 execution document, Interfaces "Catalogue cache"): an
// unstarted session's model chip runs before any session exists, and X6 only lets a live session answer `list_models`,
// so the engine host keeps the catalogues it saw (every `initialize` response's `models`, every `list_models` answer)
// at `<userData>/engine-host/models.json` (`{ entries: { [key]: { at, models } } }`, temp-then-rename), as the
// terminal's own `/model` shows after one launch. A catalogue is specific to the launch that answered it, so each is
// kept under the key of what varies between launches, the binary version and the route (`modelsKey`): a Direct launch
// and a relay launch no longer overwrite each other's lists (debt wave 3). Before any catalogue for a key it answers the
// built-in list.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod';
import { BUILTIN_MODELS, ModelCatalogueEntrySchema, type ModelCatalogue } from '@shared/sessions/models';

// The built-in list is shared (the renderer shows it when the host cannot answer at all).
export { BUILTIN_MODELS };

const EntrySchema = z.strictObject({ at: z.string(), models: z.array(ModelCatalogueEntrySchema) });
const CacheFileSchema = z.strictObject({ entries: z.record(z.string(), EntrySchema) });
type Entry = z.infer<typeof EntrySchema>;
type CacheFile = z.infer<typeof CacheFileSchema>;

// What a launch's catalogue depends on that the launch plan carries: the binary and the route (the relay and a Direct
// launch resolve the aliases differently).
export function modelsKey(engineVersion: string, gateway: 'gateway' | 'direct'): string {
  return `${engineVersion}/${gateway}`;
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
      const loaded = CacheFileSchema.parse(JSON.parse(text));
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

  // The catalogue kept under `key`; with no key (a caller that does not name its route), the most recently updated.
  answer(key?: string): ModelCatalogue {
    const entry: Entry | undefined = key !== undefined ? this.cached.entries[key] : Object.values(this.cached.entries).at(-1);
    return entry ? { models: entry.models, source: 'cached', at: entry.at } : { models: [...BUILTIN_MODELS], source: 'builtin', at: null };
  }

  private async write(file: CacheFile): Promise<void> {
    await mkdir(join(this.file, '..'), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(file)}\n`);
    await rename(temp, this.file);
  }
}
