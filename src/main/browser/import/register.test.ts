import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ImportedExtension } from '@shared/browser/import';
import type { CommandName } from '@shared/ipc/schema';
import { buildChromeUserData, type ChromeUserData } from '../../../../test/support/chrome-profile';

vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, BrowserWindow: { fromWebContents: () => null } }));

const { CommandFailure } = await import('../../ipc/router');
const { registerBrowserImportHandlers } = await import('./register');
const { ImportRefused } = await import('./service');

const IMPORT_ID = '11111111-1111-4111-8111-111111111111';
const INSPECTION_ID = '22222222-2222-4222-8222-222222222222';
const EXTENSION_ID = 'a'.repeat(32);

let root: string;
let fixture: ChromeUserData;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-e4b-register-'));
  fixture = buildChromeUserData(join(root, 'Chrome'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function setup(env: NodeJS.ProcessEnv = { MAWS_E2E: '1', MAWS_E2E_CHROME_USER_DATA: fixture.dir }) {
  const handlers = new Map<CommandName, (input: unknown, context: unknown) => Promise<unknown>>();
  const sender = {} as WebContents;
  const service = {
    inspect: vi.fn(async () => ({ inspectionId: INSPECTION_ID })),
    discard: vi.fn(async () => {}),
    start: vi.fn(() => ({ importId: IMPORT_ID, finished: new Promise(() => {}) })),
    cancel: vi.fn(),
    running: vi.fn((): { importId: string; profileDir: string; phase: string | null } | null => null),
  };
  const record = { profileDir: 'Default', name: 'Person 1' };
  const profiles = { list: vi.fn(() => [record]), get: vi.fn((dir: string) => (dir === 'Default' ? record : null)), fileBroken: false };
  const extension = { id: EXTENSION_ID, enabled: false } as ImportedExtension;
  const extensions = { setExtension: vi.fn(async () => extension) };
  const remove = vi.fn(async () => ({ tabs: 1, historyRows: 4, extensions: 3 }));
  const chooseDirectory = vi.fn(async () => ({ canceled: false, filePaths: [fixture.dir] }));
  const emit = vi.fn();
  registerBrowserImportHandlers({
    service: service as never,
    profiles: profiles as never,
    extensions,
    remove,
    chooseDirectory,
    emit,
    env,
    home: '/Users/someone',
    register: (name, handler) => void handlers.set(name, handler as never),
  });
  const call = (name: CommandName, input?: unknown) => handlers.get(name)!(input, { sender });
  const failure = async (name: CommandName, input?: unknown) => {
    const error = await call(name, input).then(() => null, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(CommandFailure);
    return (error as InstanceType<typeof CommandFailure>).error;
  };
  return { handlers, call, failure, service, profiles, extensions, remove, chooseDirectory, emit, sender, extension };
}

describe('browser.import.* handlers (E4b Interfaces "IPC"; Design §2, §15)', () => {
  it('registers every browser.import command', () => {
    expect([...setup().handlers.keys()].sort()).toEqual(
      ['profiles', 'chooseUserData', 'inspect', 'discard', 'start', 'cancel', 'list', 'remove', 'setExtension'].map((name) => `browser.import.${name}`).sort(),
    );
  });

  it('lists the default folder\'s profiles, under e2e the seam\'s folder, marking the imported one', async () => {
    const answer = (await setup().call('browser.import.profiles', { userDataDir: null })) as { userDataDir: string; found: boolean; profiles: { profileDir: string; imported: boolean }[] };
    expect(answer).toMatchObject({ userDataDir: fixture.dir, found: true });
    expect(answer.profiles.map(({ profileDir, imported }) => [profileDir, imported])).toEqual([
      ['Default', true],
      ['Profile 1', false],
    ]);
  });

  it('under e2e without the seam\'s folder finds nothing (Decision Log 37), naming Chrome\'s default folder unread', async () => {
    const answer = await setup({ MAWS_E2E: '1' }).call('browser.import.profiles', { userDataDir: null });
    expect(answer).toEqual({ userDataDir: '/Users/someone/Library/Application Support/Google/Chrome', found: false, chromeRunning: false, profiles: [], error: null });
  });

  it('chooses a folder through the dialog seam, answering null when cancelled', async () => {
    const { call, chooseDirectory, sender } = setup();
    expect(await call('browser.import.chooseUserData')).toEqual({ userDataDir: fixture.dir });
    expect(chooseDirectory).toHaveBeenCalledWith(sender, expect.objectContaining({ properties: ['openDirectory'], defaultPath: fixture.dir }));
    chooseDirectory.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await call('browser.import.chooseUserData')).toEqual({ userDataDir: null });
  });

  it('refuses a folder that is not absolute and normal, or a bad profile directory, before anything reads the disk', async () => {
    const { failure, service } = setup();
    for (const userDataDir of ['relative/Chrome', `${fixture.dir}/../Chrome`, `${fixture.dir}//x`]) {
      expect(await failure('browser.import.inspect', { userDataDir, profileDir: 'Default' })).toMatchObject({ code: 'invalid_input' });
      expect(await failure('browser.import.profiles', { userDataDir })).toMatchObject({ code: 'invalid_input' });
    }
    for (const profileDir of ['../Default', 'a/b', '']) {
      expect(await failure('browser.import.inspect', { userDataDir: fixture.dir, profileDir })).toMatchObject({ code: 'invalid_input' });
      expect(await failure('browser.import.remove', { profileDir })).toMatchObject({ code: 'invalid_input' });
    }
    expect(service.inspect).not.toHaveBeenCalled();
  });

  it('answers a refusal as invalid_input with its sentence', async () => {
    const { failure, service } = setup();
    service.start.mockImplementationOnce(() => {
      throw new ImportRefused('running');
    });
    expect(await failure('browser.import.start', { inspectionId: INSPECTION_ID, categories: { history: true, cookies: false, extensions: false }, extensionIds: [], allowUnverifiedExtensions: false })).toEqual({
      code: 'invalid_input',
      message: 'an import is running',
    });
  });

  it('answers any other failure as internal with its message redacted, never quoting a value', async () => {
    const { failure, service } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      service.inspect.mockRejectedValueOnce(new Error('could not read https://bank.example.test/account?token=e4b-sentinel-x value=e4b-sentinel-y'));
      const error = await failure('browser.import.inspect', { userDataDir: fixture.dir, profileDir: 'Default' });
      expect(error.code).toBe('internal');
      expect(error.message).toBe('could not read bank.example.test value=<redacted>');
      expect(warn.mock.calls.flat().join(' ')).not.toContain('e4b-sentinel');
    } finally {
      warn.mockRestore();
    }
  });

  it('start answers the run\'s id only; list answers the records and whether the file was moved aside', async () => {
    const { call } = setup();
    expect(await call('browser.import.start', { inspectionId: INSPECTION_ID, categories: { history: true, cookies: false, extensions: false }, extensionIds: [], allowUnverifiedExtensions: false })).toEqual({
      importId: IMPORT_ID,
    });
    expect(await call('browser.import.list')).toEqual({ profiles: [{ profileDir: 'Default', name: 'Person 1' }], fileBroken: false, running: null });
  });

  it('list answers the run under way, so a window reloaded mid-run shows it (Decision Log 41)', async () => {
    const { call, service } = setup();
    service.running.mockReturnValue({ importId: IMPORT_ID, profileDir: 'Default', phase: 'keychain' });
    expect(await call('browser.import.list')).toMatchObject({ running: { importId: IMPORT_ID, profileDir: 'Default', phase: 'keychain' } });
  });

  it('remove and setExtension answer, then announce the records', async () => {
    const { call, emit, remove, extensions, extension } = setup();
    expect(await call('browser.import.remove', { profileDir: 'Default' })).toEqual({ removed: { tabs: 1, historyRows: 4, extensions: 3 } });
    expect(remove).toHaveBeenCalledWith('Default');
    expect(await call('browser.import.setExtension', { profileDir: 'Default', extensionId: EXTENSION_ID, enabled: false })).toEqual({ extension });
    expect(extensions.setExtension).toHaveBeenCalledWith('Default', EXTENSION_ID, false);
    expect(emit.mock.calls).toEqual([
      ['browser.import.changed', { profiles: [{ profileDir: 'Default', name: 'Person 1' }] }],
      ['browser.import.changed', { profiles: [{ profileDir: 'Default', name: 'Person 1' }] }],
    ]);
  });

  it('a failed removal announces nothing', async () => {
    const { failure, emit, remove } = setup();
    remove.mockRejectedValueOnce(new ImportRefused('notImported'));
    expect(await failure('browser.import.remove', { profileDir: 'Default' })).toEqual({ code: 'invalid_input', message: 'not an imported profile' });
    expect(emit).not.toHaveBeenCalled();
  });
});
