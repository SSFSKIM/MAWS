// The P0 SessionStateStore (charter §4.4 as amended 2026-09-28; C3 execution document, Interfaces "Queue, steer,
// interrupt"): one JSON file per app session at `<userData>/engine-host/state/<appSessionId>.json` holding
// `{ version: 1, queue, grants, launchSpec }`, written to a temp file and renamed so a crash leaves the old file or the
// new one, never half of either. Operations on one session run strictly in the order they were issued (one chain per
// session, loads included), so a save issued at a process's exit is visible to the load of the resume that follows.
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import { GrantSnapshotSchema, QueueStateSchema, type GrantSnapshot, type QueueState, type SessionStateStore, type StoredQueue } from '@shared/engine/session-state-store';

const StateFileSchema = z.strictObject({ version: z.literal(1), queue: QueueStateSchema, grants: GrantSnapshotSchema, launchSpec: LaunchSpecSchema.nullable() });
type StateFile = z.infer<typeof StateFileSchema>;

const empty = (): StateFile => ({ version: 1, queue: { entries: [], paused: false }, grants: { allow: [] }, launchSpec: null });

export class FileSessionStateStore implements SessionStateStore {
  private readonly stateDir: string;
  private readonly journalDir: string;
  private readonly chains = new Map<AppSessionId, Promise<unknown>>();
  private readonly corrupted = new Map<AppSessionId, string>(); // where an unreadable file went, until a queue load reports it
  private readonly warn: (message: string) => void;

  // `userData` is the app's userData directory; the engine host's files live under `engine-host/` there.
  constructor(userData: string, opts: { warn?: (message: string) => void } = {}) {
    this.stateDir = join(userData, 'engine-host', 'state');
    this.journalDir = join(userData, 'engine-host', 'journal');
    this.warn = opts.warn ?? ((message) => console.warn(`[engine-host state] ${message}`));
  }

  exists(id: AppSessionId): Promise<boolean> {
    return this.run(id, () => access(this.fileOf(id)).then(() => true, () => false));
  }

  // Reads only: the recovery transitions (uncertain, interrupted) happen in MessageQueue, never here, so `loadQueue` for
  // an id with no live process shows the queue exactly as it was persisted. `corrupt` names the file an unreadable state
  // file was moved to by any operation since the last queue load (a launch reads grants before the queue), once.
  loadQueue(id: AppSessionId): Promise<StoredQueue> {
    return this.run(id, async () => {
      const { queue } = await this.read(id);
      const corrupt = this.corrupted.get(id) ?? null;
      this.corrupted.delete(id);
      return { ...queue, corrupt };
    });
  }

  saveQueue(id: AppSessionId, queue: QueueState): Promise<void> {
    return this.update(id, (file) => ({ ...file, queue: QueueStateSchema.parse(queue) })); // an invalid queue rejects; nothing is written
  }

  loadGrants(id: AppSessionId): Promise<GrantSnapshot> {
    return this.run(id, async () => (await this.read(id)).grants);
  }

  saveGrants(id: AppSessionId, grants: GrantSnapshot): Promise<void> {
    return this.update(id, (file) => ({ ...file, grants: GrantSnapshotSchema.parse(grants) }));
  }

  loadLaunchSpec(id: AppSessionId): Promise<LaunchSpec | null> {
    return this.run(id, async () => (await this.read(id)).launchSpec);
  }

  saveLaunchSpec(id: AppSessionId, spec: LaunchSpec): Promise<void> {
    return this.update(id, (file) => ({ ...file, launchSpec: LaunchSpecSchema.parse(spec) }));
  }

  // Archive: the state file and the session's journal directory (Interfaces, Journal: "`SessionStateStore.forget`
  // deletes the session's directory").
  forget(id: AppSessionId): Promise<void> {
    return this.run(id, async () => {
      await rm(this.fileOf(id), { force: true });
      await rm(join(this.journalDir, id), { recursive: true, force: true });
    });
  }

  private fileOf(id: AppSessionId): string {
    return join(this.stateDir, `${id}.json`);
  }

  private run<T>(id: AppSessionId, op: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(id) ?? Promise.resolve();
    const next = previous.then(op, op);
    const settled = next.catch(() => {});
    this.chains.set(id, settled);
    void settled.then(() => {
      if (this.chains.get(id) === settled) this.chains.delete(id);
    });
    return next;
  }

  private update(id: AppSessionId, patch: (file: StateFile) => StateFile): Promise<void> {
    return this.run(id, async () => {
      const next = patch(await this.read(id));
      await mkdir(this.stateDir, { recursive: true });
      const temp = `${this.fileOf(id)}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(next)}\n`);
      await rename(temp, this.fileOf(id));
    });
  }

  // The file, or the empty state when there is none. An unreadable file is moved aside and kept (never deleted), the
  // session starts empty rather than failing every launch, and the next queue load reports where it went (M4 review).
  private async read(id: AppSessionId): Promise<StateFile> {
    let text: string;
    try {
      text = await readFile(this.fileOf(id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
      throw error;
    }
    try {
      return StateFileSchema.parse(JSON.parse(text));
    } catch (error) {
      const aside = `${this.fileOf(id)}.corrupt-${Date.now()}`;
      await rename(this.fileOf(id), aside);
      this.corrupted.set(id, aside);
      this.warn(`state file for ${id} was unreadable (${error instanceof Error ? error.message.split('\n')[0] : String(error)}); moved to ${aside}`);
      return empty();
    }
  }
}
