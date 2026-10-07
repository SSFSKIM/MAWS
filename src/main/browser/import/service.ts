// The import service (E4b Design §1, §4 to §10, §13, §14): the inspection the consent sheet shows, and the run the
// owner confirmed. One inspection and one run at a time, app-wide. The inspection stages Chrome's two stores into
// `<userData>/browser/import/<uuid>/`, counts them and lists the profile's extensions in place; the run takes that
// staging over and walks its phases in order: copying (the partition opened, its storage directory recorded), history,
// keychain, cookies, verifying (the partitioned rows confirmed), extensions, cleaning. Each phase checks the abort
// signal between rows, batches and extensions. A `done` run writes the profile's record once, at its end; a cancelled
// or failed run writes none and rolls back whole (the partition is fresh at every start, Decision Log 2); the staging is
// deleted on every exit. All of that lives in the run's one `finally`. Every dependency is injected (Task 2.5 wires
// them): the partitions (Decision Log 31), the history store, the profiles store, `emit`, the Keychain, the import
// view's factory, and the extensions phase (extensions-loader.ts, Task 2.4).
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Session } from 'electron';
import type { BrowserImportInspection } from '@shared/ipc/schema/browser';
import {
  CHROME_PROFILE_DIR,
  COOKIE_SKIP_REASONS,
  HISTORY_SKIP_REASONS,
  type ExtensionCandidate,
  type ImportCategories,
  type ImportedExtension,
  type ImportPhase,
  type ImportReport,
} from '@shared/browser/import';
import { partitionDirName, type ImportedProfile } from '@shared/browser/profiles';
import { profilePartition } from '@shared/browser/tab';
import type { BrowserHistoryStore } from '../../index/browser-history';
import type { Partitions } from '../partition';
import type { BrowserEmit } from '../tabs';
import { importPartitionedCookies, type CreateImportView } from './chips-import';
import { classifyHistoryRow, historyStoreCounts, readHistoryRows, type ImportedHistoryRow } from './chrome/history';
import { cookieStoreCounts, readCookieRows } from './chrome/cookies';
import { inspectExtensions, type InspectedExtension } from './chrome/extensions';
import { readChromeProfiles } from './chrome/local-state';
import { importCookies, planCookies, type CookiePlan, type CookiesBlock } from './cookies-import';
import type { KeychainResult } from './keychain';
import { importLog, type ImportLogEvent } from './log';
import type { ImportedProfiles } from './profiles';
import { SkipTally } from './report';
import { createStaging, deleteStaging, deleteStagingSync, openStagedStore, stageStore, type Staging, type StoreName } from './staging';

// The extensions phase, implemented by Task 2.4's extensions-loader.ts. It copies each chosen extension's version
// directory into `<stagingDir>/extensions/<id>/` and renames it into `<partitionFolder>/extensions/<id>/`, loads the
// enabled ones into `ses` (a wallet arrives `off`, P-21), waits the settle, and reads each one's status. It resolves
// with one record per extension it reached (on abort, the ones reached so far) and never rejects for one extension's
// failure; whatever it loaded before an abort or a throw is the rollback's to remove.
export interface ChosenExtension {
  candidate: ExtensionCandidate;
  versionDir: string; // in Chrome's profile, copied from and never loaded in place
}
export type ImportExtensions = (input: {
  ses: Session;
  partition: string;
  partitionFolder: string;
  stagingDir: string;
  extensions: readonly ChosenExtension[];
  signal: AbortSignal;
  progress: (done: number, total: number) => void;
}) => Promise<ImportedExtension[]>;

export interface BrowserImportDeps {
  userData: string;
  env: NodeJS.ProcessEnv; // the logger's e2e mirror
  partitions: Pick<Partitions, 'session'>;
  history: Pick<BrowserHistoryStore, 'importRows' | 'removePartition'>;
  profiles: Pick<ImportedProfiles, 'get' | 'list' | 'put'>;
  emit: BrowserEmit;
  keychain: (signal: AbortSignal) => Promise<KeychainResult>; // readSafeStorageKey, bound to the environment
  createImportView: CreateImportView;
  extensions: ImportExtensions;
  now?: () => number;
}

