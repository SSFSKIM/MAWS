// The style resolver (the P2-C document, Design §2, "The resolver"): which output style a launch's settings select,
// read in the engine's precedence order, and whether that style declares a contract MAWS can present. Read only, over a
// scratch config home and project.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installToHumanPlugin, PLUGIN_STYLE } from '../../../test/support/to-human-plugin';
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
    expect(await resolveStyle(ctx())).toEqual({ name: 'default', shape: 'none', contract: null, unresolved: null, messageTool: false });
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

describe('the shape of the contract the selected style declares', () => {
  it('a built-in is never compatible, even beside a file of its name that declares the key', async () => {
    put(join(home, 'output-styles/Explanatory.md'), style('Explanatory', '1'));
    for (const name of ['default', 'Explanatory', 'Learning']) {
      userSettings({ outputStyle: name });
      expect(await resolveStyle(ctx())).toEqual({ name, shape: 'none', contract: null, unresolved: null, messageTool: false });
    }
  });

  it('a user style declaring contract 1 is compatible; by its front-matter name or, without one, its file stem', async () => {
    put(join(home, 'output-styles/report.md'), style('Report Mode', '1'));
    put(join(home, 'output-styles/terse.md'), style(null, '"1"'));
    userSettings({ outputStyle: 'Report Mode' });
    expect(await resolveStyle(ctx())).toEqual({ name: 'Report Mode', shape: 'marks', contract: 1, unresolved: null, messageTool: false });
    userSettings({ outputStyle: 'terse' });
    expect(await resolveStyle(ctx())).toEqual({ name: 'terse', shape: 'marks', contract: 1, unresolved: null, messageTool: false });
  });

  it('a project style comes before a user style of the same name', async () => {
    put(join(home, 'output-styles/report.md'), style('report', '1'));
    put(join(project, '.claude/output-styles/report.md'), style('report', null));
    userSettings({ outputStyle: 'report' });
    expect(await resolveStyle(ctx())).toMatchObject({ shape: 'none', unresolved: null, messageTool: false });
    expect(await resolveStyle(ctx({ cwd: null }))).toMatchObject({ shape: 'marks', contract: 1 });
  });

  // P2-C2 (Decision Log 31): the shape rule. The owner's doperpowers 7.149.0 declares 4.
  it.each([
    ['4', 'message-tool', 4],
    ['3', 'message-tool', 3],
    ['2', 'marks', 2],
    ['1', 'marks', 1],
    ['12', 'message-tool', 12], // a later key that keeps the shape
  ] as const)('a style declaring %s has the %s shape', async (key, shape, contract) => {
    put(join(home, 'output-styles/report.md'), style('report', key));
    userSettings({ outputStyle: 'report' });
    expect(await resolveStyle(ctx())).toEqual({ name: 'report', shape, contract, unresolved: null, messageTool: false });
  });

  it('0, a value that is no integer, or no key has no shape', async () => {
    for (const key of ['0', '1.5', 'one', '', null]) {
      put(join(home, 'output-styles/report.md'), style('report', key));
      userSettings({ outputStyle: 'report' });
      expect(await resolveStyle(ctx())).toEqual({ name: 'report', shape: 'none', contract: null, unresolved: null, messageTool: false });
    }
  });

  it('an unknown name is not compatible and says why', async () => {
    userSettings({ outputStyle: 'nowhere' });
    expect(await resolveStyle(ctx())).toEqual({ name: 'nowhere', shape: 'none', contract: null, unresolved: expect.stringContaining('nowhere'), messageTool: false });
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
      expect(await resolveStyle(ctx())).toEqual({ name: 'myplug:to-human', shape: 'marks', contract: 1, unresolved: null, messageTool: false });
      userSettings({ outputStyle: 'myplug:plain', enabledPlugins: { 'myplug@mkt': true } });
      expect(await resolveStyle(ctx())).toEqual({ name: 'myplug:plain', shape: 'none', contract: null, unresolved: null, messageTool: false });
    });

    it('declaring 4, as doperpowers 7.149.0’s to-human does, has the message-tool shape (P2-C2)', async () => {
      put(join(installPath(), 'output-styles/to-human.md'), style('to-human', '4'));
      install([{ ...user, installPath: installPath() }]);
      userSettings({ outputStyle: 'myplug:to-human', enabledPlugins: { 'myplug@mkt': true } });
      expect(await resolveStyle(ctx())).toEqual({ name: 'myplug:to-human', shape: 'message-tool', contract: 4, unresolved: null, messageTool: false });
    });

    it('is not found when the plugin is disabled, in the merged settings, or not installed', async () => {
      install([{ ...user, installPath: installPath() }]);
      userSettings({ outputStyle: 'myplug:to-human', enabledPlugins: { 'myplug@mkt': true } });
      put(join(project, '.claude/settings.local.json'), { enabledPlugins: { 'myplug@mkt': false } });
      expect(await resolveStyle(ctx())).toMatchObject({ shape: 'none', unresolved: expect.stringContaining('myplug'), messageTool: false });
      expect(await resolveStyle(ctx({ cwd: null }))).toMatchObject({ shape: 'marks' });
      userSettings({ outputStyle: 'myplug:to-human' });
      expect(await resolveStyle(ctx({ cwd: null }))).toMatchObject({ shape: 'none', unresolved: expect.stringContaining('myplug'), messageTool: false });
      userSettings({ outputStyle: 'other:to-human', enabledPlugins: { 'other@mkt': true } });
      expect(await resolveStyle(ctx({ cwd: null }))).toMatchObject({ shape: 'none', unresolved: expect.stringContaining('other'), messageTool: false });
    });

    it('a project or local installation applies only in its own project (compared by real path)', async () => {
      const link = join(root, 'project-link');
      symlinkSync(project, link);
      for (const scope of ['project', 'local']) {
        install([{ scope, projectPath: project, installPath: installPath(), version: '0.1.0' }]);
        put(join(project, '.claude/settings.json'), { outputStyle: 'myplug:to-human', enabledPlugins: { 'myplug@mkt': true } });
        expect(await resolveStyle(ctx({ cwd: link }))).toMatchObject({ shape: 'marks', contract: 1 });
        const elsewhere = join(root, 'elsewhere');
        mkdirSync(elsewhere, { recursive: true });
        put(join(elsewhere, '.claude/settings.json'), { outputStyle: 'myplug:to-human', enabledPlugins: { 'myplug@mkt': true } });
        expect(await resolveStyle(ctx({ cwd: elsewhere }))).toMatchObject({ shape: 'none', unresolved: expect.stringContaining('myplug'), messageTool: false });
      }
    });

    it('a malformed or unknown-version registry finds nothing', async () => {
      userSettings({ outputStyle: 'myplug:to-human', enabledPlugins: { 'myplug@mkt': true } });
      put(join(home, 'plugins/installed_plugins.json'), '{');
      expect(await resolveStyle(ctx())).toMatchObject({ shape: 'none', unresolved: expect.any(String), messageTool: false });
      put(join(home, 'plugins/installed_plugins.json'), { version: 1, plugins: { 'myplug@mkt': { installPath: installPath() } } });
      expect(await resolveStyle(ctx())).toMatchObject({ shape: 'none', unresolved: expect.any(String), messageTool: false });
    });
  });
});

