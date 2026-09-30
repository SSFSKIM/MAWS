// C12's §10 pre-run support (C12 execution document, M6 and Concrete Steps "M6"): the gate (C3's, with
// MAWS_C12_PRERUN=1), the scratch the shell exported (a `CLAUDE_CONFIG_DIR` with `{}` settings and a `MAWS_USER_DATA`,
// both under one /private/tmp/maws-c12-prerun-* root; the real-store case names its own `userData-real` there), the
// run's record (`<root>/prerun-run.json`, copied into the evidence pack after each test), the screenshots in both
// themes, the pinned engine run as a terminal would run it (`claude -p`, and interactively in a PTY that can stay live),
// and spend from every journal and every terminal run. Never the owner's ~/.claude or ~/.claude.json, which are only
// read by the owner-file check (and, for the real-store case alone, by the app itself, read only).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { captureShellEnvironment } from '@shared/host/shell-env';
import type { JournalRow } from '@shared/wire/journal';
import { ENGINE_BIN, ENGINE_VERSION, GATEWAY_AUTH_TOKEN, RELAY_URL } from '../../src/engine-host/launch';
import { assertConfigHomeSafe, journalCost } from '../../test/live/support/live';
import { invoke, value } from './c7-replay';
import { REPO_ROOT } from './launch';

const SCRATCH_PREFIX = '/private/tmp/maws-c12-prerun-';
export const EVIDENCE = join(REPO_ROOT, 'docs/doperpowers/evidence/c12');
export const EVIDENCE_REL = 'docs/doperpowers/evidence/c12';
export const THEMES = ['light', 'dark'] as const;

