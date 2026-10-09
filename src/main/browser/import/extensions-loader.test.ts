import { EventEmitter } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Session, WebContentsView } from 'electron';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportedExtension } from '@shared/browser/import';
import { partitionDirName, type ImportedProfile } from '@shared/browser/profiles';
import type { AppSessionId } from '@shared/graph/ids';
import { profilePartition } from '@shared/browser/tab';
import { buildChromeUserData, type ChromeUserData } from '../../../../test/support/chrome-profile';
import { inspectExtensions, type InspectedExtension } from './chrome/extensions';
import { TabStore } from '../tabs';
import { describeBackgroundError, ExtensionsLoader, FIRST_LOAD_HOLD_MS, holdFirstLoad, SETTLE_MS, type ExtensionsLoaderDeps } from './extensions-loader';
import { ImportedProfiles } from './profiles';
import { ImportRefused, type ChosenExtension } from './service';

// How the fake session's loaded extension behaves, by Chrome's directory id.
interface Behaviour {
  // `evaluationErrorKept`: the worker threw while it evaluated, then was kept running (Electron 44.4.5 under an attached
  // debugger, as Playwright's is); `laterError`: a worker that started, then logged an uncaught error while running
  background?: 'running' | 'error' | 'stopped' | 'silent' | 'evaluationErrorKept' | 'laterError';
  message?: string; // the level-3 console message the worker logs (an uncaught TypeError on `chrome.*` by default)
  throws?: string;
  id?: string; // Electron's id when it differs from the directory's
  path?: string; // where Electron says it loaded from
}

const WORKER_ERROR = "Uncaught TypeError: Cannot read properties of undefined (reading 'onClicked')";

function fakeSession(behaviours: Record<string, Behaviour> = {}) {
  const loaded = new Map<string, Electron.Extension>();
  const running: Record<number, Electron.ServiceWorkerInfo> = {};
  const versions = new Map<number, string>();
  let nextVersion = 1;
  const workers = Object.assign(new EventEmitter(), {
    getAllRunning: () => ({ ...running }),
    getInfoFromVersionID: (versionId: number) => {
      const scope = versions.get(versionId);
      if (!scope) throw new Error('no such version');
      return { scope, scriptUrl: `${scope}sw.js`, renderProcessId: 1, versionId };
    },
  });
  const extensions = {
    loadExtension: vi.fn<(dir: string, options?: Electron.LoadExtensionOptions) => Promise<Electron.Extension>>(async (dir) => {
      const behaviour = behaviours[basename(dir)] ?? {};
      if (behaviour.throws) throw new Error(behaviour.throws);
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
      const id = behaviour.id ?? basename(dir);
      const url = `chrome-extension://${id}/`;
      const extension = { id, manifest, name: String(manifest.name), path: behaviour.path ?? dir, url, version: String(manifest.version) } as Electron.Extension;
      loaded.set(id, extension);
      const versionId = nextVersion++;
      versions.set(versionId, url);
      if (behaviour.background === 'running') running[versionId] = { scope: url, scriptUrl: `${url}sw.js`, renderProcessId: 1, versionId };
      if (behaviour.background === 'error') workers.emit('console-message', {}, { message: WORKER_ERROR, versionId, source: 'javascript', level: 3, sourceUrl: `${url}sw.js`, lineNumber: 1 });
      const keep = () => (running[versionId] = { scope: url, scriptUrl: `${url}sw.js`, renderProcessId: 1, versionId });
      const error = () => workers.emit('console-message', {}, { message: behaviour.message ?? WORKER_ERROR, versionId, source: 'javascript', level: 3, sourceUrl: `${url}sw.js`, lineNumber: 1 });
      if (behaviour.background === 'evaluationErrorKept') {
        workers.emit('running-status-changed', { versionId, runningStatus: 'starting' });
        error();
        workers.emit('running-status-changed', { versionId, runningStatus: 'running' });
        keep();
      }
      if (behaviour.background === 'laterError') {
        workers.emit('running-status-changed', { versionId, runningStatus: 'starting' });
        workers.emit('running-status-changed', { versionId, runningStatus: 'running' });
        keep();
        error();
      }
      if (behaviour.background === 'stopped') {
        workers.emit('running-status-changed', { versionId, runningStatus: 'starting' });
        versions.delete(versionId); // a stopped version is no longer known by id: the loader keeps what it learnt at the start
        workers.emit('running-status-changed', { versionId, runningStatus: 'stopped' });
      }
      return extension;
    }),
    removeExtension: vi.fn((id: string) => {
      loaded.delete(id);
      for (const [versionId, info] of Object.entries(running)) if (info.scope.startsWith(`chrome-extension://${id}/`)) delete running[Number(versionId)];
    }),
    getExtension: (id: string) => loaded.get(id) ?? null,
    getAllExtensions: () => [...loaded.values()],
  };
  const ses = { extensions, serviceWorkers: workers };
  return Object.assign(ses as unknown as Session, { fake: { loaded, extensions, workers } });
}

