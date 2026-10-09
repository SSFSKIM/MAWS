// The imported extensions (E4b Design §9; Decision Log 4, 19, 20, 32): copied, loaded, watched, toggled, and loaded again
// at every boot. Nothing is ever loaded from Chrome's directory: at import each chosen version directory is copied into
// `<staging>/extensions/<id>/` (a symlink anywhere in the tree fails that copy) and renamed into
// `<partitionFolder>/extensions/<id>/`, so a half-copied extension can never be loaded. The enabled ones (a wallet
// arrives off, P-21) load with `allowFileAccess: false`, and an extension Electron says it loaded from anywhere but the
// partition folder is unloaded and refused. One settle of 1.5 s after the loads reads each background: `failed` when its
// worker threw while it evaluated (even if Chromium keeps it alive), else `running` when a worker of the extension is
// running, `failed` when its worker logged an error (or stopped) during the settle, `stopped` otherwise, `none` without a
// background (E0b: "loads is not works").
//
// Per boot, `onPartitionPrepared` (registered through `Partitions.registerPreparer`) starts loading the enabled
// extensions of the record whose partition was just prepared, and writes the statuses it observes back to the record.
// Preparation is synchronous and loading is not, so a view created in that partition while its loads are pending has
// its first `loadURL` held until its `loadExtension` calls have settled (`holdFirstLoad`), at most FIRST_LOAD_HOLD_MS;
// whether Chromium has handed the content scripts to the page's renderer by then is not observable from Electron, which
// is why the active profile's partition is also prepared at boot (Decision Log 39). Everything one profile's extensions
// go through (a boot load, a toggle, a removal's unloading) runs in one queue per partition, so a boot load's statuses
// never overwrite a toggle made meanwhile, and a toggle never writes a record a removal has begun to drop.
import { realpathSync } from 'node:fs';
import { cp, lstat, mkdir, rename, rm } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { Extension, ServiceWorkersRunningStatusChangedEventParams, Session, WebContents } from 'electron';
import type { ImportedExtension } from '@shared/browser/import';
import { partitionDirName } from '@shared/browser/profiles';
import { errorCode, importLog, redactMessage } from './log';
import type { ImportedProfiles } from './profiles';
import { ImportRefused, type ImportExtensions } from './service';

export const SETTLE_MS = 1500; // E0b's wait: long enough for a worker that fails at evaluation to have failed
export const FIRST_LOAD_HOLD_MS = 10_000; // a load that never settles holds a page no longer than this

export interface ExtensionsLoaderDeps {
  userData: string;
  profiles: Pick<ImportedProfiles, 'get' | 'list' | 'update'>;
  env: NodeJS.ProcessEnv; // the logger's e2e mirror
  changed?: () => void; // a boot load wrote its statuses to a record
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>; // the settle's clock
  now?: () => number;
}

type LoadOutcome = { ok: true; extension: Extension } | { ok: false; error: string };
type Workers = Session['serviceWorkers'];

