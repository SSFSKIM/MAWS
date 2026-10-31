// The P0 SessionStateStore (charter §4.4 as amended 2026-09-28; C3 execution document, Interfaces "Queue, steer,
// interrupt"): one JSON file per app session at `<userData>/engine-host/state/<appSessionId>.json` holding
// `{ version: 1, queue, grants, launchSpec, keep?, engineSessionIds?, owedInterrupt? }` (P5 O2 M2: `keep`, the owner's Keep
// running mark, and `engineSessionIds`, the ids the session has had; P5 O16 M2: `owedInterrupt`, an interrupt written and
// not yet answered; each absent when never set; an older build's reader strips them),
// written to a temp file and renamed so a crash leaves the old file or the new one, never half of either. The session's
// cron record (P5 O2 M2, P5 Decision Log 49) is its own file beside it, `<appSessionId>.cron.json`, written the same way.
// Operations on one session run strictly in the order they were issued (one chain per session, loads included), so a
// save issued at a process's exit is visible to the load of the resume that follows.
import { assertSafeAppSessionId } from '@shared/engine/app-session-id';
import { access, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import { CronRecordSchema, GrantSnapshotSchema, PendingSteerSchema, QueueEntrySchema, QueueStateSchema, type GrantSnapshot, type CronRecord, type QueueState, type SessionStateStore, type StoredQueue } from '@shared/engine/session-state-store';

// C10 start: a launch spec stored before C10's additive `inheritGrantsFrom` (X6) still parses, and reads as null there;
// without this a state file from an earlier build would be moved aside as unreadable, taking its queue and grants
// P2-F L117: the nested `resume`, `trust` and `retry` objects strip a later build's keys on read too.
const { resume, trust, retry } = LaunchSpecSchema.shape;
const StoredLaunchSpecSchema = LaunchSpecSchema.extend({
  inheritGrantsFrom: LaunchSpecSchema.shape.inheritGrantsFrom.optional(),
  resume: resume.unwrap().strip().nullable(),
  trust: trust.unwrap().strip().nullable(),
  retry: retry.unwrap().strip().optional(),
}).strip();
// C10 end
// P2-F L117: the queue's and grants' objects read the same way (entries, pending steers, the queue, the snapshot).
const StoredQueueStateSchema = QueueStateSchema.extend({
  entries: z.array(QueueEntrySchema.strip()),
  steers: z.array(PendingSteerSchema.strip()).optional(),
}).strip();
// P2-0 (X6): ignore a later build's state/spec keys on read, rather than moving its queue and grants aside. Strip,
// not passthrough: an update still writes only this build's shape; saveQueue, saveGrants and saveLaunchSpec keep the
// strict IPC/write schemas.
const StateFileSchema = z.object({ version: z.literal(1), queue: StoredQueueStateSchema, grants: GrantSnapshotSchema.strip(), launchSpec: StoredLaunchSpecSchema.nullable() /* C10 */, keep: z.boolean().optional() /* P5 O2 M2 */, engineSessionIds: z.array(z.string()).optional() /* P5 O2 M2 */, owedInterrupt: z.boolean().optional() /* P5 O16 M2 */ });
type StateFile = z.infer<typeof StateFileSchema>;

const empty = (): StateFile => ({ version: 1, queue: { entries: [], paused: false }, grants: { allow: [] }, launchSpec: null });

export class FileSessionStateStore implements SessionStateStore {
  private readonly unremovedCronRecords = new Set<AppSessionId>(); // P5 O2 M2: a failed save whose older record could not be unlinked
  private readonly stateDir: string;
  private readonly journalDir: string;
  private readonly chains = new Map<AppSessionId, Promise<unknown>>();
  private readonly corrupted = new Map<AppSessionId, string>(); // where an unreadable file went, until a queue load reports it
  // P5 O2 branch review: an unreadable file moved aside took its engine session ids with it, until they are saved again.
  // In memory, as `unremovedCronRecords` is: a store after a restart reads the fresh file's absent ids as none.
  private readonly lostEngineSessionIds = new Set<AppSessionId>();
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
    return this.run(id, async () => {
      const { launchSpec } = await this.read(id);
      return launchSpec && { ...launchSpec, inheritGrantsFrom: launchSpec.inheritGrantsFrom ?? null }; // C10: a pre-C10 spec
    });
  }

  // P2-C: the owner channel's two keys are left out (the P2-C document, Design §2, R5): no production code reads the
  // stored spec back, and a key an older build's strict reader does not know would move its whole state file aside.
  saveLaunchSpec(id: AppSessionId, spec: LaunchSpec): Promise<void> {
    return this.update(id, (file) => {
      const { appendSystemPrompt: _append, systemPromptSnapshot: _snapshot, ...stored } = LaunchSpecSchema.parse(spec); // P2-C
      void _append;
      void _snapshot;
      return { ...file, launchSpec: stored };
    });
  }

  // P5 O2 M2: the keep mark, in the state file beside the queue, so it holds across launches and an archive
  loadKeep(id: AppSessionId): Promise<boolean> {
    return this.run(id, async () => (await this.read(id)).keep === true);
  }

  saveKeep(id: AppSessionId, keep: boolean): Promise<void> {
    return this.update(id, (file) => ({ ...file, keep }));
  }

  // P5 O16 M2 (D12): the owed interrupt, in the state file, so an adopter after a crash sends it first
  loadOwedInterrupt(id: AppSessionId): Promise<boolean> {
    return this.run(id, async () => (await this.read(id)).owedInterrupt === true);
  }

  saveOwedInterrupt(id: AppSessionId, owed: boolean): Promise<void> {
    return this.update(id, (file) => ({ ...file, owedInterrupt: owed }));
  }

  // P5 O2 M2 (P5 Decision Log 46): the engine session ids the session has had, which its durable crons are matched against.
  // Ids in a state file moved aside as unreadable are lost, not none: the load rejects until a save of them succeeds,
  // so the caller's lineage stays unavailable (and a job some other id created reads as possibly the session's) rather
  // than loading clean and empty (P5 O2 branch review).
  loadEngineSessionIds(id: AppSessionId): Promise<string[]> {
    return this.run(id, async () => {
      const { engineSessionIds } = await this.read(id);
      if (this.lostEngineSessionIds.has(id)) throw new Error(`engine session ids of ${id} are unavailable: its state file was unreadable and moved aside, and they have not been saved since`);
      return engineSessionIds ?? [];
    });
  }

  saveEngineSessionIds(id: AppSessionId, ids: string[]): Promise<void> {
    return this.run(id, async () => {
      await this.write(id, { ...(await this.read(id)), engineSessionIds: [...ids] });
      this.lostEngineSessionIds.delete(id);
    });
  }

  // P5 O2 M2 (P5 Decision Log 49): the cron record, in its own file so a record this build cannot read is only a missing
  // record (the resume stays unknown), never an unreadable state file. A missing record reads as unknown at resume, so a
  // failed save unlinks the file rather than leave an older record that may be cleaner than the truth: unlink needs no
  // free blocks, so this holds under ENOSPC and across a restart of the engine host. If the unlink fails too (EACCES,
  // EROFS) it is logged and this store reads the record as missing until a save succeeds; a store after a restart would
  // read the older record (the residual the P5 tech-debt row names).
  loadCronRecord(id: AppSessionId): Promise<CronRecord | null> {
    return this.run(id, async () => {
      if (this.unremovedCronRecords.has(id)) return null;
      let text: string;
      try {
        text = await readFile(this.cronFileOf(id), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      try {
        const parsed = CronRecordSchema.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    });
  }

  saveCronRecord(id: AppSessionId, record: CronRecord): Promise<void> {
    return this.run(id, async () => {
      try {
        await this.writeCronFile(id, `${JSON.stringify(CronRecordSchema.parse(record))}\n`);
      } catch (error) {
        await unlink(this.cronFileOf(id)).catch((unlinkError: NodeJS.ErrnoException) => {
          if (unlinkError.code === 'ENOENT') return;
          this.unremovedCronRecords.add(id);
          this.warn(`cron record for ${id} was not saved and its older record could not be removed (${unlinkError.message}); a restart before a save succeeds would read it`);
        });
        throw error;
      }
      this.unremovedCronRecords.delete(id);
    });
  }

  // Archive: the session's journal directory only. The state file with the queue and the grant snapshot survives, so an
  // unarchived session resumes with them (charter §12 C10: "archive keeps the store file, delete forgets it").
  forgetJournal(id: AppSessionId): Promise<void> {
    return this.run(id, () => this.removeJournal(id));
  }

  // The whole erase: the state file and the session's journal directory (C10's delete conversation), never an archive.
  forget(id: AppSessionId): Promise<void> {
    return this.run(id, async () => {
      await rm(this.fileOf(id), { force: true });
      await rm(this.cronFileOf(id), { force: true });
      this.lostEngineSessionIds.delete(id); // erased, the session has no ids to lose
      await this.removeJournal(id);
    });
  }

  private async removeJournal(id: AppSessionId): Promise<void> {
    assertSafeAppSessionId(id);
    await rm(join(this.journalDir, id), { recursive: true, force: true });
  }

  private fileOf(id: AppSessionId): string {
    assertSafeAppSessionId(id);
    return join(this.stateDir, `${id}.json`);
  }

  private cronFileOf(id: AppSessionId): string {
    assertSafeAppSessionId(id);
    return join(this.stateDir, `${id}.cron.json`);
  }

  private async writeCronFile(id: AppSessionId, text: string): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    const temp = `${this.cronFileOf(id)}.${process.pid}.tmp`;
    await writeFile(temp, text);
    await rename(temp, this.cronFileOf(id));
  }

  // Every operation passes here first: an id that is not one plain path component never reaches the filesystem (M5 review).
  private run<T>(id: AppSessionId, op: () => Promise<T>): Promise<T> {
    try {
      assertSafeAppSessionId(id);
    } catch (error) {
      return Promise.reject(error as Error);
    }
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
    return this.run(id, async () => this.write(id, patch(await this.read(id))));
  }

  private async write(id: AppSessionId, file: StateFile): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    const temp = `${this.fileOf(id)}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(file)}\n`);
    await rename(temp, this.fileOf(id));
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
      this.lostEngineSessionIds.add(id);
      this.warn(`state file for ${id} was unreadable (${error instanceof Error ? error.message.split('\n')[0] : String(error)}); moved to ${aside}`);
      return empty();
    }
  }
}
