// The bookmarks mirror (cua board #90's spec, "Mirror"): an imported profile's Chrome bookmarks, re-read from Chrome's own
// `Bookmarks` file whenever the profile's partition is prepared (registered through `Partitions.registerPreparer`
// beside the extensions' boot load: at app start for the active profile, at its first tab for another) and on
// `browser.bookmarks.sync`. A read replaces the partition's rows and writes the record's `syncedAt` and `count`; a read
// that fails (the file gone, unreadable or over the cap, the Chrome folder moved, the index unable to take the rows)
// keeps the rows as they were and writes `error` and `errorAt`. Refused while an import or a removal runs, and when the
// index is read-only, before anything is read. After its read the sync looks at the record again and writes nothing
// when the record is gone, withdrawn by a removal under way, or no longer has consented bookmarks, so a removal
// racing a sync can neither resurrect the record nor leave rows behind (the extensions loader's pattern). One sync per
// profile runs at a time. Chrome's folder is only read. Nothing here logs a URL or a name: failures log their code.
import type { Session } from 'electron';
import type { BookmarkSyncError } from '@shared/browser/bookmarks';
import type { ImportedBookmarks } from '@shared/browser/profiles';
import type { BrowserBookmarksStore } from '../../index/browser-bookmarks';
import { readChromeBookmarks, type BookmarksRead } from '../import/chrome/bookmarks';
import { errorCode, importLog } from '../import/log';
import type { ImportedProfiles } from '../import/profiles';
import type { BrowserEmit } from '../tabs';

export type BookmarkSyncAnswer = { syncedAt: string; count: number } | { error: BookmarkSyncError | 'refused'; reason?: string };

export interface BookmarkSyncDeps {
  profiles: Pick<ImportedProfiles, 'get' | 'list' | 'browsable' | 'update'>;
  store: Pick<BrowserBookmarksStore, 'replace' | 'readOnly'>;
  busy(): 'importing' | 'removing' | null; // an import or a removal under way, app-wide
  read?: (userDataDir: string, profileDir: string) => Promise<BookmarksRead>; // readChromeBookmarks
  emit: BrowserEmit;
  env: NodeJS.ProcessEnv; // the logger's e2e mirror
  now?: () => number;
}

const REFUSED = {
  importing: 'an import is running',
  removing: 'a profile is being removed',
  notImported: 'not an imported profile',
  notConsented: 'this profile’s bookmarks were not imported',
} as const;
const refused = (reason: keyof typeof REFUSED): BookmarkSyncAnswer => ({ error: 'refused', reason: REFUSED[reason] });

export class BookmarkSync {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly read: (userDataDir: string, profileDir: string) => Promise<BookmarksRead>;
  private readonly now: () => number;

  constructor(private readonly deps: BookmarkSyncDeps) {
    this.read = deps.read ?? readChromeBookmarks;
    this.now = deps.now ?? Date.now;
  }

  // The preparation step: synchronous, never throws; the read runs after it. A partition with no record (the import's
  // own `copying` call opens one before its record exists) or no consented bookmarks is left alone.
  onPartitionPrepared(_ses: Session, partition: string): void {
    try {
      const record = this.deps.profiles.list().find((candidate) => candidate.partition === partition);
      if (!record || record.bookmarks === null) return;
      void this.sync(record.profileDir).then((answer) => {
        if ('error' in answer) this.log(answer.error);
      });
    } catch (error) {
      this.log(errorCode(error));
    }
  }

  // Re-reads the profile's `Bookmarks` now, after any sync of it already under way.
  sync(profileDir: string): Promise<BookmarkSyncAnswer> {
    const previous = this.queues.get(profileDir) ?? Promise.resolve();
    const run = previous.then(() => this.syncNow(profileDir));
    const settled = run.catch(() => {});
    this.queues.set(profileDir, settled);
    void settled.then(() => {
      if (this.queues.get(profileDir) === settled) this.queues.delete(profileDir);
    });
    return run;
  }

  // Settles once every sync queued so far has run (for tests).
  async idle(): Promise<void> {
    await Promise.all([...this.queues.values()]);
  }

  private async syncNow(profileDir: string): Promise<BookmarkSyncAnswer> {
    const record = this.deps.profiles.get(profileDir);
    if (!record) return refused('notImported');
    if (record.bookmarks === null) return refused('notConsented');
    const busy = this.deps.busy();
    if (busy !== null) return refused(busy);
    if (this.deps.store.readOnly) return { error: 'indexUnavailable' };

    const read = await this.read(record.userDataDir, profileDir);

    // A removal may have begun, or finished, while the file was read: its record is then not this sync's to write.
    const latest = this.deps.profiles.get(profileDir);
    if (!latest || !this.deps.profiles.browsable().some((candidate) => candidate.profileDir === profileDir)) return refused('notImported');
    if (latest.bookmarks === null) return refused('notConsented');
    const at = new Date(this.now()).toISOString();
    if (!read.ok) return this.failed(profileDir, read.error, at);
    try {
      this.deps.store.replace(latest.partition, read.tree);
    } catch (error) {
      this.log(errorCode(error));
      return this.failed(profileDir, 'indexUnavailable', at);
    }
    this.announce('browser.bookmarks.changed', { partition: latest.partition });
    await this.write(profileDir, (bookmarks) => ({ ...bookmarks, syncedAt: at, count: read.urls, error: null, errorAt: null }));
    return { syncedAt: at, count: read.urls };
  }

  private async failed(profileDir: string, error: BookmarkSyncError, at: string): Promise<BookmarkSyncAnswer> {
    await this.write(profileDir, (bookmarks) => ({ ...bookmarks, error, errorAt: at }));
    return { error };
  }

  // The record's bookmarks state, changed from the record as it stands when the write runs; a record gone or no longer
  // consented by then is left alone.
  private async write(profileDir: string, change: (bookmarks: ImportedBookmarks) => ImportedBookmarks): Promise<void> {
    try {
      const written = await this.deps.profiles.update(profileDir, (record) => (record.bookmarks === null ? null : { ...record, bookmarks: change(record.bookmarks) }));
      if (written) this.announce('browser.import.changed', { profiles: this.deps.profiles.list() });
    } catch (error) {
      importLog({ kind: 'error', where: 'bookmarks_record', code: errorCode(error) }, this.deps.env);
    }
  }

  private announce: BrowserEmit = (name, payload) => {
    try {
      return this.deps.emit(name, payload);
    } catch (error) {
      importLog({ kind: 'error', where: 'bookmarks_changed', code: errorCode(error) }, this.deps.env);
    }
  };

  private log(code: string): void {
    importLog({ kind: 'error', where: 'bookmarks_sync', code }, this.deps.env);
  }
}
