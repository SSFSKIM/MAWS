import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostOn } from '@shared/host/runtime';
import { commands, type CommandOutput } from '@shared/ipc/schema';
import { isBridgedCommandName } from '@shared/ipc/names';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { clientSettingsDefaults, machineSettingsDefaults, SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { CUSTOMIZATION_INVENTORY_COVERAGE } from '@shared/ipc/schema/customization';
import { readManifestView } from '../plugins/manifest';
import { configurationRevision, INVENTORY_BOUNDS, readCustomizationInventory, readServerEndpoints, registerCustomizationInventory } from './inventory';

// P5 O3-A: a machine-settings.json holding these app MCP servers
const appServers = (mcpServers: { name: string; type: 'http'; url: string }[]) => ({ ...machineSettingsDefaults(), engine: { ...machineSettingsDefaults().engine, mcpServers } });

let root: string;
let home: string;
let configHome: string;
let userData: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'maws-customization-')));
  home = join(root, 'home');
  configHome = join(home, 'alternate');
  userData = join(root, 'app');
  await Promise.all([mkdir(home), mkdir(userData)]);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function file(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  return path;
}
const json = (path: string, value: unknown) => file(path, JSON.stringify(value));
const skill = (base: string, name: string, words = '---\nname: Shared\ndescription: >\n  One line\n  continued\n---\nDo not return the skill body.\n') => file(join(base, name, 'SKILL.md'), words);
const environment = () => Promise.resolve({ HOME: home, CLAUDE_CONFIG_DIR: configHome });
const read = (cwd: string | null = null) => readCustomizationInventory(cwd, { userData, captureEnv: environment });

