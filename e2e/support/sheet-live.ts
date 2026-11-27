// The question sheet's live check (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md, M6 and S17): a real
// terminal session, a real model and the real `sminos`, set up as C2's own live check sets its sessions up
// (doperpowers' sminos/tests/mods/live-sheet-check.py): one scratch root whose HOME holds the engine's config directory,
// one scratch sminos home, a scratch project, C2's stand-in surface, and the terminal's `claude` in a tmux server of
// this run's own, loading the doperpowers checkout's plugin with function hooks and the sheet's setting on. The app the
// rig starts shares the config directory and the sminos home, so it sees the terminal's session and its record.
// Nothing here names a machine, an account or a home: every location comes from the run's environment (`liveConfig`).
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { request } from 'node:http';
import { hostname, userInfo } from 'node:os';
import { delimiter, dirname, join, resolve, sep } from 'node:path';
import { remainingNames, scrubTranscript, type ScrubNames } from '../../test/support/transcript-scrub';
import { REPO_ROOT } from './launch';

export const SHEET_TOOL = 'mcp__sminos__AskUserQuestion';

/** What the run is given: the doperpowers checkout, where its pictures and logs go, the terminal's engine and model. */
export interface LiveConfig {
  doperpowers: string; // SHEET_LIVE_DOPERPOWERS: a checkout at C2's merge (its sminos plugin, its command, its stand-in)
  out: string; // SHEET_LIVE_OUT: a directory outside the repository for the pictures, panes, records and the transcript
  claude: string; // SHEET_LIVE_CLAUDE, else `claude` on PATH: the terminal's engine
  model: string; // SHEET_LIVE_MODEL, else haiku (C2's live check's)
  gateway: Record<string, string>; // the model gateway's variables of the run's environment, for the terminal alone
  keep: boolean; // SHEET_LIVE_KEEP=1: the scratch root is left in place (the env file removed)
}

// C2's live check's GATEWAY_KEYS and BASE_KEYS (live-bridge-check.py): what of the caller's environment the terminal gets.
const GATEWAY_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'] as const;
const BASE_KEYS = ['PATH', 'LANG', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR'] as const;

export function liveConfig(env: NodeJS.ProcessEnv = process.env): LiveConfig {
  const need = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`the sheet's live check needs ${name} (the rig's header says what each variable names)`);
    return value;
  };
  const doperpowers = need('SHEET_LIVE_DOPERPOWERS');
  for (const part of ['sminos/bin/sminos', 'sminos/tests/sheet_surface.py', 'sminos/.claude-plugin']) {
    if (!existsSync(join(doperpowers, part))) throw new Error(`SHEET_LIVE_DOPERPOWERS has no ${part}: not a doperpowers checkout with the sheet`);
  }
  const claude = env.SHEET_LIVE_CLAUDE ?? onPath('claude', env.PATH ?? '');
  if (claude === null) throw new Error('no `claude` on PATH: name the terminal’s engine in SHEET_LIVE_CLAUDE');
  const gateway = Object.fromEntries(GATEWAY_KEYS.flatMap((key) => (env[key] ? [[key, env[key]!]] : [])));
  return { doperpowers, out: freshOutside(need('SHEET_LIVE_OUT'), REPO_ROOT), claude, model: env.SHEET_LIVE_MODEL ?? 'haiku', gateway, keep: env.SHEET_LIVE_KEEP === '1' };
}

/**
 * SHEET_LIVE_OUT as an absolute path that does not exist yet and lies outside the checkout: a run never mixes its evidence
 * with an earlier run's, and never writes a transcript into the tree.
 */
export function freshOutside(out: string, checkout: string): string {
  const path = resolve(out);
  if (existsSync(path)) throw new Error(`SHEET_LIVE_OUT must name a directory that does not exist yet (${path} does): one run’s evidence each`);
  const real = (p: string): string => (existsSync(p) ? realpathSync(p) : join(real(dirname(p)), p.slice(dirname(p).length + 1)));
  const tree = realpathSync(checkout) + sep;
  if ((real(path) + sep).startsWith(tree)) throw new Error(`SHEET_LIVE_OUT must lie outside the checkout (${path} is inside ${tree})`);
  return path;
}

function onPath(name: string, path: string): string | null {
  for (const dir of path.split(delimiter)) if (dir && existsSync(join(dir, name))) return join(dir, name);
  return null;
}

