import { mkdtemp, readFile, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelCatalogueSchema } from '@shared/sessions/models';
import { loadJournal } from '../../test/support/fixtures';
import { BUILTIN_MODELS, catalogueKey, ModelsCache, modelsKey } from './models-cache';

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-models-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

const file = () => join(userData, 'engine-host', 'models.json');
const readsModels = () => (loadJournal('pass1', 'reads').find((r) => r.seq === 3)!.frame as { response: { response: { models: unknown[] } } }).response.response.models;
// a Direct launch's initialize (pass2/auto-unrouted seq 4): no relay aliases, the engine's own fable id
const directModels = () => (loadJournal('pass2', 'auto-unrouted').find((r) => r.seq === 4)!.frame as { response: { response: { models: unknown[] } } }).response.response.models;
const RELAY = modelsKey('2.1.283', 'gateway');
const DIRECT = modelsKey('2.1.283', 'direct');

describe('models catalogue cache', () => {
  it('answers the built-in list before any catalogue was seen: the five entries of reads.jsonl, no relay alias', async () => {
    const cache = new ModelsCache(userData);
    await cache.load();
    const answer = cache.answer();
    expect(ModelCatalogueSchema.parse(answer)).toEqual(answer);
    expect(answer).toEqual({ source: 'builtin', at: null, models: BUILTIN_MODELS });
    expect(BUILTIN_MODELS.map((m) => m.value)).toEqual(['default', 'opus', 'fable', 'sonnet', 'haiku']);
    expect(BUILTIN_MODELS.filter((m) => m.supportsAutoMode === false).map((m) => m.value)).toEqual(['haiku']);
    const recorded = readsModels() as { value: string; displayName: string }[];
    for (const entry of BUILTIN_MODELS) expect(recorded.find((m) => m.value === entry.value)?.displayName).toBe(entry.displayName);
  });

  it('keeps each catalogue under its key temp-then-rename and answers it as cached, across a restart', async () => {
    const cache = new ModelsCache(userData, { now: () => '2026-09-29T10:00:00.000Z' });
    await cache.load();
    await cache.update(RELAY, readsModels());
    expect(cache.answer(RELAY)).toMatchObject({ source: 'cached', at: '2026-09-29T10:00:00.000Z' });
    expect(cache.answer(RELAY).models.map((m) => m.value)).toContain('claude/astra');
    const onDisk = JSON.parse(await readFile(file(), 'utf8')) as { entries: Record<string, { at: string; models: { value: string }[] }> };
    expect(Object.keys(onDisk.entries)).toEqual([RELAY]);
    expect(onDisk.entries[RELAY]!.at).toBe('2026-09-29T10:00:00.000Z');
    expect(onDisk.entries[RELAY]!.models).toHaveLength(12);
    const again = new ModelsCache(userData);
    await again.load();
    expect(again.answer(RELAY)).toEqual(cache.answer(RELAY));
  });

  it('a Direct launch and a relay launch keep their own lists; a key never seen answers the built-in list, no key the newest', async () => {
    let clock = 0;
    const cache = new ModelsCache(userData, { now: () => `2026-09-29T10:00:0${clock++}.000Z` });
    await cache.load();
    expect(cache.answer(DIRECT).source).toBe('builtin');
    await cache.update(RELAY, readsModels());
    expect(cache.answer(DIRECT)).toEqual({ source: 'builtin', at: null, models: BUILTIN_MODELS }); // the relay's aliases never answer for Direct
    await cache.update(DIRECT, directModels());
    const values = (key?: string) => cache.answer(key).models.map((m) => m.value);
    expect(values(RELAY)).toContain('claude/astra');
    expect(values(DIRECT)).toEqual(['default', 'opus', 'claude-fable-5-1[1m]', 'sonnet', 'haiku']);
    expect(values()).toEqual(values(DIRECT)); // the most recently updated
    await cache.update(RELAY, readsModels());
    expect(values()).toEqual(values(RELAY));
    expect(cache.answer(modelsKey('2.1.284', 'gateway')).source).toBe('builtin'); // another binary's catalogue is another key
    const again = new ModelsCache(userData);
    await again.load();
    expect(again.answer(DIRECT)).toEqual(cache.answer(DIRECT));
    expect(again.answer()).toEqual(cache.answer(RELAY));
  });

  it('drops entries that are not catalogue entries and ignores an empty list', async () => {
    const cache = new ModelsCache(userData);
    await cache.load();
    await cache.update(RELAY, [{ value: 'sonnet', displayName: 'Sonnet 5' }, { value: 'broken' }, 'nonsense']);
    expect(cache.answer(RELAY).models).toEqual([{ value: 'sonnet', displayName: 'Sonnet 5' }]);
    await cache.update(RELAY, []);
    expect(cache.answer(RELAY).models).toEqual([{ value: 'sonnet', displayName: 'Sonnet 5' }]);
  });

  it('answers the built-in list over an unreadable cache file, with a warning', async () => {
    await mkdir(join(userData, 'engine-host'), { recursive: true });
    for (const text of ['{"at":', '{"at":"2026-09-29T10:00:00.000Z","models":[]}' /* the unkeyed file before debt wave 3 */]) {
      await writeFile(file(), text);
      const warnings: string[] = [];
      const cache = new ModelsCache(userData, { warn: (m) => warnings.push(m) });
      await cache.load();
      expect(cache.answer().source).toBe('builtin');
      expect(warnings).toHaveLength(1);
    }
  });

  // P2-F L117 (G3's pattern): a later build's key in the file or an entry is stripped on read, the file left as it was
  // until the next update writes this build's shape
  it("reads a cache carrying a later build's keys, leaves its bytes on read and writes back only the current shape", async () => {
    await mkdir(join(userData, 'engine-host'), { recursive: true });
    const models = [{ value: 'sonnet', displayName: 'Sonnet' }];
    const text = JSON.stringify({ entries: { [RELAY]: { at: '2026-09-29T10:00:00.000Z', models, futureKey: 1 } }, futureKey: 2 });
    await writeFile(file(), text);
    const warnings: string[] = [];
    const cache = new ModelsCache(userData, { now: () => '2026-09-29T11:00:00.000Z', warn: (m) => warnings.push(m) });
    await cache.load();
    expect(cache.answer(RELAY)).toEqual({ models, source: 'cached', at: '2026-09-29T10:00:00.000Z' });
    expect(warnings).toEqual([]);
    expect(await readFile(file(), 'utf8')).toBe(text);
    await cache.update(DIRECT, models);
    expect(JSON.parse(await readFile(file(), 'utf8'))).toEqual({ entries: { [RELAY]: { at: '2026-09-29T10:00:00.000Z', models }, [DIRECT]: { at: '2026-09-29T11:00:00.000Z', models } } });
  });
});