export class ExtensionsLoader {
  private readonly live = new Map<string, Session>(); // the partitions prepared this boot
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly loads = new Map<string, Promise<void>>(); // a boot load's `loadExtension` calls, until all settled
  private readonly removing = new Set<string>();
  private readonly wait: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly deps: ExtensionsLoaderDeps) {
    this.wait = deps.wait ?? delay;
    this.now = deps.now ?? Date.now;
  }

  // The import's extensions phase (service.ts's contract): every chosen extension copied and moved into place first,
  // then the enabled ones loaded and settled. On abort it resolves with the extensions whose outcome was reached (the
  // ones off or failed to copy, and any loaded), removing nothing: what it loaded is the rollback's to remove.
  readonly importExtensions: ImportExtensions = async ({ ses, partitionFolder, stagingDir, extensions, signal, progress }) => {
    const records: ImportedExtension[] = [];
    progress(0, extensions.length);
    for (const [at, { candidate, versionDir }] of extensions.entries()) {
      if (signal.aborted) break;
      const record: ImportedExtension = {
        id: candidate.id,
        chromeId: null,
        name: candidate.name,
        version: candidate.version,
        enabled: !candidate.wallet,
        wallet: candidate.wallet,
        unsupportedPermissions: [...candidate.unsupportedPermissions],
        status: 'off',
        error: null,
        background: 'none',
        backgroundError: null,
        checkedAt: this.iso(),
      };
      const copied = await copyIntoPlace(versionDir, stagingDir, partitionFolder, candidate.id);
      records.push(copied === null ? record : { ...record, status: 'copyFailed', error: copied });
      if (copied !== null) this.log({ kind: 'skip', category: 'extensions', reason: 'copyFailed' });
      progress(at + 1, extensions.length);
    }
    const toLoad = records.filter((record) => record.enabled && record.status === 'off');
    const loaded = signal.aborted ? new Map<ImportedExtension, ImportedExtension>() : await this.loadAndSettle(ses, partitionFolder, toLoad, { signal });
    // An enabled extension the abort kept from loading has no outcome yet: it is left out rather than called off.
    return records.flatMap((record) => (!toLoad.includes(record) ? [this.logged(record)] : (loaded.get(record) ?? [])));
  };

  // The per-boot step (Decision Log 32), run inside E4a's partition preparation: it must never throw there.
  onPartitionPrepared(ses: Session, partition: string): void {
    try {
      this.live.set(partition, ses);
      if (this.removing.has(partition)) return;
      const record = this.deps.profiles.list().find((candidate) => candidate.partition === partition);
      if (!record || !record.extensions.some(loadable)) return;
      let loadsDone!: () => void;
      const loads = new Promise<void>((resolve) => (loadsDone = resolve));
      this.loads.set(partition, loads);
      const finishLoads = () => {
        if (this.loads.get(partition) === loads) this.loads.delete(partition);
        loadsDone();
      };
      this.enqueue(partition, () => this.bootLoad(ses, record.profileDir, partition, finishLoads))
        .catch((error: unknown) => this.log({ kind: 'error', where: 'extensions_boot', code: errorCode(error) }))
        .finally(finishLoads);
    } catch (error) {
      this.log({ kind: 'error', where: 'extensions_boot', code: errorCode(error) });
    }
  }

  // The loads a view of this partition must wait for, or null when none are pending.
  loading(partition: string): Promise<void> | null {
    return this.loads.get(partition) ?? null;
  }

  // Holds the first page of a view created while its partition's loads are pending (the boot race), at most
  // FIRST_LOAD_HOLD_MS on the settle's clock.
  holdIfLoading(webContents: Pick<WebContents, 'loadURL' | 'isDestroyed'>, partition: string): void {
    const loads = this.loading(partition);
    if (!loads) return;
    const bound = new AbortController();
    const ready = Promise.race([loads, this.wait(FIRST_LOAD_HOLD_MS, bound.signal)]).finally(() => bound.abort());
    holdFirstLoad(webContents, ready);
  }

  // E4a's `onViewCreated` hook: a tab's new view, held when its partition's loads are pending.
  holdNewView(entry: { tab: { partition: string }; view: { webContents: Pick<WebContents, 'loadURL' | 'isDestroyed'> } | null }): void {
    if (entry.view) this.holdIfLoading(entry.view.webContents, entry.tab.partition);
  }

  // Settles once everything queued for the partition has run (for tests).
  async idle(partition: string): Promise<void> {
    await this.queues.get(partition);
  }

  // The owner's toggle (P-21; Design §9 "Toggles"): written to the record, and applied at once when the partition was
  // prepared this boot (loaded, settled and read, or unloaded); otherwise applied at its next preparation. A profile
  // being removed is no longer imported: a toggle queued or settling when its removal begins writes nothing and unloads
  // what it loaded, so it can never put back the record the removal drops.
  async setExtension(profileDir: string, extensionId: string, enabled: boolean): Promise<ImportedExtension> {
    const record = this.deps.profiles.get(profileDir);
    if (!record || this.removing.has(record.partition)) throw new ImportRefused('notImported');
    if (!record.extensions.some((extension) => extension.id === extensionId)) throw new ImportRefused('notInRecord');
    return this.enqueue(record.partition, async () => {
      const current = this.deps.profiles.get(profileDir);
      const extension = current?.extensions.find((candidate) => candidate.id === extensionId);
      if (!current || this.removing.has(current.partition)) throw new ImportRefused('notImported');
      if (!extension) throw new ImportRefused('notInRecord');
      const ses = this.live.get(current.partition) ?? null;
      let next: ImportedExtension;
      if (!enabled) {
        if (ses?.extensions.getExtension(extension.id)) ses.extensions.removeExtension(extension.id);
        next =
          extension.status === 'copyFailed'
            ? { ...extension, enabled: false }
            : { ...extension, enabled: false, status: 'off', error: null, background: 'none', backgroundError: null, checkedAt: this.iso() };
      } else if (ses && loadable({ ...extension, enabled: true }) && !ses.extensions.getExtension(extension.id)) {
        const wanted = { ...extension, enabled: true };
        next = (await this.loadAndSettle(ses, this.partitionFolder(current.partition), [wanted])).get(wanted)!;
      } else {
        next = { ...extension, enabled: true };
      }
      // Read again after the settle: a removal may have begun, or dropped the record, meanwhile.
      const unloadNext = () => {
        if (ses && next.status === 'loaded' && ses.extensions.getExtension(next.id)) ses.extensions.removeExtension(next.id);
      };
      const latest = this.deps.profiles.get(profileDir);
      if (!latest || this.removing.has(latest.partition)) {
        unloadNext();
        throw new ImportRefused('notImported');
      }
      // cua #90: changed from the record as it stands when the write runs, so a bookmarks sync's write is never lost
      const written = await this.deps.profiles.update(profileDir, (record) => ({
        ...record,
        extensions: record.extensions.map((candidate) => (candidate.id === extension.id ? next : candidate)),
      }));
      if (written === null) {
        unloadNext(); // the record went in the write queue's turn before this one
        throw new ImportRefused('notImported');
      }
      return next;
    });
  }

  // Removal's step 2 (Design §12): every extension loaded from the record's partition folder is unloaded, after anything
  // queued for it, and no later preparation loads it again until `removalDone`. Answers how many were unloaded.
  async unloadForRemoval(record: { partition: string }): Promise<number> {
    this.removing.add(record.partition);
    return this.enqueue(record.partition, async () => {
      const ses = this.live.get(record.partition);
      if (!ses) return 0;
      const roots = rootsOf(this.partitionFolder(record.partition));
      let unloaded = 0;
      for (const extension of ses.extensions.getAllExtensions()) {
        if (!under(extension.path, roots)) continue;
        try {
          ses.extensions.removeExtension(extension.id);
          unloaded++;
        } catch (error) {
          this.log({ kind: 'error', where: 'extensions_unload', code: errorCode(error) });
        }
      }
      return unloaded;
    });
  }

  removalDone(partition: string): void {
    this.removing.delete(partition);
  }

  // ---- loading ------------------------------------------------------------------------------------------------------

  // A boot's load of the record's enabled extensions, its statuses then written back over the record as it stands.
  private async bootLoad(ses: Session, profileDir: string, partition: string, loadsDone: () => void): Promise<void> {
    const record = this.deps.profiles.get(profileDir);
    if (!record || this.removing.has(partition)) return;
    const wanted = record.extensions.filter((extension) => loadable(extension) && !ses.extensions.getExtension(extension.id));
    const results = await this.loadAndSettle(ses, this.partitionFolder(partition), wanted, { loadsDone });
    if (results.size === 0) return;
    const byId = new Map([...results].map(([before, after]) => [before.id, after]));
    const withStatuses = (extensions: readonly ImportedExtension[]) =>
      extensions.map((extension) => {
        const after = byId.get(extension.id);
        if (!after) return extension;
        const { id, chromeId, status, error, background, backgroundError, checkedAt } = after;
        return { ...extension, id, chromeId, status, error, background, backgroundError, checkedAt };
      });
    try {
      // cua #90: over the record as it stands when the write runs (a bookmarks sync writes the same record at boot)
      const written = await this.deps.profiles.update(profileDir, (current) => ({ ...current, extensions: withStatuses(current.extensions) }));
      if (written) this.deps.changed?.();
    } catch (error) {
      this.log({ kind: 'error', where: 'extensions_record', code: errorCode(error) });
    }
  }

  // Loads each extension from its folder, then one settle, then each status. The workers are watched from before the
  // first load, so an error thrown while a worker evaluates is seen. Keyed by the record handed in.
  private async loadAndSettle(
    ses: Session,
    partitionFolder: string,
    extensions: readonly ImportedExtension[],
    { signal, loadsDone }: { signal?: AbortSignal; loadsDone?: () => void } = {},
  ): Promise<Map<ImportedExtension, ImportedExtension>> {
    const results = new Map<ImportedExtension, ImportedExtension>();
    const roots = rootsOf(partitionFolder);
    const watch = watchBackgrounds(ses.serviceWorkers);
    try {
      const outcomes: [ImportedExtension, LoadOutcome][] = [];
      for (const extension of extensions) {
        if (signal?.aborted) break;
        outcomes.push([extension, await loadOne(ses, join(partitionFolder, 'extensions', directoryId(extension)), roots)]);
      }
      loadsDone?.();
      const settles = outcomes.some(([, outcome]) => outcome.ok && hasBackground(outcome.extension));
      if (settles && !signal?.aborted) await this.wait(SETTLE_MS, signal);
      for (const [extension, outcome] of outcomes) results.set(extension, this.logged(this.statusOf(extension, outcome, watch)));
    } finally {
      watch.stop();
    }
    return results;
  }

  private statusOf(extension: ImportedExtension, outcome: LoadOutcome, watch: BackgroundWatch): ImportedExtension {
    const checkedAt = this.iso();
    if (!outcome.ok) return { ...extension, status: 'loadFailed', error: outcome.error, background: 'none', backgroundError: null, checkedAt };
    const loaded = outcome.extension;
    const chromeId = directoryId(extension);
    const ids = loaded.id === chromeId ? { id: chromeId, chromeId: null } : { id: loaded.id, chromeId }; // Decision Log 20
    return { ...extension, ...ids, status: 'loaded', error: null, ...backgroundOf(loaded, watch, extension.unsupportedPermissions), checkedAt };
  }

  private logged(extension: ImportedExtension): ImportedExtension {
    if (extension.status === 'loadFailed') this.log({ kind: 'skip', category: 'extensions', reason: 'loadFailed' });
    if (extension.status !== 'copyFailed') this.log({ kind: 'extension', id: extension.id, status: extension.status, background: extension.background });
    return extension;
  }

  private enqueue<T>(partition: string, task: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(partition) ?? Promise.resolve()).then(task);
    const tail = result.then(
      () => {},
      () => {},
    );
    this.queues.set(partition, tail);
    void tail.then(() => {
      if (this.queues.get(partition) === tail) this.queues.delete(partition);
    });
    return result;
  }

  private partitionFolder(partition: string): string {
    return join(this.deps.userData, 'browser', partitionDirName(partition));
  }

  private log(event: Parameters<typeof importLog>[0]): void {
    importLog(event, this.deps.env);
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }
}