// Why `inspect` or `start` would not proceed; Task 2.5's handlers answer these as `invalid_input`.
export type ImportRefusal = 'unknownProfile' | 'imported' | 'unknownInspection' | 'running' | 'noCategory' | 'unverified' | 'unknownExtension';
const REFUSALS: Record<ImportRefusal, string> = {
  unknownProfile: 'not a profile of this Chrome folder',
  imported: 'this profile is already imported; remove it first',
  unknownInspection: 'the inspection is no longer current',
  running: 'an import is running',
  noCategory: 'choose at least one category',
  unverified: 'importing extensions needs the unverified-files acknowledgement',
  unknownExtension: 'an extension is not one the inspection found',
};
export class ImportRefused extends Error {
  constructor(readonly reason: ImportRefusal) {
    super(REFUSALS[reason]);
    this.name = 'ImportRefused';
  }
}

export interface StartInput {
  inspectionId: string;
  categories: ImportCategories;
  extensionIds: readonly string[];
  allowUnverifiedExtensions: boolean;
}

// A staged store as the inspection left it: copied and readable with its row count, or the category's error code.
type StagedCopy = { ok: true; file: string; rows: number } | { ok: false; code: string };

interface Inspection {
  id: string;
  staging: Staging;
  userDataDir: string;
  answer: BrowserImportInspection;
  history: StagedCopy;
  cookies: StagedCopy;
  extensions: InspectedExtension[];
}

interface Run {
  importId: string;
  profileDir: string;
  staging: Staging;
  controller: AbortController;
}

type Progress = (phase: ImportPhase, done: number, total: number) => void;

const HISTORY_BATCH = 500;
const PROGRESS_INTERVAL_MS = 100;
const STORAGE_DIR = /^maws-chrome-[^/\\]+$/;

// Progress per phase at most every 100 ms, plus the first and the last of each (Interfaces, `browser.import.progress`).
export function progressThrottle(send: Progress, now: () => number, intervalMs = PROGRESS_INTERVAL_MS): Progress {
  const last = new Map<ImportPhase, number>();
  return (phase, done, total) => {
    const at = now();
    const previous = last.get(phase);
    if (previous !== undefined && done < total && at - previous < intervalMs) return;
    last.set(phase, at);
    send(phase, done, total);
  };
}

