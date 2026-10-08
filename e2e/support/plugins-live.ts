// E8's live run support (E8 execution document, M3 "The live run"): the gate (the installed engine answering its
// version, ClaudeUsage's relay answering /api/hello), a scratch root under /tmp holding the config home the engine and
// its plugin CLI write (`CLAUDE_CONFIG_DIR`), G0's scratch folder marketplace (`e8-scratch` offering `e8-probe`, one
// skill and one command) and a scratch git repository trusted in the scratch home; the config home's and the project's
// file trees, read around each CLI action for the G4 audit (test/support/plugins-audit.ts); the plain-text log and the
// observations file. Never the owner's ~/.claude or ~/.claude.json.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { bridgeTimedOut, readTree, type InvokeTracker, type SettledInvoke, type Tree } from '../../test/support/plugins-audit';
import { ENGINE_BIN, ENGINE_VERSION } from '../../test/support/engine-pin';
import { isolatedGitEnv } from '../../test/support/git-env';
import { relaySkipReason } from '../../test/support/relay-health';

export const RELAY = 'http://127.0.0.1:8641';

export function pluginsLiveSkipReason(): string | null {
  if (process.env.MAWS_E8_LIVE !== '1') return 'the E8 live run runs only under MAWS_E8_LIVE=1';
  if (!existsSync(ENGINE_BIN)) return `engine binary missing at ${ENGINE_BIN}`;
  if (!ENGINE_VERSION) return `engine did not report a version at ${ENGINE_BIN}`;
  return relaySkipReason(RELAY); // E11 (scale review E scalpel-1#4): a closed port or a silent relay is a skip, not a throw at collection
}

export interface PluginsScratch {
  root: string;
  config: string; // the scratch CLAUDE_CONFIG_DIR
  market: string; // the scratch folder marketplace `e8-scratch`
  repo: string; // the scratch repository the session runs in, trusted in the scratch home
  setPluginVersion(version: string): void; // rewrites e8-probe's plugin.json
  offerNope(on: boolean): void; // adds or removes a second plugin `nope` (entry and folder)
  tree(): Tree; // the config home and the repository's `.claude/`, read now
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
  return { root, config, market, repo, setPluginVersion, offerNope, tree: () => readTree(config, repo), log, observe };
}


// ---- the CLI reads in flight --------------------------------------------------------------------------------------

export interface PluginReads extends InvokeTracker {
  settledSince(at: number): Promise<{ name: string; ms: number; outcome: 'answered' | 'threw' | 'timed out at the bridge' | 'refused' }[]>; // the reads that settled since `at`
}

type ReadLog = { inflight: number; lastSettledAt: number; settled: SettledInvoke[] };

// Counts the `plugins.*` and `marketplaces.*` invokes main is answering. The page cannot do it: the preload's bridge is
// frozen and read-only under contextIsolation (`window.maws` and its `invoke` are non-writable). So main's invoke
// handlers for those channels (`maws:cmd:<name>`, one each, src/main/ipc/router.ts) are wrapped where Electron keeps
// them (`ipcMain._invokeHandlers`, whose entry resolves once the reply is sent). Each settled invoke keeps its answer's
// outcome (`ok` and the error's `code`, not its value), so a read the bridge answered `timeout` while the host's CLI ran
// on fails the audit (`untilQuiet`) rather than closing a window. Call it before the page issues any.
export async function trackPluginReads(app: ElectronApplication): Promise<PluginReads> {
  const wrapped = await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
    if (!handlers) throw new Error('ipcMain keeps no _invokeHandlers map: the read tracker cannot wrap main’s handlers');
    const log: ReadLog = { inflight: 0, lastSettledAt: 0, settled: [] };
    (globalThis as unknown as { __e8Reads: ReadLog }).__e8Reads = log;
    const channels = [...handlers.keys()].filter((key) => key.startsWith('maws:cmd:plugins.') || key.startsWith('maws:cmd:marketplaces.'));
    for (const channel of channels) {
      const handler = handlers.get(channel)!;
      handlers.set(channel, async (event, ...args) => {
        const started = Date.now();
        log.inflight += 1;
        let threw = true;
        let answer: unknown = null;
        try {
          const result = await handler(event, ...args);
          threw = false;
          const r = result as { ok?: unknown; error?: { code?: unknown } } | null;
          answer = typeof r === 'object' && r !== null ? { ok: r.ok, error: r.ok === false ? { code: r.error?.code } : undefined } : null;
          return result;
        } finally {
          log.inflight -= 1;
          log.lastSettledAt = Date.now();
          log.settled.push({ name: channel.slice('maws:cmd:'.length), at: log.lastSettledAt, ms: log.lastSettledAt - started, threw, answer });
        }
      });
    }
    return channels.length;
  });
  if (wrapped === 0) throw new Error('no plugins.* or marketplaces.* invoke handler to wrap');
  const read = () => app.evaluate(() => (globalThis as unknown as { __e8Reads: ReadLog }).__e8Reads);
  return {
    inflight: async () => (await read()).inflight,
    lastSettledAt: async () => (await read()).lastSettledAt,
    settled: async () => (await read()).settled,
    settledSince: async (at) =>
      (await read()).settled
        .filter((s) => s.at >= at)
        .map((s) => ({ name: s.name, ms: s.ms, outcome: s.threw ? 'threw' : bridgeTimedOut(s) ? 'timed out at the bridge' : (s.answer as { ok?: unknown } | null)?.ok === false ? 'refused' : 'answered' })),
  };
}
