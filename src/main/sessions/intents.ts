// The setup intents and the resume bootstrap notes (C10 execution document, Terms "Setup intent", Interfaces "Session
// service" and "Trust bootstrap"): main-owned files under `userData`, one per id, as C5's `layout.json` is main's.
//
// An intent lives at `<userData>/sessions/intents/<appSessionId>.json` from `session.create` until the session is
// identity-bound (or discarded); it is written before any effect of a start and after every phase, so a crash leaves
// `progress` truthful for the start-time reconciliation. A resume's trust bootstrap has no intent to record its id in,
// so it keeps a transient note at `<userData>/sessions/bootstraps/<bootstrapId>.json` until the bootstrap is forgotten.
// Every write is temp-then-rename in the same directory, so a reader sees a whole file or none.
import { rm } from 'node:fs/promises';
import type { AppSessionId } from '@shared/graph/ids';
import { SetupIntentSchema, type SetupIntent } from '@shared/sessions/intent';
import { fileOf, readAll, writeWhole } from './json-files';

export interface IntentStore {
  get(appSessionId: AppSessionId): SetupIntent | null;
  list(): SetupIntent[];
  put(intent: SetupIntent): Promise<void>;
  remove(appSessionId: AppSessionId): Promise<void>;
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
