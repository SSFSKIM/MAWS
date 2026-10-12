// The style resolver (the P2-C document, Design §2, "The resolver"): which output style a launch's settings select,
// read in the engine's precedence order, and whether that style declares a contract MAWS can present. Read only, over a
// scratch config home and project.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lookupStyle, resolveStyle, type StyleContext } from './resolve-style';

let root: string;
let home: string; // the config home
let project: string;
let managed: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-style-')));
  home = join(root, 'config');
  project = join(root, 'project');
  managed = join(root, 'managed', 'managed-settings.json');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (path: string, content: string | object) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
};
const style = (name: string | null, key: string | null) =>
  `---\n${name === null ? '' : `name: ${name}\n`}description: a style\n${key === null ? '' : `maws-to-human-contract: ${key}\n`}---\n\nThe body.\n`;
const ctx = (over: Partial<StyleContext> = {}): StyleContext => ({ configHome: home, cwd: project, managedSettingsPath: managed, ...over });
const userSettings = (settings: object) => put(join(home, 'settings.json'), settings);

describe('which style the settings select, in the engine’s precedence', () => {
  it('is the default when nothing sets one', async () => {
    expect(await resolveStyle(ctx())).toEqual({ name: 'default', compatible: false, contract: null, unresolved: null });
  });

  it('managed, then MAWS’s own --settings, then local, then project, then user', async () => {
    for (const [name, at] of [['user-s', join(home, 'settings.json')], ['project-s', join(project, '.claude/settings.json')], ['local-s', join(project, '.claude/settings.local.json')]] as const) {
      put(at, { outputStyle: name });
      expect((await resolveStyle(ctx())).name).toBe(name);
    }
    expect((await resolveStyle(ctx({ flagSettings: { outputStyle: 'flag-s' } }))).name).toBe('flag-s');
    put(managed, { outputStyle: 'managed-s' });
    expect((await resolveStyle(ctx({ flagSettings: { outputStyle: 'flag-s' } }))).name).toBe('managed-s');
  });

  it('skips a missing or malformed file, and a value that is not a name', async () => {
    userSettings({ outputStyle: 'user-s' });
    put(join(project, '.claude/settings.json'), '{ not json');
    put(join(project, '.claude/settings.local.json'), { outputStyle: 42 });
    expect((await resolveStyle(ctx())).name).toBe('user-s');
  });

  it('reads no project files without a project (what a new launch in no project would do)', async () => {
    userSettings({ outputStyle: 'user-s' });
    put(join(project, '.claude/settings.json'), { outputStyle: 'project-s' });
    expect((await resolveStyle(ctx({ cwd: null }))).name).toBe('user-s');
  });
});

