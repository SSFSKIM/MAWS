// The model catalogue cache behind `engine.models` (C10 execution document, Interfaces "Catalogue cache"): an
// unstarted session's model chip runs before any session exists, and X6 only lets a live session answer `list_models`,
// so the engine host keeps the latest catalogue it saw (every `initialize` response's `models`, every `list_models`
// answer) at `<userData>/engine-host/models.json` (`{ at, models }`, temp-then-rename), as the terminal's own `/model`
// shows after one launch. Before any catalogue it answers the built-in list.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod';
import { BUILTIN_MODELS, ModelCatalogueEntrySchema, type ModelCatalogue } from '@shared/sessions/models';

// The built-in list is shared (the renderer shows it when the host cannot answer at all).
export { BUILTIN_MODELS };

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
