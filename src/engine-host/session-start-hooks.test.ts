import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { plutilJson, SESSION_START_HOOK_MS, sessionStartHookMs } from './session-start-hooks';

const sessionStart = (...timeouts: (number | undefined)[]) => ({
  hooks: { SessionStart: [{ matcher: 'startup', hooks: timeouts.map((timeout) => ({ type: 'command', command: 'true', ...(timeout === undefined ? {} : { timeout }) })) }] },
});

describe('the SessionStart hook bound a launch runs with', () => {
  let base: string;
  let home: string;
  let project: string;
  let managed: string; // the machine's managed-settings directory, here a scratch one so no test reads the real machine's
  let prefs: string; // the managed-preferences directory (the MDM plists), scratch as well
  // the plist conversion: in these cases the "plist" is JSON already and the conversion reads it (each call counted);
  // the case with plutil itself is macOS's, below
  let converted: string[];
  const convertPlist = async (file: string) => {
    converted.push(file);
    return readFileSync(file, 'utf8');
  };
  const write = (file: string, content: unknown) => {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  };
  const plan = (over: { env?: Record<string, string>; flagSettings?: Record<string, unknown>; cwd?: string } = {}) => ({ env: over.env ?? { HOME: home }, cwd: over.cwd ?? project, flagSettings: over.flagSettings ?? {} });
  const bound = (over: Parameters<typeof plan>[0] = {}, convert: (file: string) => Promise<string> = convertPlist) =>
    sessionStartHookMs(plan(over), { managedDir: managed, managedPreferencesDir: prefs, convertPlist: convert });
  const PLIST = 'com.anthropic.claudecode.plist';
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'maws-hook-bound-'));
    home = join(base, 'home');
    project = join(base, 'project');
    managed = join(base, 'managed');
    prefs = join(base, 'Managed Preferences');
    converted = [];
    mkdirSync(project, { recursive: true });
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('is the engine\'s 600 s when no settings file sets a SessionStart timeout, or one is missing or malformed', async () => {
    expect(await bound()).toBe(SESSION_START_HOOK_MS);
    write(join(home, '.claude', 'settings.json'), '{ not json');
    write(join(project, '.claude', 'settings.json'), sessionStart(undefined));
    write(join(project, '.claude', 'settings.local.json'), { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'x', timeout: 5000 }] }] } }); // another event's
    write(join(managed, 'managed-settings.json'), '{ not json');
    write(join(managed, 'managed-settings.d', '10-broken.json'), '[');
    write(join(home, '.claude', 'plugins', 'installed_plugins.json'), '{ not json');
    expect(await bound()).toBe(SESSION_START_HOOK_MS);
  });

  it('is the largest SessionStart timeout, in seconds, across the user, project, local and flag settings', async () => {
    write(join(home, '.claude', 'settings.json'), sessionStart(700));
    expect(await bound()).toBe(700_000);
    write(join(project, '.claude', 'settings.json'), sessionStart(30, 900));
    expect(await bound()).toBe(900_000);
    write(join(project, '.claude', 'settings.local.json'), sessionStart(1200));
    expect(await bound()).toBe(1_200_000);
    expect(await bound({ flagSettings: sessionStart(1500) })).toBe(1_500_000);
  });

  it('reads the user settings under CLAUDE_CONFIG_DIR when the launch sets it, not HOME\'s', async () => {
    write(join(home, '.claude', 'settings.json'), sessionStart(700));
    write(join(base, 'scratch', 'settings.json'), sessionStart(800));
    expect(await bound({ env: { HOME: home, CLAUDE_CONFIG_DIR: join(base, 'scratch') } })).toBe(800_000);
  });

  it('never holds less than 600 s (a hook from a source not read keeps the engine\'s default), nor past what a timer can hold', async () => {
    write(join(project, '.claude', 'settings.json'), sessionStart(60));
    expect(await bound()).toBe(SESSION_START_HOOK_MS);
    write(join(project, '.claude', 'settings.json'), sessionStart(1e9));
    expect(await bound()).toBeLessThan(2 ** 31 - 1 - 120_000);
  });

  // L35 (P3-F wave S, F2): the sources the pinned engine reads beyond those four
  it('reads the machine\'s managed-settings.json and its managed-settings.d fragments (.json files, no dotfiles)', async () => {
    write(join(managed, 'managed-settings.json'), sessionStart(900));
    expect(await bound()).toBe(900_000);
    write(join(managed, 'managed-settings.d', '20-hooks.json'), sessionStart(1000));
    write(join(managed, 'managed-settings.d', '.hidden.json'), sessionStart(5000));
    write(join(managed, 'managed-settings.d', 'notes.txt'), JSON.stringify(sessionStart(6000)));
    expect(await bound()).toBe(1_000_000);
    write(join(managed, 'managed-settings.d', '05-more.json'), sessionStart(1100)); // every fragment counts, whatever its place
    expect(await bound()).toBe(1_100_000);
  });

  it('reads the local settings file at the git root above the working directory, and not that root\'s project file', async () => {
    const repo = join(base, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    const cwd = join(repo, 'packages', 'app');
    mkdirSync(cwd, { recursive: true });
    write(join(repo, '.claude', 'settings.json'), sessionStart(5000)); // the engine's project file is the working directory's
    expect(await bound({ cwd })).toBe(SESSION_START_HOOK_MS);
    write(join(repo, '.claude', 'settings.local.json'), sessionStart(1300));
    expect(await bound({ cwd })).toBe(1_300_000);
    write(join(cwd, '.claude', 'settings.local.json'), sessionStart(1400)); // the working directory's own, read as well
    expect(await bound({ cwd })).toBe(1_400_000);
  });

  it('reads a linked worktree\'s local settings at its main checkout, where the engine keeps them', async () => {
    const main = join(base, 'main');
    const worktree = join(base, 'wt');
    const gitdir = join(main, '.git', 'worktrees', 'wt');
    mkdirSync(gitdir, { recursive: true });
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, '.git'), `gitdir: ${gitdir}\n`);
    writeFileSync(join(gitdir, 'commondir'), '../..\n');
    writeFileSync(join(gitdir, 'gitdir'), `${join(worktree, '.git')}\n`);
    write(join(main, '.claude', 'settings.local.json'), sessionStart(1600));
    expect(await bound({ cwd: worktree })).toBe(1_600_000);
  });

  it('reads the SessionStart hooks of the enabled plugins the install records name: hooks/hooks.json and the manifest\'s hooks', async () => {
    const plugins = join(home, '.claude', 'plugins');
    const root = (name: string) => join(plugins, 'cache', 'market', name, '1.0.0');
    write(join(home, '.claude', 'settings.json'), { enabledPlugins: { 'on@market': true, 'off@market': false, 'pinned@market': ['^1.0.0'] } });
    write(join(plugins, 'installed_plugins.json'), {
      version: 2,
      plugins: Object.fromEntries(['on', 'off', 'pinned', 'listed'].map((name) => [`${name}@market`, [{ scope: 'user', installPath: root(name), version: '1.0.0' }]])),
    });
    write(join(root('off'), 'hooks', 'hooks.json'), sessionStart(9000)); // disabled
    write(join(root('listed'), 'hooks', 'hooks.json'), sessionStart(9000)); // installed, never enabled
    expect(await bound()).toBe(SESSION_START_HOOK_MS);
    write(join(root('on'), 'hooks', 'hooks.json'), sessionStart(1700));
    expect(await bound()).toBe(1_700_000);
    write(join(root('pinned'), '.claude-plugin', 'plugin.json'), { name: 'pinned', hooks: ['./extra/hooks.json', '../../escapes.json', { SessionStart: [{ hooks: [{ type: 'command', command: 'x', timeout: 1800 }] }] }] });
    expect(await bound()).toBe(1_800_000); // an inline manifest hook
    write(join(root('pinned'), 'extra', 'hooks.json'), sessionStart(1900));
    expect(await bound()).toBe(1_900_000); // a hooks file the manifest names
    write(join(plugins, 'cache', 'market', 'escapes.json'), sessionStart(9000)); // outside the plugin's directory: not read
    expect(await bound()).toBe(1_900_000);
    // the project's settings may turn a plugin off that the user's turn on (later sources win per plugin)
    write(join(project, '.claude', 'settings.json'), { enabledPlugins: { 'pinned@market': false } });
    expect(await bound()).toBe(1_700_000);
  });

  // L35 follow-up (P3-F wave S, the architect's ruling): the MDM preferences and the server-managed settings' cache
  it('reads the user\'s managed preferences plist and the machine\'s, converting only the files there are', async () => {
    expect(await bound()).toBe(SESSION_START_HOOK_MS);
    expect(converted).toEqual([]); // an unmanaged Mac: nothing converted
    write(join(prefs, PLIST), sessionStart(2000));
    expect(await bound()).toBe(2_000_000);
    write(join(prefs, userInfo().username, PLIST), sessionStart(2100));
    converted = [];
    expect(await bound()).toBe(2_100_000);
    expect(converted).toEqual([join(prefs, userInfo().username, PLIST), join(prefs, PLIST)]); // the user's first, as the engine reads them
    write(join(prefs, userInfo().username, PLIST), 'not a plist');
    expect(await bound()).toBe(2_000_000); // a plist that does not convert configures nothing
    const failing = async () => Promise.reject(new Error('plutil timed out'));
    expect(await bound({}, failing)).toBe(SESSION_START_HOOK_MS); // a conversion that fails or times out keeps the floor
  });

  // macOS: the conversion is /usr/bin/plutil's, as the engine's is
  it.skipIf(process.platform !== 'darwin')('converts a real managed preferences plist with plutil, and keeps the floor for a malformed one', async () => {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>hooks</key><dict><key>SessionStart</key><array><dict><key>hooks</key><array>
<dict><key>type</key><string>command</string><key>command</key><string>true</string><key>timeout</key><integer>2500</integer></dict>
</array></dict></array></dict></dict></plist>`;
    write(join(prefs, PLIST), plist);
    expect(await bound({}, plutilJson)).toBe(2_500_000);
    write(join(prefs, PLIST), '<plist><dict><key>broken');
    expect(await bound({}, plutilJson)).toBe(SESSION_START_HOOK_MS);
  });

  it('reads the server-managed settings\' cached copy under the config directory, unverified, as a bound only', async () => {
    write(join(home, '.claude', 'remote-settings.json'), { $signature: 'sig', ...sessionStart(2600) });
    expect(await bound()).toBe(2_600_000);
    write(join(base, 'scratch', 'remote-settings.json'), sessionStart(2700));
    expect(await bound({ env: { HOME: home, CLAUDE_CONFIG_DIR: join(base, 'scratch') } })).toBe(2_700_000);
    write(join(home, '.claude', 'remote-settings.json'), '{ not json');
    expect(await bound()).toBe(SESSION_START_HOOK_MS);
  });

  it('reads the user file as cowork_settings.json, and the plugins under cowork_plugins, when CLAUDE_CODE_USE_COWORK_PLUGINS is on in the engine\'s words', async () => {
    const config = join(home, '.claude');
    write(join(config, 'settings.json'), { enabledPlugins: { 'p@market': true }, ...sessionStart(700) });
    write(join(config, 'cowork_settings.json'), sessionStart(2800));
    write(join(config, 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'p@market': [{ scope: 'user', installPath: join(base, 'p') }] } });
    write(join(base, 'p', 'hooks', 'hooks.json'), sessionStart(2900));
    for (const on of ['1', 'TRUE ', 'yes', 'on']) expect(await bound({ env: { HOME: home, CLAUDE_CODE_USE_COWORK_PLUGINS: on } }), on).toBe(2_800_000);
    for (const off of ['0', 'false', 'off', '']) expect(await bound({ env: { HOME: home, CLAUDE_CODE_USE_COWORK_PLUGINS: off } }), off).toBe(2_900_000);
  });

  it('reads past hostile entries: a fragment that is a directory or a link, a malformed manifest, a v1 install record', async () => {
    const fragments = join(managed, 'managed-settings.d');
    mkdirSync(join(fragments, 'dir.json'), { recursive: true }); // a directory named .json: nothing to read
    write(join(base, 'elsewhere', 'linked.json'), sessionStart(3000));
    symlinkSync(join(base, 'elsewhere', 'linked.json'), join(fragments, 'link.json')); // a link the engine admits
    symlinkSync(join(base, 'elsewhere'), join(fragments, 'linkdir.json')); // a link to a directory: nothing to read
    expect(await bound()).toBe(3_000_000);
    rmSync(join(fragments, 'link.json'));
    expect(await bound()).toBe(SESSION_START_HOOK_MS);
    const root = join(base, 'v1');
    write(join(home, '.claude', 'settings.json'), { enabledPlugins: { 'v1@market': true } });
    write(join(home, '.claude', 'plugins', 'installed_plugins.json'), { version: 1, plugins: { 'v1@market': { installPath: root, version: '1.0.0' } } }); // one record, not a list
    write(join(root, '.claude-plugin', 'plugin.json'), '{ not json'); // the manifest unreadable, its hooks.json still read
    write(join(root, 'hooks', 'hooks.json'), sessionStart(3100));
    expect(await bound()).toBe(3_100_000);
  });
});