describe('lookupStyle (the engine reported a name: the mismatch check’s next decision)', () => {
  it('looks the named style up directly, whatever the settings say', async () => {
    put(join(home, 'output-styles/report.md'), style('report', '1'));
    userSettings({ outputStyle: 'default' });
    expect(await lookupStyle('report', ctx())).toEqual({ name: 'report', shape: 'marks', contract: 1, unresolved: null, messageTool: false });
    expect(await lookupStyle('Learning', ctx())).toEqual({ name: 'Learning', shape: 'none', contract: null, unresolved: null, messageTool: false });
  });
});

// P4-R7z (the P4 spec's Decision Log 92): the lane rides the to-human plugin's message tool, which the plugin registers
// only under its own style, declaring the tool, while its hooks load (test/support/to-human-plugin.ts installs both).
describe('whether the to-human plugin registers its message tool under the style (messageTool)', () => {
  it('does under doperpowers:to-human declaring 6 or later, the to-human plugin enabled and hooks on', async () => {
    installToHumanPlugin(home);
    expect(await resolveStyle(ctx())).toEqual({ name: PLUGIN_STYLE, shape: 'message-tool', contract: 6, unresolved: null, messageTool: true });
    installToHumanPlugin(home, { declared: 9 });
    expect(await resolveStyle(ctx())).toMatchObject({ contract: 9, messageTool: true });
    expect(await lookupStyle(PLUGIN_STYLE, ctx({ cwd: null }))).toMatchObject({ messageTool: true });
  });

  it('does not under the same style declaring 4, with the to-human plugin off, or with every hook off', async () => {
    installToHumanPlugin(home, { declared: 4 });
    expect(await resolveStyle(ctx())).toMatchObject({ contract: 4, messageTool: false });
    installToHumanPlugin(home, { toHuman: false });
    expect(await resolveStyle(ctx())).toMatchObject({ contract: 6, messageTool: false });
    installToHumanPlugin(home);
    // the launch profile's plugin off, or its hooks `none`, through MAWS's own --settings
    expect(await resolveStyle(ctx({ flagSettings: { enabledPlugins: { 'to-human@doperpowers': false } } }))).toMatchObject({ messageTool: false });
    expect(await resolveStyle(ctx({ flagSettings: { disableAllHooks: true } }))).toMatchObject({ contract: 6, messageTool: false });
    put(join(project, '.claude/settings.local.json'), { disableAllHooks: true });
    expect(await resolveStyle(ctx())).toMatchObject({ messageTool: false });
    expect(await resolveStyle(ctx({ flagSettings: { disableAllHooks: false } }))).toMatchObject({ messageTool: true }); // the higher source decides
  });

  it('does not where managed settings let only managed hooks run; the key anywhere else changes nothing', async () => {
    installToHumanPlugin(home);
    userSettings({ outputStyle: PLUGIN_STYLE, enabledPlugins: { 'doperpowers@doperpowers': true, 'to-human@doperpowers': true }, allowManagedHooksOnly: true });
    expect(await resolveStyle(ctx())).toMatchObject({ messageTool: true });
    put(managed, { allowManagedHooksOnly: true });
    expect(await resolveStyle(ctx())).toMatchObject({ name: PLUGIN_STYLE, contract: 6, messageTool: false });
  });

  it('does not under any other style declaring 6: the plugin keys its tool on its own style’s name', async () => {
    installToHumanPlugin(home);
    put(join(home, 'output-styles/report.md'), style('report', '6'));
    userSettings({ outputStyle: 'report', enabledPlugins: { 'doperpowers@doperpowers': true, 'to-human@doperpowers': true } });
    expect(await resolveStyle(ctx())).toEqual({ name: 'report', shape: 'message-tool', contract: 6, unresolved: null, messageTool: false });
  });
});
