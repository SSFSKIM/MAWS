// E4b Task 3.1: the import store is the run's mirror app-wide (Design §3, §11; Decision Log 7, 28, 35): a `done` end
// makes its profile active with no sheet mounted, progress is kept only for the run being shown, the records follow
// main's changes and E4a's profile list is invalidated with them, and a moved-aside records file raises one banner.
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { CANCELLED_REPORT } from '../../../../../../test/support/import-reports';
import { ipc } from '../../../ipc/client';
import { useNotices } from '../../../stores/notices';
import { useSettings } from '../../../stores/settings';
import { CHROME, DONE, IMPORT_ID, importBridge, INSPECTION, OTHER_IMPORT_ID, RECORD, type ImportBridge } from '../../../test-support/browser-import';
import { browserImport, cancel, connectBrowserImport, discard, inspect, openImport, PROFILES_FILE_BROKEN_BANNER, removeProfile, resetBrowserImport, start } from './store';

let b: ImportBridge;
let queries: QueryClient;
let disconnect = () => {};
const stage = () => browserImport.getState().stage;
const names = () => b.calls.map((c) => c.name);

function connect(over: ImportBridge['answers'] = {}) {
  Object.assign(b.answers, over);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  disconnect = connectBrowserImport(ipc, queries);
}

async function toConsent() {
  await inspect(CHROME, 'Default');
  expect(stage().kind).toBe('consent');
}
const CHOICE = { categories: { history: true, cookies: true, extensions: false }, extensionIds: [], allowUnverifiedExtensions: false };

beforeEach(() => {
  b = importBridge();
  window.maws = b.bridge;
});
afterEach(() => {
  disconnect();
  resetBrowserImport();
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  delete (window as { maws?: MawsBridge }).maws;
});

describe('the run’s end', () => {
  it('a done import makes its profile active through settings.set with no sheet mounted, and the stage holds its report', async () => {
    connect();
    b.emit('browser.import.finished', { importId: IMPORT_ID, report: DONE });
    await expect.poll(() => b.sets).toEqual([{ browser: { profile: 'Default' } }]);
    expect(useSettings.getState().state!.settings.browser.profile).toBe('Default');
    expect(stage()).toEqual({ kind: 'report', report: DONE });
  });

  it('a cancelled or failed run writes no setting', async () => {
    connect();
    b.emit('browser.import.finished', { importId: IMPORT_ID, report: CANCELLED_REPORT });
    b.emit('browser.import.finished', { importId: OTHER_IMPORT_ID, report: { ...CANCELLED_REPORT, outcome: 'failed', failure: 'partitionUnavailable' } });
    await Promise.resolve();
    expect(b.sets).toEqual([]);
  });

  it('a run that ends before start’s answer arrives shows its report, not a run that never ends', async () => {
    connect();
    await toConsent();
    let answer!: () => void;
    b.answers['browser.import.start'] = () => ({ importId: IMPORT_ID });
    const invoke = b.bridge.invoke;
    b.bridge.invoke = (async (name: string, input: unknown) => {
      if (name === 'browser.import.start') await new Promise<void>((resolve) => (answer = resolve));
      return invoke(name as never, input as never);
    }) as MawsBridge['invoke'];
    const started = start(CHOICE);
    await expect.poll(() => typeof answer).toBe('function');
    b.emit('browser.import.progress', { importId: IMPORT_ID, phase: 'history', done: 0, total: 6 });
    expect(stage()).toMatchObject({ kind: 'running', importId: IMPORT_ID, name: null });
    b.emit('browser.import.finished', { importId: IMPORT_ID, report: DONE });
    answer();
    await started;
    expect(stage()).toEqual({ kind: 'report', report: DONE });
  });
});

describe('progress', () => {
  it('is kept for the run being shown only; another run’s events and a late event after the end are ignored', async () => {
    connect();
    await toConsent();
    await start(CHOICE);
    expect(stage()).toEqual({ kind: 'running', importId: IMPORT_ID, name: 'Person 1', progress: null, cancelling: false });
    b.emit('browser.import.progress', { importId: OTHER_IMPORT_ID, phase: 'cookies', done: 3, total: 5 });
    expect(stage()).toMatchObject({ progress: null });
    b.emit('browser.import.progress', { importId: IMPORT_ID, phase: 'history', done: 6, total: 6 });
    expect(stage()).toMatchObject({ progress: { phase: 'history', done: 6, total: 6 } });
    b.emit('browser.import.finished', { importId: IMPORT_ID, report: DONE });
    b.emit('browser.import.progress', { importId: IMPORT_ID, phase: 'cleaning', done: 1, total: 1 });
    expect(stage()).toEqual({ kind: 'report', report: DONE });
  });

  it('a run this window did not start (another window’s, or one from before a reload) is adopted from its progress', () => {
    connect();
    b.emit('browser.import.progress', { importId: IMPORT_ID, phase: 'extensions', done: 1, total: 3 });
    expect(stage()).toEqual({ kind: 'running', importId: IMPORT_ID, name: null, progress: { phase: 'extensions', done: 1, total: 3 }, cancelling: false });
    openImport(); // the Import button while it runs shows the run
    expect(stage().kind).toBe('running');
    cancel();
    cancel(); // once
    expect(b.calls.filter((c) => c.name === 'browser.import.cancel')).toEqual([{ name: 'browser.import.cancel', input: { importId: IMPORT_ID } }]);
  });
});

