// The setup intents and the resume bootstrap notes (C10 execution document, Terms "Setup intent", Interfaces "Session
// service" and "Trust bootstrap"): main-owned files under `userData`, one per id, as C5's `layout.json` is main's.
//
// An intent lives at `<userData>/sessions/intents/<appSessionId>.json` from `session.create` until the session is
// identity-bound (or discarded); it is written before any effect of a start and after every phase, so a crash leaves
// `progress` truthful for the start-time reconciliation. A resume's trust bootstrap has no intent to record its id in,
// so it keeps a transient note at `<userData>/sessions/bootstraps/<bootstrapId>.json` until the bootstrap is forgotten.
// Every write is temp-then-rename in the same directory, so a reader sees a whole file or none.
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import { SetupIntentSchema, type SetupIntent } from '@shared/sessions/intent';

export interface IntentStore {
  get(appSessionId: AppSessionId): SetupIntent | null;
  list(): SetupIntent[];
  put(intent: SetupIntent): Promise<void>;
  remove(appSessionId: AppSessionId): Promise<void>;
}

// An id names a file here, so it is one plain path component (the ids are UUIDs; anything else is refused).
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function fileOf(dir: string, id: string): string {
  if (!SAFE_ID.test(id) || id.includes('..')) throw new Error(`not a file-safe id: ${id}`);
  return join(dir, `${id}.json`);
}

async function writeWhole(dir: string, id: string, value: unknown): Promise<void> {
  const target = fileOf(dir, id);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.${id}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

// Every `<id>.json` in `dir` (temp files and anything else ignored), parsed; a file that does not parse is skipped with
// a warning and left on disk for a person to look at.
async function readAll(dir: string, warn: (message: string) => void): Promise<{ id: string; value: unknown }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const out: { id: string; value: unknown }[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    try {
      out.push({ id: name.slice(0, -'.json'.length), value: JSON.parse(await readFile(join(dir, name), 'utf8')) as unknown });
    } catch (error) {
      warn(`${join(dir, name)} could not be read (${error instanceof Error ? error.message : String(error)}); skipped`);
    }
  }
  return out;
}

export class FileIntentStore implements IntentStore {
  private readonly intents = new Map<AppSessionId, SetupIntent>();

  constructor(
    readonly dir: string,
    private readonly warn: (message: string) => void = (message) => console.warn(`[sessions intents] ${message}`),
  ) {}

  // Loads every intent on disk (at the service's start). A file whose content is not an intent, or is filed under
  // another id than it names, is skipped and kept.
  async load(): Promise<void> {
    this.intents.clear();
    for (const { id, value } of await readAll(this.dir, this.warn)) {
      const parsed = SetupIntentSchema.safeParse(value);
      if (!parsed.success) {
        this.warn(`${fileOf(this.dir, id)} is not a setup intent (${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}); skipped`);
        continue;
      }
      if (parsed.data.appSessionId !== id) {
        this.warn(`${fileOf(this.dir, id)} names ${parsed.data.appSessionId}; skipped`);
        continue;
      }
      this.intents.set(parsed.data.appSessionId, parsed.data);
    }
  }

  get(appSessionId: AppSessionId): SetupIntent | null {
    return this.intents.get(appSessionId) ?? null;
  }

  list(): SetupIntent[] {
    return [...this.intents.values()];
  }

  // Written to disk first; the memory copy follows only a successful write, so what `get` answers is what survives.
  async put(intent: SetupIntent): Promise<void> {
    const checked = SetupIntentSchema.parse(intent);
    await writeWhole(this.dir, checked.appSessionId, checked);
    this.intents.set(checked.appSessionId, checked);
  }

  async remove(appSessionId: AppSessionId): Promise<void> {
    await rm(fileOf(this.dir, appSessionId), { force: true });
    this.intents.delete(appSessionId);
  }
}

// A resume's bootstrap in flight or not yet forgotten: its id, the session it trusted for, and when it began.
export interface BootstrapNote {
  bootstrapId: AppSessionId;
  appSessionId: AppSessionId;
  at: string;
}

export class BootstrapNotes {
  constructor(
    readonly dir: string,
    private readonly warn: (message: string) => void = (message) => console.warn(`[sessions bootstraps] ${message}`),
  ) {}

  put(note: BootstrapNote): Promise<void> {
    return writeWhole(this.dir, note.bootstrapId, note);
  }

  async remove(bootstrapId: AppSessionId): Promise<void> {
    await rm(fileOf(this.dir, bootstrapId), { force: true });
  }

  async list(): Promise<BootstrapNote[]> {
    const notes: BootstrapNote[] = [];
    for (const { id, value } of await readAll(this.dir, this.warn)) {
      const note = value as Partial<BootstrapNote> | null;
      // the file name is the bootstrap id whatever the content says: it is what must be forgotten
      notes.push({ bootstrapId: id as AppSessionId, appSessionId: (note?.appSessionId ?? id) as AppSessionId, at: typeof note?.at === 'string' ? note.at : '' });
    }
    return notes;
  }
}
