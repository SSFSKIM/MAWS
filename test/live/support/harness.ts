// The live recordings' shared harness (E11 W-E; the tracker's E2 · E1 row on the copied harness): what E1's
// maws-tools, E2's maws-artifacts and E4c's maws-browser cases each kept a copy of, and E11's sittings build on. The gate
// (MAWS_LIVE, the relay with one retry after two minutes, the installed engine's version), the run's scratch config home
// and userData under /tmp, the owner file's A-15 reading, scratch repositories trusted in the scratch home, the journal
// reader, the allow-once loop, and the export `finally` (journal and transcript exports with the child's provenance,
// the engine's init plugin list, the A-15 check). The owner's ~/.claude.json is only read. Every engine the cases
// launch goes through LiveHost, whose captured environment drops every inherited CLAUDE* variable (live-host.ts).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, type TestContext } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { captureShellEnvironment } from '@shared/host/shell-env';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { createBinaryProbe } from '../../../src/engine-host/binary-info';
import { RELAY_URL } from '../../../src/engine-host/launch';
import { checkRelay } from '../../../src/engine-host/relay-health';
import { ownerPlugins, withoutClaudeVariables } from '../../support/claude-env';
import { exportFixture, journalCost, redactJournal, type Provenance } from './live';
import type { LiveHost } from './live-host';

export const RELAY_RETRY_MS = 120_000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface LiveGate {
  userData: string; // the run's userData (journals, deliverables, exports/)
  home: string; // the scratch CLAUDE_CONFIG_DIR every launch of the run shares
  bin: string; // the installed engine the product resolves with no binary configured
  version: string;
  a15Before: string[]; // the owner file's /tmp project keys before the first launch
}
export type GateResult = { skip: string } | LiveGate;

// The owner's ~/.claude.json, read only: the project keys under /tmp (A-15). A launch that leaked its scratch project
// into the owner's file would add one.
export function a15(): string[] {
  const projects = (JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')) as { projects?: Record<string, unknown> }).projects ?? {};
  return Object.keys(projects).filter((k) => k.startsWith('/tmp') || k.startsWith('/private/tmp')).sort();
}

// The run's gate, in a `beforeAll` (allow it the relay's retry): skipped without MAWS_LIVE=1, with the relay still down
// after one retry two minutes later, or with an installed engine that answers no version; otherwise the run's scratch
// config home (`settings.json` `{}`) and userData under /tmp, named for the child (`/tmp/maws-<label>-config-…`).
export async function openGate(label: string, log: (line: string) => void = (line) => console.log(`   ${line}`)): Promise<GateResult> {
  if (process.env.MAWS_LIVE !== '1') return { skip: 'live tests skipped: MAWS_LIVE is not 1' };
  let relay = await checkRelay(RELAY_URL, undefined, { force: true });
  if (!relay.ok) {
    log(`relay not ready (${JSON.stringify(relay)}); waiting two minutes and retrying once`);
    await delay(RELAY_RETRY_MS);
    relay = await checkRelay(RELAY_URL, undefined, { force: true });
  }
  if (!relay.ok) return { skip: `live tests skipped: relay at ${RELAY_URL} unreachable — start ClaudeUsage` };
  const check = await createBinaryProbe({ captureEnv: async () => withoutClaudeVariables(await captureShellEnvironment()) })();
  if (!check.ok || check.version === null) return { skip: `live tests skipped: the installed engine did not answer its version (${check.error ?? check.path})` };
  const home = realpathSync(mkdtempSync(`/tmp/maws-${label}-config-`));
  writeFileSync(join(home, 'settings.json'), '{}\n');
  return { userData: realpathSync(mkdtempSync(`/tmp/maws-${label}-live-`)), home, bin: check.path, version: check.version, a15Before: a15() };
}

// The gate for one case: skips it, saying why, when the run's gate did.
export function liveCase(gate: GateResult, ctx: TestContext): LiveGate {
  if ('skip' in gate) {
    console.log(`↓ ${gate.skip}`);
    ctx.skip(gate.skip);
  }
  return gate as LiveGate;
}

// A scratch git repository under /tmp (so a leak would show in the A-15 delta) holding one.txt and whatever `seed`
// writes, committed, and trusted in the scratch home's `.claude.json` (merged, so the run's earlier repositories stay).
export function scratchRepo(g: LiveGate, label: string, seed: (dir: string) => void = () => {}): string {
  const dir = realpathSync(mkdtempSync(`/tmp/maws-${label}-repo-`));
  writeFileSync(join(dir, 'one.txt'), 'ONE\n');
  seed(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Live', '-c', 'user.email=live@localhost', 'commit', '-qm', 'seed'], { cwd: dir });
  const claudeJson = join(g.home, '.claude.json');
  const state: { projects?: Record<string, unknown> } & Record<string, unknown> = existsSync(claudeJson) ? JSON.parse(readFileSync(claudeJson, 'utf8')) : { hasCompletedOnboarding: true, theme: 'light' };
  state.projects = { ...state.projects, [dir]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } };
  writeFileSync(claudeJson, `${JSON.stringify(state, null, 2)}\n`);
  return dir;
}

export function readJournal(path: string): JournalRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseJournalRow(JSON.parse(line)));
}