describe('whether the selected style carries a compatible contract', () => {
  it('a built-in is never compatible, even beside a file of its name that declares the key', async () => {
    put(join(home, 'output-styles/Explanatory.md'), style('Explanatory', '1'));
    for (const name of ['default', 'Explanatory', 'Learning']) {
      userSettings({ outputStyle: name });
      expect(await resolveStyle(ctx())).toEqual({ name, compatible: false, contract: null, unresolved: null });
    }
  });

  it('a user style declaring contract 1 is compatible; by its front-matter name or, without one, its file stem', async () => {
    put(join(home, 'output-styles/report.md'), style('Report Mode', '1'));
    put(join(home, 'output-styles/terse.md'), style(null, '"1"'));
    userSettings({ outputStyle: 'Report Mode' });
    expect(await resolveStyle(ctx())).toEqual({ name: 'Report Mode', compatible: true, contract: 1, unresolved: null });
    userSettings({ outputStyle: 'terse' });
    expect(await resolveStyle(ctx())).toEqual({ name: 'terse', compatible: true, contract: 1, unresolved: null });
  });

  it('a project style comes before a user style of the same name', async () => {
    put(join(home, 'output-styles/report.md'), style('report', '1'));
    put(join(project, '.claude/output-styles/report.md'), style('report', null));
    userSettings({ outputStyle: 'report' });
    expect(await resolveStyle(ctx())).toMatchObject({ compatible: false, unresolved: null });
    expect(await resolveStyle(ctx({ cwd: null }))).toMatchObject({ compatible: true, contract: 1 });
  });

  it('a version outside the compatible set, a value that is no integer, or no key is not compatible', async () => {
    for (const key of ['3', '1.5', 'one', '', null]) {
      put(join(home, 'output-styles/report.md'), style('report', key));
      userSettings({ outputStyle: 'report' });
      expect(await resolveStyle(ctx())).toEqual({ name: 'report', compatible: false, contract: null, unresolved: null });
    }
  });

  it('an unknown name is not compatible and says why', async () => {
    userSettings({ outputStyle: 'nowhere' });
    expect(await resolveStyle(ctx())).toEqual({ name: 'nowhere', compatible: false, contract: null, unresolved: expect.stringContaining('nowhere') });
  });

  describe('a plugin’s style, <plugin>:<style>', () => {
    const installPath = () => join(home, 'plugins/cache/mkt/myplug/0.1.0');
    const install = (records: object[]) => put(join(home, 'plugins/installed_plugins.json'), { version: 2, plugins: { 'myplug@mkt': records } });
    const user = { scope: 'user', installPath: '', version: '0.1.0' };
    beforeEach(() => {
      put(join(installPath(), 'output-styles/to-human.md'), style('to-human', '1'));
      put(join(installPath(), 'output-styles/plain.md'), style('plain', null));
    });

    it('is found in an enabled plugin installed at user scope', async () => {
      install([{ ...user, installPath: installPath() }]);
      userSettings({ outputStyle: 'myplug:to-human', enabledPlugins: { 'myplug@mkt': true } });
      expect(await resolveStyle(ctx())).toEqual({ name: 'myplug:to-human', compatible: true, contract: 1, unresolved: null });
      userSettings({ outputStyle: 'myplug:plain', enabledPlugins: { 'myplug@mkt': true } });
      expect(await resolveStyle(ctx())).toEqual({ name: 'myplug:plain', compatible: false, contract: null, unresolved: null });
    });

    it('is not found when the plugin is disabled, in the merged settings, or not installed', async () => {
      install([{ ...user, installPath: installPath() }]);
      userSettings({ outputStyle: 'myplug:to-human', enabledPlugins: { 'myplug@mkt': true } });
      put(join(project, '.claude/settings.local.json'), { enabledPlugins: { 'myplug@mkt': false } });
      expect(await resolveStyle(ctx())).toMatchObject({ compatible: false, unresolved: expect.stringContaining('myplug') });
      expect(await resolveStyle(ctx({ cwd: null }))).toMatchObject({ compatible: true });
      userSettings({ outputStyle: 'myplug:to-human' });
      expect(await resolveStyle(ctx({ cwd: null }))).toMatchObject({ compatible: false, unresolved: expect.stringContaining('myplug') });
      userSettings({ outputStyle: 'other:to-human', enabledPlugins: { 'other@mkt': true } });
      expect(await resolveStyle(ctx({ cwd: null }))).toMatchObject({ compatible: false, unresolved: expect.stringContaining('other') });
    });

    it('a project or local installation applies only in its own project (compared by real path)', async () => {
      const link = join(root, 'project-link');
      symlinkSync(project, link);
      for (const scope of ['project', 'local']) {
        install([{ scope, projectPath: project, installPath: installPath(), version: '0.1.0' }]);
        put(join(project, '.claude/settings.json'), { outputStyle: 'myplug:to-human', enabledPlugins: { 'myplug@mkt': true } });
        expect(await resolveStyle(ctx({ cwd: link }))).toMatchObject({ compatible: true, contract: 1 });
        const elsewhere = join(root, 'elsewhere');
        mkdirSync(elsewhere, { recursive: true });
        put(join(elsewhere, '.claude/settings.json'), { outputStyle: 'myplug:to-human', enabledPlugins: { 'myplug@mkt': true } });
        expect(await resolveStyle(ctx({ cwd: elsewhere }))).toMatchObject({ compatible: false, unresolved: expect.stringContaining('myplug') });
      }
    });

    it('a malformed or unknown-version registry finds nothing', async () => {
      userSettings({ outputStyle: 'myplug:to-human', enabledPlugins: { 'myplug@mkt': true } });
      put(join(home, 'plugins/installed_plugins.json'), '{');
      expect(await resolveStyle(ctx())).toMatchObject({ compatible: false, unresolved: expect.any(String) });
      put(join(home, 'plugins/installed_plugins.json'), { version: 1, plugins: { 'myplug@mkt': { installPath: installPath() } } });
      expect(await resolveStyle(ctx())).toMatchObject({ compatible: false, unresolved: expect.any(String) });
    });
  });
});

describe('lookupStyle (the engine reported a name: the mismatch check’s next decision)', () => {
  it('looks the named style up directly, whatever the settings say', async () => {
    put(join(home, 'output-styles/report.md'), style('report', '1'));
    userSettings({ outputStyle: 'default' });
    expect(await lookupStyle('report', ctx())).toEqual({ name: 'report', compatible: true, contract: 1, unresolved: null });
    expect(await lookupStyle('Learning', ctx())).toEqual({ name: 'Learning', compatible: false, contract: null, unresolved: null });
  });
});