describe('cold customization inventory', () => {
  it('reads user and app configuration without a project, returns metadata only, and never writes configuration', async () => {
    const path = await skill(join(configHome, 'skills'), 'shared');
    await skill(join(home, '.claude', 'skills'), 'wrong-config-home');
    const global = join(configHome, '.claude.json');
    const user = { mcpServers: {
      shared: { type: 'http', url: 'https://example.test/api?token=QUERY_SECRET', headers: { Authorization: 'HEADER_SECRET' }, env: { TOKEN: 'ENV_SECRET' }, args: ['ARG_SECRET'] },
      process: { command: 'COMMAND_SECRET', args: ['ARG_SECRET'], env: { TOKEN: 'ENV_SECRET' } },
    }, projects: { [home]: { mcpServers: { notSelected: { command: 'no' } } } } };
    await json(global, user);
    const appFile = join(userData, 'machine-settings.json'); // P5 O3-A: MAWS's own servers are the machine's
    await json(appFile, appServers([{ name: 'shared', type: 'http', url: 'https://app.test/?token=APP_SECRET' }]));
    const before = await Promise.all([readFile(global, 'utf8'), readFile(appFile, 'utf8'), readFile(path, 'utf8')]);

    const answer = await read();
    expect(answer).toEqual({
      skills: [{ name: 'Shared', description: 'One line continued', source: 'user', path, plugin: null }],
      servers: [
        { name: 'shared', scope: 'app', path: appFile, transport: 'http' },
        { name: 'process', scope: 'user', path: global, transport: 'stdio' },
        { name: 'shared', scope: 'user', path: global, transport: 'http' },
      ], warnings: [], serversRead: true, pluginServers: [], plugins: [],
    });
    expect(JSON.stringify(answer)).not.toMatch(/SECRET|Do not return|Authorization|mcpServers|command|args|env|url/);
    expect(await Promise.all([readFile(global, 'utf8'), readFile(appFile, 'utf8'), readFile(path, 'utf8')])).toEqual(before);
  });

  it('preserves colliding ancestor, project, local and user rows without claiming effective precedence', async () => {
    const repo = join(home, 'repo');
    const cwd = join(repo, 'child');
    await mkdir(join(repo, '.git'), { recursive: true });
    await mkdir(cwd);
    const userSkill = await skill(join(configHome, 'skills'), 'same');
    const repoSkill = await skill(join(repo, '.claude', 'skills'), 'same');
    const childSkill = await skill(join(cwd, '.claude', 'skills'), 'same');
    await skill(join(home, '.claude', 'skills'), 'outside-repo');
    const global = await json(join(configHome, '.claude.json'), { mcpServers: { same: { command: 'x' } }, projects: {
      [repo]: { mcpServers: { same: { type: 'sse', url: 'https://local.test/' } } },
      [cwd]: { mcpServers: { wrongKey: { command: 'no' } } },
      [join(home, 'elsewhere')]: { mcpServers: { unrelated: { command: 'no' } } },
    } });
    const ancestor = await json(join(home, '.mcp.json'), { mcpServers: { same: { type: 'ws', url: 'wss://ancestor.test/' } } });
    const project = await json(join(repo, '.mcp.json'), { mcpServers: { same: { type: 'streamable-http', url: 'https://project.test/' } } });
    const child = await json(join(cwd, '.mcp.json'), { mcpServers: { same: { command: 'x' } } });

    const answer = await read(cwd);
    expect(answer.skills).toEqual([
      { name: 'Shared', description: 'One line continued', source: 'user', path: userSkill, plugin: null },
      { name: 'Shared', description: 'One line continued', source: 'project', path: childSkill, plugin: null },
      { name: 'Shared', description: 'One line continued', source: 'project', path: repoSkill, plugin: null },
    ]);
    expect(answer.servers).toEqual([
      { name: 'same', scope: 'user', path: global, transport: 'stdio' },
      { name: 'same', scope: 'local', path: global, transport: 'sse' },
      { name: 'same', scope: 'project', path: ancestor, transport: 'ws' },
      { name: 'same', scope: 'project', path: project, transport: 'http' },
      { name: 'same', scope: 'project', path: child, transport: 'stdio' },
    ]);
    expect(answer.warnings).toEqual([]);
  });

  it('uses the exact cwd local key outside a repository and the default user config paths', async () => {
    const cwd = join(home, 'plain');
    await mkdir(cwd);
    const path = await skill(join(home, '.claude', 'skills'), 'plain', 'No front matter\nPRIVATE_BODY');
    const global = await json(join(home, '.claude.json'), { projects: { [cwd]: { mcpServers: { local: { command: 'x' } } } } });
    const answer = await readCustomizationInventory(cwd, { userData, captureEnv: async () => ({ HOME: home }) });
    expect(answer.skills).toEqual([{ name: 'plain', description: '', source: 'user', path, plugin: null }]);
    expect(answer.servers).toEqual([{ name: 'local', scope: 'local', path: global, transport: 'stdio' }]);
    expect(answer.warnings).toEqual([]);
  });

  it('reads only installed plugin skill folders for the selected scope, including manifest additions', async () => {
    const cwd = join(home, 'repo');
    await mkdir(join(cwd, '.git'), { recursive: true });
    const pluginRoot = join(root, 'plugin');
    const standard = await skill(join(pluginRoot, 'skills'), 'one');
    const declared = await skill(pluginRoot, 'extra', '---\nname: Extra\ndescription: Declared\n---\n');
    await json(join(pluginRoot, '.claude-plugin', 'plugin.json'), { name: 'example', skills: ['./extra'] });
    await json(join(configHome, 'plugins', 'installed_plugins.json'), { version: 2, plugins: {
      'example@market': [{ scope: 'user', installPath: pluginRoot }],
      'other@market': [{ scope: 'project', projectPath: join(home, 'other'), installPath: pluginRoot }],
      'project@market': [{ scope: 'project', projectPath: cwd, installPath: pluginRoot }],
    } });
    const answer = await read(cwd);
    expect(answer.skills).toEqual([
      { name: 'Shared', description: 'One line continued', source: 'plugin', path: standard, plugin: 'example@market', pluginName: 'example' },
      { name: 'Extra', description: 'Declared', source: 'plugin', path: declared, plugin: 'example@market', pluginName: 'example' },
      { name: 'Shared', description: 'One line continued', source: 'plugin', path: standard, plugin: 'project@market', pluginName: 'example' },
      { name: 'Extra', description: 'Declared', source: 'plugin', path: declared, plugin: 'project@market', pluginName: 'example' },
    ]);
    expect(answer.warnings.join(' ')).toMatch(/Plugin.*MCP.*not inventoried/);
    expect((await read()).skills.every((row) => row.plugin === 'example@market')).toBe(true);
  });

  // UX wave U11a, §D "Skills" (P3, spikes/protocol-probe/findings-uxwave-u11-skill-names.txt): the engine names a plugin
  // by its manifest's `name`, so `/<key up to @>:<skill>` runs nothing when the marketplace entry is named otherwise
  it('names each plugin skill by its manifest’s name, which may differ from the installed key, and gives no other skill one', async () => {
    const cwd = join(home, 'repo');
    await mkdir(join(cwd, '.git'), { recursive: true });
    await skill(join(configHome, 'skills'), 'mine');
    await skill(join(cwd, '.claude', 'skills'), 'ours');
    const pluginRoot = join(root, 'plugin');
    await skill(join(pluginRoot, 'skills'), 'folder-skill');
    await skill(pluginRoot, 'declared', '---\nname: Declared\n---\n');
    await json(join(pluginRoot, '.claude-plugin', 'plugin.json'), { name: 'fx-manifest', skills: ['./declared'] });
    await json(join(configHome, 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'fx-entry@fx-market': [{ scope: 'user', installPath: pluginRoot }] } });
    const answer = await read(cwd);
    expect(answer.skills.filter((row) => row.source === 'plugin').map((row) => [row.name, row.plugin, row.pluginName])).toEqual([
      ['Shared', 'fx-entry@fx-market', 'fx-manifest'],
      ['Declared', 'fx-entry@fx-market', 'fx-manifest'],
    ]);
    const others = answer.skills.filter((row) => row.source !== 'plugin');
    expect(others.map((row) => row.source)).toEqual(['user', 'project']);
    expect(others.every((row) => !('pluginName' in row))).toBe(true);
    expect(validateCommandOutput('customization.inventory', answer).ok).toBe(true);
  });

  it('gives a plugin skill a null pluginName where the manifest’s name cannot be read or is not one the engine loads', async () => {
    const plugins: Record<string, { scope: 'user'; installPath: string }[]> = {};
    const manifests: [string, unknown][] = [
      ['absent', undefined],
      ['unnamed', { description: 'no name' }],
      ['numbered', { name: 7 }],
      ['empty', { name: '' }],
      ['spaced', { name: 'two words' }],
      ['long', { name: 'x'.repeat(257) }],
      ['broken', '{"name": "half'],
    ];
    for (const [key, manifest] of manifests) {
      const installPath = join(root, 'plugins', key);
      await skill(join(installPath, 'skills'), `${key}-skill`, `---\nname: ${key}-skill\n---\n`);
      if (typeof manifest === 'string') await file(join(installPath, '.claude-plugin', 'plugin.json'), manifest);
      else if (manifest !== undefined) await json(join(installPath, '.claude-plugin', 'plugin.json'), manifest);
      plugins[`${key}@fx-market`] = [{ scope: 'user', installPath }];
    }
    await json(join(configHome, 'plugins', 'installed_plugins.json'), { version: 2, plugins });
    const answer = await read();
    expect(answer.skills.map((row) => [row.name, row.pluginName])).toEqual(manifests.map(([key]) => [`${key}-skill`, null]).sort());
    expect(validateCommandOutput('customization.inventory', answer).ok).toBe(true);
  });

  it('follows disk skill symlinks but refuses plugin declarations and links that escape their installation', async () => {
    const outside = await skill(root, 'outside');
    await mkdir(join(configHome, 'skills'), { recursive: true });
    await symlink(dirname(outside), join(configHome, 'skills', 'linked'));
    const pluginRoot = join(root, 'plugin');
    await mkdir(join(pluginRoot, 'skills'), { recursive: true });
    await symlink(dirname(outside), join(pluginRoot, 'skills', 'escape'));
    await json(join(pluginRoot, '.claude-plugin', 'plugin.json'), { skills: ['../outside'] });
    await json(join(configHome, 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'p@m': [{ scope: 'user', installPath: pluginRoot }] } });
    const answer = await read();
    expect(answer.skills).toEqual([{ name: 'Shared', description: 'One line continued', source: 'user', path: join(configHome, 'skills', 'linked', 'SKILL.md'), plugin: null }]);
    expect(answer.warnings.join(' ')).toMatch(/outside the plugin/);
  });

  it('does not mistake a linked checkout for an attested local key', async () => {
    const cwd = join(home, 'linked');
    await file(join(cwd, '.git'), 'gitdir: /not/read');
    await json(join(configHome, '.claude.json'), { projects: { [cwd]: { mcpServers: { uncertain: { command: 'x' } } } } });
    const answer = await read(cwd);
    expect(answer.servers).toEqual([]);
    expect(answer.warnings.join(' ')).toMatch(/Local MCP.*not inventoried/);
  });

  it('returns other scopes when JSON is malformed, without echoing parse errors or secret configuration', async () => {
    await file(join(configHome, '.claude.json'), '{"token":"PARSE_SECRET",');
    await file(join(configHome, 'plugins', 'installed_plugins.json'), '{"token":"PLUGIN_SECRET",');
    const cwd = join(home, 'repo');
    const path = await json(join(cwd, '.mcp.json'), { mcpServers: { valid: { type: 'strange_SECRET', url: 'URL_SECRET' }, malformed: 'ENTRY_SECRET' } });
    const answer = await read(cwd);
    expect(answer.servers).toEqual([{ name: 'valid', scope: 'project', path, transport: 'unknown' }]);
    expect(answer.warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(answer)).not.toMatch(/SECRET/);
  });

  it('refuses ambiguous legacy or custom OAuth global files but still reads user skill folders', async () => {
    await json(join(configHome, '.claude.json'), { mcpServers: { hidden: { command: 'x' } } });
    await file(join(configHome, '.config.json'), '{}');
    await skill(join(configHome, 'skills'), 'one');
    const legacy = await read();
    expect(legacy.servers).toEqual([]);
    expect(legacy.skills).toHaveLength(1);
    expect(legacy.warnings.join(' ')).toMatch(/User.*MCP.*not inventoried/);
    await rm(join(configHome, '.config.json'));
    const custom = await readCustomizationInventory(null, { userData, captureEnv: async () => ({ HOME: home, CLAUDE_CONFIG_DIR: configHome, CLAUDE_CODE_CUSTOM_OAUTH_URL: 'OAUTH_SECRET' }) });
    expect(custom.servers).toEqual([]);
    expect(JSON.stringify(custom)).not.toContain('OAUTH_SECRET');
  });

  it('bounds JSON reads and reads only the front matter prefix of a large skill', async () => {
    const path = await skill(join(configHome, 'skills'), 'large', `---\nname: Large\ndescription: Prefix only\n---\n${'PRIVATE_BODY'.repeat(INVENTORY_BOUNDS.frontMatterBytes)}`);
    await file(join(configHome, '.claude.json'), ' '.repeat(INVENTORY_BOUNDS.jsonBytes + 1));
    const answer = await read();
    expect(answer.skills).toEqual([{ name: 'Large', description: 'Prefix only', source: 'user', path, plugin: null }]);
    expect(answer.servers).toEqual([]);
    expect(answer.serversRead).toBe(false); // the servers it lists are not the whole set
    expect(answer.warnings.join(' ')).toMatch(/could not be read/);
    expect(JSON.stringify(answer)).not.toContain('PRIVATE_BODY');
  });

  it('caps large configured server maps and labels the retained result as partial', async () => {
    const servers: Record<string, { command: string }> = {};
    for (let i = 0; i <= INVENTORY_BOUNDS.rows; i++) servers[`server-${String(i).padStart(4, '0')}`] = { command: 'NOT_EXECUTED' };
    await json(join(configHome, '.claude.json'), { mcpServers: servers });
    const answer = await read();
    expect(answer.servers).toHaveLength(INVENTORY_BOUNDS.rows);
    expect(answer.servers[0].name).toBe('server-0000');
    expect(answer.servers.at(-1)?.name).toBe('server-1023');
    expect(answer.warnings).toContain('Customization inventory reached its read limit; some configured items are not inventoried.');
    expect(JSON.stringify(answer)).not.toContain('NOT_EXECUTED');
  });

  // P5 O3-A (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §3; O3-A acceptance 4)
  it('reads MAWS’s servers from machine-settings.json, from a unified settings.json while no split build has run, and none from a client file', async () => {
    const servers = [{ name: 'app', type: 'http' as const, url: 'https://app.test/' }];
    const unified = await json(join(userData, 'settings.json'), { ...SETTINGS_DEFAULTS_V21, version: 20, engine: { ...SETTINGS_DEFAULTS_V21.engine, mcpServers: servers } });
    const appRows = async () => (await readCustomizationInventory(null, { userData, captureEnv: async () => { throw new Error('none'); } })).servers;
    expect(await appRows()).toEqual([{ name: 'app', scope: 'app', path: unified, transport: 'http' }]);
    const machine = await json(join(userData, 'machine-settings.json'), appServers([{ name: 'split', type: 'http', url: 'https://app.test/' }]));
    expect(await appRows()).toEqual([{ name: 'split', scope: 'app', path: machine, transport: 'http' }]); // the machine file outranks a unified one
    await json(join(userData, 'settings.json'), clientSettingsDefaults());
    await rm(machine);
    const answer = await readCustomizationInventory(null, { userData, captureEnv: async () => { throw new Error('none'); } });
    expect(answer.servers).toEqual([]);
    expect(answer.warnings).toEqual(['User configuration environment could not be read.']); // a client file is not invalid app settings
  });

  it('retains app configuration when the user environment is unavailable', async () => {
    const path = await json(join(userData, 'machine-settings.json'), appServers([{ name: 'app', type: 'http', url: 'https://app.test/' }]));
    const answer = await readCustomizationInventory(null, { userData, captureEnv: async () => { throw new Error('CAPTURE_SECRET'); } });
    expect(answer).toEqual({ skills: [], servers: [{ name: 'app', scope: 'app', path, transport: 'http' }], warnings: ['User configuration environment could not be read.'], serversRead: false, pluginServers: [], plugins: [] });
  });

  it('returns a warning within its deadline even when environment capture never settles', async () => {
    const answer = await readCustomizationInventory(null, { userData, captureEnv: () => new Promise(() => {}), timeoutMs: 5 });
    expect(answer).toEqual({ skills: [], servers: [], warnings: ['Customization inventory reached its read limit; some configured items are not inventoried.'], serversRead: false, pluginServers: [], plugins: [] });
  });

  it('a project .mcp.json it cannot read leaves the servers not wholly read; one that reads clean leaves them read', async () => {
    await json(join(configHome, '.claude.json'), { mcpServers: {} });
    const project = join(root, 'project');
    await file(join(project, '.mcp.json'), '{ not json');
    expect((await read(project)).serversRead).toBe(false);
    await json(join(project, '.mcp.json'), { mcpServers: { local: { type: 'http', url: 'https://x.test/mcp' } } });
    expect(await read(project)).toMatchObject({ servers: [{ name: 'local', scope: 'project' }], serversRead: true });
  });

  it('main alone reads each configured server with its URL, row for row with the inventory', async () => {
    const global = join(configHome, '.claude.json');
    await json(global, { mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp?token=QUERY_SECRET' }, process: { command: 'run' } } });
    const appFile = await json(join(userData, 'machine-settings.json'), appServers([{ name: 'app', type: 'http', url: 'https://app.test/' }]));
    expect(await readServerEndpoints(null, { userData, captureEnv: environment })).toEqual({ servers: [
      { name: 'app', scope: 'app', path: appFile, transport: 'http', url: 'https://app.test/', revision: expect.stringMatching(/^[0-9a-f]{32}$/) },
      { name: 'linear', scope: 'user', path: global, transport: 'http', url: 'https://mcp.linear.app/mcp?token=QUERY_SECRET', revision: expect.stringMatching(/^[0-9a-f]{32}$/) },
      { name: 'process', scope: 'user', path: global, transport: 'stdio', url: null, revision: null },
    ], pluginServers: [] });
    expect(JSON.stringify(await read())).not.toMatch(/SECRET|linear\.app/);
    expect(isBridgedCommandName('customization.serverEndpoints')).toBe(false);
    expect(commands['customization.serverEndpoints'].owner).toBe('engine-host');
  });

  // UX wave U11a M8 (§A, "The configuration's revision"): each endpoint's configuration stands as an opaque revision, an
  // HMAC of its name, transport and address under a key the host makes at its start and never writes or sends, so a
  // press from Customize can name the configuration its row showed without the window holding an address.
  it('stamps each endpoint with its configuration’s revision: the same within one run for the same name, transport and address, another for any change, none without an address', async () => {
    const global = join(configHome, '.claude.json');
    const revisions = async () => Object.fromEntries((await readServerEndpoints(null, { userData, captureEnv: environment })).servers.map((server) => [`${server.scope}:${server.name}`, server.revision]));
    await json(global, { mcpServers: { linear: { type: 'http', url: 'https://linear.example.test/mcp?token=QUERY_SECRET' }, same: { type: 'http', url: 'https://linear.example.test/mcp?token=QUERY_SECRET' }, process: { command: 'run' } } });
    await json(join(userData, 'machine-settings.json'), appServers([{ name: 'linear', type: 'http', url: 'https://linear.example.test/mcp?token=QUERY_SECRET' }]));
    const first = await revisions();
    expect(await revisions()).toEqual(first); // within one run of the host
    expect(first['user:linear']).toMatch(/^[0-9a-f]{32}$/);
    expect(first['app:linear']).toBe(first['user:linear']); // the configuration is its name, transport and address, not its file
    expect(first['user:same']).not.toBe(first['user:linear']); // another name
    expect(first['user:process']).toBeNull();
    await json(global, { mcpServers: { linear: { type: 'http', url: 'https://linear.example.test/mcp?token=OTHER_SECRET' } } });
    expect((await revisions())['user:linear']).not.toBe(first['user:linear']); // another address
    await json(global, { mcpServers: { linear: { type: 'sse', url: 'https://linear.example.test/mcp?token=QUERY_SECRET' } } });
    expect((await revisions())['user:linear']).not.toBe(first['user:linear']); // another transport
    expect(JSON.stringify(first)).not.toMatch(/SECRET|linear\.example/);
  });

  it('makes a revision that says nothing of the address: keyed, so a known address cannot be confirmed from it', () => {
    const configuration = { name: 'linear', transport: 'http', url: 'https://linear.example.test/mcp?token=QUERY_SECRET' } as const;
    const revisionOf = configurationRevision(Buffer.alloc(32, 7));
    const revision = revisionOf(configuration)!;
    expect(revision).toMatch(/^[0-9a-f]{32}$/);
    expect(revisionOf(configuration)).toBe(revision);
    expect(configurationRevision(Buffer.alloc(32, 8))(configuration)).not.toBe(revision); // another run, another key
    expect(revisionOf({ ...configuration, url: null })).toBeNull();
    expect(revision).not.toContain('linear');
  });

  it('registers a read-only host command with null-cwd support and strict metadata-only IPC output', async () => {
    const handlers = new Map<string, (input: { cwd: string | null }) => Promise<unknown>>();
    const on: HostOn = (name, handler) => { handlers.set(name, handler as (input: { cwd: string | null }) => Promise<unknown>); };
    registerCustomizationInventory(on, { userData, captureEnv: environment });
    expect([...handlers.keys()]).toEqual(['customization.inventory', 'customization.serverEndpoints']);
    expect(isBridgedCommandName('customization.inventory')).toBe(true);
    expect(commands['customization.inventory'].owner).toBe('engine-host');
    expect(validateCommandInput('customization.inventory', { cwd: null }).ok).toBe(true);
    expect(validateCommandInput('customization.inventory', { cwd: 'relative' }).ok).toBe(false);
    expect(validateCommandInput('customization.inventory', { cwd: '/absolute', launch: true }).ok).toBe(false);
    const answer = await handlers.get('customization.inventory')!({ cwd: null }) as CommandOutput<'customization.inventory'>;
    expect(validateCommandOutput('customization.inventory', answer).ok).toBe(true);
    const leaked = { ...answer, servers: [{ name: 'x', scope: 'user', path: '/config', transport: 'http', env: { TOKEN: 'SECRET' } }] };
    expect(validateCommandOutput('customization.inventory', leaked).ok).toBe(false);
  });
});

