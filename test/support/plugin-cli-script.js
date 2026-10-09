// The engine's plugin CLI, stood in for the `widgets` e2e (E8 execution document, M3 and D-10). Plain CommonJS so that
// `plugin-cli-stub.ts` copies it into a launch's userData and the engine host's runner spawns it as the engine binary
// (through a shell wrapper naming this Node; MAWS_E2E_ENGINE_BIN), with no seam in product code. `run` is pure: one
// argv over one state answers the stdout, stderr and exit code the engine's CLI would (the `--json` shapes of G0's probe,
// `docs/doperpowers/evidence/p1-e8/g0-cli-probe.txt`) and the state the change leaves. The process half reads the state
// beside the script, appends the argv to `calls.log`, holds a mutation while a `hold` file exists (printing one
// progress line first, so a row's progress can be seen), and writes the state back. As the engine does (E8's
// whole-branch review, 2.1.291): an install also installs the dependencies its plugin declares (`dependencies`: a name
// in the same marketplace, or `name@marketplace` for one the root allowlists), and a marketplace removal uninstalls every
// plugin installed from it.
// P2-B (M2): list rows carry `installedAt`, `lastUpdated` and `projectEnabled` (U3 F1); `--available` rows carry the
// entry's `source` and, for a marketplace the state marks `countsInstalls`, the plugin's `installCount`; after every run
// the process half writes what the engine keeps on disk and the state does not (`materialise`): each installation's
// plugin tree under its `installPath` and each cloned marketplace's `.claude-plugin/marketplace.json` (with its plugins'
// trees) under its `installLocation`, so the manifest service reads files where the engine's would be. It writes only
// inside an explicit CLAUDE_CONFIG_DIR, never the owner's `~/.claude`.
'use strict';
const { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { basename, dirname, isAbsolute, join, resolve, sep } = require('node:path');

const json = (value) => JSON.stringify(value);
const pretty = (value) => JSON.stringify(value, null, 2);
const clone = (value) => JSON.parse(JSON.stringify(value));

const VALUE_OPTIONS = new Set(['--scope', '--accept-command']);
const FLAG_OPTIONS = new Set(['--json', '--available', '--keep-data']);

function parse(rest) {
  const positional = [];
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (VALUE_OPTIONS.has(arg)) options[arg.slice(2)] = rest[++i];
    else if (FLAG_OPTIONS.has(arg)) options[arg.slice(2)] = true;
    else if (arg.startsWith('-')) return { error: `error: unknown option '${arg}'` };
    else positional.push(arg);
  }
  return { positional, options };
}

const splitId = (id) => {
  const at = id.lastIndexOf('@');
  return at > 0 ? { name: id.slice(0, at), marketplace: id.slice(at + 1) } : { name: id, marketplace: null };
};

// A plugin's version as the marketplace offers it: the entry's own, else its folder's plugin.json.
function readMarketplace(path) {
  const file = join(path, '.claude-plugin', 'marketplace.json');
  if (!existsSync(file)) return null;
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const plugins = (manifest.plugins || []).map((entry) => {
    let version = entry.version || null;
    if (!version && typeof entry.source === 'string') {
      const own = join(path, entry.source, '.claude-plugin', 'plugin.json');
      if (existsSync(own)) version = JSON.parse(readFileSync(own, 'utf8')).version || null;
    }
    return { name: entry.name, version, description: entry.description || null, ...(entry.source === undefined ? {} : { source: entry.source }) };
  });
  return { name: manifest.name, plugins };
}

// -- P2-B: the files the engine keeps, written for the manifest service to read ------------------------------------------