export function prerunSkipReason(): string | null {
  if (process.env.MAWS_C12_PRERUN !== '1') return 'the C12 pre-run goes only under MAWS_C12_PRERUN=1';
  if (!existsSync(ENGINE_BIN)) return `engine binary missing at ${ENGINE_BIN}`;
  const version = execFileSync(ENGINE_BIN, ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim();
  if (!version.startsWith(ENGINE_VERSION)) return `engine reports ${version}, expected ${ENGINE_VERSION}`;
  const code = execFileSync('/usr/bin/curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${RELAY_URL}/api/hello`], { encoding: 'utf8' }).trim();
  return code === '200' ? null : `relay at ${RELAY_URL} answered ${code}: start ClaudeUsage`;
}

export interface PrerunScratch {
  root: string; // /private/tmp/maws-c12-prerun-<stamp>
  config: string; // the exported CLAUDE_CONFIG_DIR
  userData: string; // the exported MAWS_USER_DATA
}

// The exported scratch, refused unless both variables name directories directly under one
// /private/tmp/maws-c12-prerun-* root and the config home's user settings are `{}`.
export function prerunScratch(): PrerunScratch {
  const config = process.env.CLAUDE_CONFIG_DIR;
  const userData = process.env.MAWS_USER_DATA;
  if (!config || !userData) throw new Error('export CLAUDE_CONFIG_DIR and MAWS_USER_DATA under /private/tmp/maws-c12-prerun-* first (Concrete Steps, "M6")');
  const root = dirname(realpathSync(config));
  if (!root.startsWith(SCRATCH_PREFIX) || dirname(realpathSync(userData)) !== root) throw new Error(`the scratch must be one ${SCRATCH_PREFIX}* root: CLAUDE_CONFIG_DIR=${config}, MAWS_USER_DATA=${userData}`);
  const settings = join(config, 'settings.json');
  if (!existsSync(settings) || JSON.stringify(JSON.parse(readFileSync(settings, 'utf8'))) !== '{}') throw new Error(`${settings} must hold {}`);
  assertConfigHomeSafe({ configHome: config, controls: ['launch:trust', 'memory:user', 'grant:local_settings'] });
  return { root, config, userData: realpathSync(userData) };
}

// ---- the run's record ------------------------------------------------------------------------------------------------

// One JSON file under the scratch root, merged per key, so tests that run separately (one `-g` at a time) add to the
// same record; `publish` copies it into the evidence pack.
export function recorder(root: string, file = 'prerun-run.json') {
  const path = join(root, file);
  const read = (): Record<string, unknown> => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {});
  return {
    read,
    note(key: string, v: unknown): void {
      const run = read();
      run[key] = v;
      writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`);
      console.log(`[c12-prerun] ${key} ${JSON.stringify(v).slice(0, 400)}`);
    },
    publish(): void {
      mkdirSync(EVIDENCE, { recursive: true });
      if (existsSync(path)) copyFileSync(path, join(EVIDENCE, file));
    },
  };
}

// Shared ids between tests (sessions made in one item and used by a later one): `<root>/prerun-state.json`.
export function stateOf(root: string) {
  const path = join(root, 'prerun-state.json');
  const read = (): Record<string, string> => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>) : {});
  return {
    get: (key: string): string | undefined => read()[key],
    set: (key: string, v: string): void => writeFileSync(path, `${JSON.stringify({ ...read(), [key]: v }, null, 2)}\n`),
  };
}

// The page in each theme: `prerun-<item>-<surface>-<theme>.png` in the pack (or `dir` when given, for the real-store
// shot, which shows the owner's titles and stays outside the repository), then back to light.
export async function shoot(page: Page, name: string, dir: string = EVIDENCE): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const theme of THEMES) {
    value(await invoke(page, 'settings.set', { theme }));
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.waitForTimeout(300); // one paint after the tokens swap
    const file = `prerun-${name}-${theme}.png`;
    await page.screenshot({ path: join(dir, file) });
    files.push(dir === EVIDENCE ? `${EVIDENCE_REL}/${file}` : join(dir, file));
  }
  value(await invoke(page, 'settings.set', { theme: 'light' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  return files;
}

// ---- the owner's files -----------------------------------------------------------------------------------------------

// The owner-file check of the standing rules, verbatim, for the root as given and as /tmp names it.
export function ownerFileCheck(root: string): string[] {
  const script = "import json,sys;p=json.load(open('/Users/new/.claude.json'))['projects'];print(json.dumps([k for k in p if k.startswith(sys.argv[1])]))";
  const found: string[] = [];
  for (const prefix of [root, root.replace(/^\/private\/tmp\//, '/tmp/')]) found.push(...(JSON.parse(execFileSync('/usr/bin/python3', ['-c', script, prefix], { encoding: 'utf8' })) as string[]));
  return found;
}

export const lsPin = (): string => execFileSync('/bin/ls', ['-l', ENGINE_BIN], { encoding: 'utf8' }).trim().replace(process.env.HOME ?? '/Users/new', '~');

// ---- scratch repositories --------------------------------------------------------------------------------------------

const gitIn = (dir: string, ...args: string[]) =>
  execFileSync('/usr/bin/git', ['-c', 'user.name=C12', '-c', 'user.email=c12@localhost', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' }).trim();
export const git = gitIn;

// A repository under the scratch root with the given files committed on `main` (made once; a rerun keeps it).
export function scratchRepo(root: string, name: string, files: Record<string, string> = { 'one.txt': 'ONE\n' }): string {
  const dir = join(root, 'repos', name);
  if (existsSync(dir)) return dir;
  mkdirSync(dir, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  gitIn(dir, 'init', '-q', '-b', 'main');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'C12 pre-run seed');
  return dir;
}

// ---- the engine as a terminal runs it ----------------------------------------------------------------------------------

// The owner's login-shell environment, as a terminal opened now would have it (the capture MAWS itself makes for its
// launches, `captureShellEnvironment`), taken once in `beforeAll`; without it only the base variables below.
let loginShell: Record<string, string> = {};
export async function captureLoginShell(): Promise<string[]> {
  loginShell = await captureShellEnvironment();
  return Object.keys(loginShell).filter((k) => k.startsWith('CLAUDE_')).sort();
}

// The terminal's environment for the pinned engine: the owner's login shell (so the owner's `CLAUDE_*` switches apply
// as they do in the owner's terminal) without anything a parent Claude or Electron process injects, then the scratch
// home, the relay and its marker token, and Haiku for subagents (spend).
export function terminalEnv(config: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { TERM: 'xterm-256color', LANG: process.env.LANG ?? 'en_US.UTF-8' };
  for (const key of ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR']) if (process.env[key]) env[key] = process.env[key]!;
  for (const [key, v] of Object.entries(process.env)) if (key.startsWith('ANTHROPIC_DEFAULT_') && v) env[key] = v;
  const injected = /^(CLAUDECODE|CLAUDE_CODE_(SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_SOCKET|MESSAGING_TOKEN|EXECPATH|ENTRYPOINT|SSE_PORT)|CLAUDE_PID|CLAUDE_EFFORT|ELECTRON_.*|NODE_OPTIONS|GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE)$/;
  for (const [key, v] of Object.entries(loginShell)) if (!injected.test(key)) env[key] = v;
  env.TERM = 'xterm-256color';
  return { ...env, CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: RELAY_URL, ANTHROPIC_AUTH_TOKEN: GATEWAY_AUTH_TOKEN, CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', ...extra };
}

// Marks a folder trusted and onboarding done in the scratch home's `.claude.json`, as a terminal's first-run dialogs
// would (so an interactive run goes straight to its prompt).
export function trustInScratch(config: string, cwd: string): void {
  const claudeJson = join(config, '.claude.json');
  const state = (existsSync(claudeJson) ? JSON.parse(readFileSync(claudeJson, 'utf8')) : {}) as Record<string, unknown> & { projects?: Record<string, unknown> };
  writeFileSync(claudeJson, JSON.stringify({ ...state, hasCompletedOnboarding: true, theme: 'light', projects: { ...state.projects, [cwd]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2));
}

export interface PrintRun { sessionId: string; costUsd: number; result: string; init: Record<string, unknown> | null }

// One `claude -p` exchange in `cwd`, on the stream-json output so the init frame is kept (the terminal's view of what
// loaded: MCP servers, commands, agents, plugins).
export function printRun(config: string, cwd: string, prompt: string, args: string[] = []): PrintRun {
  const out = execFileSync(ENGINE_BIN, ['-p', prompt, '--model', 'sonnet', '--max-budget-usd', '0.5', '--output-format', 'stream-json', '--verbose', ...args], {
    cwd, env: terminalEnv(config), encoding: 'utf8', timeout: 240_000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
  });
  const frames = out.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const init = frames.find((f) => f.type === 'system' && f.subtype === 'init') ?? null;
  const result = frames.findLast((f) => f.type === 'result') as { session_id: string; total_cost_usd: number; result?: string } | undefined;
  if (!result) throw new Error(`claude -p in ${cwd} gave no result`);
  return { sessionId: result.session_id, costUsd: result.total_cost_usd, result: result.result ?? '', init };
}

// eslint-disable-next-line no-control-regex -- the terminal's escape sequences are what this strips
const ANSI = /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The pinned engine interactively in a PTY (a terminal session), left running until `exit()`: its screen, a prompt
// sender, the session id it writes to the scratch home. `args` may resume (`--resume <id>`).
export interface PtyEngine {
  screen(): string;
  say(text: string): Promise<void>;
  waitFor(re: RegExp, ms: number, what: string): Promise<void>;
  replied(re: RegExp, ms: number): Promise<string>; // an assistant text written since the terminal started that matches
  sessionId(): string;
  exit(): Promise<void>;
  pid: number;
}
export async function ptyEngine(config: string, cwd: string, args: string[], logTo: string): Promise<PtyEngine> {
  trustInScratch(config, cwd);
  const pty = createRequire(join(REPO_ROOT, 'package.json'))('node-pty') as typeof import('node-pty');
  const started = Date.now();
  const term = pty.spawn(ENGINE_BIN, ['--model', 'sonnet', ...args], { name: 'xterm-256color', cols: 120, rows: 40, cwd, env: terminalEnv(config) });
  let raw = '';
  term.onData((d) => (raw += d));
  let alive = true;
  const exited = new Promise<void>((resolve) => term.onExit(() => ((alive = false), resolve())));
  const screen = () => raw.replace(ANSI, '');
  const waitFor = async (re: RegExp, ms: number, what: string) => {
    for (const until = Date.now() + ms; Date.now() < until; await pause(250)) if (re.test(screen())) return;
    writeFileSync(logTo, screen());
    throw new Error(`the terminal never showed ${what}:\n${screen().slice(-1500)}`);
  };
  // The caller holds no handle until this returns, so a failure before then ends the engine here.
  try {
    await waitFor(/for shortcuts|❯/, 60_000, 'its prompt');
    await pause(1_500);
  } catch (error) {
    term.kill();
    await Promise.race([exited, pause(5_000)]);
    throw error;
  }
  const projectDir = join(config, 'projects', realpathSync(cwd).replace(/[^a-zA-Z0-9]/g, '-'));
  const sessionId = (): string => {
    const resumed = args.indexOf('--resume');
    if (resumed >= 0) return args[resumed + 1]!;
    const newest = readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl') && statSync(join(projectDir, f)).mtimeMs >= started - 1_000)
      .sort((a, b) => statSync(join(projectDir, b)).mtimeMs - statSync(join(projectDir, a)).mtimeMs)[0];
    if (!newest) throw new Error(`no transcript under ${projectDir} since the terminal started`);
    return basename(newest, '.jsonl');
  };

  return {
    pid: term.pid,
    screen,
    waitFor,
    async say(text) {
      term.write(text);
      await pause(500);
      term.write('\r');
    },
    async replied(re, ms) {
      for (const until = Date.now() + ms; Date.now() < until; await pause(500)) {
        let id: string;
        try {
          id = sessionId();
        } catch {
          continue;
        }
        const file = join(projectDir, `${id}.jsonl`);
        if (!existsSync(file)) continue;
        for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
          const r = JSON.parse(line) as { type?: string; timestamp?: string; message?: { content?: unknown } };
          if (r.type !== 'assistant' || !r.timestamp || Date.parse(r.timestamp) < started - 1_000 || !Array.isArray(r.message?.content)) continue;
          const text = (r.message.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
          if (re.test(text)) return text;
        }
      }
      writeFileSync(logTo, screen());
      throw new Error(`the terminal's transcript never held a reply matching ${re}:\n${screen().slice(-1500)}`);
    },
    sessionId,
    async exit() {
      if (alive) {
        term.write('/exit');
        await pause(500);
        term.write('\r');
        await Promise.race([exited, pause(15_000)]);
      }
      if (alive) term.kill();
      writeFileSync(logTo, screen());
    },
  };
}

// ---- spend -------------------------------------------------------------------------------------------------------------

// An estimate of what an interactive terminal's turns cost, which no journal records: every assistant message written
// to its transcript since `sinceMs`, once per API message, priced as Sonnet (US$ per million tokens: 3 input, 15 output,
// 3.75 cache write, 0.30 cache read). An estimate, recorded as one.
export function transcriptUsdEstimate(file: string, sinceMs: number): number {
  if (!existsSync(file)) return 0;
  const seen = new Map<string, { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }>();
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line) as { type?: string; timestamp?: string; message?: { id?: string; usage?: Record<string, number> } };
    if (r.type !== 'assistant' || !r.timestamp || Date.parse(r.timestamp) < sinceMs || !r.message?.id || !r.message.usage) continue;
    seen.set(r.message.id, r.message.usage);
  }
  let usd = 0;
  for (const u of seen.values()) usd += ((u.input_tokens ?? 0) * 3 + (u.output_tokens ?? 0) * 15 + (u.cache_creation_input_tokens ?? 0) * 3.75 + (u.cache_read_input_tokens ?? 0) * 0.3) / 1e6;
  return Number(usd.toFixed(4));
}

export const transcriptFile = (config: string, cwd: string, sessionId: string): string => join(config, 'projects', realpathSync(cwd).replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);

// What the run spent: every journal under the profile (each process's cost, `/clear` segments summed) plus the
// terminal runs the tests recorded under `terminalUsd` (a `-p` run reports its cost; a PTY run's cost is read from the
// relay's usage by the owner, and here counted from its `--resume` journal only when MAWS later runs it).
export function journalSpend(userData: string): { usd: number; journals: number } {
  const dir = join(userData, 'engine-host', 'journal');
  let usd = 0;
  let journals = 0;
  if (existsSync(dir)) {
    for (const id of readdirSync(dir)) {
      for (const file of readdirSync(join(dir, id)).filter((f) => f.endsWith('.jsonl'))) {
        const rows = readFileSync(join(dir, id, file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalRow);
        usd += journalCost(rows).costUsd;
        journals += 1;
      }
    }
  }
  return { usd: Number(usd.toFixed(4)), journals };
}