describe('the sheet’s stages', () => {
  it('a refused start shows main’s sentence and discards the inspection it may have left standing', async () => {
    connect({
      'browser.import.start': () => {
        throw new Error('an import is running');
      },
    });
    await toConsent();
    await start(CHOICE);
    expect(stage()).toEqual({ kind: 'failed', message: 'an import is running' });
    expect(names()).toContain('browser.import.discard');
  });

  it('an inspection that answers after the sheet closed, or after another run was adopted, is discarded on arrival', async () => {
    connect();
    let answer!: () => void;
    const invoke = b.bridge.invoke;
    b.bridge.invoke = (async (name: string, input: unknown) => {
      if (name === 'browser.import.inspect') await new Promise<void>((resolve) => (answer = resolve));
      return invoke(name as never, input as never);
    }) as MawsBridge['invoke'];
    let inspecting = inspect(CHROME, 'Default');
    await expect.poll(() => typeof answer).toBe('function');
    discard(); // the sheet closed in pick
    answer();
    await inspecting;
    expect(stage()).toEqual({ kind: 'pick' });
    expect(browserImport.getState().busy).toBe(false);

    inspecting = inspect(CHROME, 'Default');
    await expect.poll(() => browserImport.getState().busy).toBe(true);
    b.emit('browser.import.progress', { importId: OTHER_IMPORT_ID, phase: 'copying', done: 0, total: 1 }); // another window's run
    answer();
    await inspecting;
    expect(stage()).toMatchObject({ kind: 'running', importId: OTHER_IMPORT_ID });
    expect(browserImport.getState().busy).toBe(false);
    expect(b.calls.filter((c) => c.name === 'browser.import.discard')).toHaveLength(2);
  });

  it('opening the sheet again over a standing inspection discards it and starts at the picker', async () => {
    connect();
    await toConsent();
    openImport();
    expect(stage()).toEqual({ kind: 'pick' });
    expect(b.calls.filter((c) => c.name === 'browser.import.discard')).toEqual([{ name: 'browser.import.discard', input: { inspectionId: INSPECTION.inspectionId } }]);
  });
});

describe('the records', () => {
  it('come from the list at connect, then from main’s changes, each change invalidating E4a’s profile list and the picker', async () => {
    connect({ 'browser.import.list': () => ({ profiles: [RECORD], fileBroken: false }) });
    await expect.poll(() => browserImport.getState().records).toEqual([RECORD]);
    queries.setQueryData(['maws', 'browser.profiles.list', undefined], { profiles: [] });
    queries.setQueryData(['maws', 'browser.import.profiles', { userDataDir: null }], { profiles: [] });
    b.emit('browser.import.changed', { profiles: [] });
    expect(browserImport.getState().records).toEqual([]);
    expect(queries.getQueryState(['maws', 'browser.profiles.list', undefined])!.isInvalidated).toBe(true);
    expect(queries.getQueryState(['maws', 'browser.import.profiles', { userDataDir: null }])!.isInvalidated).toBe(true);
    expect(useNotices.getState().notices).toEqual([]);
  });

  it('a list answer arriving after a change does not overwrite it', async () => {
    let answer!: () => void;
    const invoke = b.bridge.invoke;
    b.bridge.invoke = (async (name: string, input: unknown) => {
      if (name === 'browser.import.list') await new Promise<void>((resolve) => (answer = resolve));
      return invoke(name as never, input as never);
    }) as MawsBridge['invoke'];
    connect({ 'browser.import.list': () => ({ profiles: [RECORD], fileBroken: false }) });
    await expect.poll(() => typeof answer).toBe('function');
    b.emit('browser.import.changed', { profiles: [] });
    answer();
    await expect.poll(() => names()).toContain('browser.import.list');
    await Promise.resolve();
    expect(browserImport.getState().records).toEqual([]);
  });

  it('a records file this boot moved aside raises one app banner, with a fixed id', async () => {
    connect({ 'browser.import.list': () => ({ profiles: [], fileBroken: true }) });
    await expect.poll(() => useNotices.getState().notices.length).toBe(1);
    disconnect();
    connect(); // a second connection (a remount) replaces the same banner
    await expect.poll(() => names().filter((name) => name === 'browser.import.list')).toHaveLength(2);
    const notices = useNotices.getState().notices;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ id: PROFILES_FILE_BROKEN_BANNER, kind: 'banner', level: 'warning' });
    expect(notices[0]!.text).toContain('Import the profiles again from Settings › Browser');
  });

  it('removal writes browser.profile null only when it named the removed profile', async () => {
    connect({ 'browser.import.list': () => ({ profiles: [RECORD], fileBroken: false }), 'browser.import.remove': () => ({ removed: { tabs: 1, historyRows: 4, extensions: 3 } }) });
    await expect.poll(() => browserImport.getState().records).toHaveLength(1);
    await removeProfile('Profile 1');
    expect(b.sets).toEqual([]);
    useSettings.setState({ state: { settings: { ...useSettings.getState().state!.settings, browser: { ...useSettings.getState().state!.settings.browser, profile: 'Default' } }, resolvedTheme: 'light' } });
    expect(await removeProfile('Default')).toBeNull();
    expect(b.sets).toEqual([{ browser: { profile: null } }]);
    expect(browserImport.getState().records).toEqual([]);
  });
});