/** The run's scratch: HOME (whose .claude is the config directory), the sminos home, the project, the terminal's env file. */
export interface Scratch {
  root: string;
  home: string;
  config: string;
  sminosHome: string;
  work: string;
  envFile: string;
  sminos: string; // the checkout's command, as the app's MAWS_SMINOS_CLI names it
  plugin: string; // the checkout's plugin directory, as the terminal's --plugin-dir names it
}

/** README.md of the scratch project: the file the agent's second question references. */
export const README = ['# Harbour timetable', '', 'Imports the ferry timetable and prints the week’s sailings.', '', 'The importer reads one CSV per route.', ''].join('\n');

/**
 * The run's scratch root: short, under /tmp, as C2's (a bridge's socket path under the sminos home must fit 103 bytes);
 * by its real path, the one the engine runs in (macOS's /tmp is a link) and so the one its trust and its transcript's
 * folder are keyed by. Made apart from its contents, so its removal is registered before anything is written in it.
 */
export function scratchRoot(): string {
  return realpathSync(mkdtempSync('/tmp/qsl.'));
}

export function writeScratch(cfg: LiveConfig, root: string): Scratch {
  const home = join(root, 'home');
  const config = join(home, '.claude');
  const sminosHome = join(root, 's');
  const work = join(root, 'work');
  const sminos = join(cfg.doperpowers, 'sminos/bin/sminos');
  mkdirSync(config, { recursive: true });
  mkdirSync(sminosHome, { mode: 0o700 });
  mkdirSync(work);
  writeFileSync(join(work, 'README.md'), README);
  writeFileSync(join(work, 'routes.csv'), 'route,from,to\nR1,North Quay,Isle Pier\n');
  const trusted = { hasTrustDialogAccepted: true };
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { [work]: trusted } }));
  // the sheet's tool and the reads and listings a "keep working" turn makes run without a prompt, so nothing but the
  // sheet's questions waits on the person while the steps run
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ permissions: { allow: [SHEET_TOOL, 'Bash(ls:*)', 'Read', 'Glob', 'Grep', 'LS'] } }));
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', work]);
  const scratch: Scratch = { root, home, config, sminosHome, work, envFile: join(root, 'env'), sminos, plugin: join(cfg.doperpowers, 'sminos') };
  const env: Record<string, string> = {
    ...Object.fromEntries(BASE_KEYS.flatMap((key) => (process.env[key] ? [[key, process.env[key]!]] : []))),
    ...cfg.gateway,
    PATH: [dirname(cfg.claude), process.env.PATH ?? '/usr/bin:/bin'].join(delimiter),
    TERM: 'xterm-256color',
    HOME: home,
    CLAUDE_CONFIG_DIR: config,
    SMINOS_HOME: sminosHome,
    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1',
    SMINOS_QUESTION_SHEET: '1',
    DISABLE_AUTOUPDATER: '1',
  };
  const fd = openSync(scratch.envFile, 'wx', 0o600);
  writeSync(fd, Object.entries(env).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `export ${k}=${quote(v)}\n`).join(''));
  closeSync(fd);
  const init = sminosRun(scratch, ['project', 'init', '--name', 'qslive'], { cwd: work });
  if (init.status !== 0) throw new Error(`sminos project init failed: ${init.stderr}`);
  return scratch;
}

/** The environment the run's own `sminos` calls get: the scratch homes over the runner's PATH. */
export function sminosEnv(s: Scratch): Record<string, string> {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: s.home, CLAUDE_CONFIG_DIR: s.config, SMINOS_HOME: s.sminosHome, LANG: process.env.LANG ?? 'en_US.UTF-8' };
}

function sminosRun(s: Scratch, args: string[], opts: { cwd?: string; input?: string } = {}) {
  return spawnSync(s.sminos, args, { cwd: opts.cwd ?? s.work, env: sminosEnv(s), input: opts.input, encoding: 'utf8', timeout: 60_000 });
}

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

// ---- the stand-in surface (C2's sminos/tests/sheet_surface.py) --------------------------------------------------------
/** C2's stand-in surface, heartbeating every 2 s under the scratch sminos home, as C2's live check runs it; not yet registered. */
export function spawnSurface(cfg: LiveConfig, s: Scratch): ChildProcess {
  return spawn('python3', ['-B', join(cfg.doperpowers, 'sminos/tests/sheet_surface.py'), '--every', '2'], { env: sminosEnv(s), stdio: 'ignore' });
}

