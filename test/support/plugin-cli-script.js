// The engine's plugin CLI, stood in for the `widgets` e2e (E8 execution document, M3 and D-10). Plain CommonJS so that
// `plugin-cli-stub.ts` copies it into a launch's userData and the engine host's runner spawns it as the engine binary
// (through a shell wrapper naming this Node; MAWS_E2E_ENGINE_BIN), with no seam in product code. `run` is pure: one
// argv over one state answers the stdout, stderr and exit code the engine's CLI would (the `--json` shapes of G0's probe,
// `docs/doperpowers/evidence/p1-e8/g0-cli-probe.txt`) and the state the change leaves. The process half reads the state
// beside the script, appends the argv to `calls.log`, holds a mutation while a `hold` file exists (printing one
// progress line first, so a row's progress can be seen), and writes the state back. As the engine does (E8's
// whole-branch review, 2.1.291): an install also installs the dependencies its plugin declares (`dependencies`, names in
// the same marketplace), and a marketplace removal uninstalls every plugin installed from it.
'use strict';
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
const { basename, isAbsolute, join, resolve } = require('node:path');

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
    return { name: entry.name, version, description: entry.description || null };
  });
  return { name: manifest.name, plugins };
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
  const rowOf = (p) => {
    const { name, marketplace } = splitId(p.id);
    return { id: p.id, version: p.version, scope: p.scope, enabled: p.enabled, installPath: `${ctx.configHome}/plugins/cache/${marketplace}/${name}/${p.version}`, ...(p.projectPath ? { projectPath: p.projectPath } : {}) };
  };
  // the engine's `--available` leaves out what is installed (the E8 live run on 2.1.291)
  const installedIds = new Set(state.installed.map((p) => p.id));
  const available = () =>
    state.marketplaces.flatMap((m) =>
      m.plugins.filter((p) => !installedIds.has(`${p.name}@${m.name}`)).map((p) => ({ pluginId: `${p.name}@${m.name}`, name: p.name, description: p.description, marketplaceName: m.name, ...(p.version ? { version: p.version } : {}) })),
    );

  // the reads
  if (!marketplaceVerb && verb === 'list') {
    say(pretty(options.available ? { installed: state.installed.map(rowOf), available: available() } : state.installed.map(rowOf)));
    return out;
  }
  if (marketplaceVerb && verb === 'list') {
    const locator = (m) => (m.source === 'directory' ? { path: m.path } : m.source === 'github' ? { repo: m.repo } : { url: m.url });
    say(pretty(state.marketplaces.map((m) => ({ name: m.name, source: m.source, ...locator(m), installLocation: locationOf(m) }))));
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
      state.installed.push({ id: target, version: plugin.version, scope, enabled: true, projectPath });
      for (const dependency of plugin.dependencies || []) {
        const id = `${dependency}@${marketplace}`;
        const declared = state.marketplaces.find((m) => m.name === marketplace).plugins.find((p) => p.name === dependency);
        if (declared && !state.installed.some((p) => p.id === id && p.scope === scope && (p.projectPath || null) === projectPath)) state.installed.push({ id, version: declared.version, scope, enabled: true, projectPath });
      }
      return ok({}, `Successfully installed plugin: ${target} (scope: ${scope})`);
    }
    case 'update': {
      if (!installation) return failed(`Plugin "${target}" not found in installed plugins`, 'not_installed');
      const from = installation.version;
      const to = offered()?.version || from;
      if (from === to) return ok({ updateOutcome: 'up_to_date', oldVersion: from, newVersion: to }, `${name} is already at the latest version (${from}).`);
      installation.version = to;
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
  process.stdout.write(out.stdout);
  process.stderr.write(out.stderr);
  process.exitCode = out.code;
}

module.exports = { run };
if (require.main === module) main();