// A plugin's files as an install leaves them: plugin.json, a command, a skill, an agent, hooks and an MCP server (whose
// command line and environment carry values the manifest service must never repeat); a plugin with `manifest: false` (an
// LSP plugin of claude-plugins-official, whose marketplace entry is its manifest) holds only a licence and a readme.
function pluginTree(plugin, version) {
  if (plugin.manifest === false) return { LICENSE: 'Apache-2.0\n', 'README.md': `# ${plugin.name}\n` };
  const front = (fields) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;
  return {
    '.claude-plugin/plugin.json': pretty({ name: plugin.name, ...(version ? { version } : {}), ...(plugin.description ? { description: plugin.description } : {}), author: { name: plugin.author || 'MAWS stub' } }),
    [`commands/${plugin.name}-hello.md`]: `${front({ description: `Says hello from ${plugin.name}` })}Hello.\n`,
    [`skills/${plugin.name}-skill/SKILL.md`]: `${front({ name: `${plugin.name}-skill`, description: `The skill ${plugin.name} brings` })}Use it.\n`,
    [`agents/${plugin.name}-helper.md`]: `${front({ name: `${plugin.name}-helper`, description: `Helps with ${plugin.name}` })}You help.\n`,
    'hooks/hooks.json': pretty({ hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo stub-hook-command' }] }] } }),
    '.mcp.json': pretty({ mcpServers: { [`${plugin.name}-server`]: { command: 'node', args: ['server.js', '--token', 'stub-secret-arg'], env: { STUB_TOKEN: 'stub-secret-env' } } } }),
  };
}

function writeTree(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const at = join(root, path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, content);
  }
}

// The marketplace entry a stub plugin is listed as.
const entryOf = (plugin) => ({
  name: plugin.name,
  source: plugin.source === undefined ? `./plugins/${plugin.name}` : plugin.source,
  ...(plugin.description ? { description: plugin.description } : {}),
  ...(plugin.version ? { version: plugin.version } : {}),
  ...(plugin.author ? { author: { name: plugin.author } } : {}),
  ...(plugin.manifest === false ? { strict: false } : {}),
  ...(plugin.lspServers ? { lspServers: plugin.lspServers } : {}),
});

// Writes what is missing: every installation's tree and every cloned marketplace's catalogue (a folder marketplace is the
// person's own folder, read in place, and is never written). Only inside an explicit CLAUDE_CONFIG_DIR that is neither
// in this account's `~/.claude` nor in `$HOME/.claude`; anywhere else it writes nothing.
function materialise(state, ctx, env) {
  const configHome = env.CLAUDE_CONFIG_DIR;
  if (!configHome || !isAbsolute(configHome)) return;
  const real = (path) => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  const home = real(configHome);
  const owners = [homedir(), env.HOME].filter(Boolean).map((dir) => real(join(dir, '.claude')));
  if (owners.some((owner) => home === owner || home.startsWith(owner + sep))) return;
  const ctxHome = { ...ctx, configHome };
  for (const m of state.marketplaces) {
    if (m.source === 'directory') continue;
    const location = join(configHome, 'plugins', 'marketplaces', m.name);
    if (existsSync(join(location, '.claude-plugin', 'marketplace.json'))) continue;
    writeTree(location, { '.claude-plugin/marketplace.json': pretty({ name: m.name, owner: { name: 'MAWS stub' }, plugins: m.plugins.map(entryOf) }) });
    for (const plugin of m.plugins) if (typeof entryOf(plugin).source === 'string') writeTree(join(location, entryOf(plugin).source), pluginTree(plugin, plugin.version));
  }
  for (const p of state.installed) {
    const { name, marketplace } = splitId(p.id);
    const installPath = rowOf(p, ctxHome, state).installPath;
    if (existsSync(installPath)) continue;
    const offered = state.marketplaces.find((m) => m.name === marketplace)?.plugins.find((plugin) => plugin.name === name) || { name };
    writeTree(installPath, pluginTree(offered, p.version));
  }
}

// One installation as `plugin list --json` prints it from `ctx.cwd`: `projectEnabled` when an enabled project-scope
// installation of the id is recorded for that directory (the engine reads the directory's `.claude/settings.json`).
function rowOf(p, ctx, state) {
  const { name, marketplace } = splitId(p.id);
  const projectEnabled = state.installed.some((q) => q.id === p.id && q.scope === 'project' && q.projectPath === ctx.cwd && q.enabled);
  return {
    id: p.id, version: p.version, scope: p.scope, enabled: p.enabled, installPath: `${ctx.configHome}/plugins/cache/${marketplace}/${name}/${p.version}`,
    ...(p.installedAt ? { installedAt: p.installedAt } : {}), ...(p.lastUpdated ? { lastUpdated: p.lastUpdated } : {}),
    ...(p.projectPath ? { projectPath: p.projectPath } : {}), projectEnabled,
  };
}

function sourceOf(typed, cwd) {
  if (/^[/~.]/.test(typed)) {
    const path = typed.startsWith('~') ? join(process.env.HOME || '/', typed.slice(1)) : isAbsolute(typed) ? typed : resolve(cwd, typed);
    return { source: 'directory', path };
  }
  if (/^(https?:\/\/|git@)/.test(typed)) return { source: typed.endsWith('.json') ? 'url' : 'git', url: typed, name: basename(typed).replace(/\.(git|json)$/, '') };
  if (/^[\w.-]+\/[\w.-]+$/.test(typed)) return { source: 'github', repo: typed, name: typed.split('/')[1] };
  return null;
}

function run(argv, input, ctx) {
  const state = clone(input);
  const out = { stdout: '', stderr: '', code: 0, state };
  const say = (line) => (out.stdout += `${line}\n`);
  const err = (line) => (out.stderr += `${line}\n`);
  const fail = (result, stderrLine) => {
    say(json({ ...result, outcome: 'failed' }));
    err(`✘ ${stderrLine}`);
    out.code = 1;
    return out;
  };

  if (argv.length === 1 && argv[0] === '--version') {
    say(`${state.version || '0.0.0'} (Claude Code)`);
    return out;
  }
  if (argv[0] !== 'plugin') {
    err('MAWS plugin CLI stub: refusing anything but `claude plugin …`');
    out.code = 64;
    return out;
  }
  const marketplaceVerb = argv[1] === 'marketplace';
  const verb = marketplaceVerb ? argv[2] : argv[1];
  const parsed = parse(argv.slice(marketplaceVerb ? 3 : 2));
  if (parsed.error) {
    err(parsed.error);
    out.code = 1;
    return out;
  }
  const { positional, options } = parsed;
  const scope = options.scope || 'user';
  const projectPath = scope === 'user' ? null : ctx.cwd;
  const locationOf = (m) => (m.source === 'directory' ? m.path : `${ctx.configHome}/plugins/marketplaces/${m.name}`);
  const now = ctx.now || new Date().toISOString();
  // the engine's `--available` leaves out what is installed (the E8 live run on 2.1.291); a row carries the entry's
  // source and, for the one marketplace the engine's catalog counts (U3), the plugin's install count
  const installedIds = new Set(state.installed.map((p) => p.id));
  const available = () =>
    state.marketplaces.flatMap((m) =>
      m.plugins
        .filter((p) => !installedIds.has(`${p.name}@${m.name}`))
        .map((p) => ({ pluginId: `${p.name}@${m.name}`, name: p.name, description: p.description, marketplaceName: m.name, ...(p.version ? { version: p.version } : {}), source: entryOf(p).source, ...(m.countsInstalls && typeof p.installCount === 'number' ? { installCount: p.installCount } : {}) })),
    );

  // the reads
  if (!marketplaceVerb && verb === 'list') {
    const rows = state.installed.map((p) => rowOf(p, ctx, state));
    say(pretty(options.available ? { installed: rows, available: available() } : rows));
    return out;
  }
  if (marketplaceVerb && verb === 'list') {
    const locator = (m) => (m.source === 'directory' ? { path: m.path } : m.source === 'github' ? { repo: m.repo } : { url: m.url });
    // a repository marketplace's branch or tag, printed as the engine prints it: only when there is one (P2-B)
    const pin = (m) => ((m.source === 'github' || m.source === 'git') && m.ref ? { ref: m.ref } : {});
    say(pretty(state.marketplaces.map((m) => ({ name: m.name, source: m.source, ...locator(m), ...pin(m), installLocation: locationOf(m) }))));
    return out;
  }

  // the mutations: an on-demand failure first (one whose shownCommand is accepted by its sha256 goes on)
  const action = marketplaceVerb ? `marketplace-${verb}` : verb;
  const command = action;
  const target = positional[0];
  const failing = (state.fail || {})[action];
  if (failing && !(failing.shownCommand && options['accept-command'] === failing.shownCommand.sha256)) {
    const subject = marketplaceVerb ? { marketplace: target } : { plugin: target, scope };
    return fail({ command, ...subject, message: failing.message, failureCode: failing.failureCode, ...(failing.shownCommand ? { shownCommand: failing.shownCommand } : {}) }, failing.message);
  }

  if (marketplaceVerb) {
    if (verb === 'add') {
      const source = sourceOf(target, ctx.cwd);
      if (!source) return fail({ command, message: `Invalid marketplace source: ${target}`, failureCode: 'invalid_source' }, `Invalid marketplace source: ${target}`);
      let entry;
      if (source.source === 'directory') {
        if (!existsSync(source.path)) return fail({ command, message: `Path does not exist: ${source.path}`, failureCode: 'invalid_source' }, `Path does not exist: ${source.path}`);
        const manifest = readMarketplace(source.path);
        const missing = `Marketplace file not found at ${join(source.path, '.claude-plugin', 'marketplace.json')}`;
        if (!manifest) return fail({ command, message: missing, failureCode: 'invalid_source' }, missing);
        entry = { name: manifest.name, source: 'directory', path: source.path, plugins: manifest.plugins };
      } else {
        const { name, ...rest } = source;
        entry = { name, ...rest, plugins: [] };
      }
      const where = scope === 'user' ? 'user' : scope;
      if (state.marketplaces.some((m) => m.name === entry.name)) {
        say(json({ command, outcome: 'ok', marketplace: entry.name, message: `Marketplace '${entry.name}' already on disk — declared in ${where} settings` }));
        return out;
      }
      state.marketplaces.push(entry);
      say(json({ command, outcome: 'ok', marketplace: entry.name, message: `Successfully added marketplace: ${entry.name} (declared in ${where} settings)` }));
      return out;
    }
    const known = state.marketplaces.find((m) => m.name === target);
    if (!known) return fail({ command, marketplace: target, message: `Marketplace '${target}' not found`, failureCode: 'not_configured' }, `Failed to ${verb} marketplace: Marketplace '${target}' not found`);
    if (verb === 'update') {
      if (known.source === 'directory' && existsSync(known.path)) known.plugins = (readMarketplace(known.path) || known).plugins;
      say(json({ command, outcome: 'ok', marketplace: target, message: `${known.source === 'directory' ? 'Validating local marketplace\n' : ''}Successfully updated marketplace: ${target}` }));
      return out;
    }
    if (verb === 'remove') {
      state.marketplaces = state.marketplaces.filter((m) => m !== known);
      state.installed = state.installed.filter((p) => splitId(p.id).marketplace !== target);
      say(json({ command, outcome: 'ok', marketplace: target, message: `Successfully removed marketplace: ${target}` }));
      return out;
    }
  }

  const { name, marketplace } = splitId(target || '');
  const installation = state.installed.find((p) => p.id === target && p.scope === scope && (p.projectPath || null) === projectPath);
  const failed = (message, failureCode) => fail({ command, plugin: target, scope, message, failureCode }, `Failed to ${verb} plugin "${target}": ${message}`);
  const ok = (extra, message) => {
    say(json({ command, outcome: 'ok', plugin: target, pluginId: target, scope, ...extra, message }));
    return out;
  };
  const offered = () => state.marketplaces.find((m) => m.name === marketplace)?.plugins.find((p) => p.name === name);
  switch (verb) {
    case 'install': {
      const plugin = offered();
      if (!plugin) return failed(`Plugin "${name}" not found in marketplace "${marketplace}". Your local copy may be out of date — try \`claude plugin marketplace update ${marketplace}\`.`, 'not_found');
      if (installation) return failed(`Plugin "${target}" is already installed`, 'already_in_goal_state');
      state.installed.push({ id: target, version: plugin.version, scope, enabled: true, projectPath, installedAt: now, lastUpdated: now });
      for (const dependency of plugin.dependencies || []) {
        const named = splitId(dependency);
        const from = named.marketplace || marketplace;
        const id = `${named.name}@${from}`;
        const declared = state.marketplaces.find((m) => m.name === from)?.plugins.find((p) => p.name === named.name);
        if (declared && !state.installed.some((p) => p.id === id && p.scope === scope && (p.projectPath || null) === projectPath)) state.installed.push({ id, version: declared.version, scope, enabled: true, projectPath, installedAt: now, lastUpdated: now });
      }
      return ok({}, `Successfully installed plugin: ${target} (scope: ${scope})`);
    }
    case 'update': {
      if (!installation) return failed(`Plugin "${target}" not found in installed plugins`, 'not_installed');
      const from = installation.version;
      const to = offered()?.version || from;
      if (from === to) return ok({ updateOutcome: 'up_to_date', oldVersion: from, newVersion: to }, `${name} is already at the latest version (${from}).`);
      installation.version = to;
      installation.lastUpdated = now;
      return ok({ updateOutcome: 'updated', oldVersion: from, newVersion: to }, `Plugin "${name}" updated from ${from} to ${to} for scope ${scope}. Restart to apply changes.`); // the engine's words (live run, 2.1.291)
    }
    case 'uninstall':
      if (!installation) return failed(`Plugin "${target}" not found in installed plugins`, 'not_installed');
      state.installed = state.installed.filter((p) => p !== installation);
      return ok({ keptData: Boolean(options['keep-data']) }, `Successfully uninstalled plugin: ${name} (scope: ${scope})`);
    case 'enable':
    case 'disable': {
      if (!installation) return failed(`Plugin "${target}" not found in installed plugins`, 'not_installed');
      const enabled = verb === 'enable';
      if (installation.enabled === enabled) return failed(`Plugin "${target}" is already ${verb}d`, 'already_in_goal_state');
      installation.enabled = enabled;
      return ok({}, `Successfully ${verb}d plugin: ${name} (scope: ${scope})`);
    }
  }
  err(`error: unknown command '${argv.slice(0, 3).join(' ')}'`);
  out.code = 1;
  return out;
}

// Blocks this process for `ms` (the stub is a short-lived child; a mutation may be held for a test to watch it run).
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function main() {
  const dir = __dirname;
  const argv = process.argv.slice(2);
  appendFileSync(join(dir, 'calls.log'), `${json(argv)}\n`);
  const stateFile = join(dir, 'state.json');
  const ctx = { cwd: process.cwd(), configHome: process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || '/', '.claude') };
  const mutating = argv[0] === 'plugin' && argv.includes('--json') && !argv.includes('list');
  if (mutating && existsSync(join(dir, 'hold'))) {
    process.stderr.write(`Holding ${argv.slice(1, -1).join(' ')} (plugin CLI stub)\n`);
    for (let waited = 0; existsSync(join(dir, 'hold')) && waited < 60_000; waited += 50) sleep(50);
  }
  const out = run(argv, JSON.parse(readFileSync(stateFile, 'utf8')), ctx);
  if (mutating) writeFileSync(stateFile, pretty(out.state));
  materialise(out.state, ctx, process.env);
  process.stdout.write(out.stdout);
  process.stderr.write(out.stderr);
  process.exitCode = out.code;
}

module.exports = { run, pluginTree, writeTree, entryOf, materialise };
if (require.main === module) main();