// Every permission the session asks allowed once as it arrives, and any further `steps` (a stand-in's answers), every
// 100 ms until the returned stop is called.
export function answerWhileRunning(host: LiveHost, appSessionId: string, steps: (() => Promise<void>)[] = []): () => void {
  let running = true;
  const allowed = new Set<string>();
  void (async () => {
    while (running) {
      for (const ask of host.events(appSessionId)) {
        if (ask.kind !== 'permission.requested' || allowed.has(ask.requestId)) continue;
        allowed.add(ask.requestId);
        console.log(`   allow once: ${ask.toolName} (seq ${ask.seq})`);
        await host.call('session.answer', { appSessionId, requestId: ask.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }).catch((error: unknown) => console.log(`   allow failed: ${String(error)}`));
      }
      for (const step of steps) await step();
      await delay(100);
    }
  })();
  return () => void (running = false);
}

// The engine's `system/init` plugin list for the session (the first init's), or null before one arrived.
export function initPlugins(events: SessionEvent[]): { name: string; source: string }[] | null {
  const init = events.find((e): e is Extract<SessionEvent, { kind: 'session.init' }> => e.kind === 'session.init');
  return init ? init.plugins : null;
}

// The engine's transcript of one session in the scratch home, redacted, under `<userData>/exports/<name>.jsonl`; null
// when the scratch home holds none.
export function exportTranscript(g: LiveGate, name: string, engineSessionId: string): { dest: string; source: string; text: string } | null {
  const projects = join(g.home, 'projects');
  const source = existsSync(projects) ? readdirSync(projects).map((dir) => join(projects, dir, `${engineSessionId}.jsonl`)).find((path) => existsSync(path)) : undefined;
  if (!source) return null;
  const dir = join(g.userData, 'exports');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${name}.jsonl`);
  const text = redactJournal(readFileSync(source, 'utf8'));
  writeFileSync(dest, text);
  return { dest, source, text };
}

// The export `finally` of a case's session: the host shut down, the journal costed and exported with the child's
// provenance (engineVersion, model, scenario and costUsd added), the engine's transcript exported when `transcript`
// names it, the engine's init plugin list recorded and checked to hold no plugin of the owner's, and the A-15 reading
// checked against the run's first. Each step's line goes to `report` as it happens, so a failing check still leaves the
// exports and the record. Called whatever the case's outcome; answers the journal's cost (null with no journal) and the
// export's path.
export async function closeSession(
  host: LiveHost,
  g: LiveGate,
  session: { appSessionId: string; journalPath: string; scenario: string; provenance: Provenance; transcript?: { name: string; engineSessionId: string } },
  report: (line: string) => void,
): Promise<{ costUsd: number | null; exported: string | null }> {
  await host.shutdown().catch((error: unknown) => report(`shutdown failed: ${String(error)}`));
  let costUsd: number | null = null;
  let exported: string | null = null;
  if (session.journalPath) {
    costUsd = journalCost(readJournal(session.journalPath)).costUsd;
    report(`journal: ${session.journalPath} (total_cost_usd ${costUsd.toFixed(4)})`);
    const dir = join(g.userData, 'exports');
    mkdirSync(dir, { recursive: true });
    exported = join(dir, `${session.scenario}.jsonl`);
    const provenance: Provenance = { ...session.provenance, engineVersion: g.version, model: 'haiku', scenario: session.scenario, costUsd: costUsd.toFixed(4) };
    writeFileSync(exported, exportFixture(readFileSync(session.journalPath, 'utf8'), undefined, undefined, provenance));
    report(`exported: ${exported} (from ${session.journalPath})`);
    if (session.transcript) {
      const transcript = exportTranscript(g, session.transcript.name, session.transcript.engineSessionId);
      report(transcript ? `exported: ${transcript.dest} (transcript ${transcript.source})` : `no transcript for ${session.transcript.engineSessionId} under ${join(g.home, 'projects')}`);
    }
  }
  const plugins = initPlugins(host.events(session.appSessionId));
  report(`init plugins: ${JSON.stringify(plugins)}`);
  const after = a15();
  report(`A-15 after: ${after.length} keys, ${JSON.stringify(after) === JSON.stringify(g.a15Before) ? 'identical' : `CHANGED: ${JSON.stringify(after)}`}`);
  expect(ownerPlugins(plugins ?? []), 'the engine loaded none of the owner plugins (no inherited CLAUDE_CODE_PLUGIN_DIRS)').toEqual([]);
  expect(after, 'the A-15 delta: no scratch project in the owner file').toEqual(g.a15Before);
  return { costUsd, exported };
}
