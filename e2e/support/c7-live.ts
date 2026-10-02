// C7's live acceptance support (C7 execution document, M6 and Acceptance item 3): C3's live gate (the pinned binary
// answering its version, ClaudeUsage's relay answering /api/hello), a scratch CLAUDE_CONFIG_DIR (C3's
// `scratchConfigHome`, checked by `assertConfigHomeSafe` before anything spawns) holding every session the run creates
// and resumes, scratch git repositories under /tmp, the sessions themselves (created by the pinned binary through the
// relay: one interactively in a PTY so the terminal writes its `history.jsonl` into the scratch home, the rest with
// `-p`), the launch the Diagnostics launcher would make (`resumeSpec`, spread from `launchDefaults`), and journal
// readers over `status.journalPath`. Never the owner's `~/.claude` or `~/.claude.json`.
import { hasCompletedReply, waitForSeedTranscript } from '../../test/support/live-seed';
import { relaySkipReason } from '../../test/support/relay-health';
import { isolatedGitEnv } from '../../test/support/git-env';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import type { JournalRow } from '@shared/wire/journal';
import { GATEWAY_AUTH_TOKEN, RELAY_URL } from '../../src/engine-host/launch';
import { ENGINE_BIN, ENGINE_VERSION } from '../../test/support/engine-pin'; // W13: the fixtures' engine
import { resumeSpec, type ResumeFields } from '../../src/renderer/src/composer/dev/resume-spec';
import { assertConfigHomeSafe, scratchConfigHome } from '../../test/live/support/live';
import { invoke, value } from './c7-replay';
import { REPO_ROOT } from './launch';

export const LIVE = process.env.MAWS_C7_LIVE === '1';