// ---- the background status ------------------------------------------------------------------------------------------

interface BackgroundWatch {
  running(url: string): boolean;
  error(url: string): string | null;
  evaluationError(url: string): string | null; // an exception thrown while the version was starting, before it ran
  stopped(url: string): boolean;
  stop(): void;
}

// What the session's workers report while extensions load and settle: errors (`console-message` at level 3, the
// worker's uncaught error naming the absent `chrome.*` member) and versions that stopped (`running-status-changed`, an
// experimental signal; a version's scope is learnt while it is still known, since a stopped one may no longer be). An
// exception thrown synchronously while its version was reported `starting` and not yet `running` was thrown as the
// worker evaluated: the script stopped there, whether or not Chromium then keeps the worker alive (Electron 44.4.5 does
// when a debugger is attached to the session's targets, as Playwright's is; without one it stops the worker). Anything
// else at level 3 while starting (an error the worker logs itself, an `Uncaught (in promise)` rejection) did not stop
// the script, so the worker is read by whether it runs.
const THROWN_WHILE_EVALUATING = /^Uncaught (?!\(in promise\))/;

function watchBackgrounds(workers: Workers): BackgroundWatch {
  const errors: { url: string; message: string; evaluating: boolean }[] = [];
  const scopes = new Map<number, string>();
  const stopped = new Set<number>();
  const status = new Map<number, string>();
  const onConsole = (_event: unknown, details: Electron.MessageDetails) => {
    if (details.level !== 3) return;
    const evaluating = status.get(details.versionId) === 'starting' && THROWN_WHILE_EVALUATING.test(details.message);
    errors.push({ url: details.sourceUrl, message: details.message, evaluating });
  };
  const onStatus = ({ versionId, runningStatus }: ServiceWorkersRunningStatusChangedEventParams) => {
    if (!scopes.has(versionId)) {
      try {
        scopes.set(versionId, workers.getInfoFromVersionID(versionId).scope);
      } catch {
        // gone already: this version's stop cannot be attributed
      }
    }
    if (runningStatus === 'stopped') stopped.add(versionId);
    status.set(versionId, runningStatus);
  };
  workers.on('console-message', onConsole);
  workers.on('running-status-changed', onStatus);
  return {
    running: (url) => Object.values(workers.getAllRunning()).some((worker) => worker.scope.startsWith(url)),
    error: (url) => errors.find((entry) => entry.url.startsWith(url))?.message ?? null,
    evaluationError: (url) => errors.find((entry) => entry.evaluating && entry.url.startsWith(url))?.message ?? null,
    stopped: (url) => [...stopped].some((versionId) => scopes.get(versionId)?.startsWith(url) ?? false),
    stop: () => {
      workers.off('console-message', onConsole);
      workers.off('running-status-changed', onStatus);
    },
  };
}

