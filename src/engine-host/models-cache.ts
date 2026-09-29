// The model catalogue cache behind `engine.models` (C10 execution document, Interfaces "Catalogue cache"): an
// unstarted session's model chip runs before any session exists, and X6 only lets a live session answer `list_models`,
// so the engine host keeps the latest catalogue it saw (every `initialize` response's `models`, every `list_models`
// answer) at `<userData>/engine-host/models.json` (`{ at, models }`, temp-then-rename), as the terminal's own `/model`
// shows after one launch. Before any catalogue it answers the built-in list.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod';
import { ModelCatalogueEntrySchema, type ModelCatalogue, type ModelCatalogueEntry } from '@shared/sessions/models';

// The five entries `reads.jsonl` seq 3 carries before the relay's aliases, which exist only through the relay and
// arrive with the first routed launch. Haiku is the one that cannot hold auto mode.
export const BUILTIN_MODELS: readonly ModelCatalogueEntry[] = Object.freeze([
  { value: 'default', displayName: 'Default (recommended)', supportsAutoMode: true, supportsFastMode: true },
  { value: 'opus', displayName: 'Opus 5.5 (1M context)', supportsAutoMode: true, supportsFastMode: true },
  { value: 'fable', displayName: 'Fable 5.1', supportsAutoMode: true },
  { value: 'sonnet', displayName: 'Sonnet 5', supportsAutoMode: true },
  { value: 'haiku', displayName: 'Haiku', supportsAutoMode: false },
]);

const CacheFileSchema = z.strictObject({ at: z.string(), models: z.array(ModelCatalogueEntrySchema) });
type CacheFile = z.infer<typeof CacheFileSchema>;

export class ModelsCache {
  private readonly file: string;
  private readonly now: () => string;
  private readonly warn: (message: string) => void;
  private cached: CacheFile | null = null;
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
      this.cached ??= CacheFileSchema.parse(JSON.parse(text));
    } catch (error) {
      this.warn(`${this.file} is not a catalogue (${error instanceof Error ? error.message.split('\n')[0] : String(error)}); answering the built-in list`);
    }
  }

  // A catalogue the engine answered: the entries that are catalogue entries, kept and written; an empty list changes nothing.
  async update(models: readonly unknown[]): Promise<void> {
    const entries = models.flatMap((raw) => {
      const parsed = ModelCatalogueEntrySchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    });
    if (entries.length === 0) return;
    const next: CacheFile = { at: this.now(), models: entries };
    this.cached = next;
    this.writing = this.writing.then(() => this.write(next)).catch((error: unknown) => this.warn(`${this.file} not written: ${error instanceof Error ? error.message : String(error)}`));
    await this.writing;
  }

  answer(): ModelCatalogue {
    return this.cached ? { models: this.cached.models, source: 'cached', at: this.cached.at } : { models: [...BUILTIN_MODELS], source: 'builtin', at: null };
  }

  private async write(file: CacheFile): Promise<void> {
    await mkdir(join(this.file, '..'), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(file)}\n`);
    await rename(temp, this.file);
  }
}