// C3's gate, as `liveGate` checks it: null when the live run may go, else why it skips.
export function liveSkipReason(): string | null {
  if (!LIVE) return 'the C7 live acceptance runs only under MAWS_C7_LIVE=1';
  if (!existsSync(ENGINE_BIN)) return `engine binary missing at ${ENGINE_BIN}`;
  const version = execFileSync(ENGINE_BIN, ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim();
  if (!version.startsWith(ENGINE_VERSION)) return `engine reports ${version}, expected ${ENGINE_VERSION}`;
  return relaySkipReason(RELAY_URL);
}

// The run's scratch: a config home (C3's, with its empty user settings layer) and a root for the repositories under
// /tmp. MAWS_C7_LIVE_SCRATCH names an earlier run's root to reuse its home and sessions.
export interface LiveScratch {
  root: string;
  config: string;
}
export function liveScratch(): LiveScratch {
  const reuse = process.env.MAWS_C7_LIVE_SCRATCH;
  if (reuse) return { root: reuse, config: join(reuse, 'claude-config') };
  const root = realpathSync(mkdtempSync('/tmp/maws-c7-live-'));
  const home = scratchConfigHome();
  const config = join(root, 'claude-config');
  execFileSync('/bin/mv', [home, config]);
  // Every control this run issues persists into this home, never the owner's (C3's config-home rule).
  assertConfigHomeSafe({ configHome: config, controls: ['grant:local_settings', 'memory:user'] });
  return { root, config };
}

// The engine's environment for the sessions the run creates: the relay, its marker token, the owner's model aliases,
// the scratch home; nothing of the shell this runs in (a parent Claude session's variables included).
function engineEnv(config: string): Record<string, string> {
  const env: Record<string, string> = { TERM: 'xterm-256color', LANG: process.env.LANG ?? 'en_US.UTF-8' };
  for (const key of ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR']) if (process.env[key]) env[key] = process.env[key]!;
  for (const [key, v] of Object.entries(process.env)) if (key.startsWith('ANTHROPIC_DEFAULT_') && v) env[key] = v;
  return { ...env, CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: RELAY_URL, ANTHROPIC_AUTH_TOKEN: GATEWAY_AUTH_TOKEN, CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' };
}

function scratchRepo(root: string, name: string): string {
  const dir = join(root, name);
  if (existsSync(dir)) return dir;
  mkdirSync(dir);
  writeFileSync(join(dir, 'one.txt'), 'ONE\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=Live', '-c', 'user.email=live@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('add', 'one.txt');
  git('commit', '-qm', 'seed');
  return dir;
}

export interface ScratchSession {
  name: string;
  cwd: string;
  sessionId: string;
  costUsd: number | null; // what creating it cost (`-p` reports it; the PTY run does not)
  how: string;
}

const sessionsFile = (s: LiveScratch) => join(s.root, 'sessions.json');
const known = (s: LiveScratch): Record<string, ScratchSession> => (existsSync(sessionsFile(s)) ? JSON.parse(readFileSync(sessionsFile(s), 'utf8')) : {});
function remember(s: LiveScratch, session: ScratchSession): ScratchSession {
  writeFileSync(sessionsFile(s), JSON.stringify({ ...known(s), [session.name]: session }, null, 2));
  return session;
}

// A session created with `claude -p` in a scratch repository (one exchange), or the one named `name` already.
export function printSession(s: LiveScratch, name: string, repo: string): ScratchSession {
  const prior = known(s)[name];
  if (prior) return prior;
  const cwd = scratchRepo(s.root, repo);
  const out = execFileSync(ENGINE_BIN, ['-p', `Reply with exactly: ${name.toUpperCase()} READY`, '--model', 'sonnet', '--max-budget-usd', '0.5', '--output-format', 'json'], {
    cwd,
    env: engineEnv(s.config),
    encoding: 'utf8',
    timeout: 180_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const r = JSON.parse(out) as { session_id: string; total_cost_usd: number };
  return remember(s, { name, cwd, sessionId: r.session_id, costUsd: r.total_cost_usd, how: 'claude -p' });
}

// eslint-disable-next-line no-control-regex -- the terminal's escape sequences are what this strips
const ANSI = /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g;

// A session created interactively (`claude`, one exchange, `/exit`) in a PTY, so the terminal writes the prompt to the
// scratch home's `history.jsonl` as the owner's terminal would. Onboarding and the folder trust dialog are answered in
// the scratch home's `.claude.json` first.
export async function terminalSession(s: LiveScratch, name: string, repo: string, prompt: string, marker: string): Promise<ScratchSession> {
  const prior = known(s)[name];
  if (prior) {
    const transcript = join(s.config, 'projects', prior.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${prior.sessionId}.jsonl`);
    if (!existsSync(transcript) || !hasCompletedReply(readFileSync(transcript, 'utf8'), prompt, marker)) throw new Error(`saved seed ${name} has no completed assistant turn`);
    return prior;
  }
  const cwd = scratchRepo(s.root, repo);
  const dir = join(s.config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  const existing = new Set(existsSync(dir) ? readdirSync(dir) : []);
  let sessionId: string;
  const claudeJson = join(s.config, '.claude.json');
  const state = (existsSync(claudeJson) ? JSON.parse(readFileSync(claudeJson, 'utf8')) : {}) as Record<string, unknown> & { projects?: Record<string, unknown> };
  writeFileSync(claudeJson, JSON.stringify({ ...state, hasCompletedOnboarding: true, theme: 'light', projects: { ...state.projects, [cwd]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2));
  const pty = createRequire(join(REPO_ROOT, 'package.json'))('node-pty') as typeof import('node-pty');
  const term = pty.spawn(ENGINE_BIN, ['--model', 'sonnet', '--max-budget-usd', '0.5'], { name: 'xterm-256color', cols: 120, rows: 40, cwd, env: engineEnv(s.config) });
  let screen = '';
  term.onData((d) => (screen += d));
  const exited = new Promise<void>((resolve) => term.onExit(() => resolve()));
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (re: RegExp, ms: number, what: string) => {
    for (const until = Date.now() + ms; Date.now() < until; await pause(250)) if (re.test(screen.replace(ANSI, ''))) return;
    throw new Error(`the terminal never showed ${what}:\n${screen.replace(ANSI, '').slice(-2000)}`);
  };
  try {
    await waitFor(/for shortcuts|❯/, 60_000, 'its prompt');
    await pause(1_500);
    term.write(prompt);
    await pause(500);
    term.write('\r');
    sessionId = await waitForSeedTranscript(dir, existing, prompt, marker);
    term.write('/exit');
    await pause(500);
    term.write('\r');
    await Promise.race([exited, pause(15_000)]);
  } finally {
    term.kill();
    writeFileSync(join(s.root, `${name}.terminal.txt`), screen.replace(ANSI, ''));
  }
  return remember(s, { name, cwd, sessionId, costUsd: null, how: 'claude (interactive, in a PTY)' });
}

// The record C4 discovered for an engine session in the scratch home.
export async function recordOf(page: Page, sessionId: string): Promise<SessionRecord> {
  let found: SessionRecord | undefined;
  await expect
    .poll(
      async () => {
        found = value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sessionId);
        return found !== undefined;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found!;
}

// The launch the Diagnostics launcher makes for a record (`resumeSpec`), on Sonnet with Sonnet subagents: the live
// budget is a Sonnet one, and the owner's shell exports CLAUDE_CODE_SUBAGENT_MODEL=opus.
export function liveResumeSpec(record: SessionRecord, fields: Partial<ResumeFields> = {}): LaunchSpec {
  const spec = resumeSpec(record as Parameters<typeof resumeSpec>[0], { direct: false, permissionMode: null, extraSettings: null, ...fields });
  return { ...spec, model: 'sonnet', subagentModel: 'sonnet' };
}

export async function resumeLive(page: Page, record: SessionRecord, fields: Partial<ResumeFields> = {}): Promise<EngineSessionStatus> {
  const launched = value(await invoke(page, 'session.launch', { spec: liveResumeSpec(record, fields) }));
  expect(launched, JSON.stringify(launched)).toMatchObject({ status: 'launching' });
  await expect.poll(async () => (await statusOf(page, record.appId)).process, { timeout: 60_000 }).toBe('ready');
  return statusOf(page, record.appId);
}

export const statusOf = async (page: Page, appSessionId: string) => value(await invoke(page, 'session.status', { appSessionId: appSessionId as never }));

export function journal(path: string): JournalRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JournalRow);
}

type Frame = Record<string, unknown> & { type?: string; subtype?: string; message?: { content?: unknown }; request?: { subtype?: string } };
export const framesOf = (rows: JournalRow[], direction: 'in' | 'out') => rows.filter((r) => r.direction === direction).map((r) => ({ seq: r.seq, frame: r.frame as Frame }));
export const userWrites = (rows: JournalRow[]) => framesOf(rows, 'out').filter((f) => f.frame.type === 'user');
export const mainResults = (rows: JournalRow[]) => framesOf(rows, 'in').filter((f) => f.frame.type === 'result' && (f.frame.parent_tool_use_id ?? null) === null);

// What a journal's process cost: the engine's cumulative `total_cost_usd`, its largest main-lane figure.
export function processCost(rows: JournalRow[]): number {
  return Math.max(0, ...mainResults(rows).map((r) => (typeof r.frame.total_cost_usd === 'number' ? r.frame.total_cost_usd : 0)));
}