const hasBackground = (extension: Extension) => Boolean((extension.manifest as { background?: unknown } | null)?.background);

function backgroundOf(extension: Extension, watch: BackgroundWatch, unsupported: readonly string[]): Pick<ImportedExtension, 'background' | 'backgroundError'> {
  if (!hasBackground(extension)) return { background: 'none', backgroundError: null };
  const url = extension.url.endsWith('/') ? extension.url : `${extension.url}/`;
  const thrown = watch.evaluationError(url);
  if (thrown !== null) return { background: 'failed', backgroundError: describeBackgroundError(thrown, unsupported) };
  if (watch.running(url)) return { background: 'running', backgroundError: null };
  const error = watch.error(url);
  if (error !== null) return { background: 'failed', backgroundError: describeBackgroundError(error, unsupported) };
  if (watch.stopped(url)) return { background: 'failed', backgroundError: null };
  return { background: 'stopped', backgroundError: null }; // an MV2 page, or a worker seen neither running nor failing
}

const READING = /reading '([A-Za-z_$][\w$]{0,63})'/;

// The worker's error as the report shows it (Decision Log 19): Electron's text names the member a missing `chrome.*`
// namespace lacked (`Cannot read properties of undefined (reading 'onClicked')`); the namespace is named only when the
// manifest asks for exactly one permission Electron lacks, otherwise the member alone. Any other error keeps its first
// line, redacted.
export function describeBackgroundError(message: string, unsupportedPermissions: readonly string[]): string {
  const member = READING.exec(message)?.[1];
  if (!member) return redactMessage(message.split('\n')[0] ?? '');
  return unsupportedPermissions.length === 1 ? `chrome.${unsupportedPermissions[0]}.${member} is not available in MAWS` : `${member} of an unavailable chrome API`;
}

