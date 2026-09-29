import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGitRunner } from '../git/runner';
import { ScratchRepo } from '../../../test/support/scratch-repo';
import { TrustStoreFixture } from '../../../test/support/trust-store';
import { configFilePath, readTrustStore, trustKeyOf, trustStateOf } from './trust';

const none = () => false;

describe('config path and trust key', () => {
  it('follows the engine: the legacy <configHome>/.config.json, else <CLAUDE_CONFIG_DIR or HOME>/.claude<suffix>.json', () => {
    const home = '/Users/someone';
    expect(configFilePath({ HOME: home }, none)).toBe('/Users/someone/.claude.json');
    expect(configFilePath({ HOME: home, CLAUDE_CONFIG_DIR: '/tmp/scratch' }, none)).toBe('/tmp/scratch/.claude.json');
    // the legacy file sits inside the config home: ~/.claude by default, the override when set
    expect(configFilePath({ HOME: home }, (p) => p === '/Users/someone/.claude/.config.json')).toBe('/Users/someone/.claude/.config.json');
    expect(configFilePath({ HOME: home, CLAUDE_CONFIG_DIR: '/tmp/scratch' }, (p) => p === '/tmp/scratch/.config.json')).toBe('/tmp/scratch/.config.json');
    expect(configFilePath({ HOME: home, CLAUDE_CONFIG_DIR: '/tmp/scratch' }, (p) => p === '/Users/someone/.claude/.config.json')).toBe('/tmp/scratch/.claude.json');
    // the OAuth suffix: 2.1.283 compiles its environment switch to production, so only the custom OAuth URL selects one
    expect(configFilePath({ HOME: home, CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://oauth.example' }, none)).toBe('/Users/someone/.claude-custom-oauth.json');
    expect(configFilePath({ HOME: home, CLAUDE_CONFIG_DIR: '/tmp/scratch', CLAUDE_CODE_CUSTOM_OAUTH_URL: 'x' }, none)).toBe('/tmp/scratch/.claude-custom-oauth.json');
  });

  describe('trustKeyOf', () => {
    let repo: ScratchRepo;
    let git: ReturnType<typeof createGitRunner>;
    let plain: string;
    let link: string;
    beforeAll(async () => {
      repo = await ScratchRepo.create();
      git = createGitRunner({ env: repo.serviceEnv() });
      plain = realpathSync(mkdtempSync(join(tmpdir(), 'maws-trust-plain-')));
      link = join(realpathSync(mkdtempSync(join(tmpdir(), 'maws-trust-link-'))), 'to-repo');
      symlinkSync(repo.root, link);
    });
    afterAll(() => {
      repo.dispose();
      rmSync(plain, { recursive: true, force: true });
      rmSync(join(link, '..'), { recursive: true, force: true });
    });

    it('answers the main worktree root for the repository, a subdirectory and a linked worktree', async () => {
      mkdirSync(repo.path('src/deep'), { recursive: true });
      const worktree = await repo.addManagedWorktree('trust-key');
      expect(await trustKeyOf(repo.root, git)).toEqual({ trustKey: repo.root, keyKind: 'repo', directory: repo.root });
      expect(await trustKeyOf(repo.path('src/deep'), git)).toEqual({ trustKey: repo.root, keyKind: 'repo', directory: repo.path('src/deep') });
      expect(await trustKeyOf(worktree, git)).toEqual({ trustKey: repo.root, keyKind: 'repo', directory: worktree });
    });

    it('answers the directory itself outside a repository, and the realpath through a symlink', async () => {
      expect(await trustKeyOf(plain, git)).toEqual({ trustKey: plain, keyKind: 'directory', directory: plain });
      expect(await trustKeyOf(link, git)).toEqual({ trustKey: repo.root, keyKind: 'repo', directory: repo.root });
      const tmpSpelling = plain.replace(/^\/private\/tmp\//, '/tmp/'); // the engine canonicalises /tmp to /private/tmp too
      expect((await trustKeyOf(tmpSpelling, git)).trustKey).toBe(plain);
    });

    it('never throws for a missing directory (the caller answers missing_directory first)', async () => {
      const missing = join(plain, 'gone', 'café');
      expect(await trustKeyOf(missing, git)).toEqual({ trustKey: missing.normalize('NFC'), keyKind: 'directory', directory: missing.normalize('NFC') });
    });
  });
});

describe('trust store', () => {
  let store: TrustStoreFixture;
  beforeAll(() => {
    store = new TrustStoreFixture();
  });
  afterAll(() => store.dispose());

  it('reads the projects map; {} for a missing file', async () => {
    store.write({ '/a': { hasTrustDialogAccepted: true } });
    expect(await readTrustStore(store.configPath)).toEqual({ '/a': { hasTrustDialogAccepted: true } });
    expect(await readTrustStore(join(store.configHome, 'absent.json'))).toEqual({});
  });

  it('retries a torn read once after 50 ms, then answers {} with a warning', async () => {
    const warn = vi.fn();
    let calls = 0;
    const torn = async () => (++calls === 1 ? '{"projects":{"/a":' : JSON.stringify({ projects: { '/a': { hasTrustDialogAccepted: true } } }));
    expect(await readTrustStore('/x/.claude.json', { read: torn, delayMs: 1, warn })).toEqual({ '/a': { hasTrustDialogAccepted: true } });
    expect(calls).toBe(2);
    expect(warn).not.toHaveBeenCalled();
    const always = vi.fn(async () => 'not json');
    expect(await readTrustStore('/x/.claude.json', { read: always, delayMs: 1, warn })).toEqual({});
    expect(always).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
    expect(await readTrustStore('/x/.claude.json', { read: async () => '[1,2]', delayMs: 1, warn })).toEqual({}); // not an object: nothing trusted
  });

  describe('trustStateOf', () => {
    let repo: ScratchRepo;
    let worktree: string;
    let home: string;
    let deps: Parameters<typeof trustStateOf>[1];
    beforeAll(async () => {
      repo = await ScratchRepo.create();
      worktree = await repo.addManagedWorktree('state');
      home = realpathSync(mkdtempSync(join(tmpdir(), 'maws-trust-home-')));
      deps = { git: createGitRunner({ env: repo.serviceEnv() }), env: store.env({ HOME: home }) };
    });
    afterAll(() => {
      repo.dispose();
      rmSync(home, { recursive: true, force: true });
    });

    it("reads hasTrustDialogAccepted under the trust key only, as the engine's Xf() does", async () => {
      store.write({ [worktree]: { hasTrustDialogAccepted: true }, '/': { hasTrustDialogAccepted: true } });
      const untrusted = await trustStateOf(worktree, deps);
      expect(untrusted).toMatchObject({ directory: worktree, trustKey: repo.root, keyKind: 'repo', configPath: store.configPath, trusted: false, source: null, isHome: false });
      store.write({ [repo.root]: { hasTrustDialogAccepted: true } });
      expect(await trustStateOf(worktree, deps)).toMatchObject({ trusted: true, source: 'trustKey' });
      store.write({ [repo.root]: { hasTrustDialogAccepted: false } });
      expect(await trustStateOf(repo.root, deps)).toMatchObject({ trusted: false, source: null });
    });

    it('is untrusted when the global config file is missing', async () => {
      const empty = new TrustStoreFixture();
      try {
        expect(await trustStateOf(repo.root, { ...deps, env: empty.env({ HOME: home }) })).toMatchObject({ trusted: false, source: null, configPath: empty.configPath });
      } finally {
        empty.dispose();
      }
    });

    it('lists what trust would load, read from the directory itself', async () => {
      const state = await trustStateOf(worktree, deps);
      expect(state.found).toEqual([
        { file: '.claude/settings.json', summary: '1 allow rule, 1 hook, 1 marketplace, 1 plugin' },
        { file: '.mcp.json', summary: '1 MCP server: scratch-sentinel' },
      ]);
      const plain = realpathSync(mkdtempSync(join(tmpdir(), 'maws-trust-found-')));
      try {
        expect((await trustStateOf(plain, deps)).found).toEqual([]);
        mkdirSync(join(plain, '.claude'));
        writeFileSync(join(plain, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['A', 'B'], additionalDirectories: ['/x'] }, env: { K: '1', L: '2' } }));
        writeFileSync(join(plain, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet' })); // nothing gated
        writeFileSync(join(plain, '.mcp.json'), 'not json');
        expect((await trustStateOf(plain, deps)).found).toEqual([{ file: '.claude/settings.local.json', summary: '2 allow rules, 1 additional directory, 2 env keys' }]);
      } finally {
        rmSync(plain, { recursive: true, force: true });
      }
    });

    it('marks the home directory, whose trust the engine keeps per session only', async () => {
      expect(await trustStateOf(home, deps)).toMatchObject({ directory: home, trustKey: home, keyKind: 'directory', isHome: true });
    });
  });
});
