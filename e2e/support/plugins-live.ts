// E8's live run support (E8 execution document, M3 "The live run"): the gate (the installed engine answering its
// version, ClaudeUsage's relay answering /api/hello), a scratch root under /tmp holding the config home the engine and
// its plugin CLI write (`CLAUDE_CONFIG_DIR`), G0's scratch folder marketplace (`e8-scratch` offering `e8-probe`, one
// skill and one command) and a scratch git repository trusted in the scratch home; the config home's file tree, read
// before and after each action, and its delta set beside the `writesOf` manifest the confirm sheet announced; the
// plain-text log and the observations file. Never the owner's ~/.claude or ~/.claude.json.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { writesOf, type PluginsAction, type PluginsScope } from '../../src/shared/plugins/cli';
import { ENGINE_BIN, ENGINE_VERSION } from '../../test/support/engine-pin';
import { isolatedGitEnv } from '../../test/support/git-env';

export const RELAY = 'http://127.0.0.1:8641';

export function pluginsLiveSkipReason(): string | null {
  if (process.env.MAWS_E8_LIVE !== '1') return 'the E8 live run runs only under MAWS_E8_LIVE=1';
  if (!existsSync(ENGINE_BIN)) return `engine binary missing at ${ENGINE_BIN}`;
  if (!ENGINE_VERSION) return `engine did not report a version at ${ENGINE_BIN}`;
  const code = execFileSync('/usr/bin/curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${RELAY}/api/hello`], { encoding: 'utf8' }).trim();
  return code === '200' ? null : `relay at ${RELAY} answered ${code}: start ClaudeUsage`;
}

export interface PluginsScratch {
  root: string;
  config: string; // the scratch CLAUDE_CONFIG_DIR
  market: string; // the scratch folder marketplace `e8-scratch`
  repo: string; // the scratch repository the session runs in, trusted in the scratch home
  setPluginVersion(version: string): void; // rewrites e8-probe's plugin.json
  offerNope(on: boolean): void; // adds or removes a second plugin `nope` (entry and folder)
  snapshot(): Snapshot;
  log(line?: string): void; // live-run.txt
  observe(key: string, value: unknown): void; // observations.json
}

const PLUGIN_JSON = (version: string) => ({ name: 'e8-probe', version, description: 'E8 grounding probe plugin', author: { name: 'E8 probe' } });
const PROBE_ENTRY = { name: 'e8-probe', source: './plugins/e8-probe', description: 'One skill and one command, for the probe' };
const NOPE_ENTRY = { name: 'nope', source: './plugins/nope', description: 'Offered once, then withdrawn, for the error step' };

export function pluginsScratch(): PluginsScratch {
  const root = realpathSync(mkdtempSync('/tmp/maws-e8-live-'));
  const config = join(root, 'claude-config');
  const market = join(root, 'market');
  const repo = join(root, 'e8-repo');
  mkdirSync(config);
  writeFileSync(join(config, 'settings.json'), '{}\n');

  // G0's marketplace (spikes/protocol-probe/e8-cli-probe/probe-cli.sh)
  const probe = join(market, 'plugins', 'e8-probe');
  for (const dir of [join(market, '.claude-plugin'), join(probe, '.claude-plugin'), join(probe, 'skills', 'e8-hello'), join(probe, 'commands')]) mkdirSync(dir, { recursive: true });
  const manifest = (plugins: object[]) =>
    writeFileSync(join(market, '.claude-plugin', 'marketplace.json'), `${JSON.stringify({ name: 'e8-scratch', owner: { name: 'E8 probe' }, description: 'A scratch marketplace for the E8 live run', plugins }, null, 2)}\n`);
  manifest([PROBE_ENTRY]);
  const setPluginVersion = (version: string) => writeFileSync(join(probe, '.claude-plugin', 'plugin.json'), `${JSON.stringify(PLUGIN_JSON(version), null, 2)}\n`);
  setPluginVersion('0.1.0');
  writeFileSync(join(probe, 'skills', 'e8-hello', 'SKILL.md'), '---\nname: e8-hello\ndescription: Says hello from the E8 probe plugin.\n---\nReply with exactly: hello from e8-probe.\n');
  writeFileSync(join(probe, 'commands', 'e8-ping.md'), '---\ndescription: Answers pong, for the E8 probe.\n---\nReply with exactly: pong.\n');
  const nope = join(market, 'plugins', 'nope');
  const offerNope = (on: boolean) => {
    if (on) {
      mkdirSync(join(nope, '.claude-plugin'), { recursive: true });
      writeFileSync(join(nope, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'nope', version: '0.0.1', description: 'Withdrawn' }, null, 2)}\n`);
      manifest([PROBE_ENTRY, NOPE_ENTRY]);
    } else {
      manifest([PROBE_ENTRY]);
      rmSync(nope, { recursive: true, force: true });
    }
  };

  // the session's repository, trusted in the scratch home as the owner's trust dialog would leave it
  mkdirSync(repo);
  writeFileSync(join(repo, 'README.md'), '# E8 live run\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=Live', '-c', 'user.email=live@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'seed');
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2));

  const logFile = join(root, 'live-run.txt');
  const log = (line = '') => appendFileSync(logFile, `${line}\n`);
  const file = join(root, 'observations.json');
  const observe = (key: string, value: unknown) => {
    const prior = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
    writeFileSync(file, JSON.stringify({ ...prior, [key]: value }, null, 2));
  };
  const snapshot = () => ({ ...treeOf(config, 'config'), ...treeOf(join(repo, '.claude'), 'project/.claude') });
  return { root, config, market, repo, setPluginVersion, offerNope, snapshot, log, observe };
}

// ---- the file trees and their deltas --------------------------------------------------------------------------------

// path (prefixed `config/` or `project/.claude/`) → a fingerprint: a file's size and content hash; a clone or a cached
// plugin version (thousands of files) as one entry over its files' names, sizes and hashes of their mtimes.
export type Snapshot = Record<string, string>;

// Directories the delta treats as one entry: a marketplace's clone and one cached plugin version.
const LEAF_DIRS = [/^plugins\/marketplaces\/[^/]+$/, /^plugins\/cache\/[^/]+\/[^/]+\/[^/]+$/];

function treeOf(dir: string, prefix: string): Snapshot {
  const out: Snapshot = {};
  if (!existsSync(dir)) return out;
  const walk = (path: string) => {
    const rel = relative(dir, path);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (LEAF_DIRS.some((re) => re.test(rel))) {
        const hash = createHash('sha1');
        let files = 0;
        const inner = (p: string) => {
          for (const entry of readdirSync(p, { withFileTypes: true })) {
            const full = join(p, entry.name);
            if (entry.isDirectory()) inner(full);
            else {
              const s = statSync(full);
              files += 1;
              hash.update(`${relative(path, full)}\0${s.size}\0${s.mtimeMs}\n`);
            }
          }
        };
        inner(path);
        out[`${prefix}/${rel}/`] = `dir ${files} files ${hash.digest('hex').slice(0, 12)}`;
        return;
      }
      const entries = readdirSync(path);
      if (entries.length === 0 && rel !== '') out[`${prefix}/${rel}/`] = 'empty dir';
      for (const entry of entries) walk(join(path, entry));
      return;
    }
    out[`${prefix}/${rel}`] = `${stat.size} bytes ${createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 12)}`;
  };
  walk(dir);
  return out;
}

export interface Delta {
  added: string[];
  removed: string[];
  changed: string[];
}

// An empty directory is listed as itself; once something lands in it (or leaves it empty) only its contents are a change.
export function deltaOf(before: Snapshot, after: Snapshot): Delta {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const filled = (dir: string, tree: Snapshot) => Object.keys(tree).some((k) => k !== dir && k.startsWith(dir));
  return {
    added: keys.filter((k) => !(k in before) && !(after[k] === 'empty dir' && filled(k, before))),
    removed: keys.filter((k) => !(k in after) && !(before[k] === 'empty dir' && filled(k, after))),
    changed: keys.filter((k) => k in before && k in after && before[k] !== after[k]),
  };
}

// The manifest of one action as patterns over the snapshot's paths: the scope's settings file and `writesOf`'s others
// under `config/plugins/`, the segments the action names filled in, any other `<…>` one segment; a trailing `/` covers
// the directory and everything under it.
export function manifestOf(action: PluginsAction, scope: PluginsScope, source: string | null, fill: Record<string, string>): { paths: string[]; covers(path: string): boolean } {
  const writes = writesOf(action, scope, source);
  const filled = (path: string) => path.replace(/<([a-z]+)>/g, (whole, name: string) => fill[name] ?? whole);
  const paths = [scope === 'user' ? `config/${writes.settings}` : `project/${writes.settings}`, ...writes.others.map((other) => `config/plugins/${filled(other)}`)];
  const patterns = paths.map((path) => {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/<[a-z]+>/g, '[^/]+');
    return new RegExp(path.endsWith('/') ? `^${escaped}` : `^${escaped}$`);
  });
  return { paths, covers: (path) => patterns.some((re) => re.test(path)) };
}

// What a changed path is, when the manifest does not cover it: the engine's own records and caches (D-12), the running
// session's own files, or a write the sheet did not announce.
export function kindOf(path: string): 'records (D-12)' | 'catalogue cache (D-12)' | 'session files' | 'unannounced' {
  if (/^config\/\.claude\.json(\.backup.*)?$/.test(path) || path.startsWith('config/backups/')) return 'records (D-12)';
  if (/^config\/plugins\/(plugin-catalog-cache\.json|plugin-directory-cache-v2\.json)$/.test(path)) return 'catalogue cache (D-12)';
  if (path.startsWith('config/plugins/') || path === 'config/settings.json' || path.startsWith('project/')) return 'unannounced';
  return 'session files';
}