/** The stand-in's registration written. */
export async function surfaceRegistered(s: Scratch): Promise<void> {
  await until('the stand-in surface’s registration', 10_000, () => existsSync(join(s.sminosHome, 'sheet', 'surfaces', 'standin.json')));
}

export async function stopSurface(surface: ChildProcess): Promise<void> {
  if (surface.exitCode !== null || surface.signalCode !== null) return;
  const exit = new Promise<void>((resolve) => surface.once('exit', () => resolve()));
  surface.kill('SIGTERM');
  await exit;
}

// ---- the terminal ----------------------------------------------------------------------------------------------------
/** The terminal sessions of this run, in a tmux server of its own, each started from the env file alone (`env -i`). */
export class Terminals {
  private readonly tmux: string[];
  constructor(private readonly cfg: LiveConfig, private readonly s: Scratch) {
    this.tmux = ['-L', `qsl-${process.pid}`, '-f', '/dev/null'];
  }

  /** A pane running `claude` in the project with the checkout's plugin; its session id once its bridge answers. */
  async open(name: string, args: string[] = []): Promise<{ sid: string; pid: number }> {
    const known = new Set(presences(this.s).map((p) => p.pid));
    const inner = `set -e; . ${quote(this.s.envFile)}; cd ${quote(this.s.work)}; exec ${quote(this.cfg.claude)} --plugin-dir ${quote(this.s.plugin)} --model ${quote(this.cfg.model)} --permission-mode default ${args.map(quote).join(' ')}`;
    this.run(['new-session', '-d', '-s', name, '-x', '200', '-y', '50', `env -i /bin/bash --noprofile --norc -c ${quote(inner)}`]);
    const { pid, sid } = await until(`${name}'s session`, 90_000, () => presences(this.s).find((p) => !known.has(p.pid)) ?? null, () => this.pane(name));
    await until(`${name}'s bridge`, 60_000, () => ping(this.s, sid), () => this.pane(name));
    return { sid, pid };
  }

  /** Text typed into the pane and sent, as a person types a prompt. */
  async say(name: string, text: string): Promise<void> {
    this.run(['send-keys', '-t', name, '-l', text]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    this.run(['send-keys', '-t', name, 'Enter']);
  }

  pane(name: string): string {
    return spawnSync('tmux', [...this.tmux, 'capture-pane', '-p', '-t', name], { encoding: 'utf8' }).stdout ?? '';
  }

  close(name: string): void {
    spawnSync('tmux', [...this.tmux, 'kill-session', '-t', name]);
  }

  /** Every pane and the server itself. */
  closeAll(): void {
    spawnSync('tmux', [...this.tmux, 'kill-server']);
  }

  private run(args: string[]): void {
    execFileSync('tmux', [...this.tmux, ...args]);
  }
}

/** (pid, session id) of each live process's presence record in the config directory, as the engine writes it. */
export function presences(s: Scratch): { pid: number; sid: string }[] {
  const dir = join(s.config, 'sessions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    try {
      const rec = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { pid?: number; sessionId?: string };
      return rec.pid && rec.sessionId && alive(rec.pid) ? [{ pid: rec.pid, sid: rec.sessionId }] : [];
    } catch {
      return [];
    }
  });
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The bridge's ping (C2's live check's): its state, or null while no bridge answers for the session. */
export function ping(s: Scratch, sid: string): Promise<{ mainTurn: unknown } | null> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ op: 'ping' });
    const req = request({ socketPath: join(s.sminosHome, 'bridge', `${sid}.sock`), method: 'POST', path: '/command?wait=8000', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 15_000 }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => {
        try {
          const answer = JSON.parse(text) as { ok?: boolean; result?: { state?: { mainTurn: unknown } } };
          resolve(res.statusCode === 200 && answer.ok && answer.result?.state ? answer.result.state : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => req.destroy());
    req.end(body);
  });
}

/** The session idle for two seconds running: no main turn, by its bridge. */
export async function idle(s: Scratch, sid: string, ms = 240_000): Promise<void> {
  let calm: number | null = null;
  await until('the session idle', ms, async () => {
    const state = await ping(s, sid);
    if (state === null || state.mainTurn !== null) {
      calm = null;
      return false;
    }
    calm ??= Date.now();
    return Date.now() - calm >= 2_000;
  });
}