// Debt wave 5: what a launch's catalogue depends on beyond its route, the model environment the engine will run with
// (the spawn environment, then the settings files' `env` blocks in the engine's order, user < project < local < flag).
describe('catalogueKey', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'maws-model-env-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const settings = async (dir: string, name: string, value: unknown) => {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(join(dir, '.claude', name), typeof value === 'string' ? value : JSON.stringify(value));
  };

  it('is the route key when no settings file changes the model environment the spawn and user settings set', async () => {
    const home = join(root, 'home');
    const project = join(root, 'project');
    await settings(home, 'settings.json', { env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5[1m]' } });
    await settings(project, 'settings.json', { env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5[1m]', MCP_TIMEOUT: '9000' }, model: 'opus' }); // same value; not a model variable
    const env = { HOME: home, ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5' };
    expect(await catalogueKey('2.1.283', 'gateway', { env, cwd: project })).toBe(RELAY);
    expect(await catalogueKey('2.1.283', 'gateway', { env, cwd: null })).toBe(RELAY);
    expect(await catalogueKey('2.1.283', 'gateway', { env, cwd: join(root, 'missing') })).toBe(RELAY);
  });

  it('keys a launch apart when its project settings set model env, the M6 home-directory case: the home as a project under a scratch config home', async () => {
    const home = join(root, 'home');
    const config = join(root, 'config');
    await settings(home, 'settings.json', { env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5[1m]', CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: 1 } });
    const env = { HOME: home, CLAUDE_CONFIG_DIR: config };
    const atHome = await catalogueKey('2.1.283', 'gateway', { env, cwd: home });
    expect(atHome).toMatch(/^2\.1\.283\/gateway\/env-[0-9a-f]{12}$/);
    expect(await catalogueKey('2.1.283', 'direct', { env, cwd: home })).toBe(atHome.replace('/gateway/', '/direct/'));
    expect(await catalogueKey('2.1.283', 'gateway', { env, cwd: root })).toBe(RELAY); // elsewhere, the route's
    // with the owner's config home the same file is user settings, which every launch reads: the route's key again
    expect(await catalogueKey('2.1.283', 'gateway', { env: { HOME: home }, cwd: home })).toBe(RELAY);
  });

  it('layers local over project and flag over both, so equal effective environments share a key', async () => {
    const a = join(root, 'a');
    const b = join(root, 'b');
    await settings(a, 'settings.json', { env: { ANTHROPIC_MODEL: 'haiku' } });
    await settings(a, 'settings.local.json', { env: { ANTHROPIC_MODEL: 'sonnet' } });
    await settings(b, 'settings.json', { env: { ANTHROPIC_MODEL: 'sonnet' } });
    const keyA = await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: a });
    expect(keyA).not.toBe(RELAY);
    expect(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: b })).toBe(keyA);
    expect(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: a, flagEnv: { ANTHROPIC_MODEL: 'haiku' } })).toBe(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: null, flagEnv: { ANTHROPIC_MODEL: 'haiku' } }));
  });

  // P2-F wave S (S-catalogue; the owner's D1): the engine 2.1.296 reads the local store at the repository's canonical
  // root (the main checkout for a linked worktree, the repository root for a subdirectory), the cwd's own file merged
  // under it, so a worktree or a subdirectory of a repository whose local settings set model env keys apart
  describe("the local store at the repository's canonical root", () => {
    const git = async (dir: string, entries: Record<string, string>) => {
      for (const [name, text] of Object.entries(entries)) {
        await mkdir(join(dir, name, '..'), { recursive: true });
        await writeFile(join(dir, name), text);
      }
    };
    // a repository `main` with a linked worktree `wt` beside it, laid out as `git worktree add ../wt` writes it
    const repository = async () => {
      const real = await realpath(root);
      const main = join(real, 'main');
      const wt = join(real, 'wt');
      await mkdir(join(main, '.git'), { recursive: true });
      await git(main, { '.git/worktrees/wt/commondir': '../..\n', '.git/worktrees/wt/gitdir': `${join(wt, '.git')}\n` });
      await git(wt, { '.git': `gitdir: ${join(main, '.git', 'worktrees', 'wt')}\n` });
      await mkdir(join(main, 'sub'), { recursive: true });
      return { main, wt, sub: join(main, 'sub'), keyed: async () => {
        const plain = join(real, 'plain');
        await settings(plain, 'settings.local.json', { env: { ANTHROPIC_MODEL: 'sonnet' } });
        return catalogueKey('2.1.283', 'gateway', { env: {}, cwd: plain });
      } };
    };

    it("keys a linked worktree and a subdirectory by the main checkout's local settings", async () => {
      const { main, wt, sub, keyed } = await repository();
      expect(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: wt })).toBe(RELAY); // nothing sets model env yet
      await settings(main, 'settings.local.json', { env: { ANTHROPIC_MODEL: 'sonnet' } });
      const sonnet = await keyed(); // a directory whose own local settings set the same
      expect(sonnet).not.toBe(RELAY);
      expect(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: wt })).toBe(sonnet);
      expect(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: sub })).toBe(sonnet);
      expect(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: main })).toBe(sonnet);
    });

    it("reads the cwd's own local settings beneath the canonical store's, which wins a variable both set", async () => {
      const { main, wt, keyed } = await repository();
      await settings(wt, 'settings.local.json', { env: { ANTHROPIC_MODEL: 'sonnet' } }); // the legacy overlay alone
      const sonnet = await keyed();
      expect(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: wt })).toBe(sonnet);
      await settings(main, 'settings.local.json', { env: { ANTHROPIC_MODEL: 'haiku' } });
      expect(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: wt })).toBe(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: main }));
      expect(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: wt })).not.toBe(sonnet);
    });

    it('keeps the store at the cwd under a repository rooted at the home directory, and for a .git file that is not a worktree', async () => {
      const { main, sub } = await repository();
      await settings(main, 'settings.local.json', { env: { ANTHROPIC_MODEL: 'sonnet' } });
      expect(await catalogueKey('2.1.283', 'gateway', { env: { HOME: main }, cwd: sub })).toBe(RELAY); // the home is never a repository store
      const odd = join(await realpath(root), 'odd');
      await git(odd, { '.git': 'gitdir: /nowhere/at/all\n' });
      expect(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: odd })).toBe(RELAY);
    });
  });

  // P2-F wave S (S-catalogue): the global config's env (`~/.claude.json`, inside CLAUDE_CONFIG_DIR when set) is applied
  // over the spawn environment and under every settings source, alike for every launch
  // P2-F S-catalogue review: CLAUDE_CODE_RESTRICTED in the spawn environment empties the engine's setting sources
  // (2.1.296 `vSr`), so only the global config and the flag settings set env; CLAUDE_CODE_SAFE_MODE changes no env
  it('reads no user, project or local settings when the spawn environment sets CLAUDE_CODE_RESTRICTED', async () => {
    const home = join(root, 'home');
    const project = join(root, 'project');
    await settings(home, 'settings.json', { env: { ANTHROPIC_MODEL: 'haiku' } });
    await settings(project, 'settings.local.json', { env: { ANTHROPIC_MODEL: 'sonnet' } });
    for (const restricted of [{ CLAUDE_CODE_RESTRICTED: '1' }, { CLAUDE_CODE_RESTRICTED: ' TRUE ' }]) {
      const env = { HOME: home, ...restricted };
      expect(await catalogueKey('2.1.283', 'gateway', { env, cwd: project })).toBe(RELAY); // the local settings are not read
      const flagged = await catalogueKey('2.1.283', 'gateway', { env, cwd: project, flagEnv: { ANTHROPIC_MODEL: 'haiku' } });
      expect(flagged).not.toBe(RELAY); // the user settings' value is no launch's: the flag's sets the model apart
      expect(flagged).toBe(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: null, flagEnv: { ANTHROPIC_MODEL: 'haiku' } }));
    }
    const plain = { HOME: home, CLAUDE_CODE_RESTRICTED: '0', CLAUDE_CODE_SAFE_MODE: '1' };
    expect(await catalogueKey('2.1.283', 'gateway', { env: plain, cwd: project })).toBe(await catalogueKey('2.1.283', 'gateway', { env: { HOME: home }, cwd: project }));
    expect(await catalogueKey('2.1.283', 'gateway', { env: plain, cwd: project })).not.toBe(RELAY);
  });

  it("layers the global config's env between the spawn environment and the user settings", async () => {
    const home = join(root, 'home');
    const project = join(root, 'project');
    await mkdir(home, { recursive: true });
    await writeFile(join(home, '.claude.json'), JSON.stringify({ numStartups: 3, env: { ANTHROPIC_MODEL: 'haiku' } }));
    const env = { HOME: home, ANTHROPIC_MODEL: 'sonnet' };
    await settings(project, 'settings.json', { env: { ANTHROPIC_MODEL: 'haiku' } }); // what every launch runs with already
    expect(await catalogueKey('2.1.283', 'gateway', { env, cwd: project })).toBe(RELAY);
    await settings(project, 'settings.json', { env: { ANTHROPIC_MODEL: 'sonnet' } }); // the spawn's value, which the global config replaced
    expect(await catalogueKey('2.1.283', 'gateway', { env, cwd: project })).not.toBe(RELAY);
    const config = join(root, 'config');
    await mkdir(config, { recursive: true });
    await writeFile(join(config, '.claude.json'), JSON.stringify({ env: { ANTHROPIC_MODEL: 'sonnet' } }));
    expect(await catalogueKey('2.1.283', 'gateway', { env: { ...env, CLAUDE_CONFIG_DIR: config }, cwd: project })).toBe(RELAY);
    await writeFile(join(config, '.config.json'), JSON.stringify({ env: { ANTHROPIC_MODEL: 'haiku' } })); // the legacy file, read while it exists
    expect(await catalogueKey('2.1.283', 'gateway', { env: { ...env, CLAUDE_CONFIG_DIR: config }, cwd: project })).not.toBe(RELAY);
  });

  it('reads an unreadable or malformed settings file as no env', async () => {
    const project = join(root, 'project');
    await settings(project, 'settings.json', '{ not json');
    await settings(project, 'settings.local.json', { env: ['ANTHROPIC_MODEL'] });
    expect(await catalogueKey('2.1.283', 'gateway', { env: {}, cwd: project })).toBe(RELAY);
  });
});

describe('ModelsCache.answer with a fallback key', () => {
  it("answers a keyed launch's own list, else its route's, else the built-in list", async () => {
    const cache = new ModelsCache(userData);
    await cache.load();
    const keyed = `${RELAY}/env-0123456789ab`;
    expect(cache.answer(keyed, RELAY).source).toBe('builtin');
    await cache.update(RELAY, readsModels());
    expect(cache.answer(keyed, RELAY).models.map((m) => m.value)).toContain('claude/astra');
    await cache.update(keyed, directModels());
    expect(cache.answer(keyed, RELAY).models.map((m) => m.value)).toEqual(['default', 'opus', 'claude-fable-5-1[1m]', 'sonnet', 'haiku']);
    expect(cache.answer(RELAY).models.map((m) => m.value)).toContain('claude/astra'); // the route's own list untouched
  });
});