export class BrowserImportService {
  private inspection: Inspection | null = null;
  private current: Run | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: BrowserImportDeps) {
    this.now = deps.now ?? Date.now;
  }

  // The run under way, for the e2e seam and for refusing a removal meanwhile.
  running(): { importId: string; profileDir: string } | null {
    return this.current && { importId: this.current.importId, profileDir: this.current.profileDir };
  }

  // Stages the two stores, counts them, lists the extensions in place; a standing inspection is discarded first. The
  // profile directory is admitted only as `Local State` names it and the disk holds it (local-state.ts).
  async inspect({ userDataDir, profileDir }: { userDataDir: string; profileDir: string }): Promise<BrowserImportInspection> {
    await this.dropInspection();
    if (!CHROME_PROFILE_DIR.test(profileDir)) throw new ImportRefused('unknownProfile');
    const chrome = await readChromeProfiles(userDataDir, (dir) => this.deps.profiles.get(dir) !== null);
    const profile = chrome.profiles.find((candidate) => candidate.profileDir === profileDir);
    if (!profile) throw new ImportRefused('unknownProfile');
    if (profile.imported) throw new ImportRefused('imported'); // a re-import is a removal and an import (Decision Log 2)
    const profilePath = join(userDataDir, profileDir);

    const staging = await createStaging(this.deps.userData);
    try {
      const history = await this.stage(profilePath, staging, 'History', (db) => historyStoreCounts(db).rows);
      let cookieCounts = { partitioned: 0, storeVersion: 0 }; // read with the row count, from the same open copy
      const cookies = await this.stage(profilePath, staging, 'Cookies', (db) => {
        const { rows, partitioned, storeVersion } = cookieStoreCounts(db);
        cookieCounts = { partitioned, storeVersion };
        return rows;
      });
      const extensions = await inspectExtensions(profilePath);
      const answer: BrowserImportInspection = {
        inspectionId: staging.id,
        profile,
        chromeRunning: chrome.chromeRunning,
        history: history.ok ? { rows: history.rows } : { error: history.code },
        cookies: cookies.ok ? { rows: cookies.rows, ...cookieCounts } : { error: cookies.code },
        extensions: extensions.map((extension) => extension.candidate),
      };
      await this.dropInspection(); // a second inspection finished meanwhile: this one is the newer
      this.inspection = { id: staging.id, staging, userDataDir, answer, history, cookies, extensions };
      return answer;
    } catch (error) {
      await deleteStaging(staging);
      throw error;
    }
  }

  async discard(inspectionId: string): Promise<void> {
    if (this.inspection?.id === inspectionId) await this.dropInspection();
  }

  // Validates the consent against the standing inspection, takes its staging over and starts the run; `finished`
  // settles with the report the `browser.import.finished` event carries, and never rejects.
  start({ inspectionId, categories, extensionIds, allowUnverifiedExtensions }: StartInput): { importId: string; finished: Promise<ImportReport> } {
    if (this.current) throw new ImportRefused('running');
    const inspection = this.inspection;
    if (!inspection || inspection.id !== inspectionId) throw new ImportRefused('unknownInspection');
    if (!categories.history && !categories.cookies && !categories.extensions) throw new ImportRefused('noCategory');
    // Nothing from the profile runs before the owner acknowledged the unverified files (Design §15).
    if (categories.extensions && !allowUnverifiedExtensions) throw new ImportRefused('unverified');
    const chosen: ChosenExtension[] = [];
    if (categories.extensions) {
      for (const id of new Set(extensionIds)) {
        const found = inspection.extensions.find((extension) => extension.candidate.id === id);
        if (!found || found.versionDir === null || found.candidate.error !== null) throw new ImportRefused('unknownExtension');
        chosen.push({ candidate: found.candidate, versionDir: found.versionDir });
      }
    }
    const { profileDir } = inspection.answer.profile;
    if (this.deps.profiles.get(profileDir) !== null) throw new ImportRefused('imported');

    this.inspection = null; // the run owns the staging now
    const run: Run = { importId: randomUUID(), profileDir, staging: inspection.staging, controller: new AbortController() };
    this.current = run;
    const finished = this.run(run, inspection, categories, chosen);
    return { importId: run.importId, finished };
  }

  cancel(importId: string): void {
    if (this.current?.importId === importId) this.current.controller.abort();
  }

  // At `will-quit`: the run cancelled (the Keychain child killed, the import view destroyed) and every staging
  // directory removed synchronously; nothing asynchronous finishes after this (Design §13).
  stop(): void {
    if (this.current) {
      this.current.controller.abort();
      deleteStagingSync(this.current.staging);
    }
    if (this.inspection) {
      deleteStagingSync(this.inspection.staging);
      this.inspection = null;
    }
  }

  // ---- the run ----------------------------------------------------------------------------------------------------

  private async run(run: Run, inspection: Inspection, categories: ImportCategories, chosen: readonly ChosenExtension[]): Promise<ImportReport> {
    const { signal } = run.controller;
    const { profile } = inspection.answer;
    const partition = profilePartition(profile.profileDir);
    const partitionFolder = join(this.deps.userData, 'browser', partitionDirName(partition));
    const progress = this.progressFor(run.importId);
    const report: ImportReport = {
      profileDir: profile.profileDir,
      name: profile.name,
      partition,
      startedAt: this.iso(),
      finishedAt: this.iso(),
      outcome: 'done',
      failure: null,
      history: null,
      cookies: null,
      extensions: null,
    };
    let ses: Session | null = null;
    let storageDirName = '';
    await nextTurn(); // `start` answers `{ importId }` before any event of the run
    try {
      progress('copying', 0, 1);
      try {
        ses = this.deps.partitions.session(partition);
        storageDirName = basename(ses.storagePath ?? '');
      } catch {
        ses = null;
      }
      if (ses === null || !STORAGE_DIR.test(storageDirName)) {
        ses = null; // a session the guard refused is never rolled back: it may not be this profile's
        throw new RunFailure('partitionUnavailable');
      }
      progress('copying', 1, 1);

      if (categories.history && !signal.aborted) report.history = await this.importHistory(inspection.history, partition, signal, progress);
      if (categories.cookies && !signal.aborted) report.cookies = await this.importCookies(inspection.cookies, ses, partition, run, progress);
      if (categories.extensions && !signal.aborted) {
        report.extensions =
          chosen.length === 0
            ? []
            : await this.deps.extensions({
                ses,
                partition,
                partitionFolder,
                stagingDir: run.staging.dir,
                extensions: chosen,
                signal,
                progress: (done, total) => progress('extensions', done, total),
              });
      }
      if (signal.aborted) report.outcome = 'cancelled';
    } catch (error) {
      report.outcome = signal.aborted ? 'cancelled' : 'failed';
      if (report.outcome === 'failed') report.failure = this.failureOf(error);
    } finally {
      progress('cleaning', 0, 1);
      this.fillUnreached(report, categories, inspection);
      report.finishedAt = this.iso();
      if (report.outcome === 'done') {
        try {
          await this.deps.profiles.put(this.recordOf(report, inspection, storageDirName));
        } catch (error) {
          report.outcome = 'failed';
          report.failure = 'recordUnwritable';
          this.log({ kind: 'error', where: 'record', code: codeOf(error) });
        }
      }
      // Announced only once the record stands; a failed announcement never undoes a written record.
      if (report.outcome === 'done') {
        try {
          this.deps.emit('browser.import.changed', { profiles: this.deps.profiles.list() });
        } catch (error) {
          this.log({ kind: 'error', where: 'changed', code: codeOf(error) });
        }
      }
      if (report.outcome !== 'done' && ses !== null) await this.rollback(ses, partition, partitionFolder);
      await deleteStaging(run.staging).catch((error: unknown) => this.log({ kind: 'error', where: 'staging', code: codeOf(error) }));
      progress('cleaning', 1, 1);
      this.current = null;
      this.deps.emit('browser.import.finished', { importId: run.importId, report });
    }
    return report;
  }

  // History (Design §6): the staged copy's rows classified, the importable ones written in batches of 500, each batch
  // one transaction; progress and the abort checked between batches. An unavailable index fails this category only.
  private async importHistory(staged: StagedCopy, partition: string, signal: AbortSignal, progress: Progress): Promise<NonNullable<ImportReport['history']>> {
    const tally = new SkipTally(HISTORY_SKIP_REASONS, (reason, host) => this.log({ kind: 'skip', category: 'history', reason, host }));
    let imported = 0;
    const block = (error: string | null = null) => ({ imported, skipped: tally.skipped, hosts: tally.hosts, error });
    if (!staged.ok) return block(staged.code);
    const rows = this.readStore(staged.file, readHistoryRows);
    if (!rows.ok) return block(rows.code);

    progress('history', 0, rows.value.length);
    for (let at = 0; at < rows.value.length; at += HISTORY_BATCH) {
      if (signal.aborted) break;
      const batch: ImportedHistoryRow[] = [];
      for (const row of rows.value.slice(at, at + HISTORY_BATCH)) {
        const decision = classifyHistoryRow(row);
        if (decision.kind === 'import') batch.push(decision.row);
        else tally.add(decision.reason, decision.host);
      }
      try {
        if (batch.length > 0) imported += this.deps.history.importRows(partition, batch);
      } catch (error) {
        this.log({ kind: 'error', where: 'history', code: codeOf(error) });
        return block(codeOf(error));
      }
      progress('history', Math.min(at + HISTORY_BATCH, rows.value.length), rows.value.length);
      await nextTurn(); // a cancel arriving over IPC is heard between batches
    }
    return block();
  }

  // Cookies (Design §5, §7, §8): the staged copy read, the Keychain asked once, every row decoded with the key, the key
  // zeroed at once, then the plan set into the partition. Only `allowed` goes on; the Keychain's own `cancelled` (the
  // abort killed the child) is a cancelled run.
  private async importCookies(staged: StagedCopy, ses: Session, partition: string, run: Run, progress: Progress): Promise<CookiesBlock> {
    const { signal } = run.controller;
    if (!staged.ok) return emptyCookies('skipped', staged.code);
    const read = this.readStore(staged.file, readCookieRows);
    if (!read.ok) return emptyCookies('skipped', read.code);
    const rows = read.value.rows.length;
    if (rows === 0) return emptyCookies('skipped', null); // nothing to decrypt: the Keychain is never asked

    progress('keychain', 0, 1);
    const answer = await this.deps.keychain(signal);
    let plan: CookiePlan;
    try {
      this.log({ kind: 'keychain', outcome: answer.outcome, exitCode: answer.outcome === 'denied' ? answer.exitCode : null });
      progress('keychain', 1, 1);
      if (answer.outcome === 'cancelled' || signal.aborted) {
        run.controller.abort(); // the Keychain step was cancelled: so is the run
        return emptyCookies('skipped', null, rows);
      }
      if (answer.outcome !== 'allowed') return emptyCookies(answer.outcome, answer.outcome === 'denied' ? answer.error : null);
      plan = planCookies(read.value.rows, answer.key, read.value.storeVersion, this.now());
    } finally {
      if (answer.outcome === 'allowed') answer.key.fill(0); // the key exists for the decode only, and is never written, logged or sent
    }
    if (plan.wrongKey) this.log({ kind: 'keychain', outcome: 'wrongKey' });
    return importCookies({
      plan,
      ses,
      partition,
      signal,
      progress,
      importPartitioned: (input) => importPartitionedCookies({ ...input, createView: this.deps.createImportView }),
      onSkip: (reason, host) => this.log({ kind: 'skip', category: 'cookies', reason, host }),
    });
  }

  // Undoes a cancelled or failed run (Design §14): the partition was fresh at start, so its history and storage are this
  // run's; of its extensions, the ones loaded from the partition's own folder are. Each step is attempted whatever the
  // one before did.
  private async rollback(ses: Session, partition: string, partitionFolder: string): Promise<void> {
    const roots = [partitionFolder, realOrNull(partitionFolder)].filter((root): root is string => root !== null).map((root) => root + sep);
    const steps: [string, () => unknown][] = [
      ['history', () => this.deps.history.removePartition(partition)],
      [
        'extensions',
        () => {
          for (const extension of ses.extensions.getAllExtensions()) {
            if (roots.some((root) => extension.path.startsWith(root))) ses.extensions.removeExtension(extension.id);
          }
        },
      ],
      ['storage', () => ses.clearStorageData()],
      ['cookies', () => ses.cookies.flushStore()],
      ['folder', () => rm(partitionFolder, { recursive: true, force: true })],
    ];
    for (const [where, step] of steps) {
      try {
        await step();
      } catch (error) {
        this.log({ kind: 'error', where: `rollback_${where}`, code: codeOf(error) });
      }
    }
  }

  // ---- helpers ------------------------------------------------------------------------------------------------------

  private async stage(profilePath: string, staging: Staging, store: StoreName, count: (db: DatabaseSync) => number): Promise<StagedCopy> {
    const staged = await stageStore(profilePath, staging, store);
    if (!staged.ok) return { ok: false, code: staged.error === 'missing' ? 'missing' : staged.code };
    const opened = openStagedStore(staged.file);
    if (!opened.ok) return { ok: false, code: opened.code };
    try {
      return { ok: true, file: staged.file, rows: count(opened.db) };
    } catch (error) {
      return { ok: false, code: codeOf(error) };
    } finally {
      opened.db.close();
    }
  }

  private readStore<T>(file: string, read: (db: DatabaseSync) => T): { ok: true; value: T } | { ok: false; code: string } {
    const opened = openStagedStore(file);
    if (!opened.ok) return { ok: false, code: opened.code };
    try {
      return { ok: true, value: read(opened.db) };
    } catch (error) {
      return { ok: false, code: codeOf(error) };
    } finally {
      opened.db.close();
    }
  }

  private async dropInspection(): Promise<void> {
    const standing = this.inspection;
    this.inspection = null;
    if (standing) await deleteStaging(standing.staging);
  }

  // A category the owner chose that the run never reached (a cancel or a failure before it) still has its block, so
  // the report says what happened to it: the cookies not reached are `cancelled` on a cancel.
  private fillUnreached(report: ImportReport, categories: ImportCategories, inspection: Inspection): void {
    if (categories.history && report.history === null) report.history = { imported: 0, skipped: { hidden: 0, unsupportedScheme: 0, invalid: 0 }, hosts: {}, error: null };
    if (categories.cookies && report.cookies === null) {
      const rows = report.outcome === 'cancelled' && inspection.cookies.ok ? inspection.cookies.rows : 0;
      report.cookies = emptyCookies('skipped', null, rows);
    }
    if (categories.extensions && report.extensions === null) report.extensions = [];
  }

  private recordOf(report: ImportReport, inspection: Inspection, storageDirName: string): ImportedProfile {
    return {
      profileDir: report.profileDir,
      name: report.name,
      partition: report.partition,
      importedAt: report.finishedAt,
      storageDirName,
      userDataDir: inspection.userDataDir,
      extensions: report.extensions ?? [],
      report,
    };
  }

  private failureOf(error: unknown): string {
    if (error instanceof RunFailure) return error.code;
    this.log({ kind: 'error', where: 'import', code: codeOf(error), message: error instanceof Error ? error.message : undefined });
    return 'unexpected';
  }

  private progressFor(importId: string): Progress {
    const throttled = progressThrottle((phase, done, total) => this.deps.emit('browser.import.progress', { importId, phase, done, total }), this.now);
    const started = new Set<ImportPhase>();
    return (phase, done, total) => {
      throttled(phase, done, total);
      if (!started.has(phase) || done >= total) this.log({ kind: 'phase', importId, phase, done, total });
      started.add(phase);
    };
  }

  private log(event: ImportLogEvent): void {
    importLog(event, this.deps.env);
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }
}

class RunFailure extends Error {
  constructor(readonly code: 'partitionUnavailable') {
    super(code);
  }
}

function emptyCookies(keychain: CookiesBlock['keychain'], error: string | null, cancelled = 0): CookiesBlock {
  const tally = new SkipTally(COOKIE_SKIP_REASONS);
  tally.add('cancelled', null, cancelled);
  return { imported: 0, partitioned: { imported: 0, verified: 0 }, skipped: tally.skipped, hosts: tally.hosts, keychain, error };
}

// An error's code as the report and the log keep it: an identifier (`EBUSY`, `indexUnavailable`), never its message.
function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(code) ? code : 'unexpected';
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

// The folder's real path (Electron may report an extension's path resolved), or null when it does not exist.
function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