// ---- the first page's hold ------------------------------------------------------------------------------------------

// Defers `loadURL` on this page until `ready`, then puts the original back; a load asked meanwhile runs in order once
// ready, unless the page was closed first. E4a's tab store voids the promise and reads the navigation from the view's
// events, so a deferred load reads as a slow start. A synchronous throw of the original load becomes the held load's
// rejection, which E4a's `.catch` swallows where it would have failed the view: harmless, because the throws Electron's
// `loadURL` makes synchronously are for a destroyed page (checked here first) and a malformed argument (E4a passes only
// URLs `validateBrowserUrl` admitted).
export function holdFirstLoad(webContents: Pick<WebContents, 'loadURL' | 'isDestroyed'>, ready: Promise<void>): void {
  const original = webContents.loadURL;
  const held: WebContents['loadURL'] = (url, options) =>
    ready.then(() => {
      if (webContents.isDestroyed()) throw new Error('the page was closed before its first load');
      return original.call(webContents, url, options);
    });
  webContents.loadURL = held;
  void ready.then(() => {
    if (webContents.loadURL === held) webContents.loadURL = original;
  });
}

// ---- files ----------------------------------------------------------------------------------------------------------

// Copies the version directory to staging (a symlink anywhere fails it) and renames it into the partition folder,
// replacing a stale one a crashed run left there; answers null, or the failure's code.
async function copyIntoPlace(versionDir: string, stagingDir: string, partitionFolder: string, id: string): Promise<string | null> {
  const staged = join(stagingDir, 'extensions', id);
  const placed = join(partitionFolder, 'extensions', id);
  try {
    await mkdir(join(stagingDir, 'extensions'), { recursive: true, mode: 0o700 });
    await cp(versionDir, staged, {
      recursive: true,
      dereference: false,
      force: false,
      errorOnExist: true,
      // throws, so the copy fails: a filter answering false would skip the link silently
      filter: async (source) => {
        if ((await lstat(source)).isSymbolicLink()) throw Object.assign(new Error('a symlink in the extension'), { code: 'symlink' });
        return true;
      },
    });
    await mkdir(join(partitionFolder, 'extensions'), { recursive: true, mode: 0o700 });
    await rm(placed, { recursive: true, force: true });
    await rename(staged, placed);
    return null;
  } catch (error) {
    await rm(staged, { recursive: true, force: true }).catch(() => {});
    return errorCode(error);
  }
}