function memoryProfiles(records: ImportedProfile[] = []) {
  const store = {
    records,
    list: () => [...store.records],
    get: (profileDir: string) => store.records.find((record) => record.profileDir === profileDir) ?? null,
    put: vi.fn(async (record: ImportedProfile) => {
      const at = store.records.findIndex((candidate) => candidate.profileDir === record.profileDir);
      store.records = at === -1 ? [...store.records, record] : store.records.map((candidate, i) => (i === at ? record : candidate));
    }),
    // cua #90: ImportedProfiles.update's contract over the same records, writing through `put`
    update: vi.fn(async (profileDir: string, change: (record: ImportedProfile) => ImportedProfile | null) => {
      const current = store.get(profileDir);
      const next = current ? change(current) : null;
      if (next) await store.put(next);
      return next;
    }),
  };
  return store;
}

const PARTITION = profilePartition('Default');
let root: string;
let fixture: ChromeUserData;
let inspected: InspectedExtension[];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'maws-e4b-extensions-'));
  fixture = buildChromeUserData(join(root, 'Chrome'));
  inspected = await inspectExtensions(fixture.profiles.Default.dir);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('the extensions loader (E4b Design §9, Decision Log 4, 19, 20)', () => {
  let userData: string;
  let partitionFolder: string;
  let stagingDir: string;
  let wait: ReturnType<typeof vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>>;

  const chosen = (...names: (keyof ChromeUserData['extensions'])[]): ChosenExtension[] =>
    names.map((name) => {
      const found = inspected.find((extension) => extension.candidate.id === fixture.extensions[name].id)!;
      return { candidate: found.candidate, versionDir: found.versionDir! };
    });
  const loader = (profiles: ExtensionsLoaderDeps['profiles'] = memoryProfiles(), extra: { changed?: () => void } = {}) =>
    new ExtensionsLoader({ userData, profiles, env: {}, wait, now: () => Date.parse('2026-10-07T00:00:00Z'), ...extra });
  const run = (target: ExtensionsLoader, ses: Session, extensions: ChosenExtension[], signal = new AbortController().signal) =>
    target.importExtensions({ ses, partition: PARTITION, partitionFolder, stagingDir, extensions, signal, progress: () => {} });

  beforeEach(() => {
    userData = mkdtempSync(join(root, 'userData-'));
    partitionFolder = join(userData, 'browser', partitionDirName(PARTITION));
    stagingDir = join(userData, 'browser', 'import', 'run');
    mkdirSync(stagingDir, { recursive: true });
    wait = vi.fn(async () => {});
  });

  describe('the import phase', () => {
    it('copies each extension to staging, renames it into the partition folder, then loads the enabled ones from there', async () => {
      const { probe, fails, wallet } = fixture.extensions;
      const ses = fakeSession({ [probe.id]: { background: 'running' }, [fails.id]: { background: 'error' } });
      const records = await run(loader(), ses, chosen('probe', 'fails', 'wallet'));

      for (const { id } of [probe, fails, wallet]) expect(existsSync(join(partitionFolder, 'extensions', id, 'manifest.json'))).toBe(true);
      expect(readdirSync(join(stagingDir, 'extensions'))).toEqual([]); // renamed, not copied twice
      expect(ses.fake.extensions.loadExtension.mock.calls).toEqual([
        [join(partitionFolder, 'extensions', probe.id), { allowFileAccess: false }],
        [join(partitionFolder, 'extensions', fails.id), { allowFileAccess: false }],
      ]);
      expect(wait).toHaveBeenCalledExactlyOnceWith(SETTLE_MS, expect.any(AbortSignal)); // one settle for every load
      const byId = Object.fromEntries(records.map((record) => [record.id, record]));
      expect(byId[probe.id]).toMatchObject({ status: 'loaded', enabled: true, background: 'running', backgroundError: null, error: null, chromeId: null, checkedAt: '2026-10-07T00:00:00.000Z' });
      expect(byId[fails.id]).toMatchObject({ status: 'loaded', background: 'failed', backgroundError: 'chrome.contextMenus.onClicked is not available in MAWS' });
      expect(byId[wallet.id]).toMatchObject({ status: 'off', enabled: false, wallet: true, background: 'none', backgroundError: null });
    });

    it('reads no background for a manifest without one, and a stopped one for a worker neither running nor failing', async () => {
      const { probe, disabled } = fixture.extensions;
      const ses = fakeSession({ [probe.id]: { background: 'silent' } });
      const records = await run(loader(), ses, chosen('probe', 'disabled'));
      expect(records.find((record) => record.id === disabled.id)).toMatchObject({ status: 'loaded', background: 'none' });
      expect(records.find((record) => record.id === probe.id)).toMatchObject({ status: 'loaded', background: 'stopped', backgroundError: null });
    });

    it('reads a worker that threw while it evaluated as failed even when Electron keeps it running; an error logged after it ran leaves it running', async () => {
      const { probe, fails } = fixture.extensions;
      const ses = fakeSession({ [probe.id]: { background: 'laterError' }, [fails.id]: { background: 'evaluationErrorKept' } });
      const records = await run(loader(), ses, chosen('probe', 'fails'));
      const byId = Object.fromEntries(records.map((record) => [record.id, record]));
      expect(byId[fails.id]).toMatchObject({ background: 'failed', backgroundError: 'chrome.contextMenus.onClicked is not available in MAWS' });
      expect(byId[probe.id]).toMatchObject({ background: 'running', backgroundError: null });
    });

    it('reads a worker that logged an error while starting but threw nothing (its own error log, a rejected promise) by whether it runs', async () => {
      const { probe, fails } = fixture.extensions;
      const ses = fakeSession({
        [probe.id]: { background: 'evaluationErrorKept', message: 'config missing, using defaults' }, // the worker's own error log at top level
        [fails.id]: { background: 'evaluationErrorKept', message: 'Uncaught (in promise) TypeError: Failed to fetch' },
      });
      const records = await run(loader(), ses, chosen('probe', 'fails'));
      expect(records.map(({ background, backgroundError }) => ({ background, backgroundError }))).toEqual([
        { background: 'running', backgroundError: null },
        { background: 'running', backgroundError: null },
      ]);
    });

    it('reads a worker that stopped within the settle as failed, with no error text', async () => {
      const { probe } = fixture.extensions;
      const records = await run(loader(), fakeSession({ [probe.id]: { background: 'stopped' } }), chosen('probe'));
      expect(records[0]).toMatchObject({ background: 'failed', backgroundError: null });
    });

    it('a load that throws is loadFailed with its first line; the others still load', async () => {
      const { probe, fails } = fixture.extensions;
      const ses = fakeSession({ [probe.id]: { throws: 'Manifest file is missing or unreadable\nat /somewhere' }, [fails.id]: { background: 'running' } });
      const records = await run(loader(), ses, chosen('probe', 'fails'));
      expect(records[0]).toMatchObject({ id: probe.id, status: 'loadFailed', error: 'Manifest file is missing or unreadable', background: 'none' });
      expect(records[1]).toMatchObject({ id: fails.id, status: 'loaded', background: 'running' });
    });

    it('refuses an extension Electron says it loaded from outside the partition folder, and unloads it', async () => {
      const { probe } = fixture.extensions;
      const ses = fakeSession({ [probe.id]: { path: join(root, 'elsewhere'), background: 'running' } });
      const records = await run(loader(), ses, chosen('probe'));
      expect(records[0]).toMatchObject({ status: 'loadFailed', error: 'pathOutsideProfile', background: 'none' });
      expect(ses.fake.extensions.removeExtension).toHaveBeenCalledWith(probe.id);
    });

    it('admits an extension Electron reports under the partition folder\'s real path', async () => {
      const { probe } = fixture.extensions;
      const real = mkdtempSync(join(root, 'real-'));
      const linked = join(root, `linked-${basename(real)}`);
      symlinkSync(real, linked); // userData reached through a symlink: Electron answers the resolved path
      const folder = join(linked, 'browser', partitionDirName(PARTITION));
      const ses = fakeSession({ [probe.id]: { path: join(realpathSync(real), 'browser', partitionDirName(PARTITION), 'extensions', probe.id), background: 'running' } });
      const records = await loader().importExtensions({ ses, partition: PARTITION, partitionFolder: folder, stagingDir, extensions: chosen('probe'), signal: new AbortController().signal, progress: () => {} });
      expect(records[0]).toMatchObject({ status: 'loaded', background: 'running' });
      expect(ses.fake.extensions.removeExtension).not.toHaveBeenCalled();
    });

    it('keeps Electron\'s id and Chrome\'s directory id beside it when they differ', async () => {
      const { probe } = fixture.extensions;
      const electronId = 'a'.repeat(32);
      const records = await run(loader(), fakeSession({ [probe.id]: { id: electronId, background: 'running' } }), chosen('probe'));
      expect(records[0]).toMatchObject({ id: electronId, chromeId: probe.id, status: 'loaded', background: 'running' });
    });

    it('a tree that cannot be copied is copyFailed with its code, never loaded; the others continue', async () => {
      const [probe, fails] = chosen('probe', 'fails');
      const copy = join(root, `symlinked-${basename(userData)}`);
      mkdirSync(copy);
      for (const name of readdirSync(probe!.versionDir)) symlinkSync(join(probe!.versionDir, name), join(copy, name)); // appeared after the inspection
      const ses = fakeSession({ [fails!.candidate.id]: { background: 'running' } });
      const records = await run(loader(), ses, [{ ...probe!, versionDir: copy }, fails!]);
      expect(records[0]).toMatchObject({ id: probe!.candidate.id, status: 'copyFailed', error: 'symlink', background: 'none' });
      expect(records[1]).toMatchObject({ status: 'loaded' });
      expect(ses.fake.extensions.loadExtension).toHaveBeenCalledTimes(1);
      expect(existsSync(join(partitionFolder, 'extensions', probe!.candidate.id))).toBe(false);
    });

    it('replaces a stale folder a crashed run left in the partition folder', async () => {
      const { probe } = fixture.extensions;
      mkdirSync(join(partitionFolder, 'extensions', probe.id, 'stale'), { recursive: true });
      await run(loader(), fakeSession(), chosen('probe'));
      expect(existsSync(join(partitionFolder, 'extensions', probe.id, 'stale'))).toBe(false);
      expect(existsSync(join(partitionFolder, 'extensions', probe.id, 'manifest.json'))).toBe(true);
    });

    it('on abort resolves with what it reached, removes nothing and skips the settle', async () => {
      const controller = new AbortController();
      const ses = fakeSession();
      const target = loader();
      const records = await target.importExtensions({
        ses,
        partition: PARTITION,
        partitionFolder,
        stagingDir,
        extensions: chosen('wallet', 'probe', 'fails'),
        signal: controller.signal,
        progress: (done) => {
          if (done === 1) controller.abort(); // the cancel lands once the first extension is in place
        },
      });
      expect(records.map((record) => record.id)).toEqual([fixture.extensions.wallet.id]);
      expect(ses.fake.extensions.loadExtension).not.toHaveBeenCalled();
      expect(ses.fake.extensions.removeExtension).not.toHaveBeenCalled();
      expect(wait).not.toHaveBeenCalled();
    });
  });

  describe('the namespace-naming rule (Decision Log 19)', () => {
    it('names the namespace only when exactly one permission is unsupported', () => {
      expect(describeBackgroundError(WORKER_ERROR, ['contextMenus'])).toBe('chrome.contextMenus.onClicked is not available in MAWS');
      expect(describeBackgroundError(WORKER_ERROR, ['contextMenus', 'cookies'])).toBe('onClicked of an unavailable chrome API');
      expect(describeBackgroundError(WORKER_ERROR, [])).toBe('onClicked of an unavailable chrome API');
    });

    it('keeps any other error as its redacted first line', () => {
      expect(describeBackgroundError('Uncaught Error: fetch https://secret.example.test/a?b=1 failed\nstack', [])).toBe('Uncaught Error: fetch secret.example.test failed');
    });
  });

  describe('per boot (Decision Log 32)', () => {
    const record = (extensions: ImportedExtension[]): ImportedProfile => ({
      profileDir: 'Default',
      name: 'Person 1',
      partition: PARTITION,
      importedAt: '2026-10-06T00:00:00.000Z',
      storageDirName: 'maws-chrome-default',
      userDataDir: fixture.dir,
      extensions,
      report: { profileDir: 'Default', name: 'Person 1', partition: PARTITION, startedAt: '2026-10-06T00:00:00.000Z', finishedAt: '2026-10-06T00:00:00.000Z', outcome: 'done', failure: null, history: null, cookies: null, extensions: [], bookmarks: null },
      bookmarks: null, // cua #90: profiles.json version 2
      gaiaName: null,
      userName: null,
      avatar: { kind: 'initials' },
    });
    // An import of probe, fails and wallet, as the import phase leaves it.
    async function imported(behaviours: Record<string, Behaviour> = {}) {
      const records = await run(loader(), fakeSession(behaviours), chosen('probe', 'fails', 'wallet'));
      wait.mockClear();
      return record(records);
    }

    it('loads the enabled extensions of the prepared partition\'s record, writes their statuses back and announces it', async () => {
      const { probe, fails, wallet } = fixture.extensions;
      const profiles = memoryProfiles([await imported()]);
      const changed = vi.fn();
      const target = loader(profiles, { changed });
      const ses = fakeSession({ [probe.id]: { background: 'running' }, [fails.id]: { background: 'error' } });

      target.onPartitionPrepared(ses, PARTITION);
      expect(target.loading(PARTITION)).not.toBeNull();
      await target.idle(PARTITION);

      expect(ses.fake.extensions.loadExtension.mock.calls.map(([dir]) => basename(dir))).toEqual([probe.id, fails.id]); // the wallet is off
      const extensions = profiles.get('Default')!.extensions;
      expect(extensions.find((extension) => extension.id === probe.id)).toMatchObject({ status: 'loaded', background: 'running', checkedAt: '2026-10-07T00:00:00.000Z' });
      expect(extensions.find((extension) => extension.id === fails.id)).toMatchObject({ background: 'failed', backgroundError: 'chrome.contextMenus.onClicked is not available in MAWS' });
      expect(extensions.find((extension) => extension.id === wallet.id)).toMatchObject({ status: 'off', enabled: false });
      expect(changed).toHaveBeenCalledTimes(1);
      expect(target.loading(PARTITION)).toBeNull();
    });

    // cua #90: the bookmarks sync writes the same record at the same boot; each writer changes only its own field
    it('writes its statuses over the record as it stands when the write runs, keeping a bookmarks state another writer put meanwhile', async () => {
      const { probe } = fixture.extensions;
      const profiles = ImportedProfiles.open(userData);
      await profiles.put(await imported());
      const synced = { consentedAt: '2026-10-06T00:00:00.000Z', syncedAt: '2026-10-07T00:00:00.000Z', count: 46, error: null, errorAt: null };
      let bookmarksWrite: Promise<unknown> = Promise.resolve();
      wait.mockImplementationOnce(async () => {
        bookmarksWrite = profiles.update('Default', (r) => ({ ...r, bookmarks: synced })); // in flight when the settle ends
      });
      const target = loader(profiles);
      target.onPartitionPrepared(fakeSession({ [probe.id]: { background: 'running' } }), PARTITION);
      await target.idle(PARTITION);
      await bookmarksWrite;
      expect(profiles.get('Default')!.bookmarks).toEqual(synced);
      expect(profiles.get('Default')!.extensions.find((extension) => extension.id === probe.id)).toMatchObject({ status: 'loaded', background: 'running' });
      expect(ImportedProfiles.open(userData).get('Default')!.bookmarks).toEqual(synced);
    });

    it('loads nothing for a partition no record names, and never throws into the partition\'s preparation', async () => {
      const ses = fakeSession();
      const target = loader();
      target.onPartitionPrepared(ses, profilePartition('Profile 1'));
      expect(target.loading(profilePartition('Profile 1'))).toBeNull();
      const broken = new ExtensionsLoader({
        userData,
        profiles: { list: () => { throw new Error('boom'); }, get: () => null, update: vi.fn() },
        env: {},
        wait,
      });
      expect(() => broken.onPartitionPrepared(ses, PARTITION)).not.toThrow();
      expect(ses.fake.extensions.loadExtension).not.toHaveBeenCalled();
    });

    it('reports a load that fails again, and keeps the extension enabled for the owner to turn off', async () => {
      const { probe } = fixture.extensions;
      const profiles = memoryProfiles([await imported()]);
      const target = loader(profiles);
      target.onPartitionPrepared(fakeSession({ [probe.id]: { throws: 'Could not load background script' } }), PARTITION);
      await target.idle(PARTITION);
      expect(profiles.get('Default')!.extensions.find((extension) => extension.id === probe.id)).toMatchObject({ status: 'loadFailed', enabled: true, error: 'Could not load background script' });
    });
  });

  describe('the first page of a partition waits for its loads (the boot race)', () => {
    it('holds a load until ready, then passes it through; a load after that is not held', async () => {
      let release!: () => void;
      const ready = new Promise<void>((resolve) => (release = resolve));
      const calls: string[] = [];
      const webContents = { loadURL: vi.fn(async (url: string) => void calls.push(url)), isDestroyed: () => false };
      const original = webContents.loadURL;
      holdFirstLoad(webContents, ready);
      const first = webContents.loadURL('http://127.0.0.1/a');
      await Promise.resolve();
      expect(calls).toEqual([]);
      release();
      await first;
      expect(calls).toEqual(['http://127.0.0.1/a']);
      expect(webContents.loadURL).toBe(original);
    });

    it('drops a held load whose page was closed meanwhile', async () => {
      const webContents = { loadURL: vi.fn<(url: string) => Promise<void>>(async () => {}), isDestroyed: () => true };
      const original = webContents.loadURL;
      holdFirstLoad(webContents, Promise.resolve());
      await expect(webContents.loadURL('http://127.0.0.1/a')).rejects.toThrow();
      expect(original).not.toHaveBeenCalled();
    });

    it('turns a synchronous throw of the original load into the held load\'s rejection', async () => {
      const webContents = {
        loadURL: vi.fn<(url: string) => Promise<void>>(() => {
          throw new Error('refused synchronously');
        }),
        isDestroyed: () => false,
      };
      holdFirstLoad(webContents, Promise.resolve());
      await expect(webContents.loadURL('http://127.0.0.1/a')).rejects.toThrow('refused synchronously');
    });

    // A boot load whose single `loadExtension` the test settles itself.
    function pendingBootLoad() {
      const { probe } = fixture.extensions;
      cpSync(probe.dir, join(partitionFolder, 'extensions', probe.id), { recursive: true }); // as an earlier import left it
      let settle!: () => void;
      const ses = fakeSession({ [probe.id]: { background: 'running' } });
      const load = ses.fake.extensions.loadExtension.getMockImplementation()!;
      ses.fake.extensions.loadExtension.mockImplementationOnce((dir, options) => new Promise((resolve) => (settle = () => resolve(load(dir, options)))));
      const extension = { id: probe.id, chromeId: null, name: 'Probe', version: '1.0', enabled: true, wallet: false, unsupportedPermissions: [], status: 'loaded', error: null, background: 'running', backgroundError: null, checkedAt: '2026-10-06T00:00:00.000Z' } as const;
      const profiles = memoryProfiles([
        {
          profileDir: 'Default', name: 'Person 1', partition: PARTITION, importedAt: '2026-10-06T00:00:00.000Z', storageDirName: 'maws-chrome-default', userDataDir: fixture.dir, extensions: [{ ...extension, unsupportedPermissions: [] }],
          report: { profileDir: 'Default', name: 'Person 1', partition: PARTITION, startedAt: '2026-10-06T00:00:00.000Z', finishedAt: '2026-10-06T00:00:00.000Z', outcome: 'done', failure: null, history: null, cookies: null, extensions: [], bookmarks: null },
          bookmarks: null, gaiaName: null, userName: null, avatar: { kind: 'initials' }, // cua #90
        },
      ]);
      return { ses, profiles, settle: () => settle() };
    }

    it('holds a page no longer than the bound when its partition\'s loads never settle', async () => {
      const { ses, profiles } = pendingBootLoad();
      let bound!: () => void;
      wait.mockImplementation((ms) => (ms === FIRST_LOAD_HOLD_MS ? new Promise<void>((resolve) => (bound = resolve)) : Promise.resolve()));
      const target = loader(profiles);
      target.onPartitionPrepared(ses, PARTITION);
      const webContents = { loadURL: vi.fn<(url: string) => Promise<void>>(async () => {}), isDestroyed: () => false };
      const original = webContents.loadURL;
      target.holdIfLoading(webContents, PARTITION);
      const held = webContents.loadURL('http://127.0.0.1/a');
      await new Promise((resolve) => setImmediate(resolve));
      expect(wait).toHaveBeenCalledWith(FIRST_LOAD_HOLD_MS, expect.any(AbortSignal));
      expect(original).not.toHaveBeenCalled();
      bound();
      await held;
      expect(original).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1/a', undefined);
    });

    it('through E4a\'s tab store: a new tab\'s first load in an imported partition waits for its extensions', async () => {
      const { ses, profiles, settle } = pendingBootLoad();
      // the hold's bound runs out only when the loads settle first and abort it
      wait.mockImplementation((ms, signal) => (ms === FIRST_LOAD_HOLD_MS ? new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve())) : Promise.resolve()));
      const target = loader(profiles);
      const prepared = new Set<string>();
      const loads: string[] = [];
      const store = new TabStore({
        emit: () => {},
        // E4a's createTabView prepares the partition before it makes the view: the preparer starts the loads
        createView: (tab) => {
          if (!prepared.has(tab.partition)) {
            prepared.add(tab.partition);
            target.onPartitionPrepared(ses, tab.partition);
          }
          return { webContents: { loadURL: vi.fn(async (url: string) => void loads.push(url)), close: vi.fn(), isDestroyed: () => false } } as unknown as WebContentsView;
        },
        resolvePartition: () => PARTITION,
        schedule: () => {},
      });
      store.onViewCreated((entry) => target.holdNewView(entry));
      store.open({ appSessionId: 'App-A' as AppSessionId, url: 'http://127.0.0.1/a', select: true });
      await new Promise((resolve) => setImmediate(resolve));
      expect(loads).toEqual([]);
      settle();
      await target.idle(PARTITION);
      expect(loads).toEqual(['http://127.0.0.1/a']);
      expect(ses.fake.loaded.has(fixture.extensions.probe.id)).toBe(true);
    });
  });

  describe('the toggle (P-21)', () => {
    async function liveImport(behaviours: Record<string, Behaviour> = {}) {
      const ses = fakeSession(behaviours);
      const profiles = memoryProfiles();
      const target = loader(profiles);
      target.onPartitionPrepared(ses, PARTITION); // the import opened the partition: no record yet, nothing loaded
      const records = await run(target, ses, chosen('probe', 'fails', 'wallet'));
      profiles.records = [
        {
          profileDir: 'Default', name: 'Person 1', partition: PARTITION, importedAt: '2026-10-06T00:00:00.000Z', storageDirName: 'maws-chrome-default', userDataDir: fixture.dir, extensions: records,
          report: { profileDir: 'Default', name: 'Person 1', partition: PARTITION, startedAt: '2026-10-06T00:00:00.000Z', finishedAt: '2026-10-06T00:00:00.000Z', outcome: 'done', failure: null, history: null, cookies: null, extensions: records, bookmarks: null },
          bookmarks: null, gaiaName: null, userName: null, avatar: { kind: 'initials' }, // cua #90
        },
      ];
      wait.mockClear();
      return { ses, profiles, target };
    }

    it('turns a loaded extension off at once on a live partition', async () => {
      const { fails } = fixture.extensions;
      const { ses, profiles, target } = await liveImport({ [fails.id]: { background: 'error' } });
      const extension = await target.setExtension('Default', fails.id, false);
      expect(ses.fake.extensions.removeExtension).toHaveBeenCalledWith(fails.id);
      expect(extension).toMatchObject({ enabled: false, status: 'off', background: 'none', backgroundError: null });
      expect(profiles.get('Default')!.extensions.find((candidate) => candidate.id === fails.id)).toEqual(extension);
    });

    it('turns a wallet on: loaded and read, with no settle for an extension without a background', async () => {
      const { wallet } = fixture.extensions;
      const { ses, target } = await liveImport();
      const extension = await target.setExtension('Default', wallet.id, true);
      expect(ses.fake.extensions.loadExtension).toHaveBeenLastCalledWith(join(partitionFolder, 'extensions', wallet.id), { allowFileAccess: false });
      expect(wait).not.toHaveBeenCalled();
      expect(extension).toMatchObject({ enabled: true, wallet: true, status: 'loaded', background: 'none' });
    });

    it('turns an extension back on: loaded again, settled, its background read again', async () => {
      const { fails } = fixture.extensions;
      const { target } = await liveImport({ [fails.id]: { background: 'error' } });
      await target.setExtension('Default', fails.id, false);
      const extension = await target.setExtension('Default', fails.id, true);
      expect(wait).toHaveBeenCalledExactlyOnceWith(SETTLE_MS, undefined);
      expect(extension).toMatchObject({ enabled: true, status: 'loaded', background: 'failed', backgroundError: 'chrome.contextMenus.onClicked is not available in MAWS' });
    });

    it('on a partition not prepared this boot, writes the choice for its next preparation and loads nothing', async () => {
      const { probe, wallet } = fixture.extensions;
      const { profiles } = await liveImport();
      const target = loader(profiles); // a fresh boot: nothing prepared
      expect(await target.setExtension('Default', probe.id, false)).toMatchObject({ enabled: false, status: 'off' });
      expect(await target.setExtension('Default', wallet.id, true)).toMatchObject({ enabled: true, status: 'off' });
      const ses = fakeSession();
      target.onPartitionPrepared(ses, PARTITION);
      await target.idle(PARTITION);
      expect(ses.fake.extensions.loadExtension.mock.calls.map(([dir]) => basename(dir))).toEqual([fixture.extensions.fails.id, wallet.id]);
    });

    it('waits for a boot load of the same profile, whose statuses never undo the toggle', async () => {
      const { probe } = fixture.extensions;
      const profiles = memoryProfiles([(await liveImport()).profiles.records[0]!]);
      let release!: () => void;
      wait.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
      const target = loader(profiles);
      const ses = fakeSession({ [probe.id]: { background: 'running' } });
      target.onPartitionPrepared(ses, PARTITION);
      const toggled = target.setExtension('Default', probe.id, false);
      await new Promise((resolve) => setImmediate(resolve));
      expect(ses.fake.extensions.removeExtension).not.toHaveBeenCalled();
      release();
      expect(await toggled).toMatchObject({ enabled: false, status: 'off' });
      expect(profiles.get('Default')!.extensions.find((candidate) => candidate.id === probe.id)).toMatchObject({ enabled: false, status: 'off' });
    });

    it('a toggle racing a removal never brings the record back, and unloads what it loaded', async () => {
      const { fails, probe } = fixture.extensions;
      const { ses, profiles, target } = await liveImport({ [fails.id]: { background: 'error' } });
      await target.setExtension('Default', fails.id, false);
      const record = profiles.records[0]!;
      let release!: () => void;
      wait.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
      const inFlight = target.setExtension('Default', fails.id, true); // loads, then waits in the settle
      await new Promise((resolve) => setImmediate(resolve));
      const queued = target.setExtension('Default', probe.id, false); // behind it in the partition's queue
      const unloading = target.unloadForRemoval(record); // the removal begins
      await expect(target.setExtension('Default', probe.id, false)).rejects.toThrow(new ImportRefused('notImported'));
      profiles.records = []; // the removal drops the record while the toggle settles
      release();
      await expect(inFlight).rejects.toThrow(new ImportRefused('notImported'));
      await expect(queued).rejects.toThrow(new ImportRefused('notImported'));
      await unloading;
      expect(profiles.records).toEqual([]);
      expect(profiles.put).toHaveBeenCalledTimes(1); // the first toggle's, before the removal
      expect(ses.fake.loaded.has(fails.id)).toBe(false);
      target.removalDone(PARTITION);
    });

    it('a toggle whose record is gone by the time it writes writes nothing and unloads what it loaded', async () => {
      const { fails } = fixture.extensions;
      const { ses, profiles, target } = await liveImport({ [fails.id]: { background: 'error' } });
      await target.setExtension('Default', fails.id, false);
      profiles.put.mockClear();
      wait.mockImplementationOnce(async () => void (profiles.records = []));
      await expect(target.setExtension('Default', fails.id, true)).rejects.toThrow(new ImportRefused('notImported'));
      expect(profiles.put).not.toHaveBeenCalled();
      expect(ses.fake.loaded.has(fails.id)).toBe(false);
    });

    it('refuses a profile that is not imported, or an extension its record does not hold', async () => {
      const { target } = await liveImport();
      await expect(target.setExtension('Profile 1', fixture.extensions.probe.id, true)).rejects.toThrow('not an imported profile');
      await expect(target.setExtension('Default', 'b'.repeat(32), true)).rejects.toThrow('not an extension of this imported profile');
    });
  });

  describe('removal', () => {
    it('unloads the record\'s extensions loaded from its folder, and a later preparation loads nothing', async () => {
      const { probe, fails } = fixture.extensions;
      const ses = fakeSession();
      const profiles = memoryProfiles();
      const target = loader(profiles);
      target.onPartitionPrepared(ses, PARTITION);
      const records = await run(target, ses, chosen('probe', 'fails'));
      const { disabled } = fixture.extensions;
      const foreign = await ses.extensions.loadExtension(disabled.dir); // another loader's, from elsewhere
      expect(foreign.path.startsWith(partitionFolder)).toBe(false);
      profiles.records = [{ ...(await imported()), extensions: records }];

      const unloaded = await target.unloadForRemoval(profiles.records[0]!);
      expect(unloaded).toBe(2);
      expect(ses.fake.extensions.removeExtension.mock.calls.map(([id]) => id).sort()).toEqual([probe.id, fails.id].sort());

      const later = fakeSession();
      target.onPartitionPrepared(later, PARTITION);
      expect(later.fake.extensions.loadExtension).not.toHaveBeenCalled();
      target.removalDone(PARTITION);
    });

    async function imported(): Promise<ImportedProfile> {
      return {
        profileDir: 'Default', name: 'Person 1', partition: PARTITION, importedAt: '2026-10-06T00:00:00.000Z', storageDirName: 'maws-chrome-default', userDataDir: fixture.dir, extensions: [],
        report: { profileDir: 'Default', name: 'Person 1', partition: PARTITION, startedAt: '2026-10-06T00:00:00.000Z', finishedAt: '2026-10-06T00:00:00.000Z', outcome: 'done', failure: null, history: null, cookies: null, extensions: [], bookmarks: null },
          bookmarks: null, gaiaName: null, userName: null, avatar: { kind: 'initials' }, // cua #90
      };
    }
  });
});
