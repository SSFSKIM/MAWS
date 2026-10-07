// The import service over fakes (E4b Design §4 to §14; Acceptance G1's service list): the inspection over the synthetic
// Chrome profile, the run's phase order, the counts and the report's shape (parsed with the M1 schema), the partitioned
// row through the import view's debugger only and verified, the unverified count, a wrong key, the Keychain outcomes,
// cancel and failure rolling back whole with no record, the staging deleted on every exit, and the refusals at start.
// The Electron session, the import view, the Keychain and the extensions phase are fakes; the index is a real one.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CookiesSetDetails, Session } from 'electron';
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportedExtension, ImportPhase, ImportReport } from '@shared/browser/import';
import { ImportReportSchema } from '@shared/browser/import';
import { summaryWords } from '@shared/browser/import-summary';
import { buildChromeUserData, type ChromeUserData } from '../../../../test/support/chrome-profile';
import { Index } from '../../index/index';
import { deriveKey } from './chrome/crypto';
import type { NetworkSetCookieParams } from './chrome/cookies';
import type { ImportView } from './chips-import';
import type { KeychainResult } from './keychain';
import { ImportedProfiles } from './profiles';
import { BrowserImportService, ImportRefused, progressThrottle, type ImportExtensions } from './service';

vi.mock('electron', () => ({ WebContentsView: class {} }));

const PARTITION = 'persist:maws-chrome-Default';
let root: string;
let fixture: ChromeUserData;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-e4b-service-'));
  fixture = buildChromeUserData(join(root, 'Chrome'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

interface Emitted {
  name: string;
  payload: { phase?: ImportPhase; done?: number; total?: number; report?: ImportReport };
}

function fakeSession(userData: string, storageDirName = 'maws-chrome-default') {
  const jar: CookiesSetDetails[] = [];
  const loaded = new Map<string, { id: string; path: string }>();
  const ses = {
    storagePath: join(userData, 'Partitions', storageDirName),
    cookies: {
      set: vi.fn(async (details: CookiesSetDetails) => void jar.push(details)),
      flushStore: vi.fn(async () => {}),
    },
    clearStorageData: vi.fn(async () => void (jar.length = 0)),
    extensions: {
      getAllExtensions: vi.fn(() => [...loaded.values()]),
      removeExtension: vi.fn((id: string) => void loaded.delete(id)),
    },
  };
  return { ses, session: ses as unknown as Session, jar, loaded };
}

// The import view's debugger: Page.getFrameTree for the attach, Network.setCookie recorded, Network.getAllCookies
// listing what was set (or `listed` when given).
function fakeView(listed?: () => unknown[]) {
  const setCookie: NetworkSetCookieParams[] = [];
  const sent: string[] = [];
  let destroyed = false;
  let attached = false;
  const webContents = {
    debugger: {
      attach: () => void (attached = true),
      isAttached: () => attached,
      detach: () => void (attached = false),
      on: () => {},
      sendCommand: vi.fn(async (method: string, params?: unknown) => {
        sent.push(method);
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'f' } } };
        if (method === 'Network.setCookie') return void setCookie.push(params as NetworkSetCookieParams);
        if (method === 'Network.getAllCookies') {
          return { cookies: listed ? listed() : setCookie.map((c) => ({ name: c.name, domain: c.domain ?? new URL(c.url).hostname, path: c.path, partitionKey: c.partitionKey })) };
        }
        throw new Error(method);
      }),
    } as unknown as Electron.Debugger,
    isDestroyed: () => destroyed,
    loadURL: vi.fn(async () => {}),
    close: vi.fn(() => void (destroyed = true)),
  };
  const view: ImportView = { webContents };
  return { createImportView: vi.fn(() => view), webContents, setCookie, sent };
}