async function loadOne(ses: Session, dir: string, roots: readonly string[]): Promise<LoadOutcome> {
  let extension: Extension;
  try {
    extension = await ses.extensions.loadExtension(dir, { allowFileAccess: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: redactMessage(message.split('\n')[0] ?? '') || 'unexpected' };
  }
  // A manifest must never make Electron load from anywhere but the folder MAWS copied it to (Design §15).
  if (under(extension.path, roots)) return { ok: true, extension };
  try {
    ses.extensions.removeExtension(extension.id);
  } catch {
    // already gone
  }
  return { ok: false, error: 'pathOutsideProfile' };
}

// An extension enabled, with files in the partition folder.
const loadable = (extension: ImportedExtension) => extension.enabled && extension.status !== 'copyFailed';
// Chrome's directory id: the folder the extension was copied to.
const directoryId = (extension: ImportedExtension) => extension.chromeId ?? extension.id;

// The folder and its real path (Electron may report an extension's path resolved), each with a trailing separator.
function rootsOf(folder: string): string[] {
  const roots = [folder];
  try {
    roots.push(realpathSync(folder));
  } catch {
    // not there yet
  }
  return roots.map((root) => root + sep);
}
const under = (path: string, roots: readonly string[]) => roots.some((root) => path.startsWith(root));

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

