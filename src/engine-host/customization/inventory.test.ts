import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostOn } from '@shared/host/runtime';
import { commands, type CommandOutput } from '@shared/ipc/schema';
import { isBridgedCommandName } from '@shared/ipc/names';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { clientSettingsDefaults, machineSettingsDefaults, SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
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
      ], warnings: [], serversRead: true,
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
    expect(answer).toEqual({ skills: [], servers: [{ name: 'app', scope: 'app', path, transport: 'http' }], warnings: ['User configuration environment could not be read.'], serversRead: false });
  });

  it('returns a warning within its deadline even when environment capture never settles', async () => {
    const answer = await readCustomizationInventory(null, { userData, captureEnv: () => new Promise(() => {}), timeoutMs: 5 });
    expect(answer).toEqual({ skills: [], servers: [], warnings: ['Customization inventory reached its read limit; some configured items are not inventoried.'], serversRead: false });
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
    ] });
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