// The extensions phase Task 2.4 implements: here each chosen extension is "copied" into the partition folder and, unless
// a wallet, "loaded" into the fake session.
function fakeExtensions(loaded: Map<string, { id: string; path: string }>, { waitForAbortAfter }: { waitForAbortAfter?: number } = {}) {
  return vi.fn<ImportExtensions>(async ({ extensions, partitionFolder, signal, progress }) => {
    const records: ImportedExtension[] = [];
    for (const [i, { candidate }] of extensions.entries()) {
      if (signal.aborted) break;
      mkdirSync(join(partitionFolder, 'extensions', candidate.id), { recursive: true });
      if (!candidate.wallet) loaded.set(candidate.id, { id: candidate.id, path: join(partitionFolder, 'extensions', candidate.id) });
      records.push({
        id: candidate.id, chromeId: null, name: candidate.name, version: candidate.version, enabled: !candidate.wallet, wallet: candidate.wallet,
        unsupportedPermissions: candidate.unsupportedPermissions, status: candidate.wallet ? 'off' : 'loaded', error: null,
        background: 'none', backgroundError: null, checkedAt: new Date().toISOString(),
      });
      progress(i + 1, extensions.length);
      if (waitForAbortAfter === i + 1 && !signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    }
    return records;
  });
}

// The Keychain dialog left open until the owner cancels (as readSafeStorageKey answers an abort, before or during).
const untilCancelled = (signal: AbortSignal) =>
  new Promise<KeychainResult>((resolve) => {
    if (signal.aborted) resolve({ outcome: 'cancelled' });
    signal.addEventListener('abort', () => resolve({ outcome: 'cancelled' }), { once: true });
  });

describe('BrowserImportService', () => {
  let userData: string;
  let index: Index;
  let profiles: ImportedProfiles;
  let emitted: Emitted[];
  let session: ReturnType<typeof fakeSession>;
  let view: ReturnType<typeof fakeView>;
  let keys: Buffer[];
  let keychain: ReturnType<typeof vi.fn<(signal: AbortSignal) => Promise<KeychainResult>>>;
  let extensions: ReturnType<typeof fakeExtensions>;
  let onEmit: (event: Emitted) => void;

  const allowed = (password: string) => async (): Promise<KeychainResult> => {
    const key = deriveKey(password);
    keys.push(key);
    return { outcome: 'allowed', key };
  };

  function service(over: Partial<ConstructorParameters<typeof BrowserImportService>[0]> = {}) {
    return new BrowserImportService({
      userData,
      env: {},
      partitions: { session: vi.fn(() => session.session) },
      history: index.browserHistory,
      profiles,
      emit: (name, payload) => {
        const event = { name, payload } as Emitted;
        emitted.push(event);
        onEmit(event);
        return true;
      },
      keychain,
      createImportView: view.createImportView,
      extensions,
      ...over,
    });
  }

  const extensionIds = () => [fixture.extensions.probe.id, fixture.extensions.fails.id, fixture.extensions.wallet.id];
  const ALL = { history: true, cookies: true, extensions: true };

  async function importAll(svc: BrowserImportService, over: { categories?: typeof ALL; extensionIds?: string[]; profileDir?: string } = {}) {
    const inspection = await svc.inspect({ userDataDir: fixture.dir, profileDir: over.profileDir ?? 'Default' });
    const { importId, finished } = svc.start({ inspectionId: inspection.inspectionId, categories: over.categories ?? ALL, extensionIds: over.extensionIds ?? extensionIds(), allowUnverifiedExtensions: true });
    return { inspection, importId, report: await finished };
  }

  const phases = () => [...new Set(emitted.filter((e) => e.name === 'browser.import.progress').map((e) => e.payload.phase))];
  const stagingLeft = () => (existsSync(join(userData, 'browser', 'import')) ? readdirSync(join(userData, 'browser', 'import')) : []);
  const historyOf = (partition = PARTITION) => index.browserHistory.suggest(partition, '', 100);

  beforeEach(() => {
    userData = mkdtempSync(join(root, 'userData-'));
    index = new Index(join(userData, 'index.sqlite'));
    profiles = ImportedProfiles.open(userData);
    emitted = [];
    onEmit = () => {};
    session = fakeSession(userData);
    view = fakeView();
    keys = [];
    keychain = vi.fn(allowed(fixture.password));
    extensions = fakeExtensions(session.loaded);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    index.close();
  });

  describe('inspect', () => {
    it('stages the two stores, counts them and lists the four extensions in place', async () => {
      const svc = service();
      const inspection = await svc.inspect({ userDataDir: fixture.dir, profileDir: 'Default' });
      expect(inspection).toMatchObject({
        profile: { profileDir: 'Default', name: 'Person 1', gaiaName: 'Probe Owner', lastUsed: true, imported: false },
        chromeRunning: false,
        history: { rows: 6 },
        cookies: { rows: 5, partitioned: 1, storeVersion: 24 },
      });
      expect(inspection.extensions.map((e) => e.id).sort()).toEqual(
        [fixture.extensions.probe.id, fixture.extensions.fails.id, fixture.extensions.wallet.id, fixture.extensions.disabled.id].sort(),
      );
      expect(readdirSync(join(userData, 'browser', 'import', inspection.inspectionId)).sort()).toEqual(['Cookies', 'History']);
    });

    it('discards the standing inspection when a second one starts, and on discard', async () => {
      const svc = service();
      const first = await svc.inspect({ userDataDir: fixture.dir, profileDir: 'Default' });
      const second = await svc.inspect({ userDataDir: fixture.dir, profileDir: 'Profile 1' });
      expect(stagingLeft()).toEqual([second.inspectionId]);
      expect(() => svc.start({ inspectionId: first.inspectionId, categories: ALL, extensionIds: [], allowUnverifiedExtensions: true })).toThrow(ImportRefused);
      await svc.discard(second.inspectionId);
      expect(stagingLeft()).toEqual([]);
    });

    it('refuses a profile Local State does not name, and one already imported, touching nothing', async () => {
      const svc = service();
      await expect(svc.inspect({ userDataDir: fixture.dir, profileDir: 'Profile 9' })).rejects.toMatchObject({ reason: 'unknownProfile' });
      await importAll(svc);
      await expect(svc.inspect({ userDataDir: fixture.dir, profileDir: 'Default' })).rejects.toMatchObject({ reason: 'imported' });
      expect(stagingLeft()).toEqual([]);
    });
  });

  it('imports every category with the probe’s counts, in phase order, and writes the record once', async () => {
    const svc = service();
    const { importId, report } = await importAll(svc);

    expect(phases()).toEqual(['copying', 'history', 'keychain', 'cookies', 'verifying', 'extensions', 'cleaning']);
    expect(ImportReportSchema.parse(report)).toEqual(report);
    expect(report).toMatchObject({
      profileDir: 'Default', name: 'Person 1', partition: PARTITION, outcome: 'done', failure: null,
      history: { imported: 4, skipped: { hidden: 1, unsupportedScheme: 1, invalid: 0 }, hosts: { hidden: ['example.test'], unsupportedScheme: ['settings'] }, error: null },
      cookies: { imported: 3, partitioned: { imported: 1, verified: 1 }, keychain: 'allowed', error: null, hosts: { sameSiteNoneInsecure: [fixture.host] } },
    });
    expect(report.cookies!.skipped).toEqual({ wrongKey: 0, corruptRow: 0, expired: 0, sameSiteNoneInsecure: 1, rejected: 0, notVerified: 0, cancelled: 0 });
    expect(report.extensions!.map((e) => [e.name, e.status])).toEqual(expect.arrayContaining([['Probe Wallet', 'off']]));
    expect(summaryWords(report)).toBe(
      "4 cookies, 4 history entries, 3 extensions · 3 skipped: 1 rejected by Chromium (SameSite=None without Secure), 1 hidden page, 1 page MAWS's browser can't open",
    );
    expect(new Date(report.finishedAt).toISOString()).toBe(report.finishedAt);

    // Plain rows through cookies.set, never with a partition key; the partitioned row through the view's debugger only.
    expect(session.jar.map((c) => c.name).sort()).toEqual(['probe_pref', 'probe_session', 'sid']);
    expect(session.jar.some((c) => 'partitionKey' in c)).toBe(false);
    expect(view.createImportView).toHaveBeenCalledWith(PARTITION);
    expect(view.setCookie.map((c) => c.name)).toEqual(['__Host-part']);
    expect(view.webContents.close).toHaveBeenCalled();
    expect(session.ses.cookies.flushStore).toHaveBeenCalledTimes(2);

    // The key zeroed; the history in the index; the staging gone; the record written and announced before `finished`.
    expect(keys).toHaveLength(1);
    expect(keys[0]!.every((byte) => byte === 0)).toBe(true);
    expect(historyOf()).toHaveLength(4);
    expect(stagingLeft()).toEqual([]);
    expect(profiles.get('Default')).toMatchObject({ profileDir: 'Default', name: 'Person 1', partition: PARTITION, storageDirName: 'maws-chrome-default', userDataDir: fixture.dir, report });
    expect(profiles.get('Default')!.extensions).toEqual(report.extensions);
    expect(emitted.filter((e) => e.name !== 'browser.import.progress').map((e) => e.name)).toEqual(['browser.import.changed', 'browser.import.finished']);
    expect(emitted.at(-1)!.payload).toEqual({ importId, report });
    expect(svc.running()).toBeNull();
  });

  it('passes the chosen extensions, their version directories and the partition folder to the extensions phase', async () => {
    await importAll(service(), { extensionIds: [fixture.extensions.probe.id] });
    const input = extensions.mock.calls[0]![0];
    expect(input.extensions.map((e) => [e.candidate.id, e.versionDir])).toEqual([[fixture.extensions.probe.id, fixture.extensions.probe.dir]]);
    expect(input.partitionFolder).toBe(join(userData, 'browser', 'maws-chrome-Default'));
    expect(input.ses).toBe(session.session);
  });

  it('counts a partitioned row the partition does not list as not verified', async () => {
    view = fakeView(() => []);
    const { report } = await importAll(service());
    expect(report.cookies).toMatchObject({ imported: 3, partitioned: { imported: 1, verified: 0 }, hosts: { notVerified: ['embed.test'] } });
    expect(report.cookies!.skipped.notVerified).toBe(1);
    expect(ImportReportSchema.safeParse(report).success).toBe(true);
  });

  it('under a wrong key: wrongKey for all five rows, keychain wrongKey, nothing set, the rest imported', async () => {
    keychain = vi.fn(allowed(fixture.wrongPassword));
    const { report } = await importAll(service());
    expect(report.cookies).toMatchObject({ imported: 0, partitioned: { imported: 0, verified: 0 }, keychain: 'wrongKey' });
    expect(report.cookies!.skipped.wrongKey).toBe(5);
    expect(session.jar).toEqual([]);
    expect(view.createImportView).not.toHaveBeenCalled();
    expect(keys[0]!.every((byte) => byte === 0)).toBe(true);
    expect(report.outcome).toBe('done');
    expect(summaryWords(report)).toMatch(/^0 cookies, 4 history entries, 3 extensions · 7 skipped: 5 could not be decrypted/);
  });

  it.each([
    [{ outcome: 'denied', exitCode: 51, error: 'User interaction is not allowed.' }, 'denied', 'User interaction is not allowed.'],
    [{ outcome: 'missing' }, 'missing', null],
    [{ outcome: 'timeout' }, 'timeout', null],
  ] as const)('when the Keychain answers %o: cookies skipped with the outcome, history and extensions imported', async (answer, outcome, error) => {
    keychain = vi.fn(async () => answer as KeychainResult);
    const { report } = await importAll(service());
    expect(report).toMatchObject({ outcome: 'done', history: { imported: 4 }, cookies: { imported: 0, keychain: outcome, error } });
    expect(report.extensions).toHaveLength(3);
    expect(session.jar).toEqual([]);
    expect(profiles.get('Default')).not.toBeNull();
  });

  it('cancelled after the history phase: history and storage rolled back, no record, no staging', async () => {
    keychain = vi.fn(untilCancelled);
    const svc = service();
    onEmit = (event) => {
      if (event.payload.phase === 'keychain' && event.payload.done === 0) svc.cancel(svc.running()!.importId);
    };
    const removePartition = vi.spyOn(index.browserHistory, 'removePartition');
    const { report } = await importAll(svc);

    expect(report.outcome).toBe('cancelled');
    expect(ImportReportSchema.parse(report)).toEqual(report);
    expect(report.history!.imported).toBe(4); // the counts reached
    expect(report.cookies).toMatchObject({ imported: 0, keychain: 'skipped', skipped: { cancelled: 5 } });
    expect(report.extensions).toEqual([]);
    expect(removePartition).toHaveBeenCalledWith(PARTITION);
    expect(historyOf()).toEqual([]);
    expect(session.ses.clearStorageData).toHaveBeenCalled();
    expect(extensions).not.toHaveBeenCalled();
    expect(profiles.get('Default')).toBeNull();
    expect(existsSync(join(userData, 'browser', 'profiles.json'))).toBe(false);
    expect(stagingLeft()).toEqual([]);
    expect(phases().at(-1)).toBe('cleaning');
    expect(emitted.some((e) => e.name === 'browser.import.changed')).toBe(false);
  });

  it('treats the Keychain’s cancelled answer as a cancelled run', async () => {
    keychain = vi.fn(async () => ({ outcome: 'cancelled' }) as KeychainResult);
    const { report } = await importAll(service());
    expect(report.outcome).toBe('cancelled');
    expect(historyOf()).toEqual([]);
    expect(profiles.get('Default')).toBeNull();
  });

  it('cancelled in the extensions phase: the loaded extensions removed and the partition folder deleted', async () => {
    extensions = fakeExtensions(session.loaded, { waitForAbortAfter: 1 });
    const svc = service();
    onEmit = (event) => {
      if (event.payload.phase === 'extensions' && event.payload.done === 1) svc.cancel(svc.running()!.importId);
    };
    const { report } = await importAll(svc, { extensionIds: [fixture.extensions.probe.id, fixture.extensions.fails.id] });
    expect(report.outcome).toBe('cancelled');
    expect(session.ses.extensions.removeExtension).toHaveBeenCalledWith(fixture.extensions.probe.id);
    expect(session.loaded.size).toBe(0);
    expect(existsSync(join(userData, 'browser', 'maws-chrome-Default'))).toBe(false);
    expect(session.jar).toEqual([]);
    expect(historyOf()).toEqual([]);
    expect(profiles.get('Default')).toBeNull();
    expect(stagingLeft()).toEqual([]);
  });

  it('fails without writing anything when the partition cannot be opened', async () => {
    const svc = service({ partitions: { session: vi.fn(() => { throw new Error('cannot open'); }) } });
    const { report } = await importAll(svc);
    expect(report).toMatchObject({ outcome: 'failed', failure: 'partitionUnavailable' });
    expect(ImportReportSchema.safeParse(report).success).toBe(true);
    expect(keychain).not.toHaveBeenCalled();
    expect(historyOf()).toEqual([]);
    expect(profiles.get('Default')).toBeNull();
    expect(stagingLeft()).toEqual([]);
  });

  it('fails the history category alone when the index is unavailable', async () => {
    const history = { importRows: () => { throw Object.assign(new Error('the index is unavailable'), { code: 'indexUnavailable' }); }, removePartition: () => {} };
    const { report } = await importAll(service({ history }));
    expect(report).toMatchObject({ outcome: 'done', history: { imported: 0, error: 'indexUnavailable' }, cookies: { imported: 3 } });
  });

  it('reports a store that could not be staged as the category’s error, the Keychain never asked', async () => {
    const svc = service();
    const inspection = await svc.inspect({ userDataDir: fixture.dir, profileDir: 'Default' });
    writeFileSync(join(userData, 'browser', 'import', inspection.inspectionId, 'Cookies'), 'not a database');
    const { finished } = svc.start({ inspectionId: inspection.inspectionId, categories: { history: false, cookies: true, extensions: false }, extensionIds: [], allowUnverifiedExtensions: false });
    const report = await finished;
    expect(report).toMatchObject({ outcome: 'done', history: null, extensions: null, cookies: { imported: 0, keychain: 'skipped', error: 'SQLITE_NOTADB' } });
    expect(keychain).not.toHaveBeenCalled();
  });

  it('answers start before any progress event: the run begins on the next turn', async () => {
    const svc = service();
    const inspection = await svc.inspect({ userDataDir: fixture.dir, profileDir: 'Default' });
    const { finished } = svc.start({ inspectionId: inspection.inspectionId, categories: ALL, extensionIds: [], allowUnverifiedExtensions: true });
    await Promise.resolve();
    expect(emitted).toEqual([]);
    expect((await finished).outcome).toBe('done');
  });

  it('fails a partition whose storage directory is not an imported profile’s without touching that session', async () => {
    session = fakeSession(userData, 'maws-browser');
    const { report } = await importAll(service());
    expect(report).toMatchObject({ outcome: 'failed', failure: 'partitionUnavailable' });
    expect(session.ses.clearStorageData).not.toHaveBeenCalled();
    expect(session.ses.extensions.getAllExtensions).not.toHaveBeenCalled();
  });

  it('rolls back only the extensions loaded from the partition’s folder', async () => {
    session.loaded.set('elsewhere', { id: 'elsewhere', path: join(userData, 'not-this-import', 'elsewhere') });
    extensions = fakeExtensions(session.loaded, { waitForAbortAfter: 1 });
    const svc = service();
    onEmit = (event) => {
      if (event.payload.phase === 'extensions' && event.payload.done === 1) svc.cancel(svc.running()!.importId);
    };
    await importAll(svc, { extensionIds: [fixture.extensions.probe.id] });
    expect(session.ses.extensions.removeExtension).toHaveBeenCalledTimes(1);
    expect(session.ses.extensions.removeExtension).toHaveBeenCalledWith(fixture.extensions.probe.id);
    expect([...session.loaded.keys()]).toEqual(['elsewhere']);
  });

  it('zeroes the key when the Keychain answers allowed after the owner cancelled', async () => {
    const svc: BrowserImportService = service({
      keychain: async () => {
        svc.cancel(svc.running()!.importId);
        const key = deriveKey(fixture.password);
        keys.push(key);
        return { outcome: 'allowed', key };
      },
    });
    const { report } = await importAll(svc);
    expect(report.outcome).toBe('cancelled');
    expect(keys[0]!.every((byte) => byte === 0)).toBe(true);
    expect(session.jar).toEqual([]);
  });

  it('does not ask the Keychain for an empty cookie store', async () => {
    const svc = service();
    const inspection = await svc.inspect({ userDataDir: fixture.dir, profileDir: 'Default' });
    const db = new DatabaseSync(join(userData, 'browser', 'import', inspection.inspectionId, 'Cookies'));
    db.exec('DELETE FROM cookies');
    db.close();
    const { finished } = svc.start({ inspectionId: inspection.inspectionId, categories: { history: false, cookies: true, extensions: false }, extensionIds: [], allowUnverifiedExtensions: false });
    const report = await finished;
    expect(keychain).not.toHaveBeenCalled();
    expect(report).toMatchObject({ outcome: 'done', cookies: { imported: 0, keychain: 'skipped', error: null } });
    expect(Object.values(report.cookies!.skipped).every((n) => n === 0)).toBe(true);
    expect(phases()).not.toContain('keychain');
  });

  it('fails the run and rolls back when the record cannot be written, announcing no change', async () => {
    const put = vi.fn(() => Promise.reject(Object.assign(new Error('no space'), { code: 'ENOSPC' })));
    const { report } = await importAll(service({ profiles: { get: (dir) => profiles.get(dir), list: () => profiles.list(), put } }));
    expect(put).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ outcome: 'failed', failure: 'recordUnwritable' });
    expect(ImportReportSchema.safeParse(report).success).toBe(true);
    expect(historyOf()).toEqual([]);
    expect(session.ses.clearStorageData).toHaveBeenCalled();
    expect(emitted.some((e) => e.name === 'browser.import.changed')).toBe(false);
    expect(stagingLeft()).toEqual([]);
  });

  it('keeps a written record whole when announcing the change fails', async () => {
    const svc = service({
      emit: (name, payload) => {
        if (name === 'browser.import.changed') throw new Error('no window');
        emitted.push({ name, payload } as Emitted);
        return true;
      },
    });
    const { report } = await importAll(svc);
    expect(report.outcome).toBe('done');
    expect(profiles.get('Default')).not.toBeNull();
    expect(historyOf()).toHaveLength(4);
    expect(session.ses.clearStorageData).not.toHaveBeenCalled();
    expect(emitted.at(-1)!.name).toBe('browser.import.finished');
  });

  it('hears a cancel between history batches, and rolls back the batches written', async () => {
    const big = buildChromeUserData(join(root, 'ChromeBig'));
    const db = new DatabaseSync(big.profiles.Default.history.file);
    const insert = db.prepare('INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, NULL, 1, 0, 13300000000000000, 0)');
    for (let i = 0; i < 1200; i++) insert.run(`https://bulk.test/${i}`);
    db.close();
    let clock = 0;
    const importRows = vi.spyOn(index.browserHistory, 'importRows');
    const svc = service({ now: () => (clock += 1000) }); // every progress event passes the throttle
    onEmit = (event) => {
      if (event.payload.phase === 'history' && event.payload.done === 500) svc.cancel(svc.running()!.importId);
    };
    const inspection = await svc.inspect({ userDataDir: big.dir, profileDir: 'Default' });
    const { finished } = svc.start({ inspectionId: inspection.inspectionId, categories: { history: true, cookies: true, extensions: false }, extensionIds: [], allowUnverifiedExtensions: false });
    const report = await finished;
    expect(report.outcome).toBe('cancelled');
    expect(importRows).toHaveBeenCalledTimes(1);
    expect(report.history!.imported).toBe(498); // the first batch: the fixture's four importable rows and 494 bulk ones
    expect(keychain).not.toHaveBeenCalled();
    expect(historyOf()).toEqual([]);
  });

  describe('start refuses', () => {
    it.each([
      ['extensions without the unverified-files acknowledgement', { allowUnverifiedExtensions: false }, 'unverified'],
      ['no category', { categories: { history: false, cookies: false, extensions: false } }, 'noCategory'],
      ['an extension the inspection did not find', { extensionIds: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] }, 'unknownExtension'],
      ['an inspection that is not the standing one', { inspectionId: '00000000-0000-4000-8000-000000000000' }, 'unknownInspection'],
    ] as const)('%s', async (_, over, reason) => {
      const svc = service();
      const inspection = await svc.inspect({ userDataDir: fixture.dir, profileDir: 'Default' });
      const input = { inspectionId: inspection.inspectionId, categories: ALL, extensionIds: extensionIds(), allowUnverifiedExtensions: true, ...over };
      expect(() => svc.start(input)).toThrow(expect.objectContaining({ reason }));
      expect(svc.running()).toBeNull();
      await svc.discard(inspection.inspectionId);
    });

    it('a second start while an import runs', async () => {
      keychain = vi.fn(untilCancelled);
      const svc = service();
      const first = await svc.inspect({ userDataDir: fixture.dir, profileDir: 'Default' });
      const running = svc.start({ inspectionId: first.inspectionId, categories: ALL, extensionIds: [], allowUnverifiedExtensions: true });
      const second = await svc.inspect({ userDataDir: fixture.dir, profileDir: 'Profile 1' });
      expect(() => svc.start({ inspectionId: second.inspectionId, categories: ALL, extensionIds: [], allowUnverifiedExtensions: true })).toThrow(expect.objectContaining({ reason: 'running' }));
      await vi.waitFor(() => expect(svc.running()).toEqual({ importId: running.importId, profileDir: 'Default', phase: 'keychain' })); // the step a reloaded window reads
      svc.cancel(running.importId);
      expect((await running.finished).outcome).toBe('cancelled');
      await svc.discard(second.inspectionId);
    });
  });

  it('stop() at quit cancels the run and deletes every staging directory synchronously', async () => {
    let asked!: () => void;
    const keychainAsked = new Promise<void>((resolve) => (asked = resolve));
    keychain = vi.fn((signal: AbortSignal) => {
      asked();
      return untilCancelled(signal);
    });
    const svc = service();
    const first = await svc.inspect({ userDataDir: fixture.dir, profileDir: 'Default' });
    const running = svc.start({ inspectionId: first.inspectionId, categories: ALL, extensionIds: [], allowUnverifiedExtensions: true });
    await keychainAsked;
    await svc.inspect({ userDataDir: fixture.dir, profileDir: 'Profile 1' });
    svc.stop();
    expect(stagingLeft()).toEqual([]);
    expect((await running.finished).outcome).toBe('cancelled');
  });
});

describe('progressThrottle', () => {
  it('passes the first and last of each phase and at most one per 100 ms between', () => {
    let now = 0;
    const out: [ImportPhase, number, number][] = [];
    const progress = progressThrottle((phase, done, total) => out.push([phase, done, total]), () => now);
    progress('history', 0, 10);
    now = 50;
    progress('history', 3, 10);
    now = 100;
    progress('history', 5, 10);
    now = 120;
    progress('cookies', 0, 2);
    progress('history', 7, 10);
    progress('history', 10, 10);
    expect(out).toEqual([['history', 0, 10], ['history', 5, 10], ['cookies', 0, 2], ['history', 10, 10]]);
  });
});