// ---- the record (the session's sheet directory) -----------------------------------------------------------------------
export interface RecordState {
  questions: { id: string; revision: number; callId?: string; question: string; header?: string; options?: { label: string }[]; references?: { path: string }[] }[];
  pending: { key: string; id: string }[];
  closed: Record<string, { how: string; key?: string; receipt?: string; deliveredAt?: string }>;
  verdicts: Record<string, { verdict: string; how?: string; id?: string }>;
  inbox: { offset: number };
}
export const recordDir = (s: Scratch, sid: string) => join(s.sminosHome, 'sheet', sid);
export const hasRecord = (s: Scratch, sid: string) => existsSync(join(recordDir(s, sid), 'state.json'));
export const recordState = (s: Scratch, sid: string): RecordState => JSON.parse(readFileSync(join(recordDir(s, sid), 'state.json'), 'utf8')) as RecordState;
export function inboxLines(s: Scratch, sid: string): Record<string, unknown>[] {
  const file = join(recordDir(s, sid), 'inbox.jsonl');
  if (!existsSync(file)) return [];
  // below the committed offset the door may have padded a cut inbox: those bytes are never lines (C2 as built)
  return readFileSync(file, 'utf8').split('\n').flatMap((line) => {
    try {
      return line.trim() === '' ? [] : [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}
/** `sminos sheet show --session <sid> --json`: the model, as the real command computes it. */
export function show(s: Scratch, sid: string): { open: { id: string }[]; pending: { key: string; id: string }[]; closed: Record<string, { how: string }>; sent: { key: string; state: string }[] } {
  const r = sminosRun(s, ['sheet', 'show', '--session', sid, '--json']);
  if (r.status !== 0) throw new Error(`sheet show exited ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout) as ReturnType<typeof show>;
}

/** The record as it stands, kept under `dir`: state.json, inbox.jsonl and `show --json`. */
export function keepRecord(s: Scratch, sid: string, dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const name of ['state.json', 'inbox.jsonl']) if (existsSync(join(recordDir(s, sid), name))) copyFileSync(join(recordDir(s, sid), name), join(dir, name));
  const r = sminosRun(s, ['sheet', 'show', '--session', sid, '--json']);
  writeFileSync(join(dir, 'show.json'), r.status === 0 ? r.stdout : `exit ${r.status}: ${r.stderr}`);
}

// ---- the transcript -------------------------------------------------------------------------------------------------
export type TranscriptRow = { type?: string; uuid?: string; parentUuid?: string | null; promptSource?: string; origin?: unknown; attachment?: { type?: string; hookName?: string; content?: unknown }; message?: { role?: string; content?: unknown } };

export function transcriptFile(s: Scratch, sid: string): string | null {
  const projects = join(s.config, 'projects');
  if (!existsSync(projects)) return null;
  for (const dir of readdirSync(projects)) if (existsSync(join(projects, dir, `${sid}.jsonl`))) return join(projects, dir, `${sid}.jsonl`);
  return null;
}

export function transcriptRows(s: Scratch, sid: string): TranscriptRow[] {
  const file = transcriptFile(s, sid);
  if (file === null) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((line) => {
    try {
      return line.trim() === '' ? [] : [JSON.parse(line) as TranscriptRow];
    } catch {
      return []; // a line the engine is still writing
    }
  });
}

const contentOf = (row: TranscriptRow): Record<string, unknown>[] => (Array.isArray(row.message?.content) ? (row.message.content as Record<string, unknown>[]) : []);
const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.flatMap((b: { type?: string; text?: string }) => (b?.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('\n') : '';

/** The sheet tool's calls, in order: the call's id, its input and its result's text (null while it runs). */
export function sheetCalls(rows: TranscriptRow[]): { id: string; input: { ask?: Record<string, unknown>[]; withdraw?: string[] }; result: string | null }[] {
  const results = new Map<string, string>();
  const uses: { id: string; input: Record<string, unknown> }[] = [];
  for (const row of rows) {
    for (const block of contentOf(row)) {
      if (block.type === 'tool_use' && block.name === SHEET_TOOL) uses.push({ id: String(block.id), input: block.input as Record<string, unknown> });
      else if (block.type === 'tool_result') results.set(String(block.tool_use_id), textOf(block.content));
    }
  }
  return uses.map((use) => ({ ...use, result: results.get(use.id) ?? null }));
}

/** One `<sheet-delivery>` block of an envelope (C2's I7): its keys and the ids it answers and dismisses. */
export interface DeliveryBlock { keys: string[]; answered: { id: string; picks: number[]; text: string }[]; dismissed: string[] }
const BLOCK = /^<sheet-delivery>(.*)<\/sheet-delivery>$/;

/** The envelopes the transcript holds, as C2's live check reads them: a hook's added context, or the plugin's prompt. */
export function envelopes(rows: TranscriptRow[]): { index: number; parent: string | null; kind: string; text: string; blocks: DeliveryBlock[] }[] {
  return rows.flatMap((row, index) => {
    const texts: { kind: string; text: string }[] = [];
    if (row.type === 'attachment' && row.attachment?.type === 'hook_additional_context') {
      const content = row.attachment.content;
      for (const text of Array.isArray(content) ? content : [content]) if (typeof text === 'string') texts.push({ kind: row.attachment.hookName ?? 'hook', text });
    } else if (row.type === 'user' && JSON.stringify(row.origin) === JSON.stringify({ kind: 'plugin', name: 'sminos' })) {
      texts.push({ kind: 'plugin', text: textOf(row.message?.content) });
    }
    return texts.map(({ kind, text }) => ({ index, parent: row.parentUuid ?? null, kind, text, blocks: blocksOf(text) }));
  });
}

function blocksOf(text: string): DeliveryBlock[] {
  return text.split('\n').flatMap((line) => {
    const m = BLOCK.exec(line);
    if (!m) return [];
    try {
      const b = JSON.parse(m[1]!) as { keys?: string[]; answered?: { id: string; picks?: number[]; text?: string }[]; dismissed?: string[] };
      return [{ keys: b.keys ?? [], answered: (b.answered ?? []).map((a) => ({ id: a.id, picks: a.picks ?? [], text: a.text ?? '' })), dismissed: b.dismissed ?? [] }];
    } catch {
      return [];
    }
  });
}

/** Each assistant message after row `since`, its text blocks joined (the engine writes one row per content block). */
export function messagesAfter(rows: TranscriptRow[], since: number): string[] {
  const byMessage = new Map<string, string[]>();
  for (const row of rows.slice(since + 1)) {
    if (row.type !== 'assistant') continue;
    const id = String((row.message as { id?: string } | undefined)?.id ?? row.uuid);
    const text = textOf(row.message?.content);
    if (text !== '') byMessage.set(id, [...(byMessage.get(id) ?? []), text]);
  }
  return [...byMessage.values()].map((texts) => texts.join('\n'));
}

/**
 * The session's transcript kept under `dir`, scrubbed (test/support/transcript-scrub.ts): never the raw rows, so the
 * recording can be committed as it is. A name the scrub left in it fails the recording, naming it.
 */
export function recordTranscript(s: Scratch, sid: string, dir: string): void {
  const file = transcriptFile(s, sid);
  if (file === null) return;
  const names: ScrubNames = { project: s.work, scratch: s.root, home: userInfo().homedir, account: userInfo().username, host: hostname() };
  const rows = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Record<string, unknown>);
  const text = scrubTranscript(rows, names).map((row) => JSON.stringify(row)).join('\n') + '\n';
  const left = remainingNames(text, names);
  if (left.length > 0) throw new Error(`the recording still names ${left.length} of the account, the machine or the scratch after its scrub; not kept`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.jsonl'), text);
  if (existsSync(join(dirname(file), sid, 'subagents'))) writeFileSync(join(dir, 'SUBAGENTS'), 'the session ran subagents, whose rows are not recorded\n');
}

/** The scratch root removed, or, with `keep`, left with its env file (the gateway's variables) removed. */
export function removeScratch(root: string, keep: boolean): void {
  rmSync(join(root, 'env'), { force: true });
  if (!keep) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// ---- waiting ----------------------------------------------------------------------------------------------------------
/** `fn`'s first truthy answer, polled every 250 ms for `ms`; a timeout names `what` and, if given, what `context` reads. */
export async function until<T>(what: string, ms: number, fn: () => T | null | undefined | false | Promise<T | null | undefined | false>, context?: () => string): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out after ${ms / 1000} s waiting for ${what}${context ? `\n--- context ---\n${context()}` : ''}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