// UX wave U11h (docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, M1 and §A): the connectors an
// installed plugin's files declare are listed beside the configured ones, by the rule "What's inside" follows, with the
// three names kept apart (the key, the manifest name, the engine name) and with no address in the window's answer.
describe('a plugin’s connectors (UX wave U11h)', () => {
  const KEY = 'key-tides@harbour-market';
  const installed = (plugins: Record<string, unknown[]>) => json(join(configHome, 'plugins', 'installed_plugins.json'), { version: 2, plugins });
  const endpoints = (cwd: string | null = null) => readServerEndpoints(cwd, { userData, captureEnv: environment });

  // An invented plugin that declares servers in all three ways: its .mcp.json, a file its manifest names, and an inline
  // map (under `experimental`, which repeats a name the .mcp.json gave first); and a bundle, a URL where a path belongs
  // and two files outside it, none of them listed.
  async function tides(at = join(root, 'tides'), manifest: Record<string, unknown> = {}) {
    await json(join(at, '.mcp.json'), { mcpServers: {
      'tides-http': { type: 'http', url: 'https://tides.example.com/mcp', headers: { Authorization: 'HEADER_SECRET' } },
      'tide clock': { command: '${CLAUDE_PLUGIN_ROOT}/bin/COMMAND_SECRET', args: ['ARG_SECRET'] },
    } });
    await json(join(at, 'servers', 'more.json'), { 'ferry:times': { type: 'sse', url: 'https://ferry.example.com/${REGION}/sse' } });
    await json(join(dirname(at), 'outside.json'), { escaped: { type: 'http', url: 'https://outside.example.com/mcp' } });
    await symlink(join(dirname(at), 'outside.json'), join(at, 'linked.json'));
    await json(join(at, '.claude-plugin', 'plugin.json'), {
      name: 'mani-tides',
      mcpServers: ['./servers/more.json', './bundle.mcpb', 'https://example.com/servers.json', '../outside.json', './linked.json'],
      experimental: { mcpServers: { buoys: { type: 'streamable-http', url: 'https://buoys.example.com/mcp' }, 'tides-http': { type: 'sse', url: 'https://other.example.com/sse' } } },
      ...manifest,
    });
    return at;
  }
  const row = (at: string, server: string, transport: string, file: string, address: string | null, over: Record<string, unknown> = {}) => ({
    plugin: KEY, pluginName: 'mani-tides', server, name: `plugin:mani-tides:${server}`, installScope: 'user', version: '1.2.0', path: join(at, file), transport, address, sameAddressAs: null, ...over,
  });

  it('lists each server a plugin declares in its .mcp.json, a file its manifest names and an inline map, first declaration of a name winning, with its installation and its engine name', async () => {
    const at = await tides();
    await installed({ [KEY]: [{ scope: 'user', installPath: at, version: '1.2.0' }] });
    const answer = await read();
    expect(answer.pluginServers).toEqual([
      row(at, 'tides-http', 'http', '.mcp.json', 'literal'),
      row(at, 'tide clock', 'stdio', '.mcp.json', null), // a name with a space, as written; a local command has no address
      row(at, 'ferry:times', 'sse', 'servers/more.json', 'templated'), // a name with a colon, as written
      row(at, 'buoys', 'http', '.claude-plugin/plugin.json', 'literal'),
    ]);
    expect(answer.plugins).toEqual([{ plugin: KEY, pluginName: 'mani-tides', installScope: 'user' }]);
    // the bundle and the URL add no warning; a file outside the plugin is refused, as a skill's is
    expect(answer.warnings).toEqual([`${join(at, '.claude-plugin', 'plugin.json')}: outside the plugin`, `${join(at, 'linked.json')}: outside the plugin`, CUSTOMIZATION_INVENTORY_COVERAGE]);
    expect(validateCommandOutput('customization.inventory', answer).ok).toBe(true);
    expect(JSON.stringify(answer)).not.toMatch(/SECRET|example\.com|REGION|CLAUDE_PLUGIN_ROOT|Authorization|escaped/);
  });

  it('names the same servers as the plugin’s “What’s inside”', async () => {
    const at = await tides();
    await installed({ [KEY]: [{ scope: 'user', installPath: at, version: '1.2.0' }] });
    const view = await readManifestView({ kind: 'installation', id: KEY, scope: 'user', projectPath: null }, { root: at, marketplaceRoot: null, entryName: 'key-tides' });
    expect(view.components.mcpServers.map((server) => server.name)).toEqual(['tides-http', 'tide clock', 'ferry:times', 'buoys']);
    expect(view.components.mcpBundles).toBe(1);
    expect((await read()).pluginServers!.map((server) => server.server)).toEqual(view.components.mcpServers.map((server) => server.name));
  });

  it('builds the engine name from the manifest name, whole at 147 characters, and lists no server whose name its field cannot hold', async () => {
    const at = join(root, 'long');
    const manifestName = `long-${'p'.repeat(95)}`;
    const server = `long-${'s'.repeat(34)}`;
    await json(join(at, '.mcp.json'), { mcpServers: { [server]: { type: 'http', url: 'https://long.example.com/mcp' }, ['x'.repeat(257)]: { type: 'http', url: 'https://cut.example.com/mcp' }, '': { type: 'http', url: 'https://empty.example.com/mcp' } } });
    await json(join(at, '.claude-plugin', 'plugin.json'), { name: manifestName });
    await installed({ 'long@harbour-market': [{ scope: 'user', installPath: at, version: '0.0.1' }] });
    const answer = await read();
    expect(answer.pluginServers!.map((row) => [row.server, row.name])).toEqual([[server, `plugin:${manifestName}:${server}`]]);
    expect(answer.pluginServers![0]!.name).toHaveLength(147);
    expect(validateCommandOutput('customization.inventory', answer).ok).toBe(true);
  });

  it('gives a null manifest name and engine name where the manifest’s name cannot be read, and a null engine name to a built-in plugin', async () => {
    const plugin = async (folder: string, manifest: unknown) => {
      const at = join(root, folder);
      await json(join(at, '.mcp.json'), { mcpServers: { harbour: { type: 'http', url: 'https://harbour.example.com/mcp' } } });
      if (manifest !== undefined) await json(join(at, '.claude-plugin', 'plugin.json'), manifest);
      return at;
    };
    await installed({
      'absent@harbour-market': [{ scope: 'user', installPath: await plugin('absent', undefined) }],
      'fx-built@builtin': [{ scope: 'user', installPath: await plugin('built', { name: 'fx-built' }) }],
      'spaced@harbour-market': [{ scope: 'user', installPath: await plugin('spaced', { name: 'two words' }) }],
    });
    const answer = await read();
    expect(answer.pluginServers!.map((row) => [row.plugin, row.pluginName, row.name, row.version])).toEqual([
      ['absent@harbour-market', null, null, null],
      ['fx-built@builtin', 'fx-built', null, null],
      ['spaced@harbour-market', null, null, null],
    ]);
    expect(validateCommandOutput('customization.inventory', answer).ok).toBe(true);
  });

  it('lists no connector of an installation for another project, and one row per server of a plugin installed twice for the folder: the first installation’s', async () => {
    const cwd = join(home, 'repo');
    await mkdir(join(cwd, '.git'), { recursive: true });
    const first = await tides(join(root, 'first', 'tides'));
    const second = join(root, 'second');
    await json(join(second, '.mcp.json'), { mcpServers: { 'tides-http': { type: 'http', url: 'https://second.example.com/mcp' }, extra: { type: 'http', url: 'https://extra.example.com/mcp' } } });
    await json(join(second, '.claude-plugin', 'plugin.json'), { name: 'mani-tides' });
    await installed({
      'elsewhere@harbour-market': [{ scope: 'project', projectPath: join(home, 'other'), installPath: second, version: '9.9.9' }],
      [KEY]: [{ scope: 'project', projectPath: join(home, 'other'), installPath: second }, { scope: 'user', installPath: first, version: '1.2.0' }, { scope: 'project', projectPath: cwd, installPath: second, version: '2.0.0' }],
    });
    const answer = await read(cwd);
    expect(answer.pluginServers!.map((row) => [row.plugin, row.server, row.installScope, row.version, row.path])).toEqual([
      [KEY, 'tides-http', 'user', '1.2.0', join(first, '.mcp.json')],
      [KEY, 'tide clock', 'user', '1.2.0', join(first, '.mcp.json')],
      [KEY, 'ferry:times', 'user', '1.2.0', join(first, 'servers', 'more.json')],
      [KEY, 'buoys', 'user', '1.2.0', join(first, '.claude-plugin', 'plugin.json')],
    ]);
    expect(answer.plugins).toEqual([{ plugin: KEY, pluginName: 'mani-tides', installScope: 'user' }]);
  });

  it('names every plugin kept for the folder, one that declares no connector among them, a manifest name with a colon as written', async () => {
    const quiet = join(root, 'quiet');
    await json(join(quiet, '.claude-plugin', 'plugin.json'), { name: 'alpha:beta' });
    const at = await tides();
    await installed({ [KEY]: [{ scope: 'user', installPath: at, version: '1.2.0' }], 'quiet@harbour-market': [{ scope: 'user', installPath: quiet }] });
    const answer = await read();
    expect(answer.plugins).toEqual([
      { plugin: KEY, pluginName: 'mani-tides', installScope: 'user' },
      { plugin: 'quiet@harbour-market', pluginName: 'alpha:beta', installScope: 'user' },
    ]);
    expect(answer.pluginServers!.every((row) => row.plugin === KEY)).toBe(true);
  });

  it('words each address by its shape alone: literal, templated after a literal origin, templated-origin otherwise, none for a local command', async () => {
    const at = join(root, 'shapes');
    await json(join(at, '.mcp.json'), { mcpServers: {
      plain: { type: 'http', url: 'https://plain.example.com/mcp' },
      tenant: { type: 'http', url: 'https://tenant.example.com/${TENANT}/mcp' },
      host: { type: 'http', url: 'https://${HOST}/mcp' },
      port: { type: 'sse', url: 'https://port.example.com:${PORT}/sse' },
      slash: { type: 'http', url: 'https:///${HOST}/mcp' },
      user: { type: 'http', url: 'https://me@user.example.com/${TENANT}' },
      upper: { type: 'http', url: 'HTTPS://upper.example.com/${TENANT}' },
      local: { command: 'run-local' },
    } });
    await json(join(at, '.claude-plugin', 'plugin.json'), { name: 'shapes' });
    await installed({ 'shapes@harbour-market': [{ scope: 'user', installPath: at }] });
    expect(Object.fromEntries((await read()).pluginServers!.map((row) => [row.server, row.address]))).toEqual({
      plain: 'literal', tenant: 'templated', host: 'templated-origin', port: 'templated-origin', slash: 'templated-origin', user: 'templated-origin', upper: 'templated-origin', local: null,
    });
  });

  it('names the configured entry of the same address as written, the highest in the engine’s precedence, only for a remote transport and two addresses with no template', async () => {
    const cwd = join(home, 'repo');
    await mkdir(join(cwd, '.git'), { recursive: true });
    const SAME = 'https://same.example.com/mcp';
    await json(join(configHome, '.claude.json'), {
      mcpServers: { 'user-same': { type: 'http', url: SAME }, 'user-only': { type: 'http', url: 'https://user.example.com/mcp' }, 'user-template': { type: 'http', url: 'https://tpl.example.com/${T}' } },
      projects: { [cwd]: { mcpServers: { 'local-same': { type: 'sse', url: SAME } } } },
    });
    await json(join(home, '.mcp.json'), { mcpServers: { 'outer-project': { type: 'http', url: 'https://project.example.com/mcp' } } });
    await json(join(cwd, '.mcp.json'), { mcpServers: { 'inner-project': { type: 'http', url: 'https://project.example.com/mcp' } } });
    await json(join(userData, 'machine-settings.json'), appServers([{ name: 'own', type: 'http', url: 'https://own.example.com/mcp' }]));
    const at = join(root, 'dups');
    await json(join(at, '.mcp.json'), { mcpServers: {
      same: { type: 'http', url: SAME }, // user and local both: local is higher
      'user-only': { type: 'ws', url: 'https://user.example.com/mcp' },
      project: { type: 'sse', url: 'https://project.example.com/mcp' }, // two project files: the nearest
      'as-written': { type: 'http', url: 'https://same.example.com/mcp/' }, // another text: not compared further
      own: { type: 'http', url: 'https://own.example.com/mcp' }, // MAWS's own list is not compared
      template: { type: 'http', url: 'https://tpl.example.com/${T}' }, // neither address may hold a template
      odd: { type: 'carrier-pigeon', url: SAME }, // not a remote transport
      local: { command: 'run' },
    } });
    await json(join(at, '.claude-plugin', 'plugin.json'), { name: 'dups' });
    await installed({ 'dups@harbour-market': [{ scope: 'user', installPath: at }] });
    expect(Object.fromEntries((await read(cwd)).pluginServers!.map((row) => [row.server, row.sameAddressAs]))).toEqual({
      same: 'local-same', 'user-only': 'user-only', project: 'inner-project', 'as-written': null, own: null, template: null, odd: null, local: null,
    });
  });

  it('carries each plugin server’s address and revision to main alone; the revision moves with the key, the installation’s scope, folder or version, the engine name, the transport or the address', async () => {
    const cwd = join(home, 'repo');
    await mkdir(join(cwd, '.git'), { recursive: true });
    const at = await tides();
    const copy = await tides(join(root, 'copy', 'tides'));
    const install = (over: Record<string, unknown> = {}, key = KEY) => installed({ [key]: [{ scope: 'user', installPath: at, version: '1.2.0', ...over }] });
    const tidesHttp = async () => (await endpoints(cwd)).pluginServers!.find((row) => row.server === 'tides-http')!;
    await install();
    const answer = await endpoints(cwd);
    expect(answer.pluginServers).toEqual([
      { plugin: KEY, pluginName: 'mani-tides', server: 'tides-http', name: 'plugin:mani-tides:tides-http', version: '1.2.0', path: join(at, '.mcp.json'), transport: 'http', url: 'https://tides.example.com/mcp', revision: expect.stringMatching(/^[0-9a-f]{32}$/) },
      { plugin: KEY, pluginName: 'mani-tides', server: 'tide clock', name: 'plugin:mani-tides:tide clock', version: '1.2.0', path: join(at, '.mcp.json'), transport: 'stdio', url: null, revision: null },
      { plugin: KEY, pluginName: 'mani-tides', server: 'ferry:times', name: 'plugin:mani-tides:ferry:times', version: '1.2.0', path: join(at, 'servers', 'more.json'), transport: 'sse', url: 'https://ferry.example.com/${REGION}/sse', revision: expect.stringMatching(/^[0-9a-f]{32}$/) },
      { plugin: KEY, pluginName: 'mani-tides', server: 'buoys', name: 'plugin:mani-tides:buoys', version: '1.2.0', path: join(at, '.claude-plugin', 'plugin.json'), transport: 'http', url: 'https://buoys.example.com/mcp', revision: expect.stringMatching(/^[0-9a-f]{32}$/) },
    ]);
    expect(validateCommandOutput('customization.serverEndpoints', answer).ok).toBe(true);
    const first = (await tidesHttp()).revision;
    expect((await tidesHttp()).revision).toBe(first); // within one run of the host
    const moved: [string, () => Promise<unknown>][] = [
      ['the key', () => install({}, 'key-tides@other-market')],
      ['the scope', () => install({ scope: 'project', projectPath: cwd })],
      ['the folder', () => install({ installPath: copy })],
      ['the version', () => install({ version: '1.3.0' })],
      ['the engine name', async () => { await install(); await json(join(at, '.claude-plugin', 'plugin.json'), { name: 'mani-tides-2' }); }],
      ['the transport', async () => { await json(join(at, '.claude-plugin', 'plugin.json'), { name: 'mani-tides' }); await json(join(at, '.mcp.json'), { mcpServers: { 'tides-http': { type: 'sse', url: 'https://tides.example.com/mcp' } } }); }],
      ['the address', () => json(join(at, '.mcp.json'), { mcpServers: { 'tides-http': { type: 'http', url: 'https://tides.example.com/mcp2' } } })],
    ];
    for (const [what, move] of moved) {
      await move();
      expect([what, (await tidesHttp()).revision]).not.toEqual([what, first]);
    }
    await json(join(at, '.mcp.json'), { mcpServers: { 'tides-http': { type: 'http', url: 'https://tides.example.com/mcp' } } });
    expect((await tidesHttp()).revision).toBe(first); // all of it as it was: the same revision
    await json(join(at, '.claude-plugin', 'plugin.json'), { name: 'two words' });
    expect((await tidesHttp()).revision).toBeNull(); // no engine name, no revision
    expect(JSON.stringify(await read(cwd))).not.toMatch(/example\.com|COMMAND_SECRET|ARG_SECRET|HEADER_SECRET|REGION/);
  });

  it('caps the plugins’ connectors at the inventory’s row bound and labels the result partial', async () => {
    const at = join(root, 'many');
    const servers: Record<string, { type: string; url: string }> = {};
    for (let i = 0; i <= INVENTORY_BOUNDS.rows; i++) servers[`server-${String(i).padStart(4, '0')}`] = { type: 'http', url: `https://many.example.com/${i}` };
    await json(join(at, '.mcp.json'), { mcpServers: servers });
    await installed({ 'many@harbour-market': [{ scope: 'user', installPath: at }] });
    const answer = await read();
    expect(answer.pluginServers).toHaveLength(INVENTORY_BOUNDS.rows);
    expect(answer.pluginServers!.at(-1)!.server).toBe('server-1023');
    expect(answer.warnings).toContain('Customization inventory reached its read limit; some configured items are not inventoried.');
  });
});
